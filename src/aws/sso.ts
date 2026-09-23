/**
 * AWS SSO: the cached portal token, the device-authorization login that
 * obtains one, and the role credentials it can be exchanged for.
 *
 * Everything here is scoped to an `SSOSession` (a portal) or an `SSOProfile`
 * (an account/role in one), never to the credentials file — writing what comes
 * back is the caller's job.
 */

import {
  SSOOIDCClient,
  RegisterClientCommand,
  StartDeviceAuthorizationCommand,
  CreateTokenCommand,
} from "@aws-sdk/client-sso-oidc";
import { SSOClient, GetRoleCredentialsCommand } from "@aws-sdk/client-sso";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { CredentialsResult } from "./credentials.js";
import { ssoCacheDir } from "./paths.js";
import { discoverNamedSessions, sessionOf, type SSOProfile, type SSOSession } from "./profiles.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceAuthInfo {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  clientId: string;
  clientSecret: string;
  /** When the client registration itself lapses, if AWS said. */
  registrationExpiresAt?: Date;
  expiresAt: Date;
  interval: number;
}

export interface TokenInfo {
  accessToken: string;
  expiresAt: Date;
  /**
   * What a refreshable login carries on top of the access token, in the AWS
   * CLI's own cache format: with them, an expired access token is renewed
   * without a browser for as long as the portal's session allows.
   */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  registrationExpiresAt?: Date;
}

/**
 * Demo recording mode. When `AWSSESH_DEMO` is set, the interactive SSO network
 * calls are stubbed with canned values so the README demo GIF (scripts/demo/)
 * can show the device-login screen and the silent auto-refresh using mock data,
 * fully offline. Inert for real users — has no effect unless the env var is set.
 *
 * Read per call rather than snapshotted at import time, so it cannot depend on
 * which module happened to load first.
 */
function demoMode(): boolean {
  return !!process.env.AWSSESH_DEMO;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSO Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The AWS CLI keys its token cache by sso-session name when there is one and by
 * start URL otherwise, so awssesh reads and writes exactly the same file and
 * the two tools share a login.
 */
function cacheFileFor(session: SSOSession): string {
  const hash = createHash("sha1").update(session.name ?? session.startUrl).digest("hex");
  return `${ssoCacheDir()}/${hash}.json`;
}

/** A portal, whatever the session naming it: `…/start`, `…/start/` and `…/start#` are one. */
export function portalKey(session: SSOSession): string {
  return `${session.startUrl.replace(/[/#]+$/, "")}|${session.region}`;
}

/**
 * The session plus every other `[sso-session]` naming the same portal.
 *
 * A config commonly gives each profile its own block, all pointing at one start
 * URL. The token is the portal's, not the block's, yet the cache is keyed by
 * block name — so without this each profile wanted its own browser login.
 */
async function portalSessions(session: SSOSession): Promise<SSOSession[]> {
  const siblings = (await discoverNamedSessions()).filter(
    (other) => other.name !== session.name && portalKey(other) === portalKey(session),
  );
  return [session, ...siblings];
}

/** True when a token can be renewed without a browser. */
export function canRefresh(token: TokenInfo, now = new Date()): boolean {
  return (
    !!token.refreshToken &&
    !!token.clientId &&
    !!token.clientSecret &&
    (!token.registrationExpiresAt || token.registrationExpiresAt > now)
  );
}

/**
 * The best of several cached tokens for one portal: a live one first (the
 * longest-lived), then one that can be renewed, then whatever there is — an
 * expired token still says when the last login lapsed. Pure, for testing.
 */
export function pickToken(tokens: (TokenInfo | null)[], now = new Date()): TokenInfo | null {
  const found = tokens.filter((t): t is TokenInfo => t !== null);
  const live = found.filter((t) => t.expiresAt > now).sort((a, b) => +b.expiresAt - +a.expiresAt);
  return live[0] ?? found.find((t) => canRefresh(t, now)) ?? found[0] ?? null;
}

function optionalDate(value: unknown): Date | undefined {
  return typeof value === "string" ? new Date(value) : undefined;
}

async function readCacheFile(session: SSOSession): Promise<TokenInfo | null> {
  try {
    const content = JSON.parse(await readFile(cacheFileFor(session), "utf8"));
    if (!content.accessToken || !content.expiresAt) return null;
    return {
      accessToken: content.accessToken,
      expiresAt: new Date(content.expiresAt),
      refreshToken: content.refreshToken,
      clientId: content.clientId,
      clientSecret: content.clientSecret,
      registrationExpiresAt: optionalDate(content.registrationExpiresAt),
    };
  } catch {
    return null;
  }
}

/** The portal's cached token, from this session's file or any sibling's. */
export async function findCachedToken(session: SSOSession, now = new Date()): Promise<TokenInfo | null> {
  const sessions = await portalSessions(session);
  return pickToken(await Promise.all(sessions.map(readCacheFile)), now);
}

/** Renew an access token with its refresh token. The one network call of the refresh path. */
async function refreshAccessToken(session: SSOSession, token: TokenInfo): Promise<TokenInfo> {
  const client = new SSOOIDCClient({ region: session.region });
  const response = await client.send(
    new CreateTokenCommand({
      clientId: token.clientId,
      clientSecret: token.clientSecret,
      grantType: "refresh_token",
      refreshToken: token.refreshToken,
    }),
  );
  if (!response.accessToken) throw new Error("CreateToken returned no access token");
  return {
    ...token,
    accessToken: response.accessToken,
    expiresAt: new Date(Date.now() + (response.expiresIn || 3600) * 1000),
    refreshToken: response.refreshToken ?? token.refreshToken,
  };
}

/** Renew this early, so a token handed out is not about to lapse mid-call. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Refresh-token errors meaning the portal session is over: only a browser login helps. */
const SESSION_OVER_ERRORS = new Set([
  "InvalidGrantException",
  "ExpiredTokenException",
  "UnauthorizedClientException",
  "InvalidClientException",
  "AccessDeniedException",
]);

/**
 * The portal's token, renewed first when it is close to expiry and can be.
 *
 * A renewal that AWS refuses outright drops the refresh token from the cache,
 * so the profile reads as needing a login instead of promising a renewal that
 * cannot happen. A renewal that merely fails (network) changes nothing.
 */
export async function findValidToken(
  session: SSOSession,
  now = new Date(),
  refresh: (session: SSOSession, token: TokenInfo) => Promise<TokenInfo> = refreshAccessToken,
): Promise<TokenInfo | null> {
  const token = await findCachedToken(session, now);
  if (!token) return null;
  const live = token.expiresAt > now ? token : null;
  if (token.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS || !canRefresh(token, now) || demoMode()) {
    // Borrowed from a sibling: copy it to this session's own file, which is
    // the only one the AWS CLI reads — it consults the SSO cache before the
    // credentials file, so a stale token there breaks `aws` for the profile.
    if (live && (await readCacheFile(session))?.accessToken !== live.accessToken) {
      await saveSSOTokenToCache(session, live);
    }
    return live;
  }

  try {
    const renewed = await refresh(session, token);
    await saveSSOTokenToCache(session, renewed);
    return renewed;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (SESSION_OVER_ERRORS.has(name)) {
      await saveSSOTokenToCache(session, { accessToken: token.accessToken, expiresAt: token.expiresAt });
    }
    return live;
  }
}

/**
 * Cache a token for the session and every sibling naming the same portal, so
 * one login serves them all — and so does the AWS CLI reading those files.
 */
export async function saveSSOTokenToCache(session: SSOSession, tokenInfo: TokenInfo): Promise<void> {
  try {
    await mkdir(ssoCacheDir(), { recursive: true });
    for (const target of await portalSessions(session)) {
      const cacheData = {
        startUrl: target.startUrl,
        region: target.region,
        accessToken: tokenInfo.accessToken,
        expiresAt: tokenInfo.expiresAt.toISOString(),
        ...(tokenInfo.refreshToken && {
          clientId: tokenInfo.clientId,
          clientSecret: tokenInfo.clientSecret,
          registrationExpiresAt: tokenInfo.registrationExpiresAt?.toISOString(),
          refreshToken: tokenInfo.refreshToken,
        }),
      };
      const file = cacheFileFor(target);
      await writeFile(file, JSON.stringify(cacheData, null, 2), { mode: 0o600 });
      await chmod(file, 0o600);
    }
  } catch {
    // Silently fail — the token still works for this run, it just is not cached.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSO OIDC Device Authorization Flow
// ─────────────────────────────────────────────────────────────────────────────

export async function startDeviceAuthorization(session: SSOSession): Promise<DeviceAuthInfo | null> {
  if (demoMode()) {
    // Mirror the shape AWS actually returns for `verificationUriComplete` —
    // a long portal URL with the code embedded — so the demo exercises the
    // same wrapping the real login screen has to survive.
    return {
      verificationUri: `${session.startUrl.replace(/\/$/, "")}/#/device?user_code=BRWS-DEMO`,
      userCode: "BRWS-DEMO",
      deviceCode: "demo-device-code",
      clientId: "demo-client",
      clientSecret: "demo-secret",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      interval: 5,
    };
  }
  try {
    const client = new SSOOIDCClient({ region: session.region });

    // Registering with scopes is what makes AWS hand back a refresh token, as
    // the AWS CLI does for an [sso-session]. A bare start URL (the legacy
    // inline form) keeps the legacy, non-refreshable login.
    const scopes = session.name ? (session.scopes ?? ["sso:account:access"]) : undefined;
    const registerResponse = await client.send(
      new RegisterClientCommand({ clientName: "awssesh", clientType: "public", scopes })
    );

    if (!registerResponse.clientId || !registerResponse.clientSecret) {
      return null;
    }

    const authResponse = await client.send(
      new StartDeviceAuthorizationCommand({
        clientId: registerResponse.clientId,
        clientSecret: registerResponse.clientSecret,
        startUrl: session.startUrl,
      })
    );

    if (!authResponse.verificationUriComplete || !authResponse.deviceCode || !authResponse.userCode) {
      return null;
    }

    return {
      verificationUri: authResponse.verificationUriComplete,
      userCode: authResponse.userCode,
      deviceCode: authResponse.deviceCode,
      clientId: registerResponse.clientId,
      clientSecret: registerResponse.clientSecret,
      registrationExpiresAt: registerResponse.clientSecretExpiresAt
        ? new Date(registerResponse.clientSecretExpiresAt * 1000)
        : undefined,
      expiresAt: new Date(Date.now() + (authResponse.expiresIn || 600) * 1000),
      interval: authResponse.interval || 5,
    };
  } catch {
    return null;
  }
}

export async function pollForToken(
  session: SSOSession,
  deviceAuth: DeviceAuthInfo
): Promise<TokenInfo | null> {
  if (demoMode()) {
    // Stay pending: the recording shows the URL/code screen, then Esc cancels.
    return new Promise<TokenInfo | null>(() => {
      /* never resolves in demo mode */
    });
  }
  const client = new SSOOIDCClient({ region: session.region });
  const startTime = Date.now();
  const maxWaitMs = deviceAuth.expiresAt.getTime() - Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const tokenResponse = await client.send(
        new CreateTokenCommand({
          clientId: deviceAuth.clientId,
          clientSecret: deviceAuth.clientSecret,
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
          deviceCode: deviceAuth.deviceCode,
        })
      );

      if (tokenResponse.accessToken) {
        const expiresAt = new Date(Date.now() + (tokenResponse.expiresIn || 28800) * 1000);
        return {
          accessToken: tokenResponse.accessToken,
          expiresAt,
          ...(tokenResponse.refreshToken && {
            refreshToken: tokenResponse.refreshToken,
            clientId: deviceAuth.clientId,
            clientSecret: deviceAuth.clientSecret,
            registrationExpiresAt: deviceAuth.registrationExpiresAt,
          }),
        };
      }
    } catch (error) {
      const errName = error instanceof Error ? error.name : "";
      if (errName === "AuthorizationPendingException") {
        await new Promise((resolve) => setTimeout(resolve, deviceAuth.interval * 1000));
        continue;
      }
      if (errName === "SlowDownException") {
        await new Promise((resolve) => setTimeout(resolve, (deviceAuth.interval + 5) * 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Wait for the user to approve the device code, then cache the token.
 *
 * A login yields a portal token and nothing else: fetching credentials for any
 * particular profile is a separate step, so the same flow serves both "this
 * profile needs a login" and "let me browse the accounts in this portal".
 */
export async function loginToSession(
  session: SSOSession,
  deviceAuth: DeviceAuthInfo
): Promise<{ success: boolean; error?: string }> {
  const tokenInfo = await pollForToken(session, deviceAuth);
  if (!tokenInfo) return { success: false, error: "Authorization failed or timed out" };
  await saveSSOTokenToCache(session, tokenInfo);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Role credentials
// ─────────────────────────────────────────────────────────────────────────────

/** AWS SSO error names that genuinely mean "your cached token is no longer good". */
const TOKEN_ERRORS = new Set(["UnauthorizedException", "ExpiredTokenException", "AccessDeniedException"]);
/** Errors about the role/account, not the token — logging in again changes nothing. */
const ACCESS_ERRORS = new Set(["ForbiddenException", "ResourceNotFoundException"]);

/** Classify a GetRoleCredentials failure. Pure, so the routing is unit-testable. */
export function classifyCredentialsError(error: unknown, profile: SSOProfile): CredentialsResult {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (TOKEN_ERRORS.has(name)) return { failure: "expired-token", error: message };
  if (ACCESS_ERRORS.has(name)) {
    return {
      failure: "denied",
      error: `no access to ${profile.ssoRoleName} in ${profile.ssoAccountId}`,
    };
  }
  return { failure: "unavailable", error: message || "could not reach AWS SSO" };
}

export async function getCredentialsWithToken(
  profile: SSOProfile,
  accessToken: string
): Promise<CredentialsResult> {
  try {
    const client = new SSOClient({ region: profile.ssoRegion });
    const response = await client.send(
      new GetRoleCredentialsCommand({
        accountId: profile.ssoAccountId,
        roleName: profile.ssoRoleName,
        accessToken,
      })
    );

    const role = response.roleCredentials;
    if (!role?.accessKeyId || !role.secretAccessKey) {
      return { failure: "unavailable", error: "AWS returned no role credentials" };
    }

    return {
      credentials: {
        accessKeyId: role.accessKeyId,
        secretAccessKey: role.secretAccessKey,
        sessionToken: role.sessionToken,
        expiration: role.expiration ? new Date(role.expiration) : undefined,
      },
    };
  } catch (error) {
    return classifyCredentialsError(error, profile);
  }
}

/**
 * Fetch fresh role credentials for an SSO profile using its cached portal token.
 * Returns `expired-token` when a browser login is the only way forward.
 */
export async function fetchSSOCredentials(profile: SSOProfile): Promise<CredentialsResult> {
  const token = await findValidToken(sessionOf(profile));
  if (!token) return { failure: "expired-token", error: "SSO login required" };

  if (demoMode()) {
    // Pretend the silent refresh succeeded so the auto-refresh tick stays
    // offline and the ⟳ favorites keep their valid state during recording.
    return {
      credentials: {
        accessKeyId: "ASIADEMO",
        secretAccessKey: "demo",
        sessionToken: "demo",
        expiration: new Date(Date.now() + 50 * 60 * 1000),
      },
    };
  }

  return getCredentialsWithToken(profile, token.accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop integration
// ─────────────────────────────────────────────────────────────────────────────

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore" }).on("error", () => {});
}

export async function sendNotification(title: string, message: string): Promise<void> {
  const os = process.platform;
  try {
    if (os === "darwin") {
      // Both values are interpolated into an AppleScript string literal, so
      // backslashes and quotes must be escaped or a profile name containing
      // either would break (or inject into) the script.
      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      spawn("osascript", [
        "-e",
        `display notification "${esc(message)}" with title "${esc(title)}"`,
      ], { stdio: "ignore" }).on("error", () => {});
    } else if (os === "linux") {
      spawn("notify-send", [title, message], { stdio: "ignore" }).on("error", () => {});
    }
  } catch {
    // Silently fail
  }
}

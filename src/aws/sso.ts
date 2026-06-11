/**
 * SSOmatic - Core business logic (UI-agnostic)
 * Used by the CLI (Ink) interface
 */

import {
  SSOOIDCClient,
  RegisterClientCommand,
  StartDeviceAuthorizationCommand,
  CreateTokenCommand,
} from "@aws-sdk/client-sso-oidc";
import { SSOClient, GetRoleCredentialsCommand } from "@aws-sdk/client-sso";
import { parse as parseIni, stringify as stringifyIni } from "ini";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SSOProfile {
  name: string;
  ssoStartUrl: string;
  ssoAccountId: string;
  ssoRoleName: string;
  ssoRegion: string;
  region?: string;
  ssoSession?: string;
}

export type CredentialStatus = "valid" | "expired" | "error" | "unknown";

export interface ProfileStatus {
  profile: SSOProfile;
  status: CredentialStatus;
  expiresAt?: Date;
}

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export interface DeviceAuthInfo {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  clientId: string;
  clientSecret: string;
  expiresAt: Date;
  interval: number;
}

export interface TokenInfo {
  accessToken: string;
  expiresAt: Date;
}

interface ConfigSection {
  [key: string]: string | undefined;
}

interface ParsedConfig {
  [section: string]: ConfigSection;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const HOME = process.env.HOME || process.env.USERPROFILE || "";
export const AWS_DIR = `${HOME}/.aws`;
export const CONFIG_PATH = `${AWS_DIR}/config`;
export const CREDENTIALS_PATH = `${AWS_DIR}/credentials`;
export const SSO_CACHE_DIR = `${AWS_DIR}/sso/cache`;

// ─────────────────────────────────────────────────────────────────────────────
// File Utilities
// ─────────────────────────────────────────────────────────────────────────────

export async function parseIniFile(path: string): Promise<ParsedConfig> {
  try {
    const content = await readFile(path, "utf8");
    return parseIni(content);
  } catch {
    return {};
  }
}

export async function writeCredentials(profileName: string, credentials: AWSCredentials): Promise<void> {
  const existing = await parseIniFile(CREDENTIALS_PATH);

  existing[profileName] = {
    aws_access_key_id: credentials.accessKeyId,
    aws_secret_access_key: credentials.secretAccessKey,
    ...(credentials.sessionToken && { aws_session_token: credentials.sessionToken }),
  };

  await mkdir(AWS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_PATH, stringifyIni(existing));
}

// ─────────────────────────────────────────────────────────────────────────────
// SSO Cache
// ─────────────────────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: Date;
}

export async function findCachedToken(profile: SSOProfile): Promise<CachedToken | null> {
  try {
    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;

    const content = JSON.parse(await readFile(cacheFile, "utf8"));
    if (content.accessToken && content.expiresAt) {
      return {
        accessToken: content.accessToken,
        expiresAt: new Date(content.expiresAt),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function discoverProfiles(): Promise<SSOProfile[]> {
  const config = await parseIniFile(CONFIG_PATH);
  const profiles: SSOProfile[] = [];
  const ssoSessions: Map<string, ConfigSection> = new Map();

  for (const [section, values] of Object.entries(config)) {
    if (section.startsWith("sso-session ")) {
      ssoSessions.set(section.replace("sso-session ", ""), values);
    }
  }

  for (const [section, values] of Object.entries(config)) {
    if (!section.startsWith("profile ") && section !== "default") continue;

    const profileName = section === "default" ? "default" : section.replace("profile ", "");

    if (values.sso_session) {
      const session = ssoSessions.get(values.sso_session);
      if (session && values.sso_account_id && values.sso_role_name) {
        profiles.push({
          name: profileName,
          ssoStartUrl: session.sso_start_url || "",
          ssoAccountId: values.sso_account_id,
          ssoRoleName: values.sso_role_name,
          ssoRegion: session.sso_region || "us-east-1",
          region: values.region,
          ssoSession: values.sso_session,
        });
      }
    } else if (values.sso_start_url && values.sso_account_id && values.sso_role_name) {
      profiles.push({
        name: profileName,
        ssoStartUrl: values.sso_start_url,
        ssoAccountId: values.sso_account_id,
        ssoRoleName: values.sso_role_name,
        ssoRegion: values.sso_region || "us-east-1",
        region: values.region,
      });
    }
  }

  return profiles;
}

export async function checkTokenStatus(profile: SSOProfile): Promise<ProfileStatus> {
  const cachedToken = await findCachedToken(profile);

  if (!cachedToken || cachedToken.expiresAt <= new Date()) {
    return { profile, status: "expired" };
  }

  return { profile, status: "valid", expiresAt: cachedToken.expiresAt };
}

export async function checkAllProfiles(profiles: SSOProfile[]): Promise<ProfileStatus[]> {
  return Promise.all(profiles.map((profile) => checkTokenStatus(profile)));
}

// ─────────────────────────────────────────────────────────────────────────────
// SSO OIDC Device Authorization Flow
// ─────────────────────────────────────────────────────────────────────────────

export async function startDeviceAuthorization(profile: SSOProfile): Promise<DeviceAuthInfo | null> {
  try {
    const client = new SSOOIDCClient({ region: profile.ssoRegion });

    const registerResponse = await client.send(
      new RegisterClientCommand({
        clientName: "ssomatic",
        clientType: "public",
      })
    );

    if (!registerResponse.clientId || !registerResponse.clientSecret) {
      return null;
    }

    const authResponse = await client.send(
      new StartDeviceAuthorizationCommand({
        clientId: registerResponse.clientId,
        clientSecret: registerResponse.clientSecret,
        startUrl: profile.ssoStartUrl,
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
      expiresAt: new Date(Date.now() + (authResponse.expiresIn || 600) * 1000),
      interval: authResponse.interval || 5,
    };
  } catch {
    return null;
  }
}

export async function saveSSOTokenToCache(profile: SSOProfile, tokenInfo: TokenInfo): Promise<void> {
  try {
    await mkdir(SSO_CACHE_DIR, { recursive: true });

    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;

    const cacheData = {
      startUrl: profile.ssoStartUrl,
      region: profile.ssoRegion,
      accessToken: tokenInfo.accessToken,
      expiresAt: tokenInfo.expiresAt.toISOString(),
    };

    await writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
    await chmod(cacheFile, 0o600);
  } catch {
    // Silently fail - credentials will still work via credentials file
  }
}

export async function pollForToken(
  profile: SSOProfile,
  deviceAuth: DeviceAuthInfo
): Promise<TokenInfo | null> {
  const client = new SSOOIDCClient({ region: profile.ssoRegion });
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
        return { accessToken: tokenResponse.accessToken, expiresAt };
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
      if (errName === "ExpiredTokenException" || errName === "AccessDeniedException") {
        return null;
      }
      return null;
    }
  }
  return null;
}

export async function getCredentialsWithToken(
  profile: SSOProfile,
  accessToken: string
): Promise<AWSCredentials | null> {
  try {
    const client = new SSOClient({ region: profile.ssoRegion });
    const response = await client.send(
      new GetRoleCredentialsCommand({
        accountId: profile.ssoAccountId,
        roleName: profile.ssoRoleName,
        accessToken,
      })
    );

    if (!response.roleCredentials) {
      return null;
    }

    return {
      accessKeyId: response.roleCredentials.accessKeyId!,
      secretAccessKey: response.roleCredentials.secretAccessKey!,
      sessionToken: response.roleCredentials.sessionToken,
      expiration: response.roleCredentials.expiration
        ? new Date(response.roleCredentials.expiration)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore" }).on("error", () => {});
}

export async function performSSOLoginFlow(
  profile: SSOProfile,
  deviceAuth: DeviceAuthInfo
): Promise<{ success: boolean; error?: string }> {
  const tokenInfo = await pollForToken(profile, deviceAuth);
  if (!tokenInfo) {
    return { success: false, error: "Authorization failed or timed out" };
  }

  await saveSSOTokenToCache(profile, tokenInfo);

  const creds = await getCredentialsWithToken(profile, tokenInfo.accessToken);
  if (!creds) {
    return { success: false, error: "Failed to get credentials" };
  }
  await writeCredentials(profile.name, creds);
  return { success: true };
}

export async function refreshProfile(
  profile: SSOProfile
): Promise<{ success: boolean; error?: string; needsLogin?: boolean; expiresAt?: Date }> {
  const cachedToken = await findCachedToken(profile);
  if (!cachedToken || cachedToken.expiresAt <= new Date()) {
    return { success: false, needsLogin: true };
  }

  const credentials = await getCredentialsWithToken(profile, cachedToken.accessToken);
  if (!credentials) {
    return { success: false, needsLogin: true };
  }

  await writeCredentials(profile.name, credentials);
  return { success: true, expiresAt: credentials.expiration };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export async function sendNotification(title: string, message: string): Promise<void> {
  const os = process.platform;
  try {
    if (os === "darwin") {
      spawn("osascript", [
        "-e",
        `display notification "${message}" with title "${title}"`,
      ], { stdio: "ignore" }).on("error", () => {});
    } else if (os === "linux") {
      spawn("notify-send", [title, message], { stdio: "ignore" }).on("error", () => {});
    }
  } catch {
    // Silently fail
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

export function formatExpiry(date?: Date): string {
  if (!date) return "Unknown";

  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return "Expired";

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function getStatusColor(status: CredentialStatus): string {
  const colors: Record<CredentialStatus, string> = {
    valid: "green",
    expired: "red",
    error: "yellow",
    unknown: "gray",
  };
  return colors[status];
}

export function sortByFavorites<T>(items: T[], favorites: string[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const aFav = favorites.includes(getName(a));
    const bFav = favorites.includes(getName(b));
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return getName(a).localeCompare(getName(b));
  });
}

/**
 * One way in for "give me usable credentials for this profile", whatever kind
 * of profile it is.
 *
 * SSO profiles fetch role credentials with the cached portal token; chained
 * profiles resolve their `source_profile` first — recursively, and reusing
 * still-valid credentials rather than re-fetching them — and then call
 * `sts:AssumeRole`. Callers branch on one outcome type instead of knowing which
 * provider a profile happens to use.
 */

import { assumeRole } from "./assumeRole.js";
import {
  credentialsAreFresh,
  type AWSCredentials,
  type CredentialsResult,
  type StoredCredentials,
} from "./credentials.js";
import { readProfileCredentials, writeCredentials } from "./credentialsFile.js";
import {
  discoverProfiles,
  profileRegion,
  type AssumeProfile,
  type Profile,
  type SSOProfile,
} from "./profiles.js";
import { fetchSSOCredentials } from "./sso.js";

/** See sso.ts — in demo mode the credentials are canned, so nothing may be written. */
function demoMode(): boolean {
  return !!process.env.AWSSESH_DEMO;
}

const DEFAULT_STS_REGION = "us-east-1";

export type CredentialsOutcome =
  | { ok: true; credentials: StoredCredentials }
  /** A browser login is due — for `profile`, which may be further up the chain. */
  | { ok: false; reason: "needs-login"; profile: SSOProfile }
  /** An MFA code is needed for `profile`, which may be further up the chain. */
  | { ok: false; reason: "needs-mfa"; profile: AssumeProfile }
  | { ok: false; reason: "error"; error: string };

/**
 * Where credentials actually come from. The two providers are the only part of
 * a refresh that talks to AWS, so naming them here lets everything the
 * dispatcher does around them — caching, chaining, attributing failures — be
 * exercised without a network.
 */
export interface CredentialProviders {
  fetchSSO: (profile: SSOProfile) => Promise<CredentialsResult>;
  assume: (
    profile: AssumeProfile,
    source: StoredCredentials,
    region: string,
    mfaCode?: string,
  ) => Promise<CredentialsResult>;
}

const AWS_PROVIDERS: CredentialProviders = { fetchSSO: fetchSSOCredentials, assume: assumeRole };

export interface CredentialsOptions {
  /** The known profiles, so a chain can be resolved without re-reading config. */
  profiles?: Profile[];
  /**
   * MFA codes by profile name. Keyed rather than a single code because a chain
   * can cross two MFA-gated roles, and a TOTP is single-use: replaying one
   * profile's code at the next hop is rejected, with an error that reads like a
   * permissions problem.
   */
  mfaCodes?: Record<string, string>;
  /** How much life credentials must have left to count as usable. */
  leadMs?: number;
  providers?: CredentialProviders;
}

interface Context {
  profiles: Profile[];
  mfaCodes: Record<string, string>;
  leadMs: number;
  providers: CredentialProviders;
  /** Profiles already being resolved, so a `source_profile` loop cannot recurse forever. */
  visiting: Set<string>;
}

function stored(credentials: AWSCredentials): StoredCredentials {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    expiresAt: credentials.expiration ?? null,
  };
}

async function context(opts: CredentialsOptions): Promise<Context> {
  return {
    profiles: opts.profiles ?? (await discoverProfiles()),
    mfaCodes: opts.mfaCodes ?? {},
    leadMs: opts.leadMs ?? 60_000,
    providers: opts.providers ?? AWS_PROVIDERS,
    visiting: new Set(),
  };
}

/** Turn a provider result into an outcome, attributing failures to `profile`. */
function outcomeOf(result: CredentialsResult, profile: Profile): CredentialsOutcome {
  if (result.credentials) return { ok: true, credentials: stored(result.credentials) };
  if (result.failure === "expired-token" && profile.kind === "sso") {
    return { ok: false, reason: "needs-login", profile };
  }
  if (result.failure === "mfa-required" && profile.kind === "assume") {
    return { ok: false, reason: "needs-mfa", profile };
  }
  return { ok: false, reason: "error", error: result.error ?? "could not fetch credentials" };
}

/** The region the STS call should be signed for. */
function stsRegion(profile: AssumeProfile, source: Profile | undefined): string {
  return profileRegion(profile) ?? (source && profileRegion(source)) ?? DEFAULT_STS_REGION;
}

/**
 * Credentials to sign a chained profile's AssumeRole call with: another managed
 * profile (resolved the same way, so chains of any depth work), or a plain
 * `[source]` section of ~/.aws/credentials holding long-lived IAM keys.
 */
async function sourceCredentials(
  profile: AssumeProfile,
  ctx: Context,
): Promise<CredentialsOutcome> {
  const managed = ctx.profiles.find((p) => p.name === profile.sourceProfile);
  if (managed) return ensure(managed, ctx);

  const keys = readProfileCredentials(profile.sourceProfile);
  if (!keys) {
    return {
      ok: false,
      reason: "error",
      error: `source_profile '${profile.sourceProfile}' has no credentials in ~/.aws/config or ~/.aws/credentials`,
    };
  }
  return { ok: true, credentials: keys };
}

/** Fetch new credentials for one profile and cache them in ~/.aws/credentials. */
async function fetch(profile: Profile, ctx: Context): Promise<CredentialsOutcome> {
  if (ctx.visiting.has(profile.name)) {
    return { ok: false, reason: "error", error: `source_profile chain loops at '${profile.name}'` };
  }
  ctx.visiting.add(profile.name);
  try {
    let result: CredentialsResult;

    if (profile.kind === "sso") {
      result = await ctx.providers.fetchSSO(profile);
    } else {
      // Asking STS without the code just returns AccessDenied, so check here
      // and let the caller prompt for one.
      const mfaCode = ctx.mfaCodes[profile.name];
      if (profile.mfaSerial && !mfaCode) return { ok: false, reason: "needs-mfa", profile };

      const source = await sourceCredentials(profile, ctx);
      if (!source.ok) return source;

      const sourceProfile = ctx.profiles.find((p) => p.name === profile.sourceProfile);
      result = await ctx.providers.assume(
        profile,
        source.credentials,
        stsRegion(profile, sourceProfile),
        mfaCode,
      );
    }

    if (result.credentials && !demoMode()) await writeCredentials(profile.name, result.credentials);
    return outcomeOf(result, profile);
  } finally {
    ctx.visiting.delete(profile.name);
  }
}

async function ensure(profile: Profile, ctx: Context): Promise<CredentialsOutcome> {
  const cached = readProfileCredentials(profile.name);
  if (credentialsAreFresh(cached, ctx.leadMs)) return { ok: true, credentials: cached! };
  return fetch(profile, ctx);
}

/** Fetch new credentials for a profile, whatever it takes, and cache them. */
export async function refreshProfile(
  profile: Profile,
  opts: CredentialsOptions = {},
): Promise<CredentialsOutcome> {
  return fetch(profile, await context(opts));
}

/**
 * Credentials that are actually usable, refreshing only when the cached ones
 * are missing, expired or about to expire.
 *
 * Checking merely for *presence* meant handing out an hour-old, already-dead
 * session token and reporting success — an SSO profile still shows "valid"
 * because that reflects the portal token, which outlives the role credentials
 * several times over.
 */
export async function ensureCredentials(
  profile: Profile,
  opts: CredentialsOptions = {},
): Promise<CredentialsOutcome> {
  return ensure(profile, await context(opts));
}

/** A one-line explanation of an outcome, for the CLI and the status line. */
export function describeOutcome(outcome: CredentialsOutcome): string {
  if (outcome.ok) return "ok";
  if (outcome.reason === "needs-login") return `SSO login required for ${outcome.profile.name}`;
  if (outcome.reason === "needs-mfa") return `MFA code required for ${outcome.profile.name}`;
  return outcome.error;
}

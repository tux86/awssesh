import { credentialsAreFresh } from "./credentials.js";
import { readProfileCredentials } from "./credentialsFile.js";
import {
  discoverProfiles,
  profileAccountId,
  sessionOf,
  type Profile,
  type SSOProfile,
} from "./profiles.js";
import { loadSettings } from "./settings.js";
import { findCachedToken } from "./sso.js";

export type ProfileStatusKind = "valid" | "expired" | "needs-login" | "needs-mfa" | "error" | "refreshing";

export interface ProfileState {
  name: string;
  kind: Profile["kind"];
  status: ProfileStatusKind;
  /**
   * When the stored credentials expire. ISO string, or null when there are none.
   *
   * Strictly the credentials' own clock. It used to fall back to the SSO
   * token's, which put a row in the impossible position of reading
   * "valid · expired": the status came from the login, the countdown from the
   * credentials, and nothing said so.
   */
  expiresAt: string | null;
  /** SSO token expiry — when the next interactive browser login is due. */
  ssoExpiresAt: string | null;
  favorite: boolean;
  accountId?: string;
  error?: string;
}

/** Guards against a `source_profile` cycle that config alone cannot rule out. */
const MAX_CHAIN_DEPTH = 8;

/**
 * The SSO profile a chain ultimately logs in through, if it has one.
 *
 * A chain rooted in long-lived IAM keys instead returns null: nothing about it
 * expires interactively, so it must never be reported as needing a login.
 */
export function rootSSOProfile(profile: Profile, all: Profile[]): SSOProfile | null {
  let current: Profile | undefined = profile;
  for (let depth = 0; current && depth < MAX_CHAIN_DEPTH; depth++) {
    if (current.kind === "sso") return current;
    const sourceName: string = current.sourceProfile;
    current = all.find((p) => p.name === sourceName);
  }
  return null;
}

/**
 * Derive one profile's state from what is on disk.
 *
 * Single source of truth for both the initial load and the auto-refresh tick.
 * They used to compute `expiresAt` differently — the tick from an in-memory map
 * of role-credential expiries, the reload from the SSO token — so every refresh
 * made the countdown jump from "58m" up to the token's "7h 58m" until the next
 * tick corrected it.
 */
export async function buildProfileState(
  profile: Profile,
  all: Profile[],
  favorite: boolean,
  now: Date,
): Promise<ProfileState> {
  const root = rootSSOProfile(profile, all);
  const cachedToken = root ? await findCachedToken(sessionOf(root)) : null;
  const ssoValid = root === null || (cachedToken !== null && cachedToken.expiresAt > now);
  const creds = readProfileCredentials(profile.name);
  const ssoExpiresAt = cachedToken ? cachedToken.expiresAt.toISOString() : null;

  return {
    name: profile.name,
    kind: profile.kind,
    status: status(profile, ssoValid, creds ? credentialsAreFresh(creds, 0, now.getTime()) : false),
    expiresAt: creds?.expiresAt?.toISOString() ?? null,
    ssoExpiresAt,
    favorite,
    accountId: profileAccountId(profile),
  };
}

/**
 * What the profile needs before it can be used, most blocking first.
 *
 * `valid` means the credentials on disk work right now — not merely that the
 * login behind them does. `expired` is the ordinary resting state of a profile
 * nobody has pinned: the login is fine, the hour-long credentials are not, and
 * `r` (or ⟳) is all it takes.
 */
function status(profile: Profile, ssoValid: boolean, credsFresh: boolean): ProfileStatusKind {
  if (!ssoValid) return "needs-login";
  // An MFA-gated profile cannot be refreshed silently, so say so up front
  // rather than looking healthy until the user asks for credentials.
  if (profile.kind === "assume" && profile.mfaSerial && !credsFresh) return "needs-mfa";
  return credsFresh ? "valid" : "expired";
}

/**
 * Build the list of profile states from local disk (config, SSO token cache and
 * the credentials file). Shared by the CLI `status` command and the TUI root so
 * there is a single source of truth for the locally-derived view.
 */
export async function buildLocalProfileStates(): Promise<ProfileState[]> {
  const favorites = new Set(loadSettings().favoriteProfiles);
  const now = new Date();
  const profiles = await discoverProfiles();
  return Promise.all(profiles.map((p) => buildProfileState(p, profiles, favorites.has(p.name), now)));
}

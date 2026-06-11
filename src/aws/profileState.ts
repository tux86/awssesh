import { discoverProfiles, findCachedToken } from "./sso.js";
import { loadSettings } from "./settings.js";

export type ProfileStatusKind = "valid" | "expired" | "needs-login" | "error" | "refreshing";

export interface ProfileState {
  name: string;
  status: ProfileStatusKind;
  expiresAt: string | null; // ISO string or null
  favorite: boolean;
  accountId?: string;
  error?: string;
}

/**
 * Build the list of profile states from local disk (config + SSO token cache).
 * Shared by the CLI `status` command and the TUI root so there is a single
 * source of truth for the "no daemon" fallback view.
 */
export async function buildLocalProfileStates(): Promise<ProfileState[]> {
  const favorites = new Set(loadSettings().favoriteProfiles);
  const now = new Date();
  const profiles = await discoverProfiles();
  const states: ProfileState[] = [];
  for (const p of profiles) {
    const cached = await findCachedToken(p);
    const ssoValid = cached !== null && cached.expiresAt > now;
    const expiresAt = cached ? cached.expiresAt.toISOString() : null;
    states.push({
      name: p.name,
      status: ssoValid ? "valid" : "needs-login",
      expiresAt,
      favorite: favorites.has(p.name),
      accountId: p.ssoAccountId,
    });
  }
  return states;
}

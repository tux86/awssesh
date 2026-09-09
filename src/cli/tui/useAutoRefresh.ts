import { useCallback, useEffect, useRef, useState } from "react";
import { readProfileCredentials } from "../../aws/credentialsFile.js";
import { buildProfileState, type ProfileState } from "../../aws/profileState.js";
import { discoverProfiles, type Profile } from "../../aws/profiles.js";
import { refreshProfile, type CredentialsOutcome } from "../../aws/refresh.js";
import { decideAction } from "../../aws/refreshScheduler.js";
import { saveSettings, type AppSettings } from "../../aws/settings.js";

/** How often the in-process loop checks favorites for due refreshes. */
const TICK_MS = 30_000;

export interface AutoRefreshView {
  profiles: ProfileState[];
  /** False until the first pass over ~/.aws/config has finished. */
  ready: boolean;
  /** The profiles as configured, for the screens that need more than their state. */
  configured: Profile[];
  reload: () => Promise<void>;
  refreshOne: (name: string, mfaCodes?: Record<string, string>) => Promise<CredentialsOutcome>;
  /** Toggle ⟳ for a profile, persist it, and return the resulting settings. */
  setFavorite: (name: string) => AppSettings;
}

/**
 * In-process auto-refresh for the TUI. While the dashboard is open it keeps the
 * ⟳ (favorite) profiles fresh: every tick it decides, per favorite, whether the
 * cached credentials are due for a silent refresh and performs it,
 * expiry-aware — entirely in-process, no background process or sockets.
 *
 * Both the periodic tick and the on-demand reload derive their view from disk
 * (SSO token cache + the credentials file), so they can never disagree about
 * when something expires.
 */
export function useAutoRefresh(
  settings: AppSettings,
  onNeedsLogin?: (name: string) => void,
): AutoRefreshView {
  const [profiles, setProfiles] = useState<ProfileState[]>([]);
  const [configured, setConfigured] = useState<Profile[]>([]);
  const [ready, setReady] = useState(false);
  const notified = useRef(new Set<string>());
  /**
   * Which pass is the current one. A tick refreshes profiles over the network
   * and can outlive a later reload — toggling ⟳ during a slow tick used to see
   * the marker flip back, because the tick finished last with flags it had
   * snapshotted before the toggle.
   */
  const generation = useRef(0);

  // Keep the latest settings + callback in refs so the interval closure always
  // reads current values without resubscribing the timer.
  const settingsRef = useRef(settings);
  const onNeedsLoginRef = useRef(onNeedsLogin);
  useEffect(() => {
    settingsRef.current = settings;
    onNeedsLoginRef.current = onNeedsLogin;
  }, [settings, onNeedsLogin]);

  const notifyOnce = useCallback((name: string) => {
    if (notified.current.has(name)) return;
    notified.current.add(name);
    onNeedsLoginRef.current?.(name);
  }, []);

  /** Recompute every profile from disk, refreshing the favorites that are due. */
  const sync = useCallback(
    async ({ refreshDue }: { refreshDue: boolean }) => {
      const pass = ++generation.current;
      const s = settingsRef.current;
      const leadMs = s.refreshLeadMinutes * 60 * 1000;
      const favorites = new Set(s.favoriteProfiles);
      const now = new Date();
      const discovered = await discoverProfiles();
      const states: ProfileState[] = [];

      for (const p of discovered) {
        const favorite = favorites.has(p.name);
        let state = await buildProfileState(p, discovered, favorite, now);

        // Only ⟳ profiles are touched, and only when they are actually due.
        // A profile waiting on a login or an MFA code cannot be refreshed
        // silently, so it is left alone until the user acts on it.
        if (refreshDue && favorite && state.status === "needs-login") notifyOnce(p.name);
        // "expired" is the state a due profile is usually in — refreshing only
        // the ones already reported as valid would mean never refreshing.
        if (refreshDue && favorite && (state.status === "valid" || state.status === "expired")) {
          const credsExpireAt = readProfileCredentials(p.name)?.expiresAt ?? null;
          if (decideAction(credsExpireAt, now, leadMs) === "refresh") {
            const outcome = await refreshProfile(p, { profiles: discovered });
            if (outcome.ok) notified.current.delete(p.name);
            else if (outcome.reason === "needs-login") notifyOnce(outcome.profile.name);

            // Read back after the refresh, so the state reflects what is on disk.
            state = await buildProfileState(p, discovered, favorite, new Date());
            if (!outcome.ok && outcome.reason === "error") {
              state = { ...state, status: "error", error: outcome.error };
            }
          }
        }

        states.push(state);
      }

      if (generation.current !== pass) return; // superseded while we were away
      setProfiles(states);
      setConfigured(discovered);
      setReady(true);
    },
    [notifyOnce],
  );

  const reload = useCallback(() => sync({ refreshDue: false }), [sync]);

  // Seed from disk on mount.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Run the auto-refresh loop while mounted. The callback never throws
  // unhandled; any failure is swallowed so the timer survives.
  useEffect(() => {
    const id = setInterval(() => {
      void sync({ refreshDue: true }).catch(() => {
        /* keep the loop alive on transient failures */
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [sync]);

  /** Refresh a single profile now. The caller acts on whatever it still needs. */
  const refreshOne = useCallback(
    async (name: string, mfaCodes?: Record<string, string>): Promise<CredentialsOutcome> => {
      const discovered = await discoverProfiles();
      const profile = discovered.find((p) => p.name === name);
      if (!profile) return { ok: false, reason: "error", error: `${name} is no longer in ~/.aws/config` };

      const outcome = await refreshProfile(profile, { profiles: discovered, mfaCodes });
      if (outcome.ok) notified.current.delete(name);
      await reload();
      return outcome;
    },
    [reload],
  );

  // Toggle ⟳ (favorite) for a profile: persist favoriteProfiles, then reload so
  // the marker updates immediately. This is the single writer for favourites —
  // the caller mirrors the returned settings into React state rather than
  // computing its own copy, which previously let the two drift apart.
  const setFavorite = useCallback(
    (name: string): AppSettings => {
      const current = settingsRef.current;
      const favorites = new Set(current.favoriteProfiles);
      if (favorites.has(name)) favorites.delete(name);
      else favorites.add(name);

      const next: AppSettings = { ...current, favoriteProfiles: [...favorites] };
      settingsRef.current = next;
      saveSettings(next);
      void reload();
      return next;
    },
    [reload],
  );

  return { profiles, ready, configured, reload, refreshOne, setFavorite };
}

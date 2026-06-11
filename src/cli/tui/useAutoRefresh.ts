import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildLocalProfileStates,
  type ProfileState,
  type ProfileStatusKind,
} from "../../aws/profileState.js";
import { decideAction } from "../../aws/refreshScheduler.js";
import { discoverProfiles, findCachedToken, refreshProfile } from "../../aws/sso.js";
import { saveSettings, type AppSettings } from "../../aws/settings.js";

/** How often the in-process loop checks favorites for due refreshes. */
const TICK_MS = 30_000;

/** Fallback credential TTL when AWS omits the credential expiration in the response. */
const DEFAULT_CRED_TTL_MS = 50 * 60 * 1000;

export interface AutoRefreshView {
  profiles: ProfileState[];
  reload: () => Promise<void>;
  refreshOne: (name: string) => Promise<{ needsLogin: boolean; ok: boolean; error?: string }>;
  setAuto: (name: string, value: boolean) => void;
}

/**
 * In-process auto-refresh for the TUI. While the dashboard is open it keeps the
 * ⟳ (favorite) profiles fresh: every tick it decides, per favorite, whether the
 * cached role credentials are due for a silent refresh and performs it,
 * expiry-aware. Replaces the old background daemon — no sockets, no detach.
 *
 * Ported from the daemon's `computeState`: SSO-token validity comes from the
 * cache file, role-cred expiry is tracked in a ref-held Map, and a notify-once
 * set drives the optional `onNeedsLogin` callback.
 */
export function useAutoRefresh(
  settings: AppSettings,
  onNeedsLogin?: (name: string) => void,
): AutoRefreshView {
  const [profiles, setProfiles] = useState<ProfileState[]>([]);
  const credExpiry = useRef(new Map<string, Date>());
  const notified = useRef(new Set<string>());

  // Keep the latest settings + callback in refs so the interval closure always
  // reads current values without resubscribing the timer.
  const settingsRef = useRef(settings);
  const onNeedsLoginRef = useRef(onNeedsLogin);
  useEffect(() => {
    settingsRef.current = settings;
    onNeedsLoginRef.current = onNeedsLogin;
  }, [settings, onNeedsLogin]);

  const reload = useCallback(async () => {
    const states = await buildLocalProfileStates();
    setProfiles(states);
  }, []);

  // Seed from disk on mount.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Recompute the full ProfileState[] from disk + tracked cred expiry,
  // performing silent refreshes for favorites that are due.
  const tick = useCallback(async () => {
    const s = settingsRef.current;
    const leadMs = s.refreshLeadMinutes * 60 * 1000;
    const favorites = new Set(s.favoriteProfiles);
    const now = new Date();
    const states: ProfileState[] = [];

    for (const p of await discoverProfiles()) {
      const cachedToken = await findCachedToken(p);
      const ssoTokenValid = cachedToken !== null && cachedToken.expiresAt > now;
      const credsExpireAt: Date | null = credExpiry.current.get(p.name) ?? null;

      const favorite = favorites.has(p.name);
      let status: ProfileStatusKind = ssoTokenValid ? "valid" : "needs-login";
      let errorMsg: string | undefined;

      if (favorite) {
        const action = decideAction({ ssoTokenValid, credsExpireAt }, now, leadMs);

        if (action === "refresh") {
          const r = await refreshProfile(p);
          if (r.success) {
            notified.current.delete(p.name);
            status = "valid";
            credExpiry.current.set(p.name, r.expiresAt ?? new Date(Date.now() + DEFAULT_CRED_TTL_MS));
          } else if (r.needsLogin) {
            status = "needs-login";
            credExpiry.current.delete(p.name);
            if (!notified.current.has(p.name)) {
              notified.current.add(p.name);
              onNeedsLoginRef.current?.(p.name);
            }
          } else {
            status = "error";
            errorMsg = r.error;
          }
        } else if (action === "needs-login") {
          status = "needs-login";
          credExpiry.current.delete(p.name);
          if (!notified.current.has(p.name)) {
            notified.current.add(p.name);
            onNeedsLoginRef.current?.(p.name);
          }
        }
        // action === "wait" → keep status derived from ssoTokenValid above
      }

      const trackedExpiry = credExpiry.current.get(p.name);
      states.push({
        name: p.name,
        status,
        expiresAt: trackedExpiry
          ? trackedExpiry.toISOString()
          : cachedToken
            ? cachedToken.expiresAt.toISOString()
            : null,
        favorite,
        accountId: p.ssoAccountId,
        ...(errorMsg !== undefined && { error: errorMsg }),
      });
    }

    setProfiles(states);
  }, []);

  // Run the auto-refresh loop while mounted. The callback never throws
  // unhandled; any failure is swallowed so the timer survives.
  useEffect(() => {
    const id = setInterval(() => {
      void tick().catch(() => {
        /* keep the loop alive on transient failures */
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [tick]);

  // Refresh a single profile immediately (silent). Returns whether the caller
  // should kick off an interactive device-auth flow.
  const refreshOne = useCallback(
    async (name: string): Promise<{ needsLogin: boolean; ok: boolean; error?: string }> => {
      const profiles = await discoverProfiles();
      const p = profiles.find((x) => x.name === name);
      if (!p) return { needsLogin: false, ok: false, error: "profile not found" };

      const r = await refreshProfile(p);
      if (r.success) {
        notified.current.delete(name);
        credExpiry.current.set(name, r.expiresAt ?? new Date(Date.now() + DEFAULT_CRED_TTL_MS));
        await reload();
        return { needsLogin: false, ok: true };
      }
      if (r.needsLogin) {
        credExpiry.current.delete(name);
        await reload();
        return { needsLogin: true, ok: false };
      }
      await reload();
      return { needsLogin: false, ok: false, error: r.error };
    },
    [reload],
  );

  // Toggle ⟳ (favorite) for a profile: persist favoriteProfiles, then reload so
  // the marker updates immediately.
  const setAuto = useCallback(
    (name: string, value: boolean) => {
      const s = settingsRef.current;
      const set = new Set(s.favoriteProfiles);
      if (value) set.add(name);
      else set.delete(name);
      saveSettings({ ...s, favoriteProfiles: [...set] });
      void reload();
    },
    [reload],
  );

  return { profiles, reload, refreshOne, setAuto };
}

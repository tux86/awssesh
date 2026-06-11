import { spawn } from "node:child_process";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server";
import { isDaemonAlive } from "./lifecycle";
import { decideAction } from "./scheduler";
import {
  discoverProfiles,
  findCachedToken,
  refreshProfile as coreRefresh,
  sendNotification,
} from "../aws/sso";
import { loadSettings, saveSettings } from "../aws/settings";
import type { ProfileState, ProfileStatusKind } from "./protocol";

function logPath(): string {
  const dir = join(homedir(), ".aws", "ssomatic");
  mkdirSync(dir, { recursive: true });
  return join(dir, "daemon.log");
}

const notified = new Set<string>();
const credExpiry = new Map<string, Date>();

function maybeNotify(enabled: boolean, profile: string): void {
  if (!enabled || notified.has(profile)) return;
  notified.add(profile);
  void sendNotification("SSOmatic", `${profile} needs login`);
}

/**
 * Build current ProfileState[] from disk.
 * For each favorite, decide + perform a silent refresh when due.
 *
 * Role-credential expiry is tracked in `credExpiry` (populated after each
 * successful refresh). On daemon start the map is empty, so every favorite
 * refreshes once; afterward `decideAction` returns "wait" until within
 * `refreshLeadMinutes` of the role-cred expiry, making computeState a cheap
 * read on normal snapshots/subscribes.
 */
async function computeState(): Promise<ProfileState[]> {
  const settings = loadSettings();
  const leadMs = settings.refreshLeadMinutes * 60 * 1000;
  const favorites = new Set(settings.favoriteProfiles);
  const now = new Date();
  const states: ProfileState[] = [];

  for (const p of await discoverProfiles()) {
    // Determine SSO token validity directly from the cache file.
    const cachedToken = await findCachedToken(p);
    const ssoTokenValid = cachedToken !== null && cachedToken.expiresAt > now;

    // Use tracked role-cred expiry when available; null triggers a refresh.
    const credsExpireAt: Date | null = credExpiry.get(p.name) ?? null;

    const favorite = favorites.has(p.name);
    let status: ProfileStatusKind = ssoTokenValid ? "valid" : "needs-login";

    if (favorite) {
      const action = decideAction({ ssoTokenValid, credsExpireAt }, now, leadMs);

      if (action === "refresh") {
        const r = await coreRefresh(p);
        if (r.success) {
          notified.delete(p.name);
          status = "valid";
          credExpiry.set(p.name, r.expiresAt ?? new Date(Date.now() + 50 * 60 * 1000));
        } else if (r.needsLogin) {
          status = "needs-login";
          credExpiry.delete(p.name);
          maybeNotify(settings.notifications, p.name);
        } else {
          status = "error";
        }
      } else if (action === "needs-login") {
        status = "needs-login";
        credExpiry.delete(p.name);
        maybeNotify(settings.notifications, p.name);
      }
      // action === "wait" → keep status derived from ssoTokenValid above
    }

    // Prefer role-cred expiry for the expiresAt field when known; fall back to
    // the cached SSO-token expiry.
    const trackedExpiry = credExpiry.get(p.name);
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
    });
  }

  return states;
}

export async function runDaemon(): Promise<void> {
  const startedAtIso = new Date().toISOString();
  const server = await startServer({
    startedAtIso,
    tickMs: 30_000,
    computeState,
    refreshProfile: async (name) => {
      const profiles = await discoverProfiles();
      const p = profiles.find((x) => x.name === name);
      if (!p) return;
      const r = await coreRefresh(p);
      if (r.success) {
        notified.delete(name);
        credExpiry.set(name, r.expiresAt ?? new Date(Date.now() + 50 * 60 * 1000));
      } else if (r.needsLogin) {
        credExpiry.delete(name);
      }
    },
    setFavorite: (name, value) => {
      const s = loadSettings();
      const set = new Set(s.favoriteProfiles);
      if (value) set.add(name);
      else set.delete(name);
      saveSettings({ ...s, favoriteProfiles: [...set] });
    },
  });

  process.on("SIGTERM", () => void server.stop().then(() => process.exit(0)));
  process.on("SIGINT", () => void server.stop().then(() => process.exit(0)));
}

/** Spawn a detached daemon process running `<node|bun> <thisScript> __daemon`, return immediately. */
export async function spawnDetached(): Promise<void> {
  if (await isDaemonAlive()) return;
  const out = openSync(logPath(), "a");
  const child = spawn(process.execPath, [process.argv[1], "__daemon"], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  closeSync(out);
  // Brief pause so the daemon has time to bind the socket before the caller checks it.
  await new Promise((r) => setTimeout(r, 300));
}

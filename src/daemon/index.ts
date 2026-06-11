import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
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

function maybeNotify(enabled: boolean, profile: string): void {
  if (!enabled || notified.has(profile)) return;
  notified.add(profile);
  void sendNotification("SSOmatic", `${profile} needs login`);
}

/**
 * Build current ProfileState[] from disk.
 * For each favorite, decide + perform a silent refresh when due.
 *
 * NOTE: checkTokenStatus() only exposes the SSO token expiry, not role-credential
 * expiry (which is not cached on disk). We therefore pass credsExpireAt=null to
 * the scheduler, which causes it to always return "refresh" for profiles with a
 * valid SSO token — the intended behaviour so the daemon keeps role creds fresh.
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

    // Role-credential expiry is not persisted on disk; pass null so the scheduler
    // always triggers a refresh while the SSO token is valid.
    const credsExpireAt: Date | null = null;

    const favorite = favorites.has(p.name);
    let status: ProfileStatusKind = ssoTokenValid ? "valid" : "needs-login";

    if (favorite) {
      const action = decideAction({ ssoTokenValid, credsExpireAt }, now, leadMs);

      if (action === "refresh") {
        const r = await coreRefresh(p);
        if (r.success) {
          notified.delete(p.name);
          status = "valid";
        } else if (r.needsLogin) {
          status = "needs-login";
          maybeNotify(settings.notifications, p.name);
        } else {
          status = "error";
        }
      } else if (action === "needs-login") {
        status = "needs-login";
        maybeNotify(settings.notifications, p.name);
      }
      // action === "wait" → keep status derived from ssoTokenValid above
    }

    states.push({
      name: p.name,
      status,
      expiresAt: cachedToken ? cachedToken.expiresAt.toISOString() : null,
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
      if (p) await coreRefresh(p);
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
  // Brief pause so the daemon has time to bind the socket before the caller checks it.
  await new Promise((r) => setTimeout(r, 300));
}

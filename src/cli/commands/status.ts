import { request, isDaemonAlive } from "../../daemon/client";
import type { ProfileState } from "../../daemon/protocol";
import { discoverProfiles, findCachedToken } from "../../aws/sso";
import { loadSettings } from "../../aws/settings";

function minsLeft(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "—";
  const m = Math.round((new Date(expiresAt).getTime() - now.getTime()) / 60000);
  return m <= 0 ? "expired" : `${m}m`;
}

export function formatStatusTable(rows: ProfileState[], now: Date): string {
  const nameW = Math.max(7, ...rows.map((r) => r.name.length));
  const statusW = Math.max(6, ...rows.map((r) => r.status.length));
  return rows
    .map((r) => {
      const star = r.favorite ? "★ " : "  ";
      return `${star}${r.name.padEnd(nameW)}  ${r.status.padEnd(statusW)}  ${minsLeft(r.expiresAt, now)}`;
    })
    .join("\n");
}

async function localState(): Promise<ProfileState[]> {
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

export async function runStatus(): Promise<number> {
  const now = new Date();
  let rows: ProfileState[];
  if (await isDaemonAlive()) {
    const msg = await request({ type: "snapshot" });
    rows = msg.type === "state" ? msg.profiles : [];
  } else {
    rows = await localState();
  }
  process.stdout.write(formatStatusTable(rows, now) + "\n");
  return 0;
}

import { request, isDaemonAlive } from "../../daemon/client";
import type { ProfileState } from "../../daemon/protocol";
import { buildLocalProfileStates } from "../../aws/profileState";

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

export async function runStatus(): Promise<number> {
  const now = new Date();
  let rows: ProfileState[];
  if (await isDaemonAlive()) {
    try {
      const msg = await request({ type: "snapshot" });
      rows = msg.type === "state" ? msg.profiles : [];
    } catch (err) {
      process.stderr.write(`warning: daemon request failed (${String(err)}), falling back to local state\n`);
      rows = await buildLocalProfileStates();
    }
  } else {
    rows = await buildLocalProfileStates();
  }
  process.stdout.write(formatStatusTable(rows, now) + "\n");
  return 0;
}

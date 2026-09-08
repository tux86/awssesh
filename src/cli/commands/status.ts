import type { ProfileState } from "../../aws/profileState";
import { buildLocalProfileStates } from "../../aws/profileState";
import { formatTimeLeft } from "../../aws/duration";

const MARKER_WIDTH = 2;

export function formatStatusTable(rows: ProfileState[], now: Date): string {
  if (rows.length === 0) return "no profiles found in ~/.aws/config";

  const nameW = Math.max(7, ...rows.map((r) => r.name.length));
  const statusW = Math.max(6, ...rows.map((r) => r.status.length));

  return rows
    .map((r) => {
      const marker = (r.favorite ? "⟳" : "").padEnd(MARKER_WIDTH);
      const expires = formatTimeLeft(r.expiresAt, now.getTime());
      return `${marker}${r.name.padEnd(nameW)}  ${r.status.padEnd(statusW)}  ${expires}`;
    })
    .join("\n");
}

export async function runStatus(): Promise<number> {
  const now = new Date();
  const rows = await buildLocalProfileStates();
  process.stdout.write(formatStatusTable(rows, now) + "\n");
  return 0;
}

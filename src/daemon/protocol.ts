// ProfileState / ProfileStatusKind now live in ../aws/profileState (co-located
// with buildLocalProfileStates). Re-exported here so the daemon backend wire
// types keep working until the daemon is removed.
import type { ProfileState } from "../aws/profileState.js";
export type { ProfileState, ProfileStatusKind } from "../aws/profileState.js";

export interface DaemonInfo {
  pid: number;
  startedAt: string; // ISO string
}

export type ClientMessage =
  | { type: "subscribe" }
  | { type: "snapshot" }
  | { type: "refresh"; profile?: string }
  | { type: "setFavorite"; profile: string; value: boolean }
  | { type: "stop" };

export type DaemonMessage =
  | { type: "state"; daemon: DaemonInfo; profiles: ProfileState[] }
  | { type: "error"; message: string };

export function encode(msg: ClientMessage | DaemonMessage): string {
  return JSON.stringify(msg) + "\n";
}

/** Stateful newline-delimited JSON decoder. Call push() with each chunk. */
export function decodeStream<T = ClientMessage | DaemonMessage>() {
  let buffer = "";
  return {
    push(chunk: string): T[] {
      buffer += chunk;
      const out: T[] = [];
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim().length > 0) out.push(JSON.parse(line) as T);
      }
      return out;
    },
  };
}

export type ProfileStatusKind = "valid" | "expired" | "needs-login" | "error" | "refreshing";

export interface ProfileState {
  name: string;
  status: ProfileStatusKind;
  expiresAt: string | null; // ISO string or null
  favorite: boolean;
  accountId?: string;
  error?: string;
}

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

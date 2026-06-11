import { createServer, type Server, type Socket } from "node:net";
import {
  encode,
  decodeStream,
  type ClientMessage,
  type DaemonMessage,
  type ProfileState,
  type DaemonInfo,
} from "./protocol";
import { socketPath, reclaimStaleSocket, writePidFile, clearPidFile } from "./lifecycle";

export interface ServerDeps {
  computeState: () => Promise<ProfileState[]>;
  refreshProfile: (name: string) => Promise<void>;
  setFavorite?: (name: string, value: boolean) => Promise<void> | void;
  tickMs?: number;
  startedAtIso: string;
}

export interface DaemonServer {
  broadcast: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startServer(deps: ServerDeps): Promise<DaemonServer> {
  await reclaimStaleSocket();
  const connections = new Set<Socket>();
  const subscribers = new Set<Socket>();
  let state: ProfileState[] = [];
  let stopped = false;
  const info: DaemonInfo = { pid: process.pid, startedAt: deps.startedAtIso };

  async function refreshState(): Promise<void> {
    state = await deps.computeState();
  }

  async function broadcast(): Promise<void> {
    await refreshState();
    const line = encode({ type: "state", daemon: info, profiles: state } satisfies DaemonMessage);
    for (const sock of subscribers) sock.write(line);
  }

  async function handle(sock: Socket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "subscribe": {
        subscribers.add(sock);
        await refreshState();
        sock.write(encode({ type: "state", daemon: info, profiles: state } satisfies DaemonMessage));
        break;
      }
      case "snapshot": {
        await refreshState();
        sock.write(encode({ type: "state", daemon: info, profiles: state } satisfies DaemonMessage));
        break;
      }
      case "refresh": {
        const targets = msg.profile ? [msg.profile] : state.filter((p) => p.favorite).map((p) => p.name);
        for (const name of targets) await deps.refreshProfile(name);
        await broadcast();
        break;
      }
      case "setFavorite": {
        await deps.setFavorite?.(msg.profile, msg.value);
        await broadcast();
        break;
      }
      case "stop": {
        await stop();
        break;
      }
    }
  }

  const netServer: Server = createServer((sock) => {
    connections.add(sock);
    const dec = decodeStream<ClientMessage>();
    sock.on("data", (buf) => {
      for (const msg of dec.push(buf.toString())) {
        handle(sock, msg).catch((err) => {
          if (!sock.destroyed) sock.write(encode({ type: "error", message: String(err) }));
        });
      }
    });
    sock.on("close", () => {
      connections.delete(sock);
      subscribers.delete(sock);
    });
    sock.on("error", () => {
      connections.delete(sock);
      subscribers.delete(sock);
    });
  });

  await new Promise<void>((resolve) => netServer.listen(socketPath(), resolve));
  writePidFile(process.pid);

  const interval = setInterval(() => void broadcast(), deps.tickMs ?? 60_000);

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    for (const sock of connections) sock.destroy();
    connections.clear();
    subscribers.clear();
    await new Promise<void>((resolve) => netServer.close(() => resolve()));
    clearPidFile();
  }

  await refreshState();
  return { broadcast, stop };
}

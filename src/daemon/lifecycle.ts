import { connect, type Socket } from "node:net";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runtimeDir(): string {
  const dir = process.env.XDG_RUNTIME_DIR || tmpdir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function socketPath(): string {
  return join(runtimeDir(), "ssomatic.sock");
}

export function pidPath(): string {
  return join(runtimeDir(), "ssomatic.pid");
}

/** True if something is actually listening on the socket. */
export function isDaemonAlive(timeoutMs = 500): Promise<boolean> {
  const path = socketPath();
  if (!existsSync(path)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock: Socket = connect(path);
    const done = (alive: boolean) => {
      sock.destroy();
      resolve(alive);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/** Remove a socket file with no live listener so we can rebind. Returns true if reclaimed. */
export async function reclaimStaleSocket(): Promise<boolean> {
  const path = socketPath();
  if (existsSync(path) && !(await isDaemonAlive())) {
    rmSync(path, { force: true });
    return true;
  }
  return false;
}

export function writePidFile(pid: number): void {
  writeFileSync(pidPath(), String(pid));
}

export function readPidFile(): number | null {
  const path = pidPath();
  if (!existsSync(path)) return null;
  const n = Number(readFileSync(path, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

export function clearPidFile(): void {
  rmSync(pidPath(), { force: true });
}

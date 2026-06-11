import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { socketPath, pidPath, isDaemonAlive, writePidFile, readPidFile } from "./lifecycle";

let runtime: string;
let prev: string | undefined;

beforeEach(() => {
  prev = process.env.XDG_RUNTIME_DIR;
  runtime = mkdtempSync(join(tmpdir(), "ssomatic-rt-"));
  process.env.XDG_RUNTIME_DIR = runtime;
});
afterEach(() => {
  process.env.XDG_RUNTIME_DIR = prev;
  rmSync(runtime, { recursive: true, force: true });
});

test("socketPath/pidPath live under the runtime dir", () => {
  expect(socketPath().startsWith(runtime)).toBe(true);
  expect(pidPath().startsWith(runtime)).toBe(true);
});

test("isDaemonAlive is false when no socket is listening", async () => {
  expect(await isDaemonAlive()).toBe(false);
});

test("isDaemonAlive is true when a server is listening on the socket", async () => {
  const srv: Server = await new Promise((resolve) => {
    const s = createServer();
    s.listen(socketPath(), () => resolve(s));
  });
  try {
    expect(await isDaemonAlive()).toBe(true);
  } finally {
    srv.close();
  }
});

test("pid file round-trips", () => {
  writePidFile(4242);
  expect(existsSync(pidPath())).toBe(true);
  expect(readPidFile()).toBe(4242);
});

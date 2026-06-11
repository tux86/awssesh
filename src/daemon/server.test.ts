import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import { encode, decodeStream, type DaemonMessage, type ProfileState } from "./protocol";
import { socketPath } from "./lifecycle";
import { startServer, type DaemonServer } from "./server";

let runtime: string;
let prev: string | undefined;
let server: DaemonServer;

const fakeProfiles: ProfileState[] = [
  { name: "prod", status: "valid", expiresAt: "2026-06-11T12:00:00.000Z", favorite: true },
];

beforeEach(() => {
  prev = process.env.XDG_RUNTIME_DIR;
  runtime = mkdtempSync(join(tmpdir(), "ssomatic-srv-"));
  process.env.XDG_RUNTIME_DIR = runtime;
});
afterEach(async () => {
  await server?.stop();
  process.env.XDG_RUNTIME_DIR = prev;
  rmSync(runtime, { recursive: true, force: true });
});

function readOne(sock: Socket): Promise<DaemonMessage> {
  const dec = decodeStream<DaemonMessage>();
  return new Promise((resolve) => {
    sock.on("data", (buf) => {
      const msgs = dec.push(buf.toString());
      if (msgs.length) resolve(msgs[0]);
    });
  });
}

test("snapshot returns current state then the client can disconnect", async () => {
  server = await startServer({
    startedAtIso: "2026-06-11T10:00:00.000Z",
    computeState: async () => fakeProfiles,
    refreshProfile: async () => {},
    tickMs: 10_000,
  });
  const sock = connect(socketPath());
  await new Promise((r) => sock.once("connect", r));
  const reply = readOne(sock);
  sock.write(encode({ type: "snapshot" }));
  const msg = await reply;
  expect(msg.type).toBe("state");
  if (msg.type === "state") expect(msg.profiles).toEqual(fakeProfiles);
  sock.destroy();
});

test("subscribe pushes state on broadcast", async () => {
  let current = fakeProfiles;
  server = await startServer({
    startedAtIso: "2026-06-11T10:00:00.000Z",
    computeState: async () => current,
    refreshProfile: async () => {},
    tickMs: 10_000,
  });
  const sock = connect(socketPath());
  await new Promise((r) => sock.once("connect", r));
  sock.write(encode({ type: "subscribe" }));
  await readOne(sock); // first push on subscribe
  current = [{ ...fakeProfiles[0], status: "refreshing" }];
  const next = readOne(sock);
  await server.broadcast();
  const msg = await next;
  expect(msg.type === "state" && msg.profiles[0].status).toBe("refreshing");
  sock.destroy();
});

test("refresh request receives a state reply directly (requester is not a subscriber)", async () => {
  let refreshedProfile: string | undefined;
  server = await startServer({
    startedAtIso: "2026-06-11T10:00:00.000Z",
    computeState: async () => fakeProfiles,
    refreshProfile: async (name) => { refreshedProfile = name; },
    tickMs: 10_000,
  });
  const sock = connect(socketPath());
  await new Promise((r) => sock.once("connect", r));
  const reply = readOne(sock);
  sock.write(encode({ type: "refresh", profile: "prod" }));
  const msg = await reply;
  expect(msg.type).toBe("state");
  if (msg.type === "state") expect(msg.profiles).toEqual(fakeProfiles);
  expect(refreshedProfile).toBe("prod");
  sock.destroy();
});

test("stop() resolves even with a lingering non-subscriber connection", async () => {
  server = await startServer({
    startedAtIso: "2026-06-11T10:00:00.000Z",
    computeState: async () => fakeProfiles,
    refreshProfile: async () => {},
    tickMs: 10_000,
  });
  const sock = connect(socketPath());
  await new Promise((r) => sock.once("connect", r));
  const reply = readOne(sock);
  sock.write(encode({ type: "snapshot" }));
  await reply; // got snapshot; deliberately do NOT destroy sock
  await Promise.race([
    server.stop(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("stop() hung")), 2000)),
  ]);
  sock.destroy();
});

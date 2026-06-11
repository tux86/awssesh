# SSOmatic 2.0 — Background Daemon + List-First UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild SSOmatic with a real per-host background daemon (Unix socket, live-attach), a list-first k9s-style TUI, full CLI subcommands, latest libraries, and an npm-facing README.

**Architecture:** Three layers — `core/` (UI-agnostic AWS logic), `daemon/` (detached process: expiry-aware scheduler + Unix-socket server with a shared newline-delimited-JSON protocol), and `cli/` (arg router → non-interactive subcommands or the Ink TUI client that attaches to the daemon over the socket). The socket is the single source of truth for live state; login (browser device-auth) is always client-driven, never done by the daemon.

**Tech Stack:** Bun (runtime + test runner + build), TypeScript, React 19, Ink 6, `node:net` (Unix socket), `node:child_process` (detach), AWS SDK v3 (`client-sso`, `client-sso-oidc`, `client-sts`), `ini`.

**Reference spec:** `docs/superpowers/specs/2026-06-11-ssomatic-v2-daemon-ux-design.md`

---

## Conventions for every task

- Tests use `bun:test` (`import { test, expect, describe, beforeEach, afterEach } from "bun:test"`).
- Run a single test file with: `bun test src/path/to/file.test.ts`
- Run all tests with: `bun test`
- Lint with: `bun run lint`
- Commit messages follow Conventional Commits with allowed scopes `cli`, `aws`, `deps`, `ci`. For this work use `core`-related changes under scope `aws`, daemon/TUI under scope `cli`.
- After each task, run `bun run lint` and `bun test` before committing.

### IMPORTANT — confirm existing signatures first

Several tasks call existing functions in `src/aws/sso.ts` and `src/aws/aws.ts`. Before the first task that uses each one, open the file and confirm the exact signature/type field names, then adapt the plan's code to match. The functions referenced (verify names + shapes): `discoverProfiles()`, `checkTokenStatus(profile)`, `checkAllProfiles(profiles)`, `findCachedToken(profile)`, `startDeviceAuthorization(profile)`, `pollForToken(profile, deviceAuth)`, `saveSSOTokenToCache(profile, tokenInfo)`, `getCredentialsWithToken(profile, accessToken)`, `refreshProfile(profile)`, `performSSOLoginFlow(profile, deviceAuth)`, `formatExpiry(date)`, `getStatusColor(status)`, `sortByFavorites(items, favorites, getName)`, `openBrowser(url)`, `sendNotification(title, msg)`. Types: `SSOProfile`, `ProfileStatus`, `CachedToken`, `AWSCredentials`, `DeviceAuthInfo`, `AppSettings`.

---

## Phase 0 — Dependency upgrades

### Task 0: Bump to latest library versions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check the latest versions**

Run:
```bash
bun pm view ink version; bun pm view ink-spinner version; bun pm view react version; \
bun pm view @aws-sdk/client-sso version; bun pm view @aws-sdk/client-sso-oidc version; \
bun pm view @aws-sdk/client-sts version; bun pm view ini version; \
bun pm view eslint version; bun pm view typescript version
```
Note each version. (If `bun pm view` is unavailable, use `npm view <pkg> version`.)

- [ ] **Step 2: Upgrade dependencies**

Run:
```bash
bun add ink@latest ink-spinner@latest react@latest \
  @aws-sdk/client-sso@latest @aws-sdk/client-sso-oidc@latest @aws-sdk/client-sts@latest ini@latest
bun add -d @types/react@latest typescript@latest eslint@latest @eslint/js@latest \
  @typescript-eslint/eslint-plugin@latest @typescript-eslint/parser@latest \
  eslint-plugin-react@latest eslint-plugin-react-hooks@latest @types/ini@latest
```

- [ ] **Step 3: Verify the app still builds, lints, and tests pass**

Run: `bun install && bun run lint && bun test && bun run build`
Expected: all succeed. If a major bump breaks something (e.g. Ink API change), read that library's changelog/migration notes and fix the breakage before continuing. Do not proceed with a red build.

- [ ] **Step 4: Smoke-test the current app launches**

Run: `bun run start` then press `q` to quit.
Expected: the existing TUI renders and exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "build(deps): upgrade ink, react, aws-sdk and toolchain to latest"
```

---

## Phase 1 — Core layer refactor

The existing `src/aws/` becomes the UI-agnostic core. We split settings out, update the settings shape, and add a console-URL builder. We do NOT rename the directory (keep `src/aws/`) to minimize churn and preserve import paths and the CLAUDE.md structure.

### Task 1: Split settings into `settings.ts` with the new shape

**Files:**
- Create: `src/aws/settings.ts`
- Create: `src/aws/settings.test.ts`
- Modify: `src/aws/sso.ts` (remove `loadSettings`/`saveSettings`/`AppSettings` and re-export from settings, or delete and update imports)

**New settings shape** (drop `defaultInterval`, add `refreshLeadMinutes` + `autoStartDaemon`):

```typescript
export interface AppSettings {
  notifications: boolean;
  refreshLeadMinutes: number;   // refresh this many minutes before expiry
  autoStartDaemon: boolean;     // start daemon automatically on TUI launch
  favoriteProfiles: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  refreshLeadMinutes: 5,
  autoStartDaemon: false,
  favoriteProfiles: [],
};
```

- [ ] **Step 1: Write the failing test**

Create `src/aws/settings.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "ssomatic-settings-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test("loadSettings returns defaults when no file exists", async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await import("./settings");
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test("saveSettings then loadSettings round-trips", async () => {
  const { loadSettings, saveSettings } = await import("./settings");
  saveSettings({
    notifications: false,
    refreshLeadMinutes: 10,
    autoStartDaemon: true,
    favoriteProfiles: ["prod", "dev"],
  });
  expect(loadSettings()).toEqual({
    notifications: false,
    refreshLeadMinutes: 10,
    autoStartDaemon: true,
    favoriteProfiles: ["prod", "dev"],
  });
});

test("loadSettings migrates a legacy file with defaultInterval", async () => {
  const { loadSettings } = await import("./settings");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(home, ".aws"), { recursive: true });
  writeFileSync(
    join(home, ".aws", "credentials-manager.json"),
    JSON.stringify({ notifications: true, defaultInterval: 30, favoriteProfiles: ["x"] }),
  );
  const s = loadSettings();
  expect(s.favoriteProfiles).toEqual(["x"]);
  expect(s.refreshLeadMinutes).toBe(5);    // default filled in
  expect(s.autoStartDaemon).toBe(false);   // default filled in
  expect("defaultInterval" in s).toBe(false);
});
```
Note: `bun:test` runs each test file in a fresh module registry, so dynamic `import("./settings")` after setting `HOME` is the safe pattern if the module reads `HOME` at import time. If `loadSettings` reads `HOME` lazily (inside the function), a top-level static import is fine — adapt to match the implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/aws/settings.test.ts`
Expected: FAIL — module `./settings` not found.

- [ ] **Step 3: Implement `settings.ts`**

Create `src/aws/settings.ts`:
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface AppSettings {
  notifications: boolean;
  refreshLeadMinutes: number;
  autoStartDaemon: boolean;
  favoriteProfiles: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  refreshLeadMinutes: 5,
  autoStartDaemon: false,
  favoriteProfiles: [],
};

function settingsPath(): string {
  return join(homedir(), ".aws", "credentials-manager.json");
}

export function loadSettings(): AppSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppSettings> & {
      defaultInterval?: number;
    };
    return {
      notifications: raw.notifications ?? DEFAULT_SETTINGS.notifications,
      refreshLeadMinutes: raw.refreshLeadMinutes ?? DEFAULT_SETTINGS.refreshLeadMinutes,
      autoStartDaemon: raw.autoStartDaemon ?? DEFAULT_SETTINGS.autoStartDaemon,
      favoriteProfiles: raw.favoriteProfiles ?? DEFAULT_SETTINGS.favoriteProfiles,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2));
}
```
Note: `homedir()` reflects `process.env.HOME` on macOS/Linux, so the temp-HOME tests work. If the existing code used a cached home constant, replicate lazy reads as above.

- [ ] **Step 4: Remove the old settings code from `sso.ts`**

In `src/aws/sso.ts`, delete the old `AppSettings` interface and `loadSettings`/`saveSettings` functions. If other code in `sso.ts` referenced them, import from `./settings` instead. Update `src/cli/index.tsx` (and any other importers) to import `loadSettings`, `saveSettings`, `AppSettings` from `../aws/settings` instead of `../aws/sso`. Search first:
```bash
grep -rn "loadSettings\|saveSettings\|AppSettings\|defaultInterval" src
```

- [ ] **Step 5: Run tests + lint**

Run: `bun test src/aws/settings.test.ts && bun run lint`
Expected: settings tests PASS; lint clean. (Other tests/TUI may reference `defaultInterval` — fix those references now; the old interval UI is removed in Phase 9, so for now just make it compile.)

- [ ] **Step 6: Commit**

```bash
git add src/aws/settings.ts src/aws/settings.test.ts src/aws/sso.ts src/cli/index.tsx
git commit -m "refactor(aws): split settings into settings.ts with expiry-aware shape"
```

### Task 2: Add console-URL builder + role-credentials accessor to core

The TUI's `o` (open console) and `c`/`export` actions need (a) a federated console sign-in URL and (b) the current role credentials for a profile. Add focused helpers.

**Files:**
- Create: `src/aws/console.ts`
- Create: `src/aws/console.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/aws/console.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { buildFederationSigninUrl, buildExportBlock } from "./console";

test("buildExportBlock produces shell export lines", () => {
  const block = buildExportBlock({
    accessKeyId: "ASIAEXAMPLE",
    secretAccessKey: "secret",
    sessionToken: "token",
  });
  expect(block).toBe(
    "export AWS_ACCESS_KEY_ID=ASIAEXAMPLE\n" +
      "export AWS_SECRET_ACCESS_KEY=secret\n" +
      "export AWS_SESSION_TOKEN=token",
  );
});

test("buildFederationSigninUrl wraps the federation endpoint with a signin token", () => {
  const url = buildFederationSigninUrl("SIGNINTOKEN", "https://console.aws.amazon.com/");
  expect(url).toContain("https://signin.aws.amazon.com/federation");
  expect(url).toContain("Action=login");
  expect(url).toContain("SigninToken=SIGNINTOKEN");
  expect(url).toContain(encodeURIComponent("https://console.aws.amazon.com/"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/aws/console.test.ts`
Expected: FAIL — module `./console` not found.

- [ ] **Step 3: Implement `console.ts`**

Create `src/aws/console.ts`:
```typescript
import type { AWSCredentials } from "./sso";

export function buildExportBlock(creds: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}): string {
  return [
    `export AWS_ACCESS_KEY_ID=${creds.accessKeyId}`,
    `export AWS_SECRET_ACCESS_KEY=${creds.secretAccessKey}`,
    `export AWS_SESSION_TOKEN=${creds.sessionToken}`,
  ].join("\n");
}

export function buildFederationSigninUrl(
  signinToken: string,
  destination = "https://console.aws.amazon.com/",
): string {
  const params = new URLSearchParams({
    Action: "login",
    Issuer: "ssomatic",
    Destination: destination,
    SigninToken: signinToken,
  });
  return `https://signin.aws.amazon.com/federation?${params.toString()}`;
}

/**
 * Exchange role credentials for a console signin token, then build the URL.
 * Network call — kept separate from the pure builders above so they stay unit-testable.
 */
export async function getConsoleSigninUrl(creds: AWSCredentials): Promise<string> {
  const session = encodeURIComponent(
    JSON.stringify({
      sessionId: creds.accessKeyId,
      sessionKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    }),
  );
  const res = await fetch(
    `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${session}`,
  );
  if (!res.ok) throw new Error(`federation getSigninToken failed: ${res.status}`);
  const { SigninToken } = (await res.json()) as { SigninToken: string };
  return buildFederationSigninUrl(SigninToken);
}
```
Note: confirm the `AWSCredentials` field names in `sso.ts` (`accessKeyId`/`secretAccessKey`/`sessionToken` vs `AccessKeyId` etc.) and adapt `buildExportBlock`/`getConsoleSigninUrl` to match.

- [ ] **Step 4: Run tests + lint**

Run: `bun test src/aws/console.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/aws/console.ts src/aws/console.test.ts
git commit -m "feat(aws): add console signin URL and export-block builders"
```

---

## Phase 2 — Daemon protocol

### Task 3: Define the wire protocol and (de)serialization

**Files:**
- Create: `src/daemon/protocol.ts`
- Create: `src/daemon/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/daemon/protocol.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { encode, decodeStream, type ClientMessage, type DaemonMessage } from "./protocol";

test("encode appends a newline and is JSON-parseable", () => {
  const msg: ClientMessage = { type: "subscribe" };
  const line = encode(msg);
  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line)).toEqual({ type: "subscribe" });
});

test("decodeStream yields complete messages and buffers partials", () => {
  const dec = decodeStream();
  const a = encode({ type: "snapshot" } as ClientMessage);
  const b = encode({ type: "refresh", profile: "prod" } as ClientMessage);
  // feed one-and-a-half messages, then the rest
  const first = dec.push(a + b.slice(0, 5));
  expect(first).toEqual([{ type: "snapshot" }]);
  const second = dec.push(b.slice(5));
  expect(second).toEqual([{ type: "refresh", profile: "prod" }]);
});

test("daemon state message shape is preserved through encode/decode", () => {
  const dec = decodeStream<DaemonMessage>();
  const state: DaemonMessage = {
    type: "state",
    daemon: { pid: 123, startedAt: "2026-06-11T10:00:00.000Z" },
    profiles: [{ name: "prod", status: "valid", expiresAt: "2026-06-11T12:00:00.000Z", favorite: true }],
  };
  expect(dec.push(encode(state))).toEqual([state]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/daemon/protocol.test.ts`
Expected: FAIL — module `./protocol` not found.

- [ ] **Step 3: Implement `protocol.ts`**

Create `src/daemon/protocol.ts`:
```typescript
export type ProfileStatusKind = "valid" | "expired" | "needs-login" | "error" | "refreshing";

export interface ProfileState {
  name: string;
  status: ProfileStatusKind;
  expiresAt: string | null;   // ISO string or null
  favorite: boolean;
  accountId?: string;
  error?: string;
}

export interface DaemonInfo {
  pid: number;
  startedAt: string;          // ISO string
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
```

- [ ] **Step 4: Run tests + lint**

Run: `bun test src/daemon/protocol.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/protocol.ts src/daemon/protocol.test.ts
git commit -m "feat(cli): add daemon wire protocol and ndjson codec"
```

---

## Phase 3 — Daemon lifecycle (single-instance, pid/sock files)

### Task 4: Runtime paths + single-instance guard

**Files:**
- Create: `src/daemon/lifecycle.ts`
- Create: `src/daemon/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/daemon/lifecycle.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/daemon/lifecycle.test.ts`
Expected: FAIL — module `./lifecycle` not found.

- [ ] **Step 3: Implement `lifecycle.ts`**

Create `src/daemon/lifecycle.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests + lint**

Run: `bun test src/daemon/lifecycle.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/lifecycle.ts src/daemon/lifecycle.test.ts
git commit -m "feat(cli): add daemon runtime paths and single-instance detection"
```

---

## Phase 4 — Scheduler (expiry-aware decision)

### Task 5: Pure "should refresh now?" decision

Keep the scheduling *decision* pure and unit-testable; the loop that calls AWS lives in the server (Task 6).

**Files:**
- Create: `src/daemon/scheduler.ts`
- Create: `src/daemon/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/daemon/scheduler.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { decideAction } from "./scheduler";

const now = new Date("2026-06-11T12:00:00.000Z");
const leadMs = 5 * 60 * 1000;

test("refresh when within lead window of expiry", () => {
  const expiresAt = new Date("2026-06-11T12:03:00.000Z"); // 3m left < 5m lead
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: expiresAt }, now, leadMs)).toBe("refresh");
});

test("wait when comfortably before lead window", () => {
  const expiresAt = new Date("2026-06-11T12:30:00.000Z"); // 30m left
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: expiresAt }, now, leadMs)).toBe("wait");
});

test("needs-login when sso token invalid regardless of creds", () => {
  const expiresAt = new Date("2026-06-11T12:30:00.000Z");
  expect(decideAction({ ssoTokenValid: false, credsExpireAt: expiresAt }, now, leadMs)).toBe("needs-login");
});

test("refresh when there are no creds yet but sso token is valid", () => {
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: null }, now, leadMs)).toBe("refresh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/daemon/scheduler.test.ts`
Expected: FAIL — module `./scheduler` not found.

- [ ] **Step 3: Implement `scheduler.ts`**

Create `src/daemon/scheduler.ts`:
```typescript
export type Action = "refresh" | "wait" | "needs-login";

export interface ProfileTiming {
  ssoTokenValid: boolean;        // is the cached SSO token still valid?
  credsExpireAt: Date | null;    // when current role creds expire (null = none/unknown)
}

export function decideAction(timing: ProfileTiming, now: Date, leadMs: number): Action {
  if (!timing.ssoTokenValid) return "needs-login";
  if (timing.credsExpireAt === null) return "refresh";
  const msLeft = timing.credsExpireAt.getTime() - now.getTime();
  return msLeft <= leadMs ? "refresh" : "wait";
}

/** Milliseconds until the next decision point for a profile (for scheduling the next tick). */
export function msUntilNextCheck(timing: ProfileTiming, now: Date, leadMs: number): number {
  if (!timing.ssoTokenValid || timing.credsExpireAt === null) return 0;
  return Math.max(0, timing.credsExpireAt.getTime() - now.getTime() - leadMs);
}
```

- [ ] **Step 4: Run tests + lint**

Run: `bun test src/daemon/scheduler.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/scheduler.ts src/daemon/scheduler.test.ts
git commit -m "feat(cli): add expiry-aware scheduler decision"
```

---

## Phase 5 — Socket server

### Task 6: Daemon server — accept clients, broadcast state, run the loop

**Files:**
- Create: `src/daemon/server.ts`
- Create: `src/daemon/server.test.ts`

The server owns: a `net` server on the Unix socket, the set of connected subscribers, an in-memory `ProfileState[]`, a periodic tick that builds state (using core functions + `decideAction`) and refreshes due favorites, and command handling.

To keep it testable, inject the "compute state" and "refresh one profile" functions so the test can supply fakes (no real AWS calls).

- [ ] **Step 1: Write the failing integration test**

Create `src/daemon/server.test.ts`:
```typescript
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
    computeState: async () => fakeProfiles,
    refreshProfile: async () => {},
    tickMs: 10_000, // long; we drive manually
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
    computeState: async () => current,
    refreshProfile: async () => {},
    tickMs: 10_000,
  });
  const sock = connect(socketPath());
  await new Promise((r) => sock.once("connect", r));
  sock.write(encode({ type: "subscribe" }));
  // first push on subscribe
  await readOne(sock);
  // change state and force a broadcast
  current = [{ ...fakeProfiles[0], status: "refreshing" }];
  const next = readOne(sock);
  await server.broadcast();
  const msg = await next;
  expect(msg.type === "state" && msg.profiles[0].status).toBe("refreshing");
  sock.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/daemon/server.test.ts`
Expected: FAIL — module `./server` not found.

- [ ] **Step 3: Implement `server.ts`**

Create `src/daemon/server.ts`:
```typescript
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
  startedAtIso: string;            // pass in (Date.now() is unavailable in some sandboxes)
}

export interface DaemonServer {
  broadcast: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startServer(deps: ServerDeps): Promise<DaemonServer> {
  await reclaimStaleSocket();
  const subscribers = new Set<Socket>();
  let state: ProfileState[] = [];
  const info: DaemonInfo = { pid: process.pid, startedAt: deps.startedAtIso };

  async function refreshState(): Promise<void> {
    state = await deps.computeState();
  }

  async function broadcast(): Promise<void> {
    await refreshState();
    const msg: DaemonMessage = { type: "state", daemon: info, profiles: state };
    const line = encode(msg);
    for (const sock of subscribers) sock.write(line);
  }

  async function handle(sock: Socket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "subscribe": {
        subscribers.add(sock);
        await refreshState();
        sock.write(encode({ type: "state", daemon: info, profiles: state }));
        break;
      }
      case "snapshot": {
        await refreshState();
        sock.write(encode({ type: "state", daemon: info, profiles: state }));
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

  const server: Server = createServer((sock) => {
    const dec = decodeStream<ClientMessage>();
    sock.on("data", (buf) => {
      for (const msg of dec.push(buf.toString())) void handle(sock, msg);
    });
    sock.on("close", () => subscribers.delete(sock));
    sock.on("error", () => subscribers.delete(sock));
  });

  await new Promise<void>((resolve) => server.listen(socketPath(), resolve));
  writePidFile(process.pid);

  const interval = setInterval(() => void tick(), deps.tickMs ?? 60_000);
  async function tick(): Promise<void> {
    // refreshProfile decides internally whether a refresh is due (see daemon entry wiring)
    await broadcast();
  }

  async function stop(): Promise<void> {
    clearInterval(interval);
    for (const sock of subscribers) sock.destroy();
    subscribers.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearPidFile();
  }

  await refreshState();
  return { broadcast, stop };
}
```
Note: the test passes `startedAtIso` implicitly? It does not — update the test's `startServer` calls to include `startedAtIso: "2026-06-11T10:00:00.000Z"`. Add that field to both `startServer({...})` calls in Step 1's test before running. (Do this now.)

- [ ] **Step 4: Fix the test to pass `startedAtIso`, then run**

Edit `src/daemon/server.test.ts`: add `startedAtIso: "2026-06-11T10:00:00.000Z"` to both `startServer({ ... })` option objects.

Run: `bun test src/daemon/server.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/server.ts src/daemon/server.test.ts
git commit -m "feat(cli): add unix-socket daemon server with subscribe/snapshot/refresh"
```

---

## Phase 6 — Daemon entry + spawn/detach

### Task 7: Wire real AWS into the server and add the detached entry point

**Files:**
- Create: `src/daemon/index.ts` (the in-process daemon `main()` + a `spawnDetached()` helper)
- Create: `src/daemon/client.ts` (thin socket client used by CLI subcommands + the TUI)

No new unit test file (covered by Task 6 + manual smoke test); this is integration glue.

- [ ] **Step 1: Implement the client helper**

Create `src/daemon/client.ts`:
```typescript
import { connect, type Socket } from "node:net";
import { encode, decodeStream, type ClientMessage, type DaemonMessage } from "./protocol";
import { socketPath, isDaemonAlive } from "./lifecycle";

export { isDaemonAlive };

/** Connect, send one message, resolve with the first state reply, then close. */
export async function request(msg: ClientMessage, timeoutMs = 3000): Promise<DaemonMessage> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(socketPath());
    const dec = decodeStream<DaemonMessage>();
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("daemon request timed out"));
    }, timeoutMs);
    sock.once("connect", () => sock.write(encode(msg)));
    sock.on("data", (buf) => {
      const msgs = dec.push(buf.toString());
      if (msgs.length) {
        clearTimeout(timer);
        sock.destroy();
        resolve(msgs[0]);
      }
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Open a subscription; call onState for every pushed state until stop() is called. */
export function subscribe(onState: (msg: DaemonMessage) => void): { stop: () => void } {
  const sock: Socket = connect(socketPath());
  const dec = decodeStream<DaemonMessage>();
  sock.once("connect", () => sock.write(encode({ type: "subscribe" })));
  sock.on("data", (buf) => {
    for (const msg of dec.push(buf.toString())) onState(msg);
  });
  sock.on("error", () => {});
  return { stop: () => sock.destroy() };
}
```

- [ ] **Step 2: Implement the daemon main + spawn**

Create `src/daemon/index.ts`:
```typescript
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { startServer } from "./server";
import { isDaemonAlive } from "./lifecycle";
import { decideAction } from "./scheduler";
import { discoverProfiles, checkTokenStatus, refreshProfile as coreRefresh, findCachedToken } from "../aws/sso";
import { loadSettings, saveSettings } from "../aws/settings";
import type { ProfileState } from "./protocol";

function logPath(): string {
  const dir = join(homedir(), ".aws", "ssomatic");
  mkdirSync(dir, { recursive: true });
  return join(dir, "daemon.log");
}

/** Build current ProfileState[] from disk + decide which favorites are due, refreshing them. */
async function computeState(): Promise<ProfileState[]> {
  const settings = loadSettings();
  const leadMs = settings.refreshLeadMinutes * 60 * 1000;
  const favorites = new Set(settings.favoriteProfiles);
  const profiles = discoverProfiles();
  const now = new Date();
  const states: ProfileState[] = [];

  for (const p of profiles) {
    const st = checkTokenStatus(p);                 // adapt to actual return shape
    const cached = findCachedToken(p);
    const ssoValid = cached !== null && new Date(cached.expiresAt).getTime() > now.getTime();
    const credsExpireAt = st.expiresAt ? new Date(st.expiresAt) : null;
    const favorite = favorites.has(p.name);

    if (favorite) {
      const action = decideAction({ ssoTokenValid: ssoValid, credsExpireAt }, now, leadMs);
      if (action === "refresh") {
        const r = await coreRefresh(p);             // silent re-derive of role creds
        if (!r.success && r.needsLogin) {
          maybeNotify(settings.notifications, p.name);
        }
      } else if (action === "needs-login") {
        maybeNotify(settings.notifications, p.name);
      }
    }

    states.push({
      name: p.name,
      status: ssoValid ? (credsExpireAt && credsExpireAt > now ? "valid" : "needs-login") : "needs-login",
      expiresAt: credsExpireAt ? credsExpireAt.toISOString() : null,
      favorite,
      accountId: p.accountId,
    });
  }
  return states;
}

const notified = new Set<string>();
function maybeNotify(enabled: boolean, profile: string): void {
  if (!enabled || notified.has(profile)) return;
  notified.add(profile);
  // sendNotification is in src/aws/sso.ts — import + call. Reset on next successful refresh.
}

export async function runDaemon(): Promise<void> {
  const startedAtIso = new Date().toISOString();
  const server = await startServer({
    startedAtIso,
    tickMs: 30_000,
    computeState,
    refreshProfile: async (name) => {
      const p = discoverProfiles().find((x) => x.name === name);
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

/** Spawn a detached daemon process running `<bin> __daemon`, return immediately. */
export async function spawnDetached(): Promise<void> {
  if (await isDaemonAlive()) return;
  const out = openSync(logPath(), "a");
  const child = spawn(process.execPath, [process.argv[1], "__daemon"], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  // give it a moment to bind the socket
  await new Promise((r) => setTimeout(r, 300));
}
```
Note: align `checkTokenStatus`/`findCachedToken`/`refreshProfile`/`discoverProfiles` return shapes and `SSOProfile.name`/`.accountId` field names to the real code (Task conventions). Import and wire `sendNotification` in `maybeNotify`. The `__daemon` arg is the internal command routed in Task 11.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: clean (no test yet; integration verified after CLI routing in Task 11).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/client.ts src/daemon/index.ts
git commit -m "feat(cli): add daemon entry, detached spawn, and socket client"
```

---

## Phase 7 — Non-interactive CLI subcommands

### Task 8: `status`, `export`, `refresh`, `daemon …` commands

**Files:**
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/export.ts`
- Create: `src/cli/commands/refresh.ts`
- Create: `src/cli/commands/daemon.ts`
- Create: `src/cli/commands/status.test.ts`

- [ ] **Step 1: Write a failing test for the status formatter**

Create `src/cli/commands/status.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { formatStatusTable } from "./status";
import type { ProfileState } from "../../daemon/protocol";

test("formatStatusTable renders aligned rows", () => {
  const rows: ProfileState[] = [
    { name: "prod", status: "valid", expiresAt: "2026-06-11T13:00:00.000Z", favorite: true },
    { name: "staging", status: "needs-login", expiresAt: null, favorite: false },
  ];
  const out = formatStatusTable(rows, new Date("2026-06-11T12:00:00.000Z"));
  const lines = out.split("\n");
  expect(lines[0]).toContain("prod");
  expect(lines[0]).toContain("valid");
  expect(lines[0]).toContain("60m");
  expect(lines[1]).toContain("staging");
  expect(lines[1]).toContain("needs-login");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/commands/status.test.ts`
Expected: FAIL — module `./status` not found.

- [ ] **Step 3: Implement `status.ts`**

Create `src/cli/commands/status.ts`:
```typescript
import { request, isDaemonAlive } from "../../daemon/client";
import type { ProfileState } from "../../daemon/protocol";
import { discoverProfiles, checkTokenStatus, findCachedToken } from "../../aws/sso";
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

/** Build state directly from disk when no daemon is running. */
function localState(): ProfileState[] {
  const favorites = new Set(loadSettings().favoriteProfiles);
  const now = new Date();
  return discoverProfiles().map((p) => {
    const st = checkTokenStatus(p);
    const cached = findCachedToken(p);
    const ssoValid = cached !== null && new Date(cached.expiresAt) > now;
    const expiresAt = st.expiresAt ? new Date(st.expiresAt).toISOString() : null;
    return {
      name: p.name,
      status: ssoValid && expiresAt && new Date(expiresAt) > now ? "valid" : "needs-login",
      expiresAt,
      favorite: favorites.has(p.name),
      accountId: p.accountId,
    };
  });
}

export async function runStatus(): Promise<number> {
  const now = new Date();
  let rows: ProfileState[];
  if (await isDaemonAlive()) {
    const msg = await request({ type: "snapshot" });
    rows = msg.type === "state" ? msg.profiles : [];
  } else {
    rows = localState();
  }
  process.stdout.write(formatStatusTable(rows, now) + "\n");
  return 0;
}
```

- [ ] **Step 4: Run the status test**

Run: `bun test src/cli/commands/status.test.ts && bun run lint`
Expected: PASS, clean.

- [ ] **Step 5: Implement `export.ts`**

Create `src/cli/commands/export.ts`:
```typescript
import { discoverProfiles, refreshProfile, readProfileCredentials } from "../../aws/sso";
import { buildExportBlock } from "../../aws/console";

export async function runExport(profileName: string): Promise<number> {
  const profile = discoverProfiles().find((p) => p.name === profileName);
  if (!profile) {
    process.stderr.write(`unknown profile: ${profileName}\n`);
    return 1;
  }
  const result = await refreshProfile(profile);
  if (!result.success) {
    process.stderr.write(`cannot export ${profileName}: ${result.needsLogin ? "needs login" : result.error}\n`);
    return 1;
  }
  const creds = readProfileCredentials(profileName); // reads ~/.aws/credentials section
  if (!creds) {
    process.stderr.write(`no credentials found for ${profileName}\n`);
    return 1;
  }
  process.stdout.write(buildExportBlock(creds) + "\n");
  return 0;
}
```
Note: `readProfileCredentials` may not exist yet. If not, add a small reader in `src/aws/sso.ts` that parses the `[profileName]` section of `~/.aws/credentials` and returns `{accessKeyId, secretAccessKey, sessionToken}` (using the existing `ini` parsing already present in `sso.ts`). Confirm field names.

- [ ] **Step 6: Implement `refresh.ts`**

Create `src/cli/commands/refresh.ts`:
```typescript
import { discoverProfiles, refreshProfile, startDeviceAuthorization, performSSOLoginFlow } from "../../aws/sso";
import { loadSettings } from "../../aws/settings";

async function refreshOne(name: string): Promise<boolean> {
  const profile = discoverProfiles().find((p) => p.name === name);
  if (!profile) {
    process.stderr.write(`unknown profile: ${name}\n`);
    return false;
  }
  const result = await refreshProfile(profile);
  if (result.success) {
    process.stdout.write(`✓ ${name} refreshed\n`);
    return true;
  }
  if (result.needsLogin) {
    process.stdout.write(`${name} needs login — starting device authorization…\n`);
    const deviceAuth = await startDeviceAuthorization(profile);
    // prints/open browser handled inside performSSOLoginFlow; confirm it logs the verification URL+code
    await performSSOLoginFlow(profile, deviceAuth);
    process.stdout.write(`✓ ${name} logged in and refreshed\n`);
    return true;
  }
  process.stderr.write(`✗ ${name}: ${result.error}\n`);
  return false;
}

export async function runRefresh(profileArg?: string): Promise<number> {
  const targets = profileArg
    ? [profileArg]
    : loadSettings().favoriteProfiles;
  if (targets.length === 0) {
    process.stderr.write("no profile specified and no favorites configured\n");
    return 1;
  }
  let ok = true;
  for (const name of targets) ok = (await refreshOne(name)) && ok;
  return ok ? 0 : 1;
}
```

- [ ] **Step 7: Implement `daemon.ts`**

Create `src/cli/commands/daemon.ts`:
```typescript
import { spawnDetached } from "../../daemon/index";
import { request, isDaemonAlive } from "../../daemon/client";
import { readPidFile } from "../../daemon/lifecycle";

export async function runDaemonCommand(sub: string | undefined): Promise<number> {
  switch (sub) {
    case "start": {
      if (await isDaemonAlive()) {
        process.stdout.write("daemon already running\n");
        return 0;
      }
      await spawnDetached();
      process.stdout.write(
        (await isDaemonAlive()) ? "daemon started\n" : "failed to start daemon (see ~/.aws/ssomatic/daemon.log)\n",
      );
      return 0;
    }
    case "stop": {
      if (!(await isDaemonAlive())) {
        process.stdout.write("daemon not running\n");
        return 0;
      }
      await request({ type: "stop" }).catch(() => {});
      process.stdout.write("daemon stopped\n");
      return 0;
    }
    case "status":
    case undefined: {
      if (!(await isDaemonAlive())) {
        process.stdout.write("daemon: stopped\n");
        return 0;
      }
      const msg = await request({ type: "snapshot" });
      const pid = readPidFile();
      const watched = msg.type === "state" ? msg.profiles.filter((p) => p.favorite).map((p) => p.name) : [];
      process.stdout.write(`daemon: running (pid ${pid ?? "?"})\nwatching: ${watched.join(", ") || "(none)"}\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown daemon subcommand: ${sub}\n`);
      return 1;
  }
}
```

- [ ] **Step 8: Lint everything**

Run: `bun run lint && bun test`
Expected: clean; all existing + new tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands src/aws/sso.ts
git commit -m "feat(cli): add status, export, refresh, and daemon subcommands"
```

---

## Phase 8 — Argument routing

### Task 9: Route argv to subcommands, daemon, or the TUI

**Files:**
- Modify: `src/cli/index.tsx` (replace the top-level `--version` check with a full router; the TUI render moves behind a `launchTui()` function)
- Create: `src/cli/args.ts`
- Create: `src/cli/args.test.ts`

- [ ] **Step 1: Write the failing test for arg parsing**

Create `src/cli/args.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { parseArgs } from "./args";

test("no args → tui", () => {
  expect(parseArgs([])).toEqual({ kind: "tui", daemon: false });
});
test("--daemon flag → tui with daemon", () => {
  expect(parseArgs(["--daemon"])).toEqual({ kind: "tui", daemon: true });
});
test("--version → version", () => {
  expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  expect(parseArgs(["-v"])).toEqual({ kind: "version" });
});
test("status subcommand", () => {
  expect(parseArgs(["status"])).toEqual({ kind: "status" });
});
test("export requires a profile", () => {
  expect(parseArgs(["export", "prod"])).toEqual({ kind: "export", profile: "prod" });
});
test("refresh optional profile", () => {
  expect(parseArgs(["refresh"])).toEqual({ kind: "refresh", profile: undefined });
  expect(parseArgs(["refresh", "dev"])).toEqual({ kind: "refresh", profile: "dev" });
});
test("daemon subcommands", () => {
  expect(parseArgs(["daemon", "start"])).toEqual({ kind: "daemon", sub: "start" });
  expect(parseArgs(["daemon"])).toEqual({ kind: "daemon", sub: undefined });
});
test("internal __daemon command", () => {
  expect(parseArgs(["__daemon"])).toEqual({ kind: "__daemon" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/args.test.ts`
Expected: FAIL — module `./args` not found.

- [ ] **Step 3: Implement `args.ts`**

Create `src/cli/args.ts`:
```typescript
export type ParsedArgs =
  | { kind: "tui"; daemon: boolean }
  | { kind: "version" }
  | { kind: "status" }
  | { kind: "export"; profile: string }
  | { kind: "refresh"; profile?: string }
  | { kind: "daemon"; sub?: string }
  | { kind: "__daemon" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return { kind: "tui", daemon: false };
  if (cmd === "--version" || cmd === "-v") return { kind: "version" };
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return { kind: "help" };
  if (cmd === "--daemon") return { kind: "tui", daemon: true };
  if (cmd === "__daemon") return { kind: "__daemon" };
  if (cmd === "status") return { kind: "status" };
  if (cmd === "refresh") return { kind: "refresh", profile: rest[0] };
  if (cmd === "export") {
    if (!rest[0]) return { kind: "error", message: "export requires a profile name" };
    return { kind: "export", profile: rest[0] };
  }
  if (cmd === "daemon") return { kind: "daemon", sub: rest[0] };
  return { kind: "error", message: `unknown command: ${cmd}` };
}
```

- [ ] **Step 4: Run the args test**

Run: `bun test src/cli/args.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `index.tsx` entry**

In `src/cli/index.tsx`, replace the existing `--version` handling at the bottom with a router. Keep the existing TUI component, but render it from `launchTui(daemon)`. Add:
```typescript
import { render } from "ink";
import { parseArgs } from "./args";
import { runStatus } from "./commands/status";
import { runExport } from "./commands/export";
import { runRefresh } from "./commands/refresh";
import { runDaemonCommand } from "./commands/daemon";
import { runDaemon } from "../daemon/index";
import { VERSION } from "../version"; // confirm export name

const HELP = `ssomatic — interactive AWS SSO credential manager

Usage:
  ssomatic                 launch the interactive TUI
  ssomatic --daemon        launch the TUI and start the background daemon
  ssomatic status          print profile statuses and exit
  ssomatic refresh [name]  refresh a profile (or all favorites) now
  ssomatic export <name>   print export AWS_* lines for eval $(...)
  ssomatic daemon start|stop|status
  ssomatic --version
`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.kind) {
    case "version":
      process.stdout.write(VERSION + "\n");
      return;
    case "help":
      process.stdout.write(HELP);
      return;
    case "status":
      process.exit(await runStatus());
      return;
    case "export":
      process.exit(await runExport(parsed.profile));
      return;
    case "refresh":
      process.exit(await runRefresh(parsed.profile));
      return;
    case "daemon":
      process.exit(await runDaemonCommand(parsed.sub));
      return;
    case "__daemon":
      await runDaemon();   // long-lived; do not exit
      return;
    case "error":
      process.stderr.write(parsed.message + "\n");
      process.exit(1);
      return;
    case "tui":
      launchTui(parsed.daemon);
      return;
  }
}

function launchTui(startDaemon: boolean): void {
  render(<SSOmatic startDaemon={startDaemon} />); // SSOmatic = existing root component, extended in Task 12
}

void main();
```
Adapt `VERSION` import to the actual export in `src/version.ts`. Remove the old bottom-of-file `--version` block so there is a single entry path.

- [ ] **Step 6: Verify subcommands work end-to-end**

Run:
```bash
bun run build
node dist/cli.js --help
node dist/cli.js status
node dist/cli.js daemon status
node dist/cli.js daemon start && node dist/cli.js daemon status && node dist/cli.js daemon stop
```
Expected: help prints; `status` prints a table (or empty if no profiles); `daemon start` reports started, `status` shows running with a pid, `stop` reports stopped. Check `~/.aws/ssomatic/daemon.log` if start fails.

- [ ] **Step 7: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts src/cli/index.tsx
git commit -m "feat(cli): route argv to subcommands, daemon, or TUI"
```

---

## Phase 9 — TUI: live-state hook

### Task 10: `useDaemon` — connect, attach, expose live profiles

**Files:**
- Create: `src/cli/tui/useDaemon.ts`

No unit test (React hook over a socket; verified manually in Task 11–12). Keep logic thin.

- [ ] **Step 1: Implement `useDaemon.ts`**

Create `src/cli/tui/useDaemon.ts`:
```typescript
import { useEffect, useState, useCallback } from "react";
import { subscribe, request, isDaemonAlive } from "../../daemon/client";
import { spawnDetached } from "../../daemon/index";
import type { ProfileState, DaemonInfo } from "../../daemon/protocol";

export interface DaemonView {
  running: boolean;
  info: DaemonInfo | null;
  profiles: ProfileState[];
  startBackground: () => Promise<void>;
  refresh: (profile?: string) => Promise<void>;
  setFavorite: (profile: string, value: boolean) => Promise<void>;
}

export function useDaemon(localProfiles: ProfileState[]): DaemonView {
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<DaemonInfo | null>(null);
  const [profiles, setProfiles] = useState<ProfileState[]>(localProfiles);

  useEffect(() => {
    let sub: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const alive = await isDaemonAlive();
      if (cancelled) return;
      setRunning(alive);
      if (alive) {
        sub = subscribe((msg) => {
          if (msg.type === "state") {
            setInfo(msg.daemon);
            setProfiles(msg.profiles);
          }
        });
      }
    })();
    return () => {
      cancelled = true;
      sub?.stop();
    };
  }, []);

  const startBackground = useCallback(async () => {
    await spawnDetached();
    setRunning(await isDaemonAlive());
    // subscribe now that it's up
    subscribe((msg) => {
      if (msg.type === "state") {
        setInfo(msg.daemon);
        setProfiles(msg.profiles);
      }
    });
  }, []);

  const refresh = useCallback(async (profile?: string) => {
    if (await isDaemonAlive()) await request({ type: "refresh", profile });
  }, []);

  const setFavorite = useCallback(async (profile: string, value: boolean) => {
    if (await isDaemonAlive()) await request({ type: "setFavorite", profile, value });
  }, []);

  return { running, info, profiles, startBackground, refresh, setFavorite };
}
```
Note: when the daemon is NOT running, `refresh`/`setFavorite` are no-ops over the socket — the Dashboard must also update local settings/state directly in that case (Task 12 wires both paths). Favorite toggles persist via `saveSettings` regardless of daemon presence.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tui/useDaemon.ts
git commit -m "feat(cli): add useDaemon hook for live socket state"
```

---

## Phase 10 — TUI: dashboard, details, settings

### Task 11: List-first Dashboard component

**Files:**
- Create: `src/cli/tui/Dashboard.tsx`
- Reuse: existing `src/cli/components/*` (`List`, `Card`, `Divider`, `Header`, `Spinner`, `StatusMessage`, `CopyFeedback`)

This replaces the old menu → screens flow. The Dashboard is the single home view.

- [ ] **Step 1: Implement `Dashboard.tsx`**

Create `src/cli/tui/Dashboard.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState } from "../../daemon/protocol";
import { useCopy } from "../hooks";
import { buildExportBlock } from "../../aws/console";

interface Props {
  profiles: ProfileState[];
  daemonRunning: boolean;
  onRefresh: (names: string[]) => void;
  onToggleFavorite: (name: string) => void;
  onRunBackground: () => void;
  onOpenDetails: (name: string) => void;
  onOpenConsole: (name: string) => void;
  onCopyExport: (name: string) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

const STATUS_COLOR: Record<ProfileState["status"], string> = {
  valid: "green",
  refreshing: "cyan",
  expired: "yellow",
  "needs-login": "yellow",
  error: "red",
};

function minsLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const m = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  return m <= 0 ? "expired" : `${m}m`;
}

export function Dashboard(props: Props) {
  const { profiles } = props;
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);

  const visible = filter
    ? profiles.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : profiles;
  const current = visible[Math.min(cursor, visible.length - 1)];

  useInput((input, key) => {
    if (filtering) {
      if (key.return || key.escape) setFiltering(false);
      else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (input) setFilter((f) => f + input);
      return;
    }
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(visible.length - 1, c + 1));
    else if (input === " " && current) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(current.name) ? n.delete(current.name) : n.add(current.name);
        return n;
      });
    } else if (input === "a") {
      setSelected((s) => (s.size === visible.length ? new Set() : new Set(visible.map((p) => p.name))));
    } else if (input === "r") {
      const names = selected.size ? [...selected] : current ? [current.name] : [];
      props.onRefresh(names);
    } else if (input === "f" && current) props.onToggleFavorite(current.name);
    else if (input === "b") props.onRunBackground();
    else if (input === "c" && current) props.onCopyExport(current.name);
    else if (input === "o" && current) props.onOpenConsole(current.name);
    else if (key.return && current) props.onOpenDetails(current.name);
    else if (input === "/") setFiltering(true);
    else if (input === "s") props.onOpenSettings();
    else if (input === "q") props.onQuit();
  });

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>🔐 SSOmatic</Text>
        <Text>{props.daemonRunning ? "daemon ● running" : "daemon ○ off"}</Text>
      </Box>
      <Text dimColor>{"─".repeat(48)}</Text>
      {filtering && <Text>/{filter}</Text>}
      {visible.map((p, i) => {
        const isCursor = p.name === current?.name;
        const isSel = selected.has(p.name);
        return (
          <Text key={p.name} color={isCursor ? "cyan" : undefined}>
            {isCursor ? "▸ " : "  "}
            {isSel ? "◉ " : "  "}
            {p.favorite ? "★ " : "  "}
            {p.name.padEnd(12)}
            <Text color={STATUS_COLOR[p.status]}>{p.status.padEnd(12)}</Text>
            {minsLeft(p.expiresAt).padEnd(8)}
            {p.accountId ?? ""}
          </Text>
        );
      })}
      <Text dimColor>{"─".repeat(48)}</Text>
      <Text dimColor>↑↓ move  space sel  ⏎ details  r refresh  b bg</Text>
      <Text dimColor>f ★  c copy  o console  / filter  s settings  q quit</Text>
    </Box>
  );
}
```
Note: `Date.now()` is fine in the real app runtime (it's only unavailable inside Workflow scripts/this planning sandbox). Confirm `useCopy`/`buildExportBlock` usage when wiring copy feedback; the actual clipboard write happens in the container (Task 12) via `onCopyExport`.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tui/Dashboard.tsx
git commit -m "feat(cli): add list-first dashboard component"
```

### Task 12: Details + Settings views and the root container

**Files:**
- Create: `src/cli/tui/Details.tsx`
- Create: `src/cli/tui/Settings.tsx`
- Modify: `src/cli/index.tsx` — replace the old `SSOmatic` root component body with a container that owns view state (`dashboard | details | settings`), builds initial local profile state, uses `useDaemon`, and wires all Dashboard callbacks (including non-daemon fallbacks: local refresh via `refreshProfile`, favorite persistence via `saveSettings`, clipboard via `copyToClipboard`, console open via `getConsoleSigninUrl` + `openBrowser`).

- [ ] **Step 1: Implement `Details.tsx`**

Create `src/cli/tui/Details.tsx`:
```tsx
import React from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState } from "../../daemon/protocol";

interface Props {
  profile: ProfileState;
  arn?: string;
  region?: string;
  startUrl?: string;
  onBack: () => void;
}

export function Details({ profile, arn, region, startUrl, onBack }: Props) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });
  const row = (label: string, value: string) => (
    <Text>
      <Text dimColor>{label.padEnd(10)}</Text>
      {value}
    </Text>
  );
  return (
    <Box flexDirection="column">
      <Text bold>⏎ {profile.name}</Text>
      {row("account", profile.accountId ?? "—")}
      {row("role", arn ?? "—")}
      {row("region", region ?? "—")}
      {row("status", profile.status)}
      {row("expires", profile.expiresAt ?? "—")}
      {row("sso url", startUrl ?? "—")}
      <Text dimColor>esc back</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Implement `Settings.tsx`**

Create `src/cli/tui/Settings.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AppSettings } from "../../aws/settings";

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
}

export function Settings({ settings, onChange, onBack }: Props) {
  const [cursor, setCursor] = useState(0);
  const items = ["notifications", "refreshLeadMinutes", "autoStartDaemon"] as const;

  useInput((input, key) => {
    if (key.escape) return onBack();
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(items.length - 1, c + 1));
    else if (key.return || input === " ") {
      const field = items[cursor];
      if (field === "notifications") onChange({ ...settings, notifications: !settings.notifications });
      else if (field === "autoStartDaemon") onChange({ ...settings, autoStartDaemon: !settings.autoStartDaemon });
    } else if (field_is_lead(items[cursor])) {
      if (key.leftArrow) onChange({ ...settings, refreshLeadMinutes: Math.max(1, settings.refreshLeadMinutes - 1) });
      else if (key.rightArrow) onChange({ ...settings, refreshLeadMinutes: settings.refreshLeadMinutes + 1 });
    }
  });

  function field_is_lead(f: (typeof items)[number]) {
    return f === "refreshLeadMinutes";
  }

  const line = (i: number, label: string, value: string) => (
    <Text color={cursor === i ? "cyan" : undefined}>
      {cursor === i ? "▸ " : "  "}
      {label.padEnd(22)}
      {value}
    </Text>
  );

  return (
    <Box flexDirection="column">
      <Text bold>⚙ Settings</Text>
      {line(0, "Notifications", settings.notifications ? "on" : "off")}
      {line(1, "Refresh lead (min)", String(settings.refreshLeadMinutes) + "  (←/→)")}
      {line(2, "Auto-start daemon", settings.autoStartDaemon ? "on" : "off")}
      <Text dimColor>space/⏎ toggle  ←→ adjust  esc back</Text>
    </Box>
  );
}
```
Note: clean up the `field_is_lead` placement (hoist above `useInput` or inline the check) so it lints; the logic shown is the intended behavior.

- [ ] **Step 3: Rewrite the `SSOmatic` root container in `index.tsx`**

Replace the old menu/view component body with:
```tsx
function SSOmatic({ startDaemon }: { startDaemon: boolean }) {
  const { exit } = useApp();
  const [view, setView] = useState<"dashboard" | "details" | "settings">("dashboard");
  const [detailName, setDetailName] = useState<string | null>(null);
  const [settings, setSettings] = useState(() => loadSettings());

  // initial local state from disk (daemon overrides via useDaemon when running)
  const initial = useMemo<ProfileState[]>(() => buildLocalProfileStates(settings), []);
  const daemon = useDaemon(initial);

  useEffect(() => {
    if (startDaemon) void daemon.startBackground();
  }, [startDaemon]);

  const profiles = daemon.profiles;

  const persistFavorite = (name: string) => {
    const set = new Set(settings.favoriteProfiles);
    set.has(name) ? set.delete(name) : set.add(name);
    const next = { ...settings, favoriteProfiles: [...set] };
    setSettings(next);
    saveSettings(next);
    void daemon.setFavorite(name, set.has(name)); // no-op if daemon down
  };

  const doRefresh = async (names: string[]) => {
    if (daemon.running) return void daemon.refresh(names.length === 1 ? names[0] : undefined);
    for (const name of names) {
      const p = discoverProfiles().find((x) => x.name === name);
      if (p) await refreshProfile(p);
    }
  };

  const copyExport = async (name: string) => {
    const p = discoverProfiles().find((x) => x.name === name);
    if (!p) return;
    await refreshProfile(p);
    const creds = readProfileCredentials(name);
    if (creds) await copyToClipboard(buildExportBlock(creds));
  };

  const openConsole = async (name: string) => {
    const creds = readProfileCredentials(name);
    if (!creds) return;
    const url = await getConsoleSigninUrl(creds);
    await openBrowser(url);
  };

  if (view === "settings")
    return (
      <App>
        <Settings
          settings={settings}
          onChange={(next) => {
            setSettings(next);
            saveSettings(next);
          }}
          onBack={() => setView("dashboard")}
        />
      </App>
    );

  if (view === "details" && detailName) {
    const p = profiles.find((x) => x.name === detailName);
    if (p)
      return (
        <App>
          <Details profile={p} onBack={() => setView("dashboard")} />
        </App>
      );
  }

  return (
    <App>
      <Dashboard
        profiles={profiles}
        daemonRunning={daemon.running}
        onRefresh={(names) => void doRefresh(names)}
        onToggleFavorite={persistFavorite}
        onRunBackground={() => void daemon.startBackground()}
        onOpenDetails={(name) => {
          setDetailName(name);
          setView("details");
        }}
        onOpenConsole={(name) => void openConsole(name)}
        onCopyExport={(name) => void copyExport(name)}
        onOpenSettings={() => setView("settings")}
        onQuit={() => exit()}
      />
    </App>
  );
}
```
Add `buildLocalProfileStates(settings)` near the top of `index.tsx` (same logic as `localState()` in `status.ts` — extract a shared helper in `src/aws/sso.ts` named `buildProfileStates(favorites: Set<string>): ProfileState[]` and use it from both places to stay DRY). Import `useApp, useState, useEffect, useMemo`, `App` (existing root layout), `Dashboard`, `Details`, `Settings`, `useDaemon`, core functions, `loadSettings`, `saveSettings`, `copyToClipboard`, `openBrowser`, `getConsoleSigninUrl`, `buildExportBlock`, `readProfileCredentials`. Remove all now-dead old view components (StatusTable, RefreshProgress, DaemonView, daemon-interval list, the main menu `List`) from `index.tsx`.

- [ ] **Step 4: Build + manual smoke test the whole TUI**

Run: `bun run lint && bun test && bun run build`
Then exercise interactively:
```bash
node dist/cli.js
```
Verify: dashboard lists profiles with statuses; `j/k` move; `f` toggles a star (persists — re-open to confirm); `b` flips header to "daemon ● running"; `r` triggers a refresh; `Enter` opens details, `Esc` back; `s` opens settings, toggles persist; `o` opens the AWS console in browser for a valid profile; `c` copies an export block (paste to verify); `/` filters; `q` quits. With the daemon started, open a second terminal and run `node dist/cli.js status` — it should reflect the live state.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/Details.tsx src/cli/tui/Settings.tsx src/cli/index.tsx src/aws/sso.ts
git commit -m "feat(cli): wire dashboard, details, settings into list-first TUI root"
```

---

## Phase 11 — Cleanup, README, docs

### Task 13: Remove dead code and stale tests; align CLAUDE.md

**Files:**
- Modify: delete any now-unused old components in `src/cli/components/` that the new TUI no longer imports (verify with grep before deleting — keep `List`, `Card`, `Divider`, `Header`, `Spinner`, `StatusMessage`, `CopyFeedback`, `IdentityCard` if still referenced; remove `MultiSelectList` only if unused).
- Modify: `src/aws/sso.test.ts` — remove the `defaultInterval` settings assertion (moved to `settings.test.ts`); keep token/discovery/`formatExpiry`/`sortByFavorites` tests.
- Modify: `CLAUDE.md` — update Structure (`daemon/`, `cli/commands/`, `cli/tui/`), Keyboard Shortcuts table, and the Auto-refresh description.

- [ ] **Step 1: Find dead references**

Run:
```bash
grep -rn "MultiSelectList\|DaemonView\|StatusTable\|RefreshProgress\|defaultInterval\|daemon-interval" src
```
Delete components/branches with zero remaining references.

- [ ] **Step 2: Update `sso.test.ts`**

Remove any settings tests that reference `defaultInterval` or the old settings API now living in `settings.test.ts`.

- [ ] **Step 3: Update `CLAUDE.md`**

Update the Structure block to include `src/daemon/`, `src/cli/commands/`, `src/cli/tui/`; update the Keyboard Shortcuts table to the new dashboard keys; replace the "Auto-refresh daemon" wording with the real background-daemon description.

- [ ] **Step 4: Verify green**

Run: `bun run lint && bun test && bun run build`
Expected: all pass, no unused-import warnings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(cli): remove dead menu-era code and update CLAUDE.md"
```

### Task 14: Rewrite README for npm appeal

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the README**

Rewrite `README.md` with this structure (fill with real content):
1. **Title + one-line hook** — e.g. "Keep your AWS SSO credentials fresh, automatically — a fast terminal dashboard with a background daemon."
2. Badges (keep existing).
3. **Why SSOmatic** — 3-4 bullets: list-first dashboard, background daemon keeps favorites fresh (expiry-aware), notify-on-login, one-keystroke copy/console/export.
4. **Demo GIF** (`docs/screenshots/cli-demo.gif`).
5. **Install** (`npx ssomatic`, `bunx`, `npm i -g`).
6. **Quick start** — launch the TUI; star the profiles you use (`f`); press `b` to run in the background; re-run `ssomatic` from any terminal to attach.
7. **Commands** — table of `status`, `refresh`, `export`, `daemon start|stop|status`, plus `eval $(ssomatic export prod)`.
8. **Keyboard shortcuts** — new dashboard table.
9. **How the daemon works** — single instance per host, Unix socket, silent role-cred refresh while the SSO token is valid, desktop notification when a browser login is required (never opens a browser unprompted).
10. **Prerequisites** (AWS CLI v2 SSO config), **Development**, **Contributing**, **License**.

- [ ] **Step 2: Record a fresh demo GIF (manual)**

Replace `docs/screenshots/cli-demo.gif` with a new recording of the dashboard (navigate, star, run in background, refresh, attach from a second terminal). If you cannot record now, leave the existing GIF and add a `<!-- TODO: re-record demo for 2.0 -->` note — but prefer recording.

- [ ] **Step 3: Verify links/build**

Run: `bun run build` and visually confirm the README renders (preview in editor). Check that every command shown matches `ssomatic --help`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/screenshots/cli-demo.gif
git commit -m "docs: rewrite README for SSOmatic 2.0 with daemon + dashboard"
```

---

## Phase 12 — Final verification

### Task 15: Full regression + PR

- [ ] **Step 1: Full green check**

Run: `bun install && bun run lint && bun test && bun run build`
Expected: all pass.

- [ ] **Step 2: End-to-end daemon lifecycle**

```bash
node dist/cli.js daemon start
node dist/cli.js daemon status      # running, pid, watched favorites
node dist/cli.js status             # live snapshot via socket
# open a second terminal:
node dist/cli.js                    # attaches, shows live state; q to detach
node dist/cli.js daemon stop
node dist/cli.js daemon status      # stopped
```
Expected: single instance enforced (a second `daemon start` says "already running"); state consistent across terminals; clean stop.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/v2-daemon-ux
gh pr create --title "feat(cli): background daemon + list-first dashboard (SSOmatic 2.0)" \
  --body "Implements docs/superpowers/specs/2026-06-11-ssomatic-v2-daemon-ux-design.md"
```
Note: the squash-merge PR title drives release-please. `feat(cli):` → minor bump. If you intend a major (2.0), use `feat(cli)!:` with a `BREAKING CHANGE:` footer in the body (the interval-picker removal and command surface change justify a major).

---

## Self-review notes (coverage map)

- Daemon + Unix socket, live attach → Tasks 3, 6, 7, 10, 12.
- Notify + wait on needs-login → Task 7 (`maybeNotify`, daemon never opens browser).
- Bare `ssomatic` opens TUI, daemon opt-in → Tasks 9, 12 (`startDaemon` only via `--daemon`/`b`).
- Full subcommand set → Task 8 (`status`/`export`/`refresh`/`daemon`).
- List-first dashboard → Tasks 11, 12.
- Expiry-aware scheduling, no interval → Task 5; interval removed in Tasks 1, 13.
- Favorites = managed set → Tasks 1, 7, 12.
- Cred actions (copy export, open console, details, copy name) → Tasks 2, 11, 12.
- Single instance per host → Task 4 (`isDaemonAlive`/`reclaimStaleSocket`).
- Latest libs → Task 0. README rewrite → Task 14. Refactor/cleanup → Tasks 1, 13.
- Settings shrink (notifications, lead-time, auto-start) → Tasks 1, 12.

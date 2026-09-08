import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TMP: string;
let sso: typeof import("./sso.ts");
let sessionOf: typeof import("./profiles.ts")["sessionOf"];

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-test-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  sso = await import("./sso.ts");
  ({ sessionOf } = await import("./profiles.ts"));
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const DEV = {
  kind: "sso" as const,
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

test("saveSettings / loadSettings round-trip", async () => {
  const { saveSettings, loadSettings } = await import("./settings");
  saveSettings({ notifications: false, refreshLeadMinutes: 30, favoriteProfiles: ["dev"] });
  const loaded = loadSettings();
  expect(loaded.notifications).toBe(false);
  expect(loaded.refreshLeadMinutes).toBe(30);
  expect(loaded.favoriteProfiles).toEqual(["dev"]);
});

test("token cache round-trips through disk", async () => {
  const future = new Date(Date.now() + 3_600_000);
  await sso.saveSSOTokenToCache(sessionOf(DEV), { accessToken: "tok-123", expiresAt: future });

  const cached = await sso.findCachedToken(sessionOf(DEV));
  expect(cached?.accessToken).toBe("tok-123");
  expect(cached?.expiresAt.getTime()).toBe(future.getTime());
});

test("findCachedToken returns null when no token has been cached", async () => {
  const unknown = { ...DEV, ssoSession: "never-logged-in" };
  expect(await sso.findCachedToken(sessionOf(unknown))).toBeNull();
});


test("only a rejected token routes the user to an interactive login", () => {
  const named = (name: string) => Object.assign(new Error("boom"), { name });

  expect(sso.classifyCredentialsError(named("UnauthorizedException"), DEV).failure).toBe("expired-token");
  expect(sso.classifyCredentialsError(named("ExpiredTokenException"), DEV).failure).toBe("expired-token");

  // A transient network fault must NOT send the user through a browser login
  // it cannot fix.
  expect(sso.classifyCredentialsError(named("TimeoutError"), DEV).failure).toBe("unavailable");
  expect(sso.classifyCredentialsError(named("TooManyRequestsException"), DEV).failure).toBe("unavailable");

  // Neither must a role the user simply is not entitled to.
  const denied = sso.classifyCredentialsError(named("ForbiddenException"), DEV);
  expect(denied.failure).toBe("denied");
  expect(denied.error).toContain(DEV.ssoRoleName);
});

test("classifyCredentialsError copes with a non-Error throw", () => {
  expect(sso.classifyCredentialsError("just a string", DEV).failure).toBe("unavailable");
});

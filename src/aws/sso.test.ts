import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

// ── One login per portal ────────────────────────────────────────────────────

const PORTAL = "https://shared.awsapps.com/start";
const session = (name: string, startUrl = PORTAL) => ({ name, startUrl, region: "eu-west-1" });

async function writeConfig() {
  const block = (name: string, url: string) => [`[sso-session ${name}]`, `sso_start_url = ${url}`, "sso_region = eu-west-1", ""];
  await writeFile(
    join(TMP, ".aws", "config"),
    [...block("team-dev", PORTAL), ...block("team-prod", `${PORTAL}#`), ...block("other", "https://other.awsapps.com/start")].join("\n"),
  );
}

test("a login through one session serves every session naming the same portal", async () => {
  await writeConfig();
  const later = new Date(Date.now() + 8 * 3_600_000);
  await sso.saveSSOTokenToCache(session("team-dev"), { accessToken: "shared", expiresAt: later });

  expect((await sso.findCachedToken(session("team-prod", `${PORTAL}#`)))?.accessToken).toBe("shared");
  expect(await sso.findCachedToken(session("other", "https://other.awsapps.com/start"))).toBeNull();

  // Written to the sibling's own file too, which is where the AWS CLI looks.
  const siblingFile = join(TMP, ".aws", "sso", "cache", `${createHash("sha1").update("team-prod").digest("hex")}.json`);
  expect(JSON.parse(await readFile(siblingFile, "utf8")).accessToken).toBe("shared");
});

test("pickToken prefers a live token, then a renewable one", () => {
  const now = new Date();
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const dead = { accessToken: "dead", expiresAt: at(-1) };
  const renewable = { accessToken: "renew", expiresAt: at(-1), refreshToken: "r", clientId: "c", clientSecret: "s" };
  const short = { accessToken: "short", expiresAt: at(1) };
  const long = { accessToken: "long", expiresAt: at(5) };

  expect(sso.pickToken([dead, short, long, renewable], now)?.accessToken).toBe("long");
  expect(sso.pickToken([dead, renewable], now)?.accessToken).toBe("renew");
  expect(sso.pickToken([null, dead], now)?.accessToken).toBe("dead");
  expect(sso.pickToken([null], now)).toBeNull();
});

test("canRefresh needs a refresh token and a live client registration", () => {
  const now = new Date();
  const base = { accessToken: "a", expiresAt: now, refreshToken: "r", clientId: "c", clientSecret: "s" };
  expect(sso.canRefresh(base, now)).toBe(true);
  expect(sso.canRefresh({ ...base, refreshToken: undefined }, now)).toBe(false);
  expect(sso.canRefresh({ ...base, registrationExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
});

// ── Refresh tokens ──────────────────────────────────────────────────────────

const REFRESH = session("renewing", "https://renewing.awsapps.com/start");
const refreshable = (expiresAt: Date) => ({
  accessToken: "old",
  expiresAt,
  refreshToken: "refresh-1",
  clientId: "client",
  clientSecret: "secret",
  registrationExpiresAt: new Date(Date.now() + 90 * 86_400_000),
});

test("an access token about to lapse is renewed without a browser, and cached", async () => {
  await sso.saveSSOTokenToCache(REFRESH, refreshable(new Date(Date.now() + 60_000)));
  const renewed = await sso.findValidToken(REFRESH, new Date(), async (_, token) => ({
    ...token,
    accessToken: "new",
    expiresAt: new Date(Date.now() + 3_600_000),
    refreshToken: "refresh-2",
  }));

  expect(renewed?.accessToken).toBe("new");
  const cached = await sso.findCachedToken(REFRESH);
  expect(cached).toMatchObject({ accessToken: "new", refreshToken: "refresh-2", clientId: "client" });
});

test("a token with time left is used as is", async () => {
  await sso.saveSSOTokenToCache(REFRESH, refreshable(new Date(Date.now() + 3_600_000)));
  let called = false;
  const token = await sso.findValidToken(REFRESH, new Date(), async (_, t) => ((called = true), t));
  expect(token?.accessToken).toBe("old");
  expect(called).toBe(false);
});

test("a refused renewal drops the refresh token, so the profile asks for a login", async () => {
  await sso.saveSSOTokenToCache(REFRESH, refreshable(new Date(Date.now() - 60_000)));
  const token = await sso.findValidToken(REFRESH, new Date(), async () => {
    throw Object.assign(new Error("session over"), { name: "InvalidGrantException" });
  });
  expect(token).toBeNull();
  expect(sso.canRefresh((await sso.findCachedToken(REFRESH))!)).toBe(false);
});

test("a renewal that fails on the network keeps the refresh token for next time", async () => {
  await sso.saveSSOTokenToCache(REFRESH, refreshable(new Date(Date.now() - 60_000)));
  const token = await sso.findValidToken(REFRESH, new Date(), async () => {
    throw Object.assign(new Error("offline"), { name: "TimeoutError" });
  });
  expect(token).toBeNull();
  expect(sso.canRefresh((await sso.findCachedToken(REFRESH))!)).toBe(true);
});

test("using a sibling's token copies it into this session's own file", async () => {
  await writeConfig();
  const own = join(TMP, ".aws", "sso", "cache", `${createHash("sha1").update("team-prod").digest("hex")}.json`);
  await sso.saveSSOTokenToCache(session("team-dev"), { accessToken: "fresh", expiresAt: new Date(Date.now() + 3_600_000) });
  // A stale token left behind by an earlier login through this session alone.
  await writeFile(own, JSON.stringify({ accessToken: "stale", expiresAt: new Date(Date.now() - 1000).toISOString() }));

  expect((await sso.findValidToken(session("team-prod")))?.accessToken).toBe("fresh");
  expect(JSON.parse(await readFile(own, "utf8")).accessToken).toBe("fresh");
});

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TMP: string;
let sso: typeof import("./sso.ts");

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-test-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  sso = await import("./sso.ts");
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const DEV = {
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

test("discoverProfiles parses sso-session and inline profiles", async () => {
  await writeFile(
    join(TMP, ".aws", "config"),
    [
      "[sso-session my-sso]",
      "sso_start_url = https://example.awsapps.com/start",
      "sso_region = us-east-1",
      "",
      "[profile dev]",
      "sso_session = my-sso",
      "sso_account_id = 111111111111",
      "sso_role_name = Developer",
      "region = eu-west-1",
      "",
      "[profile legacy]",
      "sso_start_url = https://legacy.awsapps.com/start",
      "sso_region = us-west-2",
      "sso_account_id = 222222222222",
      "sso_role_name = Admin",
      "",
    ].join("\n"),
  );

  const profiles = await sso.discoverProfiles();
  expect(profiles).toHaveLength(2);

  const dev = profiles.find((p) => p.name === "dev")!;
  expect(dev.ssoStartUrl).toBe("https://example.awsapps.com/start");
  expect(dev.ssoAccountId).toBe("111111111111");
  expect(dev.ssoRegion).toBe("us-east-1");
  expect(dev.ssoSession).toBe("my-sso");

  const legacy = profiles.find((p) => p.name === "legacy")!;
  expect(legacy.ssoRoleName).toBe("Admin");
  expect(legacy.ssoRegion).toBe("us-west-2");
});

test("saveSettings / loadSettings round-trip", async () => {
  const { saveSettings, loadSettings } = await import("./settings");
  saveSettings({ notifications: false, refreshLeadMinutes: 60, favoriteProfiles: ["dev"] });
  const loaded = loadSettings();
  expect(loaded.notifications).toBe(false);
  expect(loaded.refreshLeadMinutes).toBe(60);
  expect(loaded.favoriteProfiles).toEqual(["dev"]);
});

test("token cache round-trip + valid status", async () => {
  const future = new Date(Date.now() + 3_600_000);
  await sso.saveSSOTokenToCache(DEV, { accessToken: "tok-123", expiresAt: future });

  const cached = await sso.findCachedToken(DEV);
  expect(cached?.accessToken).toBe("tok-123");

  const status = await sso.checkTokenStatus(DEV);
  expect(status.status).toBe("valid");
});

test("checkTokenStatus returns expired for a past token", async () => {
  const past = new Date(Date.now() - 1000);
  const old = { ...DEV, name: "old", ssoStartUrl: "https://old.awsapps.com/start" };
  await sso.saveSSOTokenToCache(old, { accessToken: "old-tok", expiresAt: past });

  const status = await sso.checkTokenStatus(old);
  expect(status.status).toBe("expired");
});

test("sortByFavorites puts favorites first, then alphabetical", () => {
  const items = [{ n: "charlie" }, { n: "alpha" }, { n: "bravo" }];
  const sorted = sso.sortByFavorites(items, ["bravo"], (i) => i.n);
  expect(sorted.map((i) => i.n)).toEqual(["bravo", "alpha", "charlie"]);
});

test("formatExpiry formats hours/minutes and handles expired/unknown", () => {
  expect(sso.formatExpiry(undefined)).toBe("Unknown");
  expect(sso.formatExpiry(new Date(Date.now() - 1000))).toBe("Expired");
  const inAlmostTwoHours = new Date(Date.now() + 2 * 3_600_000 - 60_000);
  expect(sso.formatExpiry(inAlmostTwoHours)).toMatch(/^1h \d+m$/);
});

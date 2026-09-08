import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssumeProfile, SSOProfile } from "./profiles";

let TMP: string;
let refresh: typeof import("./refresh.ts");
let credentialsFile: typeof import("./credentialsFile.ts");

// Every case here resolves before any AWS call is attempted, so the tests stay
// offline: a cache hit, a missing token, a missing MFA code, a broken chain.
beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-refresh-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  refresh = await import("./refresh.ts");
  credentialsFile = await import("./credentialsFile.ts");
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeFile(join(TMP, ".aws", "credentials"), "");
});

const DEV: SSOProfile = {
  kind: "sso",
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

const PROD: AssumeProfile = {
  kind: "assume",
  name: "prod-admin",
  roleArn: "arn:aws:iam::333333333333:role/Admin",
  sourceProfile: "dev",
};

test("fresh cached credentials are handed back without contacting AWS", async () => {
  const expiration = new Date(Date.now() + 3_600_000);
  await credentialsFile.writeCredentials("dev", {
    accessKeyId: "ASIACACHED",
    secretAccessKey: "secret",
    sessionToken: "token",
    expiration,
  });

  const outcome = await refresh.ensureCredentials(DEV, { profiles: [DEV] });
  expect(outcome.ok).toBe(true);
  expect(outcome.ok && outcome.credentials.accessKeyId).toBe("ASIACACHED");
  expect(outcome.ok && outcome.credentials.expiresAt?.getTime()).toBe(expiration.getTime());
});

test("credentials inside the lead window are not handed out as-is", async () => {
  await credentialsFile.writeCredentials("dev", {
    accessKeyId: "ASIASTALE",
    secretAccessKey: "secret",
    sessionToken: "token",
    expiration: new Date(Date.now() + 30_000),
  });

  // No cached SSO token either, so the only honest answer is "log in".
  const outcome = await refresh.ensureCredentials(DEV, { profiles: [DEV] });
  expect(outcome).toEqual({ ok: false, reason: "needs-login", profile: DEV });
});

test("an SSO profile with no cached token needs an interactive login", async () => {
  const outcome = await refresh.refreshProfile(DEV, { profiles: [DEV] });
  expect(outcome).toEqual({ ok: false, reason: "needs-login", profile: DEV });
});

test("a chained profile reports the login as due for its source, not itself", async () => {
  const outcome = await refresh.refreshProfile(PROD, { profiles: [DEV, PROD] });
  expect(outcome).toEqual({ ok: false, reason: "needs-login", profile: DEV });
});

test("an MFA-gated profile asks for a code before calling STS", async () => {
  const locked: AssumeProfile = { ...PROD, mfaSerial: "arn:aws:iam::5:mfa/walid" };
  const outcome = await refresh.refreshProfile(locked, { profiles: [DEV, locked] });
  expect(outcome).toEqual({ ok: false, reason: "needs-mfa", profile: locked });
});

test("a source_profile loop fails instead of recursing forever", async () => {
  const a: AssumeProfile = { ...PROD, name: "a", sourceProfile: "b" };
  const b: AssumeProfile = { ...PROD, name: "b", sourceProfile: "a" };
  const outcome = await refresh.refreshProfile(a, { profiles: [a, b] });
  expect(outcome.ok).toBe(false);
  expect(outcome.ok === false && outcome.reason === "error" && outcome.error).toContain("loops");
});

test("a source profile with no credentials anywhere says exactly that", async () => {
  const orphan: AssumeProfile = { ...PROD, sourceProfile: "gone" };
  const outcome = await refresh.refreshProfile(orphan, { profiles: [orphan] });
  expect(outcome.ok === false && outcome.reason === "error" && outcome.error).toContain("gone");
});

test("describeOutcome explains each failure in one line", () => {
  expect(refresh.describeOutcome({ ok: false, reason: "needs-login", profile: DEV })).toContain("dev");
  expect(refresh.describeOutcome({ ok: false, reason: "needs-mfa", profile: PROD })).toContain("prod-admin");
  expect(refresh.describeOutcome({ ok: false, reason: "error", error: "boom" })).toBe("boom");
});

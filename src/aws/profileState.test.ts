import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssumeProfile, SSOProfile } from "./profiles";

let TMP: string;
let profileState: typeof import("./profileState.ts");
let sso: typeof import("./sso.ts");
let credentialsFile: typeof import("./credentialsFile.ts");

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-state-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  profileState = await import("./profileState.ts");
  sso = await import("./sso.ts");
  credentialsFile = await import("./credentialsFile.ts");
  await mkdir(join(TMP, ".aws"), { recursive: true });
  await writeFile(join(TMP, ".aws", "credentials"), "");
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const DEV: SSOProfile = {
  kind: "sso",
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
  ssoSession: "my-sso",
};

const CHAINED: AssumeProfile = {
  kind: "assume",
  name: "prod-admin",
  roleArn: "arn:aws:iam::333333333333:role/Admin",
  sourceProfile: "dev",
};

const NOW = new Date();
const cacheToken = (expiresAt: Date) =>
  sso.saveSSOTokenToCache({ name: "my-sso", startUrl: DEV.ssoStartUrl, region: DEV.ssoRegion }, {
    accessToken: "tok",
    expiresAt,
  });

test("a valid portal token makes an SSO profile valid", async () => {
  await cacheToken(new Date(NOW.getTime() + 8 * 3_600_000));
  const state = await profileState.buildProfileState(DEV, [DEV], true, NOW);
  expect(state).toMatchObject({ name: "dev", kind: "sso", status: "valid", favorite: true, accountId: "111111111111" });
  expect(state.ssoExpiresAt).not.toBeNull();
});

test("role credentials, not the portal token, drive the countdown", async () => {
  const expiration = new Date(NOW.getTime() + 3_000_000);
  await credentialsFile.writeCredentials("dev", {
    accessKeyId: "ASIA",
    secretAccessKey: "s",
    sessionToken: "t",
    expiration,
  });
  const state = await profileState.buildProfileState(DEV, [DEV], false, NOW);
  expect(state.expiresAt).toBe(expiration.toISOString());
  expect(state.credentialsExpireAt).toBe(expiration.toISOString());
  expect(state.ssoExpiresAt).not.toBe(state.expiresAt);
});

test("a profile with no credentials has no credential expiry, only a token one", async () => {
  await cacheToken(new Date(NOW.getTime() + 8 * 3_600_000));
  const fresh: SSOProfile = { ...DEV, name: "never-fetched" };
  const state = await profileState.buildProfileState(fresh, [fresh], false, NOW);

  expect(state.credentialsExpireAt).toBeNull();
  // The dashboard column still falls back to the token — it shows whatever
  // expires next — but the two are no longer the same field.
  expect(state.expiresAt).toBe(state.ssoExpiresAt);
});

test("a chained profile inherits the login state of the SSO profile it roots at", async () => {
  const state = await profileState.buildProfileState(CHAINED, [DEV, CHAINED], false, NOW);
  expect(state).toMatchObject({ kind: "assume", status: "valid", accountId: "333333333333" });

  await cacheToken(new Date(NOW.getTime() - 1000));
  const expired = await profileState.buildProfileState(CHAINED, [DEV, CHAINED], false, NOW);
  expect(expired.status).toBe("needs-login");
});

test("a chain rooted in long-lived IAM keys never asks for a browser login", async () => {
  const standalone: AssumeProfile = { ...CHAINED, name: "iam-chained", sourceProfile: "static" };
  const state = await profileState.buildProfileState(standalone, [standalone], false, NOW);
  expect(state.status).toBe("valid");
  expect(state.ssoExpiresAt).toBeNull();
});

test("an MFA-gated profile without usable credentials says it needs a code", async () => {
  await cacheToken(new Date(NOW.getTime() + 8 * 3_600_000));
  const locked: AssumeProfile = { ...CHAINED, name: "locked", mfaSerial: "arn:aws:iam::5:mfa/walid" };
  const state = await profileState.buildProfileState(locked, [DEV, locked], false, NOW);
  expect(state.status).toBe("needs-mfa");

  await credentialsFile.writeCredentials("locked", {
    accessKeyId: "ASIA",
    secretAccessKey: "s",
    sessionToken: "t",
    expiration: new Date(NOW.getTime() + 3_600_000),
  });
  const withCreds = await profileState.buildProfileState(locked, [DEV, locked], false, NOW);
  expect(withCreds.status).toBe("valid");
});

test("rootSSOProfile survives a source_profile cycle", () => {
  const a: AssumeProfile = { ...CHAINED, name: "a", sourceProfile: "b" };
  const b: AssumeProfile = { ...CHAINED, name: "b", sourceProfile: "a" };
  expect(profileState.rootSSOProfile(a, [a, b])).toBeNull();
});

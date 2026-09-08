import { test, expect } from "bun:test";
import type { StoredCredentials } from "../../aws/credentials";
import type { AssumeProfile, SSOProfile } from "../../aws/profiles";
import type { CredentialsOutcome } from "../../aws/refresh";
import { resolveCredentials, type CredentialPrompts } from "./credentials";

const DEV: SSOProfile = {
  kind: "sso",
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "1",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

const LOCKED: AssumeProfile = {
  kind: "assume",
  name: "locked",
  roleArn: "arn:aws:iam::3:role/Ops",
  sourceProfile: "dev",
  mfaSerial: "arn:aws:iam::3:mfa/walid",
};

const CREDS: StoredCredentials = { accessKeyId: "ASIA", secretAccessKey: "s", expiresAt: null };
const OK: CredentialsOutcome = { ok: true, credentials: CREDS };
const NEEDS_LOGIN: CredentialsOutcome = { ok: false, reason: "needs-login", profile: DEV };
const NEEDS_MFA: CredentialsOutcome = { ok: false, reason: "needs-mfa", profile: LOCKED };

/** A flow whose effects are all recorded, so each test asserts what was asked of the user. */
function spy(outcomes: CredentialsOutcome[], overrides: Partial<CredentialPrompts> = {}) {
  const calls = {
    fetch: [] as Record<string, string>[],
    logins: [] as string[],
    mfaPrompts: [] as string[],
  };
  const prompts: CredentialPrompts = {
    fetch: async (mfaCodes) => {
      calls.fetch.push({ ...mfaCodes });
      return outcomes[calls.fetch.length - 1] ?? outcomes[outcomes.length - 1]!;
    },
    login: async (profile) => {
      calls.logins.push(profile.name);
      return true;
    },
    askMfa: async (profileName) => {
      calls.mfaPrompts.push(profileName);
      return "123456";
    },
    interactive: true,
    ...overrides,
  };
  return { prompts, calls };
}

test("credentials that are already usable ask the user for nothing", async () => {
  const { prompts, calls } = spy([OK]);
  const result = await resolveCredentials("dev", prompts);

  expect(result).toEqual({ ok: true, credentials: CREDS });
  expect(calls.fetch).toEqual([{}]);
  expect(calls.logins).toEqual([]);
  expect(calls.mfaPrompts).toEqual([]);
});

test("an expired session logs in once, then retries", async () => {
  const { prompts, calls } = spy([NEEDS_LOGIN, OK]);
  const result = await resolveCredentials("dev", prompts);

  expect(result.ok).toBe(true);
  expect(calls.logins).toEqual(["dev"]);
  expect(calls.fetch).toHaveLength(2);
});

test("the login is for the profile that needs it, not the one asked for", async () => {
  // A chained profile reports its source as the one needing the browser login.
  const { prompts, calls } = spy([NEEDS_LOGIN, OK]);
  await resolveCredentials("prod-admin", prompts);
  expect(calls.logins).toEqual(["dev"]);
});

test("a login that does not help is not attempted twice", async () => {
  const { prompts, calls } = spy([NEEDS_LOGIN, NEEDS_LOGIN]);
  const result = await resolveCredentials("dev", prompts);

  expect(calls.logins).toHaveLength(1);
  expect(calls.fetch).toHaveLength(2);
  expect(result.ok).toBe(false);
  expect(result.ok === false && result.error).toContain("SSO login required");
});

test("a failed login stops rather than retrying the fetch", async () => {
  const { prompts, calls } = spy([NEEDS_LOGIN], { login: async () => false });
  const result = await resolveCredentials("dev", prompts);

  expect(result.ok === false && result.error).toBe("dev: SSO login failed");
  expect(calls.fetch).toHaveLength(1);
});

test("an MFA code is collected once and passed to the retry", async () => {
  const { prompts, calls } = spy([NEEDS_MFA, OK]);
  const result = await resolveCredentials("locked", prompts);

  expect(result.ok).toBe(true);
  expect(calls.mfaPrompts).toEqual(["locked"]);
  // The second fetch carries the code, under the name of the profile that asked.
  expect(calls.fetch).toEqual([{}, { locked: "123456" }]);
});

test("a rejected code is not re-prompted in a loop", async () => {
  const { prompts, calls } = spy([NEEDS_MFA, NEEDS_MFA]);
  const result = await resolveCredentials("locked", prompts);

  expect(calls.mfaPrompts).toHaveLength(1);
  expect(result.ok).toBe(false);
  expect(result.ok === false && result.error).toContain("MFA code required");
});

test("an empty answer at the MFA prompt gives up instead of retrying", async () => {
  const { prompts, calls } = spy([NEEDS_MFA], { askMfa: async () => undefined });
  const result = await resolveCredentials("locked", prompts);

  expect(result.ok).toBe(false);
  expect(calls.fetch).toHaveLength(1);
});

test("with nothing attached to answer, it says how to fix it by hand", async () => {
  for (const outcome of [NEEDS_LOGIN, NEEDS_MFA]) {
    const { prompts, calls } = spy([outcome], { interactive: false });
    const result = await resolveCredentials("prod", prompts);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("awssesh refresh prod");
    // This is the credential_process case: never block a caller that cannot answer.
    expect(calls.logins).toEqual([]);
    expect(calls.mfaPrompts).toEqual([]);
  }
});

test("a plain failure is reported as-is, with no prompting", async () => {
  const { prompts, calls } = spy([{ ok: false, reason: "error", error: "network unreachable" }]);
  const result = await resolveCredentials("dev", prompts);

  expect(result.ok === false && result.error).toBe("dev: network unreachable");
  expect(calls.logins).toEqual([]);
  expect(calls.mfaPrompts).toEqual([]);
});

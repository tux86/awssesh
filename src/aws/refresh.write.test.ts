import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredentialsResult } from "./credentials";
import type { AssumeProfile, SSOProfile } from "./profiles";
import type { CredentialProviders } from "./refresh";

// The providers are the one part of a refresh that talks to AWS. Substituting
// just those covers what the dispatcher itself does with a *successful* fetch:
// caching it, and feeding it to the next link of a chain.
const ssoCredentials: CredentialsResult = {
  credentials: {
    accessKeyId: "ASIASSO",
    secretAccessKey: "sso-secret",
    sessionToken: "sso-token",
    expiration: new Date("2027-01-01T00:00:00.000Z"),
  },
};

const assumeCalls: { region: string; sourceKeyId: string; mfaCode?: string }[] = [];

const providers: CredentialProviders = {
  fetchSSO: async () => ssoCredentials,
  assume: async (_profile, source, region, mfaCode) => {
    assumeCalls.push({ region, sourceKeyId: source.accessKeyId, mfaCode });
    return {
      credentials: {
        accessKeyId: "ASIAASSUMED",
        secretAccessKey: "assumed-secret",
        sessionToken: "assumed-token",
        expiration: new Date("2027-01-01T01:00:00.000Z"),
      },
    };
  },
};

let TMP: string;
let refresh: typeof import("./refresh.ts");

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
  region: "eu-west-1",
};

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-write-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  await mkdir(join(TMP, ".aws"), { recursive: true });
  refresh = await import("./refresh.ts");
});

afterAll(async () => {
  delete process.env.AWSSESH_DEMO;
  await rm(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  assumeCalls.length = 0;
  await writeFile(join(TMP, ".aws", "credentials"), "");
});

const credentialsFile = () => readFile(join(TMP, ".aws", "credentials"), "utf8");

test("a successful fetch is cached in ~/.aws/credentials, expiry included", async () => {
  const outcome = await refresh.refreshProfile(DEV, { profiles: [DEV], providers });
  expect(outcome).toMatchObject({ ok: true });
  expect(outcome.ok && outcome.credentials.accessKeyId).toBe("ASIASSO");

  const file = await credentialsFile();
  expect(file).toContain("[dev]");
  expect(file).toContain("aws_access_key_id = ASIASSO");
  expect(file).toContain("aws_session_token = sso-token");
  // Without this key the next run cannot tell live credentials from dead ones.
  expect(file).toContain("x_security_token_expires = 2027-01-01T00:00:00.000Z");
});

test("the cache is what makes the second call free", async () => {
  await refresh.refreshProfile(DEV, { profiles: [DEV], providers });
  const outcome = await refresh.ensureCredentials(DEV, { profiles: [DEV], providers });
  expect(outcome.ok && outcome.credentials.accessKeyId).toBe("ASIASSO");
});

test("a chained profile is assumed with its source's freshly fetched credentials", async () => {
  const outcome = await refresh.refreshProfile(PROD, { profiles: [DEV, PROD], providers });

  expect(outcome.ok && outcome.credentials.accessKeyId).toBe("ASIAASSUMED");
  expect(assumeCalls).toEqual([{ region: "eu-west-1", sourceKeyId: "ASIASSO", mfaCode: undefined }]);

  // Both links are cached: the source is now usable on its own too.
  const file = await credentialsFile();
  expect(file).toContain("[dev]");
  expect(file).toContain("[prod-admin]");
  expect(file).toContain("aws_access_key_id = ASIAASSUMED");
});

test("an MFA code reaches the STS call rather than being swallowed", async () => {
  const locked: AssumeProfile = { ...PROD, name: "locked", mfaSerial: "arn:aws:iam::3:mfa/walid" };
  const outcome = await refresh.refreshProfile(locked, { profiles: [DEV, locked], mfaCodes: { locked: "123456" }, providers });

  expect(outcome.ok).toBe(true);
  expect(assumeCalls[0]?.mfaCode).toBe("123456");
});

test("a chain with no region of its own signs where its source does", async () => {
  const regionless: AssumeProfile = { ...PROD, region: undefined };
  await refresh.refreshProfile(regionless, { profiles: [DEV, regionless], providers });
  expect(assumeCalls[0]?.region).toBe("us-east-1");
});

test("demo mode never writes canned credentials to the real file", async () => {
  process.env.AWSSESH_DEMO = "1";
  try {
    const outcome = await refresh.refreshProfile(DEV, { profiles: [DEV], providers });
    expect(outcome.ok).toBe(true);
    expect(await credentialsFile()).toBe("");
  } finally {
    delete process.env.AWSSESH_DEMO;
  }
});

test("each MFA-gated hop of a chain is asked for separately", async () => {
  const first: AssumeProfile = { ...PROD, name: "step-one", mfaSerial: "arn:aws:iam::3:mfa/one" };
  const second: AssumeProfile = {
    ...PROD,
    name: "step-two",
    sourceProfile: "step-one",
    mfaSerial: "arn:aws:iam::3:mfa/two",
  };
  const profiles = [DEV, first, second];

  // A code for the far end alone is not enough: the hop in between wants its own.
  const partial = await refresh.refreshProfile(second, {
    profiles,
    mfaCodes: { "step-two": "222222" },
    providers,
  });
  expect(partial).toEqual({ ok: false, reason: "needs-mfa", profile: first });

  const full = await refresh.refreshProfile(second, {
    profiles,
    mfaCodes: { "step-one": "111111", "step-two": "222222" },
    providers,
  });
  expect(full.ok).toBe(true);
  // A TOTP is single-use, so each hop must carry the code typed for it.
  expect(assumeCalls.map((call) => call.mfaCode)).toEqual(["111111", "222222"]);
});

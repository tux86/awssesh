import { test, expect } from "bun:test";
import { buildCredentialProcessOutput, buildExecEnv, buildExportBlock } from "./env";

const CREDS = {
  accessKeyId: "ASIAEXAMPLE",
  secretAccessKey: "secret",
  sessionToken: "token",
  expiration: new Date("2026-01-01T10:00:00.000Z"),
};

test("buildExportBlock produces shell export lines", () => {
  expect(buildExportBlock(CREDS)).toBe(
    "export AWS_ACCESS_KEY_ID=ASIAEXAMPLE\n" +
      "export AWS_SECRET_ACCESS_KEY=secret\n" +
      "export AWS_SESSION_TOKEN=token",
  );
});

test("buildExportBlock omits the session token for long-lived IAM keys", () => {
  const block = buildExportBlock({ accessKeyId: "AKIA", secretAccessKey: "s", expiresAt: null });
  expect(block).not.toContain("AWS_SESSION_TOKEN");
});

test("credential_process output matches the contract the SDKs parse", () => {
  expect(JSON.parse(buildCredentialProcessOutput(CREDS))).toEqual({
    Version: 1,
    AccessKeyId: "ASIAEXAMPLE",
    SecretAccessKey: "secret",
    SessionToken: "token",
    Expiration: "2026-01-01T10:00:00.000Z",
  });
});

test("credential_process output carries the expiry of stored credentials too", () => {
  const out = JSON.parse(
    buildCredentialProcessOutput({
      accessKeyId: "ASIA",
      secretAccessKey: "s",
      sessionToken: "t",
      expiresAt: new Date("2026-01-01T10:00:00.000Z"),
    }),
  );
  expect(out.Expiration).toBe("2026-01-01T10:00:00.000Z");
  expect(out.Version).toBe(1);
});

test("credential_process output is a single line of JSON", () => {
  expect(buildCredentialProcessOutput(CREDS).includes("\n")).toBe(false);
});

test("buildExecEnv injects the credentials and the region", () => {
  const env = buildExecEnv({ PATH: "/usr/bin" }, CREDS, "eu-west-1");
  expect(env.PATH).toBe("/usr/bin");
  expect(env.AWS_ACCESS_KEY_ID).toBe("ASIAEXAMPLE");
  expect(env.AWS_SESSION_TOKEN).toBe("token");
  expect(env.AWS_CREDENTIAL_EXPIRATION).toBe("2026-01-01T10:00:00.000Z");
  expect(env.AWS_REGION).toBe("eu-west-1");
  expect(env.AWS_DEFAULT_REGION).toBe("eu-west-1");
});

test("buildExecEnv drops inherited AWS credentials and profile selection", () => {
  const env = buildExecEnv(
    {
      AWS_PROFILE: "other",
      AWS_DEFAULT_PROFILE: "other",
      AWS_ACCESS_KEY_ID: "stale",
      AWS_SECRET_ACCESS_KEY: "stale",
      AWS_SESSION_TOKEN: "stale",
      AWS_SECURITY_TOKEN: "stale",
      AWS_CREDENTIAL_EXPIRATION: "stale",
      HOME: "/home/x",
    },
    { accessKeyId: "AKIA", secretAccessKey: "s", expiresAt: null },
  );
  expect(env.AWS_PROFILE).toBeUndefined();
  expect(env.AWS_DEFAULT_PROFILE).toBeUndefined();
  expect(env.AWS_SECURITY_TOKEN).toBeUndefined();
  expect(env.AWS_SESSION_TOKEN).toBeUndefined();
  expect(env.AWS_CREDENTIAL_EXPIRATION).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBe("AKIA");
  expect(env.HOME).toBe("/home/x");
});

test("buildExecEnv leaves the region alone when the profile has none", () => {
  const env = buildExecEnv({ AWS_REGION: "us-east-1" }, CREDS);
  expect(env.AWS_REGION).toBe("us-east-1");
});

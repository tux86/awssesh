import { test, expect } from "bun:test";
import type { AssumeProfile, SSOProfile } from "../../aws/profiles";
import { execRegion, exitCodeFor } from "./exec";

test("the command's own exit code is passed through", () => {
  expect(exitCodeFor(0, null)).toBe(0);
  expect(exitCodeFor(42, null)).toBe(42);
});

test("a killed command reports 128 + the signal, as a shell would", () => {
  expect(exitCodeFor(null, "SIGINT")).toBe(130);
  expect(exitCodeFor(null, "SIGTERM")).toBe(143);
  expect(exitCodeFor(null, "SIGKILL")).toBe(137);
});

test("no code and no signal is a success, not a crash", () => {
  expect(exitCodeFor(null, null)).toBe(0);
});

const SSO: SSOProfile = {
  kind: "sso",
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "1",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

test("only a region the profile declares is forced on the command", () => {
  expect(execRegion({ ...SSO, region: "eu-west-1" })).toBe("eu-west-1");

  // Not the portal's region: that is where the login lives, not where the user
  // works, and setting it would override an AWS_REGION they set on purpose.
  expect(execRegion(SSO)).toBeUndefined();
});

test("a chained profile behaves the same way", () => {
  const chained: AssumeProfile = {
    kind: "assume",
    name: "prod-admin",
    roleArn: "arn:aws:iam::3:role/Admin",
    sourceProfile: "dev",
  };
  expect(execRegion(chained)).toBeUndefined();
  expect(execRegion({ ...chained, region: "us-east-2" })).toBe("us-east-2");
});

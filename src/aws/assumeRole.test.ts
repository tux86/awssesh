import { test, expect } from "bun:test";
import { assumeRoleInput, classifyAssumeError, roleSessionName } from "./assumeRole";
import type { AssumeProfile } from "./profiles";

const BASE: AssumeProfile = {
  kind: "assume",
  name: "prod-admin",
  roleArn: "arn:aws:iam::333333333333:role/Admin",
  sourceProfile: "dev",
};

test("the session name defaults to the profile and is sanitised for STS", () => {
  expect(roleSessionName(BASE)).toBe("awssesh-prod-admin");
  expect(roleSessionName({ ...BASE, name: "prod/admin team!" })).toBe("awssesh-prod-admin-team-");
  expect(roleSessionName({ ...BASE, roleSessionName: "chosen" })).toBe("chosen");
  expect(roleSessionName({ ...BASE, name: "x".repeat(100) }).length).toBe(64);
});

test("assumeRoleInput carries only the options the profile actually set", () => {
  expect(assumeRoleInput(BASE)).toEqual({
    RoleArn: BASE.roleArn,
    RoleSessionName: "awssesh-prod-admin",
  });
});

test("assumeRoleInput passes duration, external id and the MFA code through", () => {
  expect(
    assumeRoleInput(
      { ...BASE, durationSeconds: 7200, externalId: "xyz", mfaSerial: "arn:aws:iam::5:mfa/w" },
      "123456",
    ),
  ).toEqual({
    RoleArn: BASE.roleArn,
    RoleSessionName: "awssesh-prod-admin",
    DurationSeconds: 7200,
    ExternalId: "xyz",
    SerialNumber: "arn:aws:iam::5:mfa/w",
    TokenCode: "123456",
  });
});

test("an MFA rejection is reported as needing a code, not as a flat denial", () => {
  const error = Object.assign(new Error("Access denied: MultiFactorAuthentication failed"), {
    name: "AccessDenied",
  });
  expect(classifyAssumeError(error, BASE).failure).toBe("mfa-required");
});

test("a plain denial names the role the user cannot assume", () => {
  const error = Object.assign(new Error("not authorized"), { name: "AccessDenied" });
  const result = classifyAssumeError(error, BASE);
  expect(result.failure).toBe("denied");
  expect(result.error).toContain(BASE.roleArn);
});

test("unusable source credentials point at the source profile", () => {
  const error = Object.assign(new Error("token expired"), { name: "ExpiredToken" });
  const result = classifyAssumeError(error, BASE);
  expect(result.failure).toBe("denied");
  expect(result.error).toContain("dev");
});

test("anything else is transient rather than a credential problem", () => {
  expect(classifyAssumeError(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }), BASE).failure)
    .toBe("unavailable");
  expect(classifyAssumeError("just a string", BASE).failure).toBe("unavailable");
});

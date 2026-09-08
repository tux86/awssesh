import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import type { ProfileState } from "../../aws/profileState";
import type { AssumeProfile, Profile, SSOProfile } from "../../aws/profiles";
import { Details } from "./Details";
import { KEYS, tick } from "../testKeys";

const hour = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

const SSO_CONFIG: SSOProfile = {
  kind: "sso",
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
  region: "eu-west-1",
  ssoSession: "my-sso",
};

const CHAINED_CONFIG: AssumeProfile = {
  kind: "assume",
  name: "prod-admin",
  roleArn: "arn:aws:iam::333333333333:role/Admin",
  sourceProfile: "dev",
  region: "us-east-1",
  mfaSerial: "arn:aws:iam::555555555555:mfa/walid",
};

const SSO_STATE: ProfileState = {
  name: "dev",
  kind: "sso",
  status: "valid",
  expiresAt: hour(1),
  ssoExpiresAt: hour(8),
  favorite: true,
  accountId: "111111111111",
};

function mount(profile: ProfileState, config?: Profile) {
  const calls: string[] = [];
  const record = (action: string) => (name: string) => calls.push(`${action}:${name}`);
  const view = render(
    <Details
      profile={profile}
      config={config}
      onBack={() => calls.push("back")}
      onRefresh={record("refresh")}
      onCopyExport={record("copy")}
      onCopyName={record("name")}
      onOpenConsole={record("console")}
      onToggleAuto={record("auto")}
    />,
  );
  return { ...view, calls };
}

test("an SSO profile shows its role, region, portal and both expiries", async () => {
  const { lastFrame, unmount } = mount(SSO_STATE, SSO_CONFIG);
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("dev");
  expect(frame).toContain("sso");
  expect(frame).toContain("⟳ auto-refresh");
  expect(frame).toContain("Developer");
  expect(frame).toContain("eu-west-1");
  expect(frame).toContain("example.awsapps.com");
  // Two different clocks: the credentials, and the login behind them.
  expect(frame).toContain("creds");
  expect(frame).toContain("sso login");
  unmount();
});

test("a chained profile shows what it goes through instead of a portal URL", async () => {
  const state: ProfileState = { ...SSO_STATE, name: "prod-admin", kind: "assume", accountId: "333333333333" };
  const { lastFrame, unmount } = mount(state, CHAINED_CONFIG);
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("assume-role");
  // The source profile is the first thing to check when a chain misbehaves.
  expect(frame).toContain("via");
  expect(frame).toContain("dev");
  expect(frame).toContain("mfa");
  expect(frame).toContain("arn:aws:iam::555555555555:mfa/walid");
  expect(frame).toContain("Admin");
  expect(frame).not.toContain("sso url");
  unmount();
});

test("a chain with no MFA device does not show an empty mfa row", async () => {
  const state: ProfileState = { ...SSO_STATE, name: "prod-admin", kind: "assume" };
  const { lastFrame, unmount } = mount(state, { ...CHAINED_CONFIG, mfaSerial: undefined });
  await tick();

  expect(lastFrame()).not.toContain("mfa");
  unmount();
});

test("a profile awaiting a login says the login is required", async () => {
  const state: ProfileState = { ...SSO_STATE, status: "needs-login", ssoExpiresAt: null, expiresAt: null };
  const { lastFrame, unmount } = mount(state, SSO_CONFIG);
  await tick();

  expect(lastFrame()).toContain("required");
  unmount();
});

test("a chain rooted in IAM keys is not told it needs a login it will never need", async () => {
  const state: ProfileState = {
    name: "iam-chained",
    kind: "assume",
    status: "valid",
    expiresAt: hour(1),
    ssoExpiresAt: null,
    favorite: false,
    accountId: "333333333333",
  };
  const { lastFrame, unmount } = mount(state, { ...CHAINED_CONFIG, mfaSerial: undefined });
  await tick();

  // No portal behind it, so "required" here would be a lie.
  expect(lastFrame()).not.toContain("required");
  unmount();
});

test("a failure is shown rather than leaving the view looking healthy", async () => {
  const state: ProfileState = { ...SSO_STATE, status: "error", error: "role no longer granted" };
  const { lastFrame, unmount } = mount(state, SSO_CONFIG);
  await tick();

  expect(lastFrame()).toContain("role no longer granted");
  unmount();
});

test("a profile whose config has gone missing still renders", async () => {
  const { lastFrame, unmount } = mount(SSO_STATE, undefined);
  await tick();

  expect(lastFrame()).toContain("dev");
  expect(lastFrame()).toContain("—");
  unmount();
});

test("the shortcuts act on the profile being viewed", async () => {
  const { stdin, calls, unmount } = mount(SSO_STATE, SSO_CONFIG);
  await tick();

  for (const key of ["r", "c", "y", "o", "a"]) {
    stdin.write(key);
    await tick();
  }

  expect(calls).toEqual(["refresh:dev", "copy:dev", "name:dev", "console:dev", "auto:dev"]);
  unmount();
});

test("Esc, left arrow and q all go back", async () => {
  for (const key of [KEYS.escape, KEYS.left, "q"]) {
    const { stdin, calls, unmount } = mount(SSO_STATE, SSO_CONFIG);
    await tick();
    stdin.write(key);
    await tick();
    expect(calls).toEqual(["back"]);
    unmount();
  }
});

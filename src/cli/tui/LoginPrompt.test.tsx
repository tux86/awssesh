import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import type { DeviceAuthInfo } from "../../aws/sso";
import { LoginPrompt } from "./LoginPrompt";
import { tick } from "../testKeys";

const DEVICE_AUTH: DeviceAuthInfo = {
  verificationUri: "https://example.awsapps.com/start/#/device?user_code=BRWS-DEMO",
  userCode: "BRWS-DEMO",
  deviceCode: "device-code",
  clientId: "client",
  clientSecret: "secret",
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  interval: 5,
};

test("the code and the URL are both shown, and the code first", async () => {
  const { lastFrame, unmount } = render(<LoginPrompt label="dev" deviceAuth={DEVICE_AUTH} />);
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("SSO login required");
  expect(frame).toContain("dev");
  expect(frame).toContain("BRWS-DEMO");
  expect(frame).toContain("example.awsapps.com");
  // The code is what gets checked against the browser, so it comes first.
  expect(frame.indexOf("BRWS-DEMO")).toBeLessThan(frame.indexOf("url"));
  unmount();
});

test("the portal is named when the login is for browsing, not for a profile", async () => {
  const { lastFrame, unmount } = render(<LoginPrompt label="my-sso" deviceAuth={DEVICE_AUTH} />);
  await tick();

  expect(lastFrame()).toContain("my-sso");
  unmount();
});

test("waiting for the browser is visible, with how long the code lasts", async () => {
  const { lastFrame, unmount } = render(<LoginPrompt label="dev" deviceAuth={DEVICE_AUTH} authorizing />);
  await tick();

  expect(lastFrame()).toContain("Waiting for browser authorization");
  expect(lastFrame()).toContain("code expires in");
  unmount();
});

test("an expired code says to start again instead of waiting forever", async () => {
  const expired = { ...DEVICE_AUTH, expiresAt: new Date(Date.now() - 1000) };
  const { lastFrame, unmount } = render(<LoginPrompt label="dev" deviceAuth={expired} authorizing />);
  await tick();

  expect(lastFrame()).toContain("expired");
  expect(lastFrame()).toContain("Esc");
  unmount();
});

test("before a code arrives, the screen says what it is waiting for", async () => {
  const { lastFrame, unmount } = render(<LoginPrompt label="dev" deviceAuth={null} />);
  await tick();

  expect(lastFrame()).toContain("Requesting a device code");
  unmount();
});

test("a failure to start explains where to look", async () => {
  const { lastFrame, unmount } = render(
    <LoginPrompt label="dev" deviceAuth={null} authError="Failed to start device authorization." />,
  );
  await tick();

  expect(lastFrame()).toContain("Failed to start device authorization.");
  expect(lastFrame()).toContain("sso_start_url");
  unmount();
});

test("the copy result is reported either way", async () => {
  const copied = render(<LoginPrompt label="dev" deviceAuth={DEVICE_AUTH} copied />);
  await tick();
  expect(copied.lastFrame()).toContain("copied");
  copied.unmount();

  const failed = render(<LoginPrompt label="dev" deviceAuth={DEVICE_AUTH} copyFailed />);
  await tick();
  expect(failed.lastFrame()).toContain("no clipboard available");
  failed.unmount();
});

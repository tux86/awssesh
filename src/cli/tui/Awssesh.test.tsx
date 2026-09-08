import { test, expect, beforeAll, afterAll } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { createHash } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEYS, tick, waitForFrame } from "../testKeys";

/**
 * The whole app, mounted.
 *
 * `AWSSESH_DEMO` stubs the SSO network calls (device authorization and the
 * account listings) with canned values — the same switch the demo recording
 * uses — so these tests stay offline. The component is imported dynamically so
 * that HOME is already pointing at the sandbox when its modules first load.
 */
let Awssesh: (typeof import("./Awssesh.tsx"))["Awssesh"];
let TMP: string;

const SESSION = "solo";
const START_URL = "https://example.awsapps.com/start";

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-root-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  process.env.AWSSESH_DEMO = "1";
  process.env.AWSSESH_NO_UPDATE_CHECK = "1";

  await mkdir(join(TMP, ".aws", "sso", "cache"), { recursive: true });
  await writeFile(
    join(TMP, ".aws", "config"),
    [
      `[sso-session ${SESSION}]`,
      `sso_start_url = ${START_URL}`,
      "sso_region = us-east-1",
      "",
      "[profile dev]",
      `sso_session = ${SESSION}`,
      "sso_account_id = 111111111111",
      "sso_role_name = Developer",
      "",
    ].join("\n"),
  );

  ({ Awssesh } = await import("./Awssesh.tsx"));
});

afterAll(async () => {
  delete process.env.AWSSESH_DEMO;
  await rm(TMP, { recursive: true, force: true });
});

/** Give the portal a token, or take it away, between tests. */
async function cacheToken(expiresAt: Date | null) {
  const file = join(TMP, ".aws", "sso", "cache", `${createHash("sha1").update(SESSION).digest("hex")}.json`);
  if (!expiresAt) return rm(file, { force: true });
  await writeFile(
    file,
    JSON.stringify({ startUrl: START_URL, region: "us-east-1", accessToken: "tok", expiresAt }),
  );
}

test("cancelling the login that adding a profile needs gets the user out", async () => {
  await cacheToken(null); // no token, so browsing has to log in first
  const { stdin, lastFrame, unmount } = render(<Awssesh />);
  await waitForFrame(lastFrame, "PROFILE");

  stdin.write("n");
  await waitForFrame(lastFrame, "SSO login required");

  stdin.write(KEYS.escape);
  await waitForFrame(lastFrame, "PROFILE");

  // The browser is unmounted while the login is up, so it remounts when the
  // login clears — and a remounted browser with no token asks to log in again.
  // That made Esc an inescapable loop, with no `q` on the login screen either.
  expect(lastFrame()).not.toContain("SSO login required");

  stdin.write(KEYS.escape);
  await tick(150);
  expect(lastFrame()).not.toContain("SSO login required");
  unmount();
});

test("the way out is explained rather than silent", async () => {
  await cacheToken(null);
  const { stdin, lastFrame, unmount } = render(<Awssesh />);
  await waitForFrame(lastFrame, "PROFILE");

  stdin.write("n");
  await waitForFrame(lastFrame, "SSO login required");
  stdin.write(KEYS.escape);

  await waitForFrame(lastFrame, "Adding a profile needs an SSO login");
  unmount();
});

test("the header carries the standing summary of what needs a human", async () => {
  await cacheToken(null);
  const { lastFrame, unmount } = render(<Awssesh />);
  await waitForFrame(lastFrame, "PROFILE");

  const frame = lastFrame()!;
  expect(frame).toContain("1 profile");
  expect(frame).toContain("0 ⟳ auto");
  // The one profile has no cached token, so it wants a login.
  expect(frame).toContain("1 need attention");
  unmount();
});

test("with a valid token, adding a profile goes straight to the accounts", async () => {
  await cacheToken(new Date(Date.now() + 8 * 3_600_000));
  const { stdin, lastFrame, unmount } = render(<Awssesh />);
  await waitForFrame(lastFrame, "PROFILE");

  stdin.write("n");

  // One portal, so there is nothing to pick between: it lists what the portal
  // grants right away.
  const frame = await waitForFrame(lastFrame, "choose an account");
  expect(frame).toContain("Acme Production");
  unmount();
});

test("Esc leaves the account browser without needing a login at all", async () => {
  await cacheToken(new Date(Date.now() + 8 * 3_600_000));
  const { stdin, lastFrame, unmount } = render(<Awssesh />);
  await waitForFrame(lastFrame, "PROFILE");

  stdin.write("n");
  await waitForFrame(lastFrame, "choose an account");
  stdin.write(KEYS.escape);
  await waitForFrame(lastFrame, "PROFILE");

  expect(lastFrame()).not.toContain("choose an account");
  unmount();
});

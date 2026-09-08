import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import type { ProfileState } from "../../aws/profileState";
import { Dashboard } from "./Dashboard";
import { KEYS, tick } from "../testKeys";

const hour = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

const PROFILES: ProfileState[] = [
  {
    name: "dev",
    kind: "sso",
    status: "valid",
    expiresAt: hour(1),
    ssoExpiresAt: hour(8),
    favorite: true,
    accountId: "111111111111",
  },
  {
    name: "prod-admin",
    kind: "assume",
    status: "needs-login",
    expiresAt: null,
    ssoExpiresAt: null,
    favorite: false,
    accountId: "333333333333",
  },
  {
    name: "break-glass",
    kind: "assume",
    status: "needs-mfa",
    expiresAt: hour(8),
    ssoExpiresAt: hour(8),
    favorite: false,
    accountId: "444444444444",
  },
];

/** Every callback recorded, so a test can assert which profile an action hit. */
function mount(profiles = PROFILES) {
  const calls: string[] = [];
  const record = (action: string) => (name?: string) => calls.push(name ? `${action}:${name}` : action);
  const view = render(
    <Dashboard
      profiles={profiles}
      onRefresh={record("refresh")}
      onToggleAuto={record("auto")}
      onOpenDetails={record("details")}
      onOpenConsole={record("console")}
      onCopyExport={record("copy")}
      onCopyName={record("name")}
      onAddProfile={record("add")}
      onOpenSettings={record("settings")}
      onQuit={record("quit")}
    />,
  );
  return { ...view, calls };
}

test("every profile is listed with its status and account", async () => {
  const { lastFrame, unmount } = mount();
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("dev");
  expect(frame).toContain("valid");
  expect(frame).toContain("needs-login");
  expect(frame).toContain("needs-mfa");
  expect(frame).toContain("111111111111");
  // The ⟳ marker is on the pinned profile only.
  expect(frame.split("\n").filter((line) => line.includes("⟳") && line.includes("│"))).toHaveLength(1);
  unmount();
});

test("the footer counts what is pinned and what wants attention", async () => {
  const { lastFrame, unmount } = mount();
  await tick();

  expect(lastFrame()).toContain("3 profiles");
  expect(lastFrame()).toContain("1 ⟳ auto");
  // needs-login and needs-mfa both count as needing a human.
  expect(lastFrame()).toContain("2 need attention");
  unmount();
});

test("an action applies to the profile the cursor is on", async () => {
  const { stdin, calls, unmount } = mount();
  await tick();

  stdin.write("r");
  await tick();
  stdin.write("j");
  await tick();
  stdin.write("r");
  await tick();

  expect(calls).toEqual(["refresh:dev", "refresh:prod-admin"]);
  unmount();
});

test("each shortcut reaches its own action", async () => {
  const { stdin, calls, unmount } = mount();
  await tick();

  for (const key of ["a", "c", "y", "o", "n", "s"]) {
    stdin.write(key);
    await tick();
  }
  stdin.write(KEYS.enter);
  await tick();

  expect(calls).toEqual([
    "auto:dev",
    "copy:dev",
    "name:dev",
    "console:dev",
    "add",
    "settings",
    "details:dev",
  ]);
  unmount();
});

test("g and G jump to the ends of the list", async () => {
  const { stdin, calls, unmount } = mount();
  await tick();

  stdin.write("G");
  await tick();
  stdin.write("r");
  await tick();
  stdin.write("g");
  await tick();
  stdin.write("r");
  await tick();

  expect(calls).toEqual(["refresh:break-glass", "refresh:dev"]);
  unmount();
});

test("the arrow keys stop at the ends rather than wrapping", async () => {
  const { stdin, calls, unmount } = mount();
  await tick();

  stdin.write(KEYS.up);
  await tick();
  stdin.write("r");
  await tick();
  for (let i = 0; i < 5; i++) stdin.write(KEYS.down);
  await tick();
  stdin.write("r");
  await tick();

  expect(calls).toEqual(["refresh:dev", "refresh:break-glass"]);
  unmount();
});

test("/ filters the list, and Enter applies it", async () => {
  const { stdin, lastFrame, calls, unmount } = mount();
  await tick();

  stdin.write("/");
  await tick();
  stdin.write("glass");
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("break-glass");
  expect(frame).not.toContain("prod-admin");
  // Typing while filtering must not fire actions — 'g' and 's' are shortcuts.
  expect(calls).toEqual([]);

  stdin.write(KEYS.enter);
  await tick();
  stdin.write("r");
  await tick();
  expect(calls).toEqual(["refresh:break-glass"]);
  unmount();
});

test("an applied filter stays visible, and Esc clears it", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();

  stdin.write("/");
  await tick();
  stdin.write("dev");
  await tick();
  stdin.write(KEYS.enter);
  await tick();
  expect(lastFrame()).toContain("1/3 shown");

  stdin.write(KEYS.escape);
  await tick();
  expect(lastFrame()).toContain("prod-admin");
  unmount();
});

test("Esc while typing a filter abandons it entirely", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();

  stdin.write("/");
  await tick();
  stdin.write("dev");
  await tick();
  stdin.write(KEYS.escape);
  await tick();

  expect(lastFrame()).toContain("prod-admin");
  expect(lastFrame()).not.toContain("/dev");
  unmount();
});

test("? opens the shortcut list, and any key closes it", async () => {
  const { stdin, lastFrame, calls, unmount } = mount();
  await tick();

  stdin.write("?");
  await tick();
  expect(lastFrame()).toContain("Keyboard shortcuts");
  expect(lastFrame()).toContain("add a profile from your SSO portal");

  stdin.write("x");
  await tick();
  expect(lastFrame()).toContain("PROFILE");
  // Dismissing help must not also fire the key that dismissed it.
  expect(calls).toEqual([]);
  unmount();
});

test("q quits, from the list and from the help screen", async () => {
  const { stdin, calls, unmount } = mount();
  await tick();

  stdin.write("q");
  await tick();
  stdin.write("?");
  await tick();
  stdin.write("q");
  await tick();

  expect(calls).toEqual(["quit", "quit"]);
  unmount();
});

test("an empty list points at the way out of an empty config", async () => {
  const { lastFrame, stdin, calls, unmount } = mount([]);
  await tick();

  expect(lastFrame()).toContain("(no profiles)");
  expect(lastFrame()).toContain("press n to add one");

  // The actions that need a profile do nothing; the one that does not still works.
  stdin.write("r");
  await tick();
  stdin.write("n");
  await tick();
  expect(calls).toEqual(["add"]);
  unmount();
});

test("a filter matching nothing says so and blocks profile actions", async () => {
  const { stdin, lastFrame, calls, unmount } = mount();
  await tick();

  stdin.write("/");
  await tick();
  stdin.write("zzz");
  await tick();
  stdin.write(KEYS.enter);
  await tick();

  expect(lastFrame()).toContain("no profile matches");
  stdin.write("r");
  await tick();
  expect(calls).toEqual([]);
  unmount();
});

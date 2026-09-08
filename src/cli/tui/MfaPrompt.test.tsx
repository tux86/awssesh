import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { MfaPrompt } from "./MfaPrompt";
import { KEYS, tick } from "../testKeys";

const SERIAL = "arn:aws:iam::555555555555:mfa/walid";

/** The prompt is controlled, so a test drives it the way the app does. */
function mount(overrides: Partial<React.ComponentProps<typeof MfaPrompt>> = {}) {
  const events = { changes: [] as string[], submits: 0, cancels: 0 };
  const props: React.ComponentProps<typeof MfaPrompt> = {
    profileName: "prod-break-glass",
    mfaSerial: SERIAL,
    code: "",
    submitting: false,
    error: null,
    onChange: (code) => events.changes.push(code),
    onSubmit: () => events.submits++,
    onCancel: () => events.cancels++,
    ...overrides,
  };
  return { ...render(<MfaPrompt {...props} />), events };
}

test("the prompt names the profile and the device being asked for", async () => {
  const { lastFrame, unmount } = mount();
  await tick();

  expect(lastFrame()).toContain("MFA required");
  expect(lastFrame()).toContain("prod-break-glass");
  expect(lastFrame()).toContain(SERIAL);
  unmount();
});

test("an empty code shows placeholders for the six digits", async () => {
  const { lastFrame, unmount } = mount();
  await tick();
  expect(lastFrame()).toContain("······");
  unmount();
});

test("digits are collected, one keystroke at a time", async () => {
  const { stdin, events, unmount } = mount({ code: "12" });
  await tick();

  stdin.write("3");
  await tick();

  expect(events.changes).toEqual(["123"]);
  unmount();
});

test("a pasted code arrives as one write and is kept whole", async () => {
  const { stdin, events, unmount } = mount();
  await tick();

  stdin.write("123456");
  await tick();

  expect(events.changes).toEqual(["123456"]);
  unmount();
});

test("anything that is not a digit is ignored rather than entered", async () => {
  const { stdin, events, unmount } = mount({ code: "12" });
  await tick();

  stdin.write("ab-/ ");
  await tick();

  // A TOTP code is digits only, so letters are a typo, not input.
  expect(events.changes).toEqual([]);
  unmount();
});

test("a code cannot grow past six digits", async () => {
  const { stdin, events, unmount } = mount({ code: "12345" });
  await tick();

  stdin.write("6789");
  await tick();

  expect(events.changes).toEqual(["123456"]);
  unmount();
});

test("backspace corrects a mistyped digit", async () => {
  const { stdin, events, unmount } = mount({ code: "1234" });
  await tick();

  stdin.write(KEYS.backspace);
  await tick();

  expect(events.changes).toEqual(["123"]);
  unmount();
});

test("Enter submits a code, and does nothing at all without one", async () => {
  const empty = mount({ code: "" });
  await tick();
  empty.stdin.write(KEYS.enter);
  await tick();
  expect(empty.events.submits).toBe(0);
  empty.unmount();

  const filled = mount({ code: "123456" });
  await tick();
  filled.stdin.write(KEYS.enter);
  await tick();
  expect(filled.events.submits).toBe(1);
  filled.unmount();
});

test("keystrokes are ignored while the code is being checked", async () => {
  const { stdin, events, lastFrame, unmount } = mount({ code: "123456", submitting: true });
  await tick();

  expect(lastFrame()).toContain("Assuming the role");
  stdin.write("9");
  stdin.write(KEYS.enter);
  await tick();

  // Two submissions of the same one-time code would be rejected by AWS.
  expect(events.submits).toBe(0);
  expect(events.changes).toEqual([]);
  unmount();
});

test("Esc always gets out, even mid-submission", async () => {
  const { stdin, events, unmount } = mount({ code: "123456", submitting: true });
  await tick();

  stdin.write(KEYS.escape);
  await tick();

  expect(events.cancels).toBe(1);
  unmount();
});

test("a rejected code is reported in place, so it can be retyped", async () => {
  const { lastFrame, unmount } = mount({ code: "", error: "that code was not accepted" });
  await tick();

  expect(lastFrame()).toContain("that code was not accepted");
  unmount();
});

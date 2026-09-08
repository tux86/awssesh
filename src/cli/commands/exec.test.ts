import { test, expect } from "bun:test";
import { exitCodeFor } from "./exec";

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

import { test, expect } from "bun:test";
import { decideAction } from "./refreshScheduler";

const now = new Date("2026-06-11T12:00:00.000Z");
const leadMs = 5 * 60 * 1000;

test("refresh when within lead window of expiry", () => {
  expect(decideAction(new Date("2026-06-11T12:03:00.000Z"), now, leadMs)).toBe("refresh");
});

test("wait when comfortably before lead window", () => {
  expect(decideAction(new Date("2026-06-11T12:30:00.000Z"), now, leadMs)).toBe("wait");
});

test("refresh when there are no credentials yet", () => {
  expect(decideAction(null, now, leadMs)).toBe("refresh");
});

test("already-expired credentials are due, not merely stale", () => {
  expect(decideAction(new Date("2026-06-11T11:00:00.000Z"), now, leadMs)).toBe("refresh");
});

import { test, expect } from "bun:test";
import { decideAction } from "./scheduler";

const now = new Date("2026-06-11T12:00:00.000Z");
const leadMs = 5 * 60 * 1000;

test("refresh when within lead window of expiry", () => {
  const expiresAt = new Date("2026-06-11T12:03:00.000Z"); // 3m left < 5m lead
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: expiresAt }, now, leadMs)).toBe("refresh");
});

test("wait when comfortably before lead window", () => {
  const expiresAt = new Date("2026-06-11T12:30:00.000Z"); // 30m left
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: expiresAt }, now, leadMs)).toBe("wait");
});

test("needs-login when sso token invalid regardless of creds", () => {
  const expiresAt = new Date("2026-06-11T12:30:00.000Z");
  expect(decideAction({ ssoTokenValid: false, credsExpireAt: expiresAt }, now, leadMs)).toBe("needs-login");
});

test("refresh when there are no creds yet but sso token is valid", () => {
  expect(decideAction({ ssoTokenValid: true, credsExpireAt: null }, now, leadMs)).toBe("refresh");
});

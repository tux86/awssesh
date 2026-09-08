import { test, expect } from "bun:test";
import { formatStatusTable } from "./status";
import type { ProfileState } from "../../aws/profileState";

test("formatStatusTable renders aligned rows", () => {
  const rows: ProfileState[] = [
    { kind: "sso" as const, name: "prod", status: "valid", expiresAt: "2026-06-11T13:00:00.000Z", credentialsExpireAt: "2026-06-11T13:00:00.000Z", ssoExpiresAt: null, favorite: true },
    { kind: "sso" as const, name: "staging", status: "needs-login", expiresAt: null, credentialsExpireAt: null, ssoExpiresAt: null, favorite: false },
  ];
  const out = formatStatusTable(rows, new Date("2026-06-11T12:00:00.000Z"));
  const lines = out.split("\n");
  expect(lines[0]).toContain("⟳"); // auto-refresh marker for favorite profile
  expect(lines[0]).toContain("prod");
  expect(lines[0]).toContain("valid");
  expect(lines[0]).toContain("1h 00m"); // hours are spelled out rather than shown as "60m"
  expect(lines[1]).not.toContain("⟳"); // non-favorite has no marker
  expect(lines[1]).toContain("staging");
  expect(lines[1]).toContain("needs-login");
});

test("formatStatusTable reports an empty config instead of a blank line", () => {
  expect(formatStatusTable([], new Date())).toContain("no profiles found");
});

test("formatStatusTable keeps the marker column aligned across rows", () => {
  const rows: ProfileState[] = [
    { kind: "sso" as const, name: "prod", status: "valid", expiresAt: null, credentialsExpireAt: null, ssoExpiresAt: null, favorite: true },
    { kind: "sso" as const, name: "dev", status: "valid", expiresAt: null, credentialsExpireAt: null, ssoExpiresAt: null, favorite: false },
  ];
  const [fav, plain] = formatStatusTable(rows, new Date()).split("\n");
  expect(fav!.indexOf("prod")).toBe(plain!.indexOf("dev"));
});

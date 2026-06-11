import { test, expect } from "bun:test";
import { formatStatusTable } from "./status";
import type { ProfileState } from "../../aws/profileState";

test("formatStatusTable renders aligned rows", () => {
  const rows: ProfileState[] = [
    { name: "prod", status: "valid", expiresAt: "2026-06-11T13:00:00.000Z", favorite: true },
    { name: "staging", status: "needs-login", expiresAt: null, favorite: false },
  ];
  const out = formatStatusTable(rows, new Date("2026-06-11T12:00:00.000Z"));
  const lines = out.split("\n");
  expect(lines[0]).toContain("⟳"); // auto-refresh marker for favorite profile
  expect(lines[0]).toContain("prod");
  expect(lines[0]).toContain("valid");
  expect(lines[0]).toContain("60m");
  expect(lines[1]).not.toContain("⟳"); // non-favorite has no marker
  expect(lines[1]).toContain("staging");
  expect(lines[1]).toContain("needs-login");
});

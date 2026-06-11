import { test, expect } from "bun:test";
import { parseArgs } from "./args";

test("no args → tui", () => { expect(parseArgs([])).toEqual({ kind: "tui" }); });
test("--version → version", () => {
  expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  expect(parseArgs(["-v"])).toEqual({ kind: "version" });
});
test("status subcommand", () => { expect(parseArgs(["status"])).toEqual({ kind: "status" }); });
test("export requires a profile", () => { expect(parseArgs(["export", "prod"])).toEqual({ kind: "export", profile: "prod" }); });
test("refresh optional profile", () => {
  expect(parseArgs(["refresh"])).toEqual({ kind: "refresh", profile: undefined });
  expect(parseArgs(["refresh", "dev"])).toEqual({ kind: "refresh", profile: "dev" });
});
test("unknown command → error", () => {
  expect(parseArgs(["daemon"])).toEqual({ kind: "error", message: "unknown command: daemon" });
  expect(parseArgs(["foobar"])).toEqual({ kind: "error", message: "unknown command: foobar" });
});

import { test, expect } from "bun:test";
import { parseArgs } from "./args";

test("no args → tui", () => { expect(parseArgs([])).toEqual({ kind: "tui", daemon: false }); });
test("--daemon flag → tui with daemon", () => { expect(parseArgs(["--daemon"])).toEqual({ kind: "tui", daemon: true }); });
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
test("daemon subcommands", () => {
  expect(parseArgs(["daemon", "start"])).toEqual({ kind: "daemon", sub: "start" });
  expect(parseArgs(["daemon"])).toEqual({ kind: "daemon", sub: undefined });
});
test("internal __daemon command", () => { expect(parseArgs(["__daemon"])).toEqual({ kind: "__daemon" }); });

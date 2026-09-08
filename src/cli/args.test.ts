import { test, expect } from "bun:test";
import { parseArgs } from "./args";

test("no args → tui", () => { expect(parseArgs([])).toEqual({ kind: "tui" }); });
test("--version → version", () => {
  expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  expect(parseArgs(["-v"])).toEqual({ kind: "version" });
});
test("status subcommand", () => { expect(parseArgs(["status"])).toEqual({ kind: "status" }); });
test("export requires a profile", () => {
  expect(parseArgs(["export"])).toEqual({ kind: "error", message: "export requires a profile name" });
});
test("refresh optional profile", () => {
  expect(parseArgs(["refresh"])).toEqual({ kind: "refresh", profile: undefined });
  expect(parseArgs(["refresh", "dev"])).toEqual({ kind: "refresh", profile: "dev" });
});
test("unknown command → error", () => {
  expect(parseArgs(["daemon"])).toEqual({ kind: "error", message: "unknown command: daemon" });
  expect(parseArgs(["foobar"])).toEqual({ kind: "error", message: "unknown command: foobar" });
});

test("export takes an optional --json for credential_process", () => {
  expect(parseArgs(["export", "prod"])).toEqual({ kind: "export", profile: "prod", json: false });
  expect(parseArgs(["export", "prod", "--json"])).toEqual({ kind: "export", profile: "prod", json: true });
  expect(parseArgs(["export", "--json", "prod"])).toEqual({ kind: "export", profile: "prod", json: true });
});

test("export rejects an unknown flag rather than treating it as a profile", () => {
  expect(parseArgs(["export", "--yolo"])).toEqual({
    kind: "error",
    message: "unknown option for export: --yolo",
  });
});

test("exec takes a profile and the command to run", () => {
  expect(parseArgs(["exec", "prod", "aws", "s3", "ls"])).toEqual({
    kind: "exec",
    profile: "prod",
    command: ["aws", "s3", "ls"],
  });
});

test("exec accepts the conventional -- separator", () => {
  expect(parseArgs(["exec", "prod", "--", "terraform", "plan"])).toEqual({
    kind: "exec",
    profile: "prod",
    command: ["terraform", "plan"],
  });
});

test("everything after the command belongs to the command, flags included", () => {
  expect(parseArgs(["exec", "prod", "--", "aws", "s3", "ls", "--profile", "x"])).toEqual({
    kind: "exec",
    profile: "prod",
    command: ["aws", "s3", "ls", "--profile", "x"],
  });
});

test("exec without a command is an error, not a silent no-op", () => {
  expect(parseArgs(["exec"])).toEqual({ kind: "error", message: "exec requires a profile name" });
  expect(parseArgs(["exec", "prod"])).toEqual({
    kind: "error",
    message: "exec requires a command to run, e.g. awssesh exec prod -- aws s3 ls",
  });
  expect(parseArgs(["exec", "prod", "--"])).toEqual({
    kind: "error",
    message: "exec requires a command to run, e.g. awssesh exec prod -- aws s3 ls",
  });
});

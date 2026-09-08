import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as creds from "./credentialsFile";
import { credentialsAreFresh } from "./credentials";

// Each test gets its own sandboxed HOME. the AWS paths are resolved per
// call, so simply pointing HOME at a fresh directory is enough to isolate it.
let home: string;
let prevHome: string | undefined;
const CREDENTIALS = () => join(home, ".aws", "credentials");

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "awssesh-creds-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const CREDS = {
  accessKeyId: "ASIAEXAMPLE",
  secretAccessKey: "secret/key+value=",
  sessionToken: "IQoJb3JpZ2luX2VjEB+token/value==",
};

test("credentials are written in the dialect the AWS CLI parses", async () => {
  await creds.writeCredentials("prod", CREDS);

  const raw = readFileSync(CREDENTIALS(), "utf8");
  // The AWS parsers take everything after the first '=' verbatim, so any
  // quoting would be baked into the secret itself.
  for (const [key, value] of Object.entries(CREDS)) {
    const iniKey = { accessKeyId: "aws_access_key_id", secretAccessKey: "aws_secret_access_key", sessionToken: "aws_session_token" }[key]!;
    const line = raw.split("\n").find((l) => l.startsWith(iniKey))!;
    expect(line.slice(line.indexOf("=") + 1).trim()).toBe(value);
  }
});

test("the credentials file is not world-readable", async () => {
  await creds.writeCredentials("prod", CREDS);
  const mode = statSync(CREDENTIALS()).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("expiry round-trips so stale credentials can be detected later", async () => {
  const expiration = new Date(Date.now() + 3_600_000);
  await creds.writeCredentials("prod", { ...CREDS, expiration });

  const read = creds.readProfileCredentials("prod");
  expect(read?.expiresAt?.getTime()).toBe(expiration.getTime());
  expect(credentialsAreFresh(read)).toBe(true);
});

test("expired credentials are never treated as fresh", async () => {
  await creds.writeCredentials("prod", { ...CREDS, expiration: new Date(Date.now() - 1000) });
  expect(credentialsAreFresh(creds.readProfileCredentials("prod"))).toBe(false);
});

test("credentials expiring inside the lead window are refreshed rather than handed out", async () => {
  await creds.writeCredentials("prod", { ...CREDS, expiration: new Date(Date.now() + 30_000) });
  expect(credentialsAreFresh(creds.readProfileCredentials("prod"), 60_000)).toBe(false);
});

test("credentials with no recorded expiry are not trusted", async () => {
  await creds.writeCredentials("prod", CREDS); // no expiration supplied
  const read = creds.readProfileCredentials("prod");
  expect(read).not.toBeNull();
  expect(read!.expiresAt).toBeNull();
  expect(credentialsAreFresh(read)).toBe(false);
});

test("writing one profile leaves other profiles intact", async () => {
  await creds.writeCredentials("prod", CREDS);
  await creds.writeCredentials("dev", { ...CREDS, accessKeyId: "ASIADEV" });

  expect(creds.readProfileCredentials("prod")?.accessKeyId).toBe("ASIAEXAMPLE");
  expect(creds.readProfileCredentials("dev")?.accessKeyId).toBe("ASIADEV");
});

test("readProfileCredentials returns null for an unknown profile", async () => {
  await creds.writeCredentials("prod", CREDS);
  expect(creds.readProfileCredentials("nope")).toBeNull();
});

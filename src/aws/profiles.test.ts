import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TMP: string;
let profiles: typeof import("./profiles.ts");

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-profiles-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  profiles = await import("./profiles.ts");
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const CONFIG = [
  "[sso-session my-sso]",
  "sso_start_url = https://example.awsapps.com/start",
  "sso_region = us-east-1",
  "",
  "[profile dev]",
  "sso_session = my-sso",
  "sso_account_id = 111111111111",
  "sso_role_name = Developer",
  "region = eu-west-1",
  "",
  "[profile legacy]",
  "sso_start_url = https://legacy.awsapps.com/start",
  "sso_region = us-west-2",
  "sso_account_id = 222222222222",
  "sso_role_name = ReadOnly",
  "",
  "[profile prod-admin]",
  "role_arn = arn:aws:iam::333333333333:role/Admin",
  "source_profile = dev",
  "region = us-east-1",
  "",
  "[profile locked]",
  "role_arn = arn:aws:iam::444444444444:role/Ops",
  "source_profile = legacy",
  "mfa_serial = arn:aws:iam::555555555555:mfa/walid",
  "external_id = xyz",
  "duration_seconds = 7200",
  "role_session_name = walid",
  "",
  "[profile static]",
  "region = eu-west-3",
  "",
].join("\n");

test("parseProfiles reads sso-session, inline sso and chained profiles", () => {
  const found = profiles.parseProfiles(profiles.parseIni(CONFIG));
  expect(found.map((p) => p.name).sort()).toEqual(["dev", "legacy", "locked", "prod-admin"]);

  const dev = found.find((p) => p.name === "dev");
  expect(dev).toEqual({
    kind: "sso",
    name: "dev",
    ssoStartUrl: "https://example.awsapps.com/start",
    ssoAccountId: "111111111111",
    ssoRoleName: "Developer",
    ssoRegion: "us-east-1",
    region: "eu-west-1",
    ssoSession: "my-sso",
  });

  const legacy = found.find((p) => p.name === "legacy");
  expect(legacy).toMatchObject({ kind: "sso", ssoRegion: "us-west-2", ssoSession: undefined });
});

test("parseProfiles maps chained role profiles", () => {
  const found = profiles.parseProfiles(profiles.parseIni(CONFIG));
  expect(found.find((p) => p.name === "prod-admin")).toEqual({
    kind: "assume",
    name: "prod-admin",
    roleArn: "arn:aws:iam::333333333333:role/Admin",
    sourceProfile: "dev",
    region: "us-east-1",
    mfaSerial: undefined,
    externalId: undefined,
    roleSessionName: undefined,
    durationSeconds: undefined,
  });

  expect(found.find((p) => p.name === "locked")).toMatchObject({
    kind: "assume",
    mfaSerial: "arn:aws:iam::555555555555:mfa/walid",
    externalId: "xyz",
    durationSeconds: 7200,
    roleSessionName: "walid",
  });
});

test("parseProfiles ignores profiles with nothing to manage", () => {
  const found = profiles.parseProfiles(profiles.parseIni(CONFIG));
  expect(found.some((p) => p.name === "static")).toBe(false);
});

test("parseProfiles skips a chained profile with no source_profile", () => {
  const found = profiles.parseProfiles(
    profiles.parseIni("[profile orphan]\nrole_arn = arn:aws:iam::1:role/x\n"),
  );
  expect(found).toEqual([]);
});

test("parseSSOSessions merges sso-session blocks and inline start urls", () => {
  const sessions = profiles.parseSSOSessions(profiles.parseIni(CONFIG));
  expect(sessions).toEqual([
    { name: "my-sso", startUrl: "https://example.awsapps.com/start", region: "us-east-1" },
    { name: undefined, startUrl: "https://legacy.awsapps.com/start", region: "us-west-2" },
  ]);
});

test("parseSSOSessions dedupes an sso-session that profiles also reference", () => {
  const sessions = profiles.parseSSOSessions(
    profiles.parseIni(
      [
        "[sso-session s]",
        "sso_start_url = https://a.awsapps.com/start",
        "sso_region = eu-west-1",
        "[profile one]",
        "sso_session = s",
        "sso_account_id = 1",
        "sso_role_name = R",
        "[profile two]",
        "sso_session = s",
        "sso_account_id = 2",
        "sso_role_name = R",
      ].join("\n"),
    ),
  );
  expect(sessions).toHaveLength(1);
});

test("arn helpers pull the account and role out of a role arn", () => {
  const arn = "arn:aws:iam::333333333333:role/path/Admin";
  expect(profiles.accountIdFromArn(arn)).toBe("333333333333");
  expect(profiles.roleNameFromArn(arn)).toBe("Admin");
  expect(profiles.accountIdFromArn("not-an-arn")).toBeUndefined();
  expect(profiles.roleNameFromArn("not-an-arn")).toBeUndefined();
});

test("suggestProfileName slugifies the account and role", () => {
  expect(profiles.suggestProfileName("Acme Production", "AdministratorAccess")).toBe(
    "acme-production-administratoraccess",
  );
  expect(profiles.suggestProfileName("", "ReadOnly")).toBe("readonly");
  expect(profiles.suggestProfileName("Acme (prod)", "Read/Only")).toBe("acme-prod-read-only");
});

test("ssoProfileEntries prefers an sso_session reference", () => {
  const session = { name: "my-sso", startUrl: "https://example.awsapps.com/start", region: "us-east-1" };
  expect(profiles.ssoProfileEntries(session, "1", "Admin", "eu-west-1")).toEqual({
    sso_session: "my-sso",
    sso_account_id: "1",
    sso_role_name: "Admin",
    region: "eu-west-1",
  });
  expect(profiles.ssoProfileEntries({ ...session, name: undefined }, "1", "Admin")).toEqual({
    sso_start_url: "https://example.awsapps.com/start",
    sso_region: "us-east-1",
    sso_account_id: "1",
    sso_role_name: "Admin",
  });
});

test("writeProfileToConfig appends a profile and leaves the rest untouched", async () => {
  const path = join(TMP, ".aws", "config");
  await writeFile(path, "[profile keep]\nregion = eu-west-1\n");
  await profiles.writeProfileToConfig("new-one", { sso_session: "my-sso", sso_account_id: "9" });

  const text = await readFile(path, "utf8");
  expect(text).toContain("[profile keep]");
  expect(text).toContain("[profile new-one]");
  expect(text).toContain("sso_session = my-sso");
  expect(profiles.parseProfiles(profiles.parseIni(text)).map((p) => p.name)).toEqual([]);
});

test("discoverProfiles reads ~/.aws/config", async () => {
  await writeFile(join(TMP, ".aws", "config"), CONFIG);
  const found = await profiles.discoverProfiles();
  expect(found.map((p) => p.name).sort()).toEqual(["dev", "legacy", "locked", "prod-admin"]);
});


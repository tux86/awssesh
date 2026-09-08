import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SSOAccount } from "../../aws/accounts";
import type { SSOSession } from "../../aws/profiles";
import { AccountBrowser } from "./AccountBrowser";
import { KEYS, tick } from "../testKeys";

const MY_SSO: SSOSession = {
  name: "my-sso",
  startUrl: "https://example.awsapps.com/start",
  region: "us-east-1",
};
const OTHER_SSO: SSOSession = { name: "other", startUrl: "https://other.awsapps.com/start", region: "eu-west-1" };

const ACCOUNTS: SSOAccount[] = [
  { accountId: "111111111111", accountName: "Acme Development" },
  { accountId: "333333333333", accountName: "Acme Production" },
];

let TMP: string;

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "awssesh-browser-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeFile(join(TMP, ".aws", "config"), "[profile keep-me]\nregion = eu-west-1\n");
});

interface Options {
  sessions?: SSOSession[];
  existingNames?: string[];
  token?: string | null;
  accounts?: SSOAccount[];
  roles?: string[];
  fetchAccounts?: (session: SSOSession, token: string) => Promise<SSOAccount[]>;
}

function mount(options: Options = {}) {
  const events = { created: [] as string[], backs: 0, tokenRequests: [] as string[] };
  const view = render(
    <AccountBrowser
      sessions={options.sessions ?? [MY_SSO]}
      existingNames={options.existingNames ?? ["keep-me"]}
      defaultRegion={() => "eu-west-1"}
      getToken={async (session) => {
        events.tokenRequests.push(session.startUrl);
        return options.token === undefined ? "tok-123" : options.token;
      }}
      onCreated={(name) => events.created.push(name)}
      onBack={() => events.backs++}
      fetchAccounts={options.fetchAccounts ?? (async () => options.accounts ?? ACCOUNTS)}
      fetchRoles={async () => options.roles ?? ["AdministratorAccess", "ReadOnlyAccess"]}
    />,
  );
  return { ...view, events };
}

const config = () => readFile(join(TMP, ".aws", "config"), "utf8");

test("a single portal is entered without asking which one", async () => {
  const { lastFrame, events, unmount } = mount();
  await tick(40);

  expect(events.tokenRequests).toEqual([MY_SSO.startUrl]);
  expect(lastFrame()).toContain("choose an account");
  expect(lastFrame()).toContain("Acme Development");
  unmount();
});

test("several portals are offered first, and the chosen one is the one loaded", async () => {
  const { lastFrame, stdin, events, unmount } = mount({ sessions: [MY_SSO, OTHER_SSO] });
  await tick();

  expect(lastFrame()).toContain("choose an SSO portal");
  expect(events.tokenRequests).toEqual([]);

  stdin.write(KEYS.down);
  await tick();
  stdin.write(KEYS.enter);
  await tick(40);

  expect(events.tokenRequests).toEqual([OTHER_SSO.startUrl]);
  unmount();
});

test("account, then role, then a name suggested from both", async () => {
  const { lastFrame, stdin, unmount } = mount();
  await tick(40);

  stdin.write(KEYS.down); // Acme Production
  await tick();
  stdin.write(KEYS.enter);
  await tick(40);

  expect(lastFrame()).toContain("choose a role in Acme Production");
  expect(lastFrame()).toContain("AdministratorAccess");

  stdin.write(KEYS.enter);
  await tick(40);

  const frame = lastFrame()!;
  expect(frame).toContain("name it");
  expect(frame).toContain("acme-production-administratoraccess");
  expect(frame).toContain("333333333333");
  unmount();
});

test("saving appends the profile and leaves the rest of the file alone", async () => {
  const { stdin, events, unmount } = mount();
  await tick(40);
  stdin.write(KEYS.enter); // Acme Development
  await tick(40);
  stdin.write(KEYS.enter); // AdministratorAccess
  await tick(40);
  stdin.write(KEYS.enter); // save
  await tick(40);

  expect(events.created).toEqual(["acme-development-administratoraccess"]);

  const text = await config();
  expect(text).toContain("[profile keep-me]");
  expect(text).toContain("[profile acme-development-administratoraccess]");
  expect(text).toContain("sso_session = my-sso");
  expect(text).toContain("sso_account_id = 111111111111");
  expect(text).toContain("sso_role_name = AdministratorAccess");
  expect(text).toContain("region = eu-west-1");
  unmount();
});

test("the suggested name can be edited before saving", async () => {
  const { stdin, lastFrame, events, unmount } = mount();
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);

  for (let i = 0; i < 40; i++) stdin.write(KEYS.backspace);
  await tick();
  stdin.write("dev");
  await tick();
  expect(lastFrame()).toContain("dev▏");

  stdin.write(KEYS.enter);
  await tick(40);
  expect(events.created).toEqual(["dev"]);
  expect(await config()).toContain("[profile dev]");
  unmount();
});

test("a name that cannot be a profile is refused rather than written", async () => {
  const { stdin, lastFrame, events, unmount } = mount();
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);

  for (let i = 0; i < 40; i++) stdin.write(KEYS.backspace);
  await tick();
  expect(lastFrame()).toContain("a profile needs a name");

  stdin.write(KEYS.enter);
  await tick(40);
  expect(events.created).toEqual([]);

  stdin.write("bad name");
  await tick();
  expect(lastFrame()).toContain("use letters, digits");
  stdin.write(KEYS.enter);
  await tick(40);
  expect(events.created).toEqual([]);
  unmount();
});

test("an existing name warns that saving would overwrite it", async () => {
  const { stdin, lastFrame, unmount } = mount({ existingNames: ["keep-me"] });
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);

  for (let i = 0; i < 40; i++) stdin.write(KEYS.backspace);
  stdin.write("keep-me");
  await tick();

  expect(lastFrame()).toContain("already exists");
  unmount();
});

test("Esc walks back through the steps instead of straight out", async () => {
  const { stdin, lastFrame, events, unmount } = mount({ sessions: [MY_SSO, OTHER_SSO] });
  await tick();
  stdin.write(KEYS.enter); // portal
  await tick(40);
  stdin.write(KEYS.enter); // account
  await tick(40);
  stdin.write(KEYS.enter); // role -> name step
  await tick(40);

  stdin.write(KEYS.escape);
  await tick(40);
  expect(lastFrame()).toContain("choose a role");

  stdin.write(KEYS.escape);
  await tick(40);
  expect(lastFrame()).toContain("choose an account");

  stdin.write(KEYS.escape);
  await tick(40);
  expect(lastFrame()).toContain("choose an SSO portal");
  expect(events.backs).toBe(0);
  unmount();
});

test("with one portal there is no step to go back to, so Esc leaves", async () => {
  const { stdin, events, unmount } = mount();
  await tick(40);

  stdin.write(KEYS.escape);
  await tick();

  expect(events.backs).toBe(1);
  unmount();
});

test("a refused login explains itself rather than showing an empty list", async () => {
  const { lastFrame, unmount } = mount({ token: null });
  await tick(40);

  expect(lastFrame()).toContain("An SSO login is needed");
  unmount();
});

test("a portal that grants nothing says so", async () => {
  const { lastFrame, unmount } = mount({ accounts: [] });
  await tick(40);

  expect(lastFrame()).toContain("grants you no accounts");
  unmount();
});

test("an account with no roles says so instead of offering an empty picker", async () => {
  const { stdin, lastFrame, unmount } = mount({ roles: [] });
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);

  expect(lastFrame()).toContain("no roles in Acme Development");
  unmount();
});

test("a listing that fails shows the reason, and any key dismisses it", async () => {
  const { stdin, lastFrame, events, unmount } = mount({
    fetchAccounts: async () => {
      throw new Error("portal unreachable");
    },
  });
  await tick(40);

  expect(lastFrame()).toContain("portal unreachable");
  stdin.write("x");
  await tick();
  expect(events.backs).toBe(1);
  unmount();
});

test("nothing is written to config while the user is still choosing", async () => {
  const { stdin, unmount } = mount();
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);
  stdin.write(KEYS.enter);
  await tick(40);

  expect(await config()).not.toContain("acme-development");
  unmount();
});

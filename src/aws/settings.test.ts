import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "ssomatic-settings-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test("loadSettings returns defaults when no file exists", async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await import("./settings");
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test("saveSettings then loadSettings round-trips", async () => {
  const { loadSettings, saveSettings } = await import("./settings");
  saveSettings({ notifications: false, refreshLeadMinutes: 10, autoStartDaemon: true, favoriteProfiles: ["prod", "dev"] });
  expect(loadSettings()).toEqual({ notifications: false, refreshLeadMinutes: 10, autoStartDaemon: true, favoriteProfiles: ["prod", "dev"] });
});

test("loadSettings migrates a legacy file with defaultInterval", async () => {
  const { loadSettings } = await import("./settings");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(home, ".aws"), { recursive: true });
  writeFileSync(join(home, ".aws", "credentials-manager.json"), JSON.stringify({ notifications: true, defaultInterval: 30, favoriteProfiles: ["x"] }));
  const s = loadSettings();
  expect(s.favoriteProfiles).toEqual(["x"]);
  expect(s.refreshLeadMinutes).toBe(5);
  expect(s.autoStartDaemon).toBe(false);
  expect("defaultInterval" in s).toBe(false);
});

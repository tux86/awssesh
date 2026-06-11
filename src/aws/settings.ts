import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface AppSettings {
  notifications: boolean;
  refreshLeadMinutes: number;
  autoStartDaemon: boolean;
  favoriteProfiles: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  refreshLeadMinutes: 5,
  autoStartDaemon: false,
  favoriteProfiles: [],
};

function settingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".aws", "credentials-manager.json");
}

export function loadSettings(): AppSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppSettings> & { defaultInterval?: number };
    return {
      notifications: raw.notifications ?? DEFAULT_SETTINGS.notifications,
      refreshLeadMinutes: raw.refreshLeadMinutes ?? DEFAULT_SETTINGS.refreshLeadMinutes,
      autoStartDaemon: raw.autoStartDaemon ?? DEFAULT_SETTINGS.autoStartDaemon,
      favoriteProfiles: raw.favoriteProfiles ?? DEFAULT_SETTINGS.favoriteProfiles,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2));
}

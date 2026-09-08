import { loadSettings } from "../../aws/settings.js";
import { obtainCredentials } from "./credentials.js";

/**
 * `awssesh refresh [profile]` — fetch new credentials now, for one profile or
 * for every ⟳ profile. Logs in or asks for an MFA code if that is what it takes.
 */
export async function runRefresh(profileArg?: string): Promise<number> {
  const targets = profileArg ? [profileArg] : loadSettings().favoriteProfiles;
  if (targets.length === 0) {
    process.stderr.write("no profile specified and no ⟳ profiles configured\n");
    return 1;
  }

  let ok = true;
  for (const name of targets) {
    const result = await obtainCredentials(name, "refresh");
    if (result.ok) process.stdout.write(`✓ ${name} refreshed\n`);
    else {
      process.stderr.write(`✗ ${result.error}\n`);
      ok = false;
    }
  }
  return ok ? 0 : 1;
}

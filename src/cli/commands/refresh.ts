import {
  discoverProfiles,
  refreshProfile,
  startDeviceAuthorization,
  performSSOLoginFlow,
  openBrowser,
} from "../../aws/sso";
import { loadSettings } from "../../aws/settings";

async function refreshOne(name: string): Promise<boolean> {
  const profile = (await discoverProfiles()).find((p) => p.name === name);
  if (!profile) {
    process.stderr.write(`unknown profile: ${name}\n`);
    return false;
  }
  const result = await refreshProfile(profile);
  if (result.success) {
    process.stdout.write(`✓ ${name} refreshed\n`);
    return true;
  }
  if (result.needsLogin) {
    process.stdout.write(`${name} needs login — starting device authorization…\n`);
    const deviceAuth = await startDeviceAuthorization(profile);
    if (!deviceAuth) {
      process.stderr.write(`✗ ${name}: failed to start device authorization\n`);
      return false;
    }
    process.stdout.write(`\nOpen this URL in your browser to authenticate:\n`);
    process.stdout.write(`  ${deviceAuth.verificationUri}\n`);
    process.stdout.write(`\nEnter this code when prompted:\n`);
    process.stdout.write(`  ${deviceAuth.userCode}\n\n`);
    openBrowser(deviceAuth.verificationUri);
    process.stdout.write(`Waiting for authorization…\n`);
    const r = await performSSOLoginFlow(profile, deviceAuth);
    if (r.success) {
      process.stdout.write(`✓ ${name} logged in and refreshed\n`);
      return true;
    }
    process.stderr.write(`✗ ${name}: ${r.error}\n`);
    return false;
  }
  process.stderr.write(`✗ ${name}: ${result.error}\n`);
  return false;
}

export async function runRefresh(profileArg?: string): Promise<number> {
  const targets = profileArg ? [profileArg] : loadSettings().favoriteProfiles;
  if (targets.length === 0) {
    process.stderr.write("no profile specified and no favorites configured\n");
    return 1;
  }
  let ok = true;
  for (const name of targets) ok = (await refreshOne(name)) && ok;
  return ok ? 0 : 1;
}

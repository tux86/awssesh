import { discoverProfiles, refreshProfile, readProfileCredentials } from "../../aws/sso";
import { buildExportBlock } from "../../aws/console";

export async function runExport(profileName: string): Promise<number> {
  const profile = (await discoverProfiles()).find((p) => p.name === profileName);
  if (!profile) {
    process.stderr.write(`unknown profile: ${profileName}\n`);
    return 1;
  }
  const result = await refreshProfile(profile);
  if (!result.success) {
    process.stderr.write(
      `cannot export ${profileName}: ${
        result.needsLogin
          ? `needs login (run: ssomatic refresh ${profileName})`
          : result.error
      }\n`
    );
    return 1;
  }
  const creds = readProfileCredentials(profileName);
  if (!creds) {
    process.stderr.write(`no credentials found for ${profileName}\n`);
    return 1;
  }
  process.stdout.write(buildExportBlock(creds) + "\n");
  return 0;
}

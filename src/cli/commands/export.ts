import { buildCredentialProcessOutput, buildExportBlock } from "../../aws/env.js";
import { obtainCredentials } from "./credentials.js";

/**
 * `awssesh export <profile>` — shell `export` lines for `eval $(…)`, or with
 * `--json` the `credential_process` payload the AWS SDKs read.
 */
export async function runExport(profileName: string, json: boolean): Promise<number> {
  const result = await obtainCredentials(profileName, "ensure");
  if (!result.ok) {
    process.stderr.write(result.error + "\n");
    return 1;
  }

  const render = json ? buildCredentialProcessOutput : buildExportBlock;
  process.stdout.write(render(result.credentials) + "\n");
  return 0;
}

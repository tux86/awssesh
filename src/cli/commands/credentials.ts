/**
 * Getting usable credentials for a named profile from a terminal.
 *
 * Shared by `export`, `exec` and `refresh` so all three handle an expired SSO
 * session and an MFA-gated role the same way — and so all three refuse to hang
 * waiting for a human when nothing is attached to stdin, which is exactly how
 * `credential_process` invokes awssesh.
 */

import { createInterface } from "node:readline/promises";
import type { StoredCredentials } from "../../aws/credentials.js";
import { discoverProfiles, sessionOf, type Profile, type SSOProfile } from "../../aws/profiles.js";
import { describeOutcome, ensureCredentials, refreshProfile } from "../../aws/refresh.js";
import { loginToSession, openBrowser, startDeviceAuthorization } from "../../aws/sso.js";

export type ObtainResult =
  | { ok: true; profile: Profile; credentials: StoredCredentials }
  | { ok: false; error: string };

/** Whether a human is there to answer a prompt or approve a browser login. */
function interactive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Prompts and device codes go to stderr, never stdout: `eval $(awssesh export
 * …)` and `credential_process` both parse stdout, and a stray prompt in there
 * breaks them.
 */
function tell(message: string): void {
  process.stderr.write(message + "\n");
}

async function promptMfaCode(profileName: string): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`MFA code for ${profileName}: `);
    return answer.trim() || undefined;
  } finally {
    rl.close();
  }
}

async function runDeviceLogin(profile: SSOProfile): Promise<boolean> {
  const session = sessionOf(profile);
  const deviceAuth = await startDeviceAuthorization(session);
  if (!deviceAuth) {
    tell(`✗ ${profile.name}: failed to start device authorization`);
    return false;
  }

  tell(`\n${profile.name} needs an SSO login. Open this URL in your browser:`);
  tell(`  ${deviceAuth.verificationUri}`);
  tell(`\nand confirm the code:  ${deviceAuth.userCode}\n`);
  openBrowser(deviceAuth.verificationUri);
  tell("Waiting for authorization…");

  const result = await loginToSession(session, deviceAuth);
  if (!result.success) tell(`✗ ${profile.name}: ${result.error}`);
  return result.success;
}

/**
 * Resolve credentials for `name`, logging in or asking for an MFA code when a
 * terminal is attached. `refresh` fetches new credentials even when the cached
 * ones are still good; `ensure` reuses them.
 */
export async function obtainCredentials(name: string, mode: "ensure" | "refresh"): Promise<ObtainResult> {
  const profiles = await discoverProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) return { ok: false, error: `unknown profile: ${name}` };

  let mfaCode: string | undefined;
  let attemptedLogin = false;

  // At most one login and one MFA prompt: if the credentials still are not
  // usable after those, asking again would only loop.
  for (;;) {
    const opts = { profiles, mfaCode };
    const outcome =
      mode === "refresh" ? await refreshProfile(profile, opts) : await ensureCredentials(profile, opts);

    if (outcome.ok) return { ok: true, profile, credentials: outcome.credentials };

    if (outcome.reason === "needs-login" && interactive() && !attemptedLogin) {
      attemptedLogin = true;
      if (await runDeviceLogin(outcome.profile)) continue;
      return { ok: false, error: `${name}: SSO login failed` };
    }

    if (outcome.reason === "needs-mfa" && interactive() && !mfaCode) {
      mfaCode = await promptMfaCode(outcome.profile.name);
      if (mfaCode) continue;
    }

    if (!interactive() && (outcome.reason === "needs-login" || outcome.reason === "needs-mfa")) {
      return {
        ok: false,
        error: `${describeOutcome(outcome)} — run \`awssesh refresh ${name}\` in a terminal first`,
      };
    }
    return { ok: false, error: `${name}: ${describeOutcome(outcome)}` };
  }
}

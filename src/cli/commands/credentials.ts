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
import {
  describeOutcome,
  ensureCredentials,
  refreshProfile,
  type CredentialsOutcome,
} from "../../aws/refresh.js";
import { loginToSession, openBrowser, startDeviceAuthorization } from "../../aws/sso.js";

export type ObtainResult =
  | { ok: true; profile: Profile; credentials: StoredCredentials }
  | { ok: false; error: string };

/**
 * The effects the flow below needs, injected so the decision-making — how many
 * times to prompt, when to refuse — can be tested without a terminal or AWS.
 */
export interface CredentialPrompts {
  /** Fetch credentials, with whatever MFA codes the user has supplied so far. */
  fetch: (mfaCodes: Record<string, string>) => Promise<CredentialsOutcome>;
  /** Run a browser login for a profile; resolves to whether it worked. */
  login: (profile: SSOProfile) => Promise<boolean>;
  askMfa: (profileName: string) => Promise<string | undefined>;
  /** Whether there is a human to answer at all. */
  interactive: boolean;
}

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
 * Fetch credentials, logging in or asking for a code when that is what stands
 * in the way — at most one login and one MFA prompt. If the credentials still
 * are not usable after those, asking a second time would only loop.
 */
export async function resolveCredentials(
  name: string,
  prompts: CredentialPrompts,
): Promise<{ ok: true; credentials: StoredCredentials } | { ok: false; error: string }> {
  const mfaCodes: Record<string, string> = {};
  const asked = new Set<string>();
  let attemptedLogin = false;

  for (;;) {
    const outcome = await prompts.fetch(mfaCodes);
    if (outcome.ok) return { ok: true, credentials: outcome.credentials };

    if (outcome.reason === "needs-login" && prompts.interactive && !attemptedLogin) {
      attemptedLogin = true;
      if (await prompts.login(outcome.profile)) continue;
      return { ok: false, error: `${name}: SSO login failed` };
    }

    // Each profile in a chain gets one prompt: a second for the same profile
    // would only mean the first code was wrong, and re-asking loops.
    if (outcome.reason === "needs-mfa" && prompts.interactive && !asked.has(outcome.profile.name)) {
      asked.add(outcome.profile.name);
      const code = await prompts.askMfa(outcome.profile.name);
      if (code) {
        mfaCodes[outcome.profile.name] = code;
        continue;
      }
    }

    // Nothing is attached to answer: say what is missing and how to supply it
    // once, by hand, rather than failing with a bare "access denied".
    if (!prompts.interactive && (outcome.reason === "needs-login" || outcome.reason === "needs-mfa")) {
      return {
        ok: false,
        error: `${describeOutcome(outcome)} — run \`awssesh refresh ${name}\` in a terminal first`,
      };
    }
    return { ok: false, error: `${name}: ${describeOutcome(outcome)}` };
  }
}

/**
 * Resolve credentials for a named profile. `refresh` fetches new credentials
 * even when the cached ones are still good; `ensure` reuses them.
 */
export async function obtainCredentials(name: string, mode: "ensure" | "refresh"): Promise<ObtainResult> {
  const profiles = await discoverProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) return { ok: false, error: `unknown profile: ${name}` };

  const result = await resolveCredentials(name, {
    fetch: (mfaCodes) =>
      mode === "refresh"
        ? refreshProfile(profile, { profiles, mfaCodes })
        : ensureCredentials(profile, { profiles, mfaCodes }),
    login: runDeviceLogin,
    askMfa: promptMfaCode,
    interactive: interactive(),
  });

  return result.ok ? { ok: true, profile, credentials: result.credentials } : result;
}

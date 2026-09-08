/**
 * Rendering credentials for the places other programs read them from: a shell
 * `export` block, the `credential_process` JSON contract, and a child
 * process's environment.
 */

import type { AWSCredentials, StoredCredentials } from "./credentials.js";

type AnyCredentials = AWSCredentials | StoredCredentials;

function expiration(creds: AnyCredentials): Date | null {
  if ("expiration" in creds && creds.expiration) return creds.expiration;
  if ("expiresAt" in creds && creds.expiresAt) return creds.expiresAt;
  return null;
}

/** `export AWS_…` lines for `eval $(awssesh export <profile>)`. */
export function buildExportBlock(creds: AnyCredentials): string {
  return [
    `export AWS_ACCESS_KEY_ID=${creds.accessKeyId}`,
    `export AWS_SECRET_ACCESS_KEY=${creds.secretAccessKey}`,
    // A long-lived IAM key pair has no session token, and exporting an empty
    // one makes every signed request fail.
    ...(creds.sessionToken ? [`export AWS_SESSION_TOKEN=${creds.sessionToken}`] : []),
  ].join("\n");
}

/**
 * The payload `credential_process` expects: one JSON object on stdout, with
 * `Version: 1` and an ISO-8601 `Expiration` the SDKs use to know when to call
 * awssesh again. Omitting `Expiration` would make the SDK cache the
 * credentials for the life of its process and keep using them after they die.
 */
export function buildCredentialProcessOutput(creds: AnyCredentials): string {
  const expiresAt = expiration(creds);
  return JSON.stringify({
    Version: 1,
    AccessKeyId: creds.accessKeyId,
    SecretAccessKey: creds.secretAccessKey,
    ...(creds.sessionToken && { SessionToken: creds.sessionToken }),
    ...(expiresAt && { Expiration: expiresAt.toISOString() }),
  });
}

/**
 * The environment for `awssesh exec`.
 *
 * Any inherited AWS credential or profile variable is dropped first: leaving
 * `AWS_PROFILE` in place would have the SDK resolve that profile instead of
 * the credentials handed to it here, and a stale `AWS_SESSION_TOKEN` from the
 * parent shell would be paired with the new access key and rejected.
 */
export function buildExecEnv(
  base: Record<string, string | undefined>,
  creds: AnyCredentials,
  region?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key === "AWS_PROFILE" || key === "AWS_DEFAULT_PROFILE") continue;
    if (key.startsWith("AWS_ACCESS_KEY") || key.startsWith("AWS_SECRET") || key.startsWith("AWS_SESSION")) continue;
    if (key === "AWS_CREDENTIAL_EXPIRATION" || key === "AWS_SECURITY_TOKEN") continue;
    env[key] = value;
  }

  env.AWS_ACCESS_KEY_ID = creds.accessKeyId;
  env.AWS_SECRET_ACCESS_KEY = creds.secretAccessKey;
  if (creds.sessionToken) env.AWS_SESSION_TOKEN = creds.sessionToken;

  const expiresAt = expiration(creds);
  if (expiresAt) env.AWS_CREDENTIAL_EXPIRATION = expiresAt.toISOString();

  if (region) {
    env.AWS_REGION = region;
    env.AWS_DEFAULT_REGION = region;
  }

  return env;
}

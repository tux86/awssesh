/**
 * `sts:AssumeRole` for profiles that chain off another profile
 * (`role_arn` + `source_profile`), optionally gated on an MFA code.
 */

import { STSClient, AssumeRoleCommand, type AssumeRoleCommandInput } from "@aws-sdk/client-sts";
import type { CredentialsResult, StoredCredentials } from "./credentials.js";
import type { AssumeProfile } from "./profiles.js";

/** STS accepts `[\w+=,.@-]{2,64}` here, and rejects the whole call otherwise. */
export function roleSessionName(profile: AssumeProfile): string {
  if (profile.roleSessionName) return profile.roleSessionName;
  return `awssesh-${profile.name}`.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}

export function assumeRoleInput(profile: AssumeProfile, mfaCode?: string): AssumeRoleCommandInput {
  return {
    RoleArn: profile.roleArn,
    RoleSessionName: roleSessionName(profile),
    ...(profile.durationSeconds && { DurationSeconds: profile.durationSeconds }),
    ...(profile.externalId && { ExternalId: profile.externalId }),
    ...(profile.mfaSerial && { SerialNumber: profile.mfaSerial }),
    ...(mfaCode && { TokenCode: mfaCode }),
  };
}

/** Credential errors STS raises about the *source* profile rather than the role. */
const SOURCE_ERRORS = new Set([
  "ExpiredToken",
  "ExpiredTokenException",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
]);

/** Classify an AssumeRole failure. Pure, so the routing is unit-testable. */
export function classifyAssumeError(error: unknown, profile: AssumeProfile): CredentialsResult {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (SOURCE_ERRORS.has(name)) {
    return { failure: "denied", error: `credentials from ${profile.sourceProfile} were rejected: ${message}` };
  }
  if (name.startsWith("AccessDenied")) {
    // STS answers a missing or wrong MFA code with a plain AccessDenied, which
    // read to the user as "you have no access to this role" — the one message
    // guaranteed to stop them entering the code that would have worked.
    if (/multifactorauthentication|mfa/i.test(message)) {
      return { failure: "mfa-required", error: message };
    }
    return { failure: "denied", error: `cannot assume ${profile.roleArn}: ${message}` };
  }
  return { failure: "unavailable", error: message || "could not reach AWS STS" };
}

/** Exchange the source profile's credentials for the chained role's. */
export async function assumeRole(
  profile: AssumeProfile,
  source: StoredCredentials,
  region: string,
  mfaCode?: string,
): Promise<CredentialsResult> {
  try {
    const client = new STSClient({
      region,
      credentials: {
        accessKeyId: source.accessKeyId,
        secretAccessKey: source.secretAccessKey,
        sessionToken: source.sessionToken,
      },
    });
    const response = await client.send(new AssumeRoleCommand(assumeRoleInput(profile, mfaCode)));

    const creds = response.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      return { failure: "unavailable", error: "AWS returned no role credentials" };
    }

    return {
      credentials: {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
        expiration: creds.Expiration,
      },
    };
  } catch (error) {
    return classifyAssumeError(error, profile);
  }
}

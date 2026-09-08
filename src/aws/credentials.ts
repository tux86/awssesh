/**
 * The credential shapes every provider in awssesh produces, and the one verdict
 * type callers branch on. Kept apart from both providers (SSO, assume-role) so
 * neither has to import the other to describe its result.
 */

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export interface StoredCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Absent for a long-lived IAM key pair, which a chained profile may be signed with. */
  sessionToken?: string;
  /** When these credentials stop working, if awssesh wrote them. */
  expiresAt: Date | null;
}

/**
 * Why a credential fetch failed. `expired-token` is the only outcome that an
 * interactive browser login can actually fix — the rest used to be lumped in
 * with it, so a network blip or a missing role grant told the user "needs
 * login" and marched them through a pointless SSO flow that then failed again.
 */
export type CredentialsFailure = "expired-token" | "mfa-required" | "denied" | "unavailable";

export interface CredentialsResult {
  credentials?: AWSCredentials;
  failure?: CredentialsFailure;
  error?: string;
}

/** Whether stored credentials are usable for at least `leadMs` longer. */
export function credentialsAreFresh(
  creds: StoredCredentials | null,
  leadMs = 60_000,
  now: number = Date.now(),
): boolean {
  if (!creds) return false;
  if (!creds.expiresAt) return false; // unknown expiry — never trust it
  return creds.expiresAt.getTime() - now > leadMs;
}

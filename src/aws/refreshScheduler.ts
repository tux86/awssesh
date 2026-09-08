export type Action = "refresh" | "wait";

/**
 * Whether cached role credentials are due for renewal.
 *
 * Only the credentials matter here: whether an interactive login or an MFA code
 * is outstanding is decided from the profile's state, which knows how to follow
 * a `source_profile` chain to whatever the login actually belongs to.
 */
export function decideAction(credsExpireAt: Date | null, now: Date, leadMs: number): Action {
  if (credsExpireAt === null) return "refresh";
  return credsExpireAt.getTime() - now.getTime() <= leadMs ? "refresh" : "wait";
}

export type Action = "refresh" | "wait" | "needs-login";

export interface ProfileTiming {
  ssoTokenValid: boolean;        // is the cached SSO token still valid?
  credsExpireAt: Date | null;    // when current role creds expire (null = none/unknown)
}

export function decideAction(timing: ProfileTiming, now: Date, leadMs: number): Action {
  if (!timing.ssoTokenValid) return "needs-login";
  if (timing.credsExpireAt === null) return "refresh";
  const msLeft = timing.credsExpireAt.getTime() - now.getTime();
  return msLeft <= leadMs ? "refresh" : "wait";
}

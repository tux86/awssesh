import type { AWSCredentials } from "./sso";

export function buildExportBlock(creds: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}): string {
  return [
    `export AWS_ACCESS_KEY_ID=${creds.accessKeyId}`,
    `export AWS_SECRET_ACCESS_KEY=${creds.secretAccessKey}`,
    `export AWS_SESSION_TOKEN=${creds.sessionToken}`,
  ].join("\n");
}

export function buildFederationSigninUrl(signinToken: string, destination = "https://console.aws.amazon.com/"): string {
  const params = new URLSearchParams({
    Action: "login",
    Issuer: "awssesh",
    Destination: destination,
    SigninToken: signinToken,
  });
  return `https://signin.aws.amazon.com/federation?${params.toString()}`;
}

/**
 * Exchange role credentials for a console signin token, then build the URL.
 * Network call — kept separate from the pure builders above so they stay unit-testable.
 */
export async function getConsoleSigninUrl(creds: AWSCredentials): Promise<string> {
  const session = encodeURIComponent(
    JSON.stringify({
      sessionId: creds.accessKeyId,
      sessionKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    }),
  );
  const res = await fetch(`https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${session}`);
  if (!res.ok) throw new Error(`federation getSigninToken failed: ${res.status}`);
  const { SigninToken } = (await res.json()) as { SigninToken: string };
  return buildFederationSigninUrl(SigninToken);
}

/**
 * Demo fixture generator.
 *
 * Builds a self-contained, network-free `$HOME/.aws` sandbox so the VHS demo
 * (scripts/demo/demo.tape) records a realistic dashboard without any AWS
 * account or live calls. Timestamps are stamped fresh on every run so the
 * "expires" countdowns are accurate at record time.
 *
 * awssesh derives a profile's state purely from local disk:
 *   - discoverProfiles()    reads ~/.aws/config (SSO and chained role profiles)
 *   - findCachedToken()     reads ~/.aws/sso/cache/<sha1(session)>.json
 *   - buildLocalProfileStates(): valid (future-dated token) | needs-login (no token)
 *   - readProfileCredentials() reads ~/.aws/credentials (for `c` copy-export),
 *     including the `x_security_token_expires` role-credential expiry
 *   - favorites (⟳)         read from ~/.aws/credentials-manager.json
 *
 * Run: bun scripts/demo/fixture.ts   (HOME is set to ./docs/demo/home)
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const HOME = join(import.meta.dir, "..", "..", "docs", "demo", "home");
const AWS_DIR = join(HOME, ".aws");
const CACHE_DIR = join(AWS_DIR, "sso", "cache");

const MIN = 60 * 1000;
const now = Date.now();
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();

// ── SSO sessions (a realistic multi-org Identity Center setup) ────────────────
// A session's token cache file (or its absence) drives every member profile's
// state, exactly like real AWS SSO: one browser login per session, shared token.
interface Session {
  name: string;
  startUrl: string;
  region: string;
  /** Token lifetime from now in minutes; null = no cached token → needs-login. */
  tokenMinutes: number | null;
}

const SESSIONS: Session[] = [
  { name: "acme", startUrl: "https://acme.awsapps.com/start", region: "eu-west-1", tokenMinutes: 58 },
  { name: "dataplatform", startUrl: "https://dataplatform.awsapps.com/start", region: "us-east-1", tokenMinutes: 7 },
  { name: "labs", startUrl: "https://acme-labs.awsapps.com/start", region: "eu-west-1", tokenMinutes: null },
];

// ── Profiles ──────────────────────────────────────────────────────────────────
interface Profile {
  name: string;
  session: string;
  accountId: string;
  roleName: string;
  region: string;
  favorite: boolean;
}

const PROFILES: Profile[] = [
  { name: "acme-prod-admin", session: "acme", accountId: "481516234299", roleName: "AdministratorAccess", region: "eu-west-1", favorite: true },
  { name: "acme-prod-readonly", session: "acme", accountId: "481516234299", roleName: "ReadOnlyAccess", region: "eu-west-1", favorite: false },
  { name: "acme-staging-deploy", session: "acme", accountId: "902134785566", roleName: "DeployBot", region: "eu-west-1", favorite: true },
  { name: "data-warehouse", session: "dataplatform", accountId: "715024896633", roleName: "DataEngineer", region: "us-east-1", favorite: true },
  { name: "labs-sandbox", session: "labs", accountId: "339481027744", roleName: "Developer", region: "eu-west-1", favorite: false },
  { name: "labs-ml-research", session: "labs", accountId: "612087340912", roleName: "MLResearcher", region: "eu-west-1", favorite: false },
];

// ── Chained profiles (role_arn + source_profile) ─────────────────────────────
// Appended after the SSO profiles so they sit at the end of the dashboard: the
// tape's cursor beats above stay on the profiles they were choreographed for.
interface ChainedProfile {
  name: string;
  /** The profile whose credentials sign the AssumeRole call. */
  sourceProfile: string;
  roleArn: string;
  region: string;
  /** Set to gate the role on an MFA code, which awssesh prompts for. */
  mfaSerial?: string;
  /** Minutes of life left on the assumed credentials; null = none on disk yet. */
  credsMinutes: number | null;
  favorite: boolean;
}

const CHAINED: ChainedProfile[] = [
  {
    name: "acme-security-audit",
    sourceProfile: "acme-prod-readonly",
    roleArn: "arn:aws:iam::604915237781:role/SecurityAudit",
    region: "eu-west-1",
    credsMinutes: 41,
    favorite: false,
  },
  {
    // No credentials on disk and an MFA device attached, so it shows the
    // needs-mfa state a chained role sits in until someone types a code.
    name: "acme-break-glass",
    sourceProfile: "acme-prod-admin",
    roleArn: "arn:aws:iam::481516234299:role/BreakGlass",
    region: "eu-west-1",
    mfaSerial: "arn:aws:iam::481516234299:mfa/dana",
    credsMinutes: null,
    favorite: false,
  },
];

// ── Render ~/.aws/config ────────────────────────────────────────────────────
function buildConfig(): string {
  const blocks: string[] = [];
  for (const s of SESSIONS) {
    blocks.push(
      `[sso-session ${s.name}]`,
      `sso_start_url = ${s.startUrl}`,
      `sso_region = ${s.region}`,
      `sso_registration_scopes = sso:account:access`,
      "",
    );
  }
  for (const p of PROFILES) {
    blocks.push(
      `[profile ${p.name}]`,
      `sso_session = ${p.session}`,
      `sso_account_id = ${p.accountId}`,
      `sso_role_name = ${p.roleName}`,
      `region = ${p.region}`,
      "",
    );
  }
  for (const c of CHAINED) {
    blocks.push(
      `[profile ${c.name}]`,
      `role_arn = ${c.roleArn}`,
      `source_profile = ${c.sourceProfile}`,
      ...(c.mfaSerial ? [`mfa_serial = ${c.mfaSerial}`] : []),
      `region = ${c.region}`,
      "",
    );
  }
  return blocks.join("\n");
}

// ── Render SSO token cache files (keyed by sha1 of the session name) ──────────
function writeTokenCaches() {
  for (const s of SESSIONS) {
    if (s.tokenMinutes === null) continue; // no token → member profiles need login
    const hash = createHash("sha1").update(s.name).digest("hex");
    const file = join(CACHE_DIR, `${hash}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          startUrl: s.startUrl,
          region: s.region,
          accessToken: `aoa-demo-${s.name}-token`,
          expiresAt: iso(s.tokenMinutes * MIN),
        },
        null,
        2,
      ),
    );
  }
}

// ── Render ~/.aws/credentials (mock role creds for `c` copy-export) ──────────
function buildCredentials(): string {
  const sessionToken = (p: Profile) => `FQoGZXIvYXdz${p.name.replace(/-/g, "")}EXAMPLEsessiontoken`;
  const lines: string[] = [];
  for (const p of PROFILES) {
    const s = SESSIONS.find((x) => x.name === p.session)!;
    if (s.tokenMinutes === null) continue; // only valid sessions have role creds on disk
    lines.push(
      `[${p.name}]`,
      `aws_access_key_id = ASIA${p.accountId.slice(0, 4)}DEMOKEY${p.roleName.slice(0, 4).toUpperCase()}`,
      `aws_secret_access_key = wJalrXUtnFEMI/demo/${p.name}/EXAMPLEKEY`,
      `aws_session_token = ${sessionToken(p)}`,
      // Role credentials live ~1h, independent of the (longer-lived) SSO token,
      // so the demo shows the two countdowns diverging like they really do.
      `x_security_token_expires = ${iso(Math.min(s.tokenMinutes, 52) * MIN)}`,
      "",
    );
  }
  for (const c of CHAINED) {
    if (c.credsMinutes === null) continue; // never assumed yet
    lines.push(
      `[${c.name}]`,
      `aws_access_key_id = ASIA${c.roleArn.slice(-8, -4).toUpperCase()}DEMOKEYCHAIN`,
      `aws_secret_access_key = wJalrXUtnFEMI/demo/${c.name}/EXAMPLEKEY`,
      `aws_session_token = FQoGZXIvYXdz${c.name.replace(/-/g, "")}EXAMPLEsessiontoken`,
      `x_security_token_expires = ${iso(c.credsMinutes * MIN)}`,
      "",
    );
  }
  return lines.join("\n");
}

// ── Render ~/.aws/credentials-manager.json (settings + favorites ⟳) ──────────
function buildSettings(): string {
  return JSON.stringify(
    {
      notifications: true,
      refreshLeadMinutes: 5,
      favoriteProfiles: [...PROFILES, ...CHAINED].filter((p) => p.favorite).map((p) => p.name),
    },
    null,
    2,
  );
}

// ── Write everything ─────────────────────────────────────────────────────────
rmSync(HOME, { recursive: true, force: true });
mkdirSync(CACHE_DIR, { recursive: true });

writeFileSync(join(AWS_DIR, "config"), buildConfig());
writeFileSync(join(AWS_DIR, "credentials"), buildCredentials());
writeFileSync(join(AWS_DIR, "credentials-manager.json"), buildSettings());
writeTokenCaches();

console.log(`Demo fixture written to ${dirname(AWS_DIR)}`);
console.log(
  `  ${PROFILES.length} SSO + ${CHAINED.length} chained profiles · ` +
    `${SESSIONS.filter((s) => s.tokenMinutes !== null).length} signed-in sessions · ` +
    `${[...PROFILES, ...CHAINED].filter((p) => p.favorite).length} favorites`,
);

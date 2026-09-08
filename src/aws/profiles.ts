/**
 * The profiles awssesh manages, read from ~/.aws/config.
 *
 * Two shapes are supported, because both need a session that expires and so
 * both benefit from being kept fresh:
 *   - `sso`    — credentials come from AWS SSO for an account/role pair.
 *   - `assume` — credentials come from `sts:AssumeRole` against `role_arn`,
 *                signed with another profile's credentials (`source_profile`),
 *                optionally gated on an MFA code.
 * Profiles with neither shape (plain long-lived IAM keys) have no session to
 * manage and are deliberately left out of the list.
 */

import { parse } from "ini";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { upsertProfile, type CredentialEntry } from "./credentialsFile.js";
import { awsDir, configPath } from "./paths.js";

export interface SSOProfile {
  kind: "sso";
  name: string;
  ssoStartUrl: string;
  ssoAccountId: string;
  ssoRoleName: string;
  ssoRegion: string;
  region?: string;
  /** The `[sso-session]` block this profile refers to, when it uses one. */
  ssoSession?: string;
}

export interface AssumeProfile {
  kind: "assume";
  name: string;
  roleArn: string;
  sourceProfile: string;
  region?: string;
  mfaSerial?: string;
  externalId?: string;
  roleSessionName?: string;
  durationSeconds?: number;
}

export type Profile = SSOProfile | AssumeProfile;

/** An SSO portal awssesh can browse accounts in. `name` is set for `[sso-session]` blocks. */
export interface SSOSession {
  name?: string;
  startUrl: string;
  region: string;
}

export interface ConfigSection {
  [key: string]: string | undefined;
}

export interface ParsedConfig {
  [section: string]: ConfigSection;
}

const SSO_SESSION_PREFIX = "sso-session ";
const PROFILE_PREFIX = "profile ";
const DEFAULT_SSO_REGION = "us-east-1";

export function parseIni(text: string): ParsedConfig {
  return parse(text) as ParsedConfig;
}

export async function parseIniFile(path: string): Promise<ParsedConfig> {
  try {
    return parseIni(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

/** The profile name a `[profile x]` / `[default]` section stands for, or null. */
function profileNameOf(section: string): string | null {
  if (section === "default") return "default";
  return section.startsWith(PROFILE_PREFIX) ? section.slice(PROFILE_PREFIX.length) : null;
}

function sessionBlocks(config: ParsedConfig): Map<string, ConfigSection> {
  const sessions = new Map<string, ConfigSection>();
  for (const [section, values] of Object.entries(config)) {
    if (section.startsWith(SSO_SESSION_PREFIX)) {
      sessions.set(section.slice(SSO_SESSION_PREFIX.length), values);
    }
  }
  return sessions;
}

function toProfile(name: string, values: ConfigSection, sessions: Map<string, ConfigSection>): Profile | null {
  if (values.role_arn) {
    // Without a source profile there is nothing to sign the AssumeRole call
    // with, so the profile is unusable rather than merely unsupported.
    if (!values.source_profile) return null;
    const duration = Number(values.duration_seconds);
    return {
      kind: "assume",
      name,
      roleArn: values.role_arn,
      sourceProfile: values.source_profile,
      region: values.region,
      mfaSerial: values.mfa_serial,
      externalId: values.external_id,
      roleSessionName: values.role_session_name,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    };
  }

  if (!values.sso_account_id || !values.sso_role_name) return null;

  const session = values.sso_session ? sessions.get(values.sso_session) : undefined;
  const startUrl = session?.sso_start_url ?? values.sso_start_url;
  if (values.sso_session && !session) return null;
  if (!startUrl) return null;

  return {
    kind: "sso",
    name,
    ssoStartUrl: startUrl,
    ssoAccountId: values.sso_account_id,
    ssoRoleName: values.sso_role_name,
    ssoRegion: session?.sso_region ?? values.sso_region ?? DEFAULT_SSO_REGION,
    region: values.region,
    ssoSession: values.sso_session,
  };
}

export function parseProfiles(config: ParsedConfig): Profile[] {
  const sessions = sessionBlocks(config);
  const profiles: Profile[] = [];

  for (const [section, values] of Object.entries(config)) {
    const name = profileNameOf(section);
    if (name === null) continue;
    const profile = toProfile(name, values, sessions);
    if (profile) profiles.push(profile);
  }

  return profiles;
}

/**
 * Every SSO portal reachable from the config: the `[sso-session]` blocks plus
 * any start URL only mentioned inline on a profile. Used to browse accounts,
 * so a config holding nothing but an `[sso-session]` block is still a usable
 * starting point.
 */
export function parseSSOSessions(config: ParsedConfig): SSOSession[] {
  const byStartUrl = new Map<string, SSOSession>();

  for (const [name, values] of sessionBlocks(config)) {
    if (!values.sso_start_url) continue;
    byStartUrl.set(values.sso_start_url, {
      name,
      startUrl: values.sso_start_url,
      region: values.sso_region ?? DEFAULT_SSO_REGION,
    });
  }

  for (const [section, values] of Object.entries(config)) {
    if (profileNameOf(section) === null) continue;
    const startUrl = values.sso_start_url;
    if (!startUrl || byStartUrl.has(startUrl)) continue;
    byStartUrl.set(startUrl, {
      name: undefined,
      startUrl,
      region: values.sso_region ?? DEFAULT_SSO_REGION,
    });
  }

  return [...byStartUrl.values()];
}

export async function discoverProfiles(): Promise<Profile[]> {
  return parseProfiles(await parseIniFile(configPath()));
}

export async function discoverSSOSessions(): Promise<SSOSession[]> {
  return parseSSOSessions(await parseIniFile(configPath()));
}

const ROLE_ARN_RE = /^arn:[^:]*:iam::(\d+):role\/(?:.*\/)?(.+)$/;

export function accountIdFromArn(arn: string): string | undefined {
  return ROLE_ARN_RE.exec(arn)?.[1];
}

export function roleNameFromArn(arn: string): string | undefined {
  return ROLE_ARN_RE.exec(arn)?.[2];
}

/** The region a profile's own calls should use, where config gives one. */
export function profileRegion(profile: Profile): string | undefined {
  return profile.region ?? (profile.kind === "sso" ? profile.ssoRegion : undefined);
}

/** The portal an SSO profile logs in to. */
export function sessionOf(profile: SSOProfile): SSOSession {
  return { name: profile.ssoSession, startUrl: profile.ssoStartUrl, region: profile.ssoRegion };
}

/** The account a profile's credentials belong to, where it is known from config alone. */
export function profileAccountId(profile: Profile): string | undefined {
  return profile.kind === "sso" ? profile.ssoAccountId : accountIdFromArn(profile.roleArn);
}

/** The role a profile assumes, where it is known from config alone. */
export function profileRoleName(profile: Profile): string | undefined {
  return profile.kind === "sso" ? profile.ssoRoleName : roleNameFromArn(profile.roleArn);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A sensible, editable default name for a newly added account/role profile. */
export function suggestProfileName(accountName: string, roleName: string): string {
  return [slug(accountName), slug(roleName)].filter(Boolean).join("-");
}

/** The config keys that describe an SSO account/role, in the dialect the session uses. */
export function ssoProfileEntries(
  session: SSOSession,
  accountId: string,
  roleName: string,
  region?: string,
): CredentialEntry {
  return {
    ...(session.name
      ? { sso_session: session.name }
      : { sso_start_url: session.startUrl, sso_region: session.region }),
    sso_account_id: accountId,
    sso_role_name: roleName,
    ...(region && { region }),
  };
}

/**
 * Add (or update) `[profile name]` in ~/.aws/config, preserving every other
 * line — other profiles, `[sso-session]` blocks, comments and formatting — of a
 * file users very much hand-maintain.
 */
export async function writeProfileToConfig(name: string, entries: CredentialEntry): Promise<void> {
  const path = configPath();
  const existing = await readFile(path, "utf8").catch(() => "");
  await mkdir(awsDir(), { recursive: true });
  await writeFile(path, upsertProfile(existing, `${PROFILE_PREFIX}${name}`, entries));
}

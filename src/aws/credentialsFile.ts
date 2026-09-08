/**
 * Reading and writing ~/.aws/credentials in the exact dialect the AWS CLI and
 * the AWS SDKs expect.
 *
 * The `ini` package is deliberately not used here. It quotes any value that
 * contains `=` — which every SSO session token does, thanks to base64 padding —
 * while the AWS parsers take everything after the first `=` verbatim. A quoted
 * token therefore reaches AWS with literal `"` characters and every signed
 * request fails. This module also preserves unrelated sections, comments and
 * formatting, since ~/.aws/credentials is frequently hand-maintained.
 */

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { awsDir, credentialsPath } from "./paths.js";
import type { AWSCredentials, StoredCredentials } from "./credentials.js";

export interface CredentialEntry {
  [key: string]: string;
}

const SECTION_RE = /^\s*\[([^\]]+)\]/;

/** Strip surrounding quotes left behind by an older awssesh (or by `ini`). */
export function unquote(value: string): string {
  const match = /^(["'])([\s\S]*)\1$/.exec(value.trim());
  return match ? match[2]! : value.trim();
}

function keyOf(line: string): string | null {
  if (SECTION_RE.test(line)) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return null;
  const eq = trimmed.indexOf("=");
  return eq > 0 ? trimmed.slice(0, eq).trim() : null;
}

/**
 * Parse a credentials file into `{ section: { key: value } }`.
 * Values are unquoted defensively so files written by earlier versions still read back.
 */
export function parseCredentials(text: string): Record<string, CredentialEntry> {
  const sections: Record<string, CredentialEntry> = {};
  let current: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const section = SECTION_RE.exec(line);
    if (section) {
      current = section[1]!.trim();
      sections[current] ??= {};
      continue;
    }
    if (!current) continue;
    const key = keyOf(line);
    if (key === null) continue;
    const value = line.slice(line.indexOf("=") + 1);
    sections[current]![key] = unquote(value);
  }

  return sections;
}

/**
 * Insert or update `entries` under `[section]`, leaving every other line —
 * other sections, comments, blank lines, key order — exactly as it was.
 *
 * `section` is the full bracket name, so this serves ~/.aws/credentials
 * (`prod`) and ~/.aws/config (`profile prod`) alike.
 *
 * Keys listed in `remove` are dropped from the section unless `entries` sets
 * them. Merging alone is wrong when the new entries redefine what a profile
 * *is*: writing an SSO profile over a `role_arn` one left both key sets in
 * place, and the reader takes `role_arn` first — so the profile the user was
 * told had been added was not the profile awssesh went on to use.
 */
export function upsertProfile(
  text: string,
  section: string,
  entries: CredentialEntry,
  remove: readonly string[] = [],
): string {
  const lines = text.length === 0 ? [] : text.split("\n");
  const header = `[${section}]`;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const found = SECTION_RE.exec(lines[i]!);
    if (found && found[1]!.trim() === section) {
      start = i;
      break;
    }
  }

  // Profile absent — append a fresh section.
  if (start === -1) {
    const body = Object.entries(entries).map(([k, v]) => `${k} = ${v}`);
    const prefix = lines.length > 0 && lines.some((l) => l.trim() !== "") ? [...trimTrailingBlank(lines), ""] : [];
    return [...prefix, header, ...body, ""].join("\n");
  }

  // Section spans until the next section header (or EOF).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  const remaining = new Map(Object.entries(entries));
  const drop = new Set(remove.filter((key) => !(key in entries)));

  const rewritten = body
    .filter((line) => {
      const key = keyOf(line);
      return key === null || !drop.has(key);
    })
    .map((line) => {
      const key = keyOf(line);
      if (key === null || !remaining.has(key)) return line;
      const value = remaining.get(key)!;
      remaining.delete(key);
      return `${key} = ${value}`;
    });

  // Append keys the section did not already have, before its trailing blank lines.
  let insertAt = rewritten.length;
  while (insertAt > 0 && rewritten[insertAt - 1]!.trim() === "") insertAt--;
  rewritten.splice(insertAt, 0, ...[...remaining].map(([k, v]) => `${k} = ${v}`));

  return [...lines.slice(0, start), header, ...rewritten, ...lines.slice(end)].join("\n");
}

function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end--;
  return lines.slice(0, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading and writing the file itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Key used to persist when the role credentials stop working.
 *
 * The AWS parsers ignore keys they do not recognise, and `x_security_token_expires`
 * is the de-facto name other SSO helpers (aws-vault, granted) already use for
 * exactly this. Without it awssesh had no way to tell live credentials from
 * hour-old dead ones, so it happily copied expired keys to the clipboard and
 * reported success.
 */
export const EXPIRY_KEY = "x_security_token_expires";

/**
 * Writes are queued, because each one reads the whole file, edits a section and
 * writes it back: two overlapping writers would each start from the same text
 * and the loser's section would silently revert. The TUI has real concurrency
 * here — the 30s auto-refresh tick and a keypress both write.
 *
 * This orders writers inside one process; a second awssesh running at the same
 * instant is still on its own, as it is for every tool that edits this file.
 */
let writeQueue: Promise<void> = Promise.resolve();

export function writeCredentials(profileName: string, credentials: AWSCredentials): Promise<void> {
  const write = writeQueue.then(() => writeCredentialsNow(profileName, credentials));
  writeQueue = write.catch(() => {});
  return write;
}

async function writeCredentialsNow(profileName: string, credentials: AWSCredentials): Promise<void> {
  const existing = await readFile(credentialsPath(), "utf8").catch(() => "");

  const next = upsertProfile(existing, profileName, {
    aws_access_key_id: credentials.accessKeyId,
    aws_secret_access_key: credentials.secretAccessKey,
    ...(credentials.sessionToken && { aws_session_token: credentials.sessionToken }),
    ...(credentials.expiration && { [EXPIRY_KEY]: credentials.expiration.toISOString() }),
  });

  await mkdir(awsDir(), { recursive: true });
  await writeFile(credentialsPath(), next, { mode: 0o600 });
  // `mode` only applies when the file is created, so enforce it on every write:
  // these are live session credentials and must not be world-readable.
  await chmod(credentialsPath(), 0o600).catch(() => {});
}

export function readProfileCredentials(profileName: string): StoredCredentials | null {
  try {
    const content = readFileSync(credentialsPath(), "utf8");
    const section = parseCredentials(content)[profileName];
    if (!section) return null;
    const accessKeyId = section.aws_access_key_id;
    const secretAccessKey = section.aws_secret_access_key;
    if (!accessKeyId || !secretAccessKey) return null;

    // Absent for credentials written by an older awssesh or by another tool;
    // callers treat an unknown expiry as "assume stale and re-fetch".
    const raw = section[EXPIRY_KEY];
    const parsed = raw ? new Date(raw) : null;
    const expiresAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

    return { accessKeyId, secretAccessKey, sessionToken: section.aws_session_token, expiresAt };
  } catch {
    return null;
  }
}


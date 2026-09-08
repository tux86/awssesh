/**
 * Locations of the AWS shared config files.
 *
 * Resolved per call rather than captured at import time: reading `HOME` once at
 * module load froze the paths for the life of the process, which silently
 * ignored a later `HOME` change (and made the modules impossible to sandbox in
 * tests).
 */

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

export function awsDir(): string {
  return `${homeDir()}/.aws`;
}

export function configPath(): string {
  return `${awsDir()}/config`;
}

export function credentialsPath(): string {
  return `${awsDir()}/credentials`;
}

export function ssoCacheDir(): string {
  return `${awsDir()}/sso/cache`;
}

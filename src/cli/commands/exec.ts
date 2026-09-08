import { spawn } from "node:child_process";
import { constants } from "node:os";
import { buildExecEnv } from "../../aws/env.js";
import { profileRegion } from "../../aws/profiles.js";
import { obtainCredentials } from "./credentials.js";

/** The shell convention for "killed by signal N", so callers see what happened. */
function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
  if (signal) return 128 + (constants.signals[signal] ?? 0);
  return code ?? 0;
}

/**
 * `awssesh exec <profile> -- <command>` — run a command with the profile's
 * credentials in its environment, and nowhere else.
 */
export async function runExec(profileName: string, command: string[]): Promise<number> {
  const result = await obtainCredentials(profileName, "ensure");
  if (!result.ok) {
    process.stderr.write(result.error + "\n");
    return 1;
  }

  const [bin, ...args] = command as [string, ...string[]];
  const child = spawn(bin, args, {
    stdio: "inherit",
    env: buildExecEnv(process.env, result.credentials, profileRegion(result.profile)),
  });

  return new Promise<number>((resolve) => {
    // 127 is what a shell returns for "command not found", which is the only
    // way this spawn realistically fails.
    child.on("error", (error) => {
      process.stderr.write(`awssesh: cannot run ${bin}: ${error.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => resolve(exitCodeFor(code, signal)));
  });
}

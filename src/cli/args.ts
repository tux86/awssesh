export type ParsedArgs =
  | { kind: "tui" }
  | { kind: "version" }
  | { kind: "status" }
  | { kind: "export"; profile: string; json: boolean }
  | { kind: "exec"; profile: string; command: string[] }
  | { kind: "refresh"; profile?: string }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return { kind: "tui" };
  if (cmd === "--version" || cmd === "-v") return { kind: "version" };
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return { kind: "help" };
  if (cmd === "status") return { kind: "status" };
  if (cmd === "refresh") return { kind: "refresh", profile: rest[0] };
  if (cmd === "export") return parseExport(rest);
  if (cmd === "exec") return parseExec(rest);
  return { kind: "error", message: `unknown command: ${cmd}` };
}

/** `export <profile> [--json]`, with the flag accepted on either side. */
function parseExport(rest: string[]): ParsedArgs {
  const json = rest.includes("--json");
  const positional = rest.filter((arg) => arg !== "--json");
  const unknown = positional.find((arg) => arg.startsWith("-"));
  if (unknown) return { kind: "error", message: `unknown option for export: ${unknown}` };
  if (!positional[0]) return { kind: "error", message: "export requires a profile name" };
  return { kind: "export", profile: positional[0], json };
}

/**
 * `exec <profile> [--] <command...>`. Everything after the profile belongs to
 * the command — including its own flags, which is why an explicit `--` is
 * supported but not required.
 */
function parseExec(rest: string[]): ParsedArgs {
  const [profile, ...tail] = rest;
  if (!profile) return { kind: "error", message: "exec requires a profile name" };
  const command = tail[0] === "--" ? tail.slice(1) : tail;
  if (command.length === 0) {
    return { kind: "error", message: "exec requires a command to run, e.g. awssesh exec prod -- aws s3 ls" };
  }
  return { kind: "exec", profile, command };
}

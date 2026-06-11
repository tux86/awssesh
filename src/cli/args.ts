export type ParsedArgs =
  | { kind: "tui" }
  | { kind: "version" }
  | { kind: "status" }
  | { kind: "export"; profile: string }
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
  if (cmd === "export") {
    if (!rest[0]) return { kind: "error", message: "export requires a profile name" };
    return { kind: "export", profile: rest[0] };
  }
  return { kind: "error", message: `unknown command: ${cmd}` };
}

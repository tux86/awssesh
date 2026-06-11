export type ParsedArgs =
  | { kind: "tui"; daemon: boolean }
  | { kind: "version" }
  | { kind: "status" }
  | { kind: "export"; profile: string }
  | { kind: "refresh"; profile?: string }
  | { kind: "daemon"; sub?: string }
  | { kind: "__daemon" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) return { kind: "tui", daemon: false };
  if (cmd === "--version" || cmd === "-v") return { kind: "version" };
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return { kind: "help" };
  if (cmd === "--daemon") return { kind: "tui", daemon: true };
  if (cmd === "__daemon") return { kind: "__daemon" };
  if (cmd === "status") return { kind: "status" };
  if (cmd === "refresh") return { kind: "refresh", profile: rest[0] };
  if (cmd === "export") {
    if (!rest[0]) return { kind: "error", message: "export requires a profile name" };
    return { kind: "export", profile: rest[0] };
  }
  if (cmd === "daemon") return { kind: "daemon", sub: rest[0] };
  return { kind: "error", message: `unknown command: ${cmd}` };
}

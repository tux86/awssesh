#!/usr/bin/env node
/**
 * awssesh — entry point. Routes the command line to a subcommand, or launches
 * the TUI (`tui/Awssesh.tsx`) when there is nothing to route.
 */

import React from "react";
import { parseArgs } from "./args.js";
import { runStatus } from "./commands/status.js";
import { runExport } from "./commands/export.js";
import { runExec } from "./commands/exec.js";
import { runRefresh } from "./commands/refresh.js";
import { renderApp } from "./components/index.js";
import { enterAltScreen } from "./altScreen.js";
import { Awssesh } from "./tui/Awssesh.js";
import { VERSION } from "../version.js";

const HELP = `awssesh — interactive AWS SSO credential manager

Usage:
  awssesh                        launch the interactive TUI
  awssesh status                 print profile statuses and exit
  awssesh refresh [profile]      refresh a profile (or all ⟳ profiles) now
  awssesh export <profile>       print export AWS_* lines for eval $(...)
  awssesh export <profile> --json  print credential_process JSON
  awssesh exec <profile> -- <cmd>  run a command with the profile's credentials
  awssesh --version              print the version
  awssesh --help                 show this message

Examples:
  eval $(awssesh export prod)
  awssesh exec prod -- terraform plan
  awssesh refresh prod

  # let every AWS SDK and the AWS CLI fetch credentials themselves,
  # in ~/.aws/config:
  #   [profile prod-auto]
  #   credential_process = awssesh export prod --json

Environment:
  AWSSESH_NO_UPDATE_CHECK    skip the release check on startup
  AWSSESH_NO_HYPERLINKS      render URLs as plain text
  AWSSESH_NO_ALT_SCREEN      draw inline instead of taking over the terminal
`;

async function launchTui(): Promise<void> {
  // The TUI owns the terminal while it runs and hands it back untouched.
  const leaveAltScreen = enterAltScreen();
  try {
    const instance = renderApp(<Awssesh />);
    // Always terminate promptly on quit; the in-process auto-refresh interval is
    // cleared on unmount, so there are no lingering handles.
    await instance.waitUntilExit();
  } finally {
    leaveAltScreen();
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.kind) {
    case "version":
      process.stdout.write(`awssesh v${VERSION}\n`);
      return;
    case "help":
      process.stdout.write(HELP);
      return;
    case "status":
      process.exit(await runStatus());
      return;
    case "export":
      process.exit(await runExport(parsed.profile, parsed.json));
      return;
    case "exec":
      process.exit(await runExec(parsed.profile, parsed.command));
      return;
    case "refresh":
      process.exit(await runRefresh(parsed.profile));
      return;
    case "error":
      process.stderr.write(parsed.message + "\n");
      process.stderr.write("\n" + HELP);
      process.exit(1);
      return;
    case "tui":
      await launchTui();
      return;
  }
}

void main();

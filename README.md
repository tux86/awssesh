# SSOmatic

Keep your AWS SSO credentials fresh — automatically. A fast terminal dashboard with a background daemon that silently maintains your favorites while you work.

[![npm version](https://img.shields.io/npm/v/ssomatic)](https://www.npmjs.com/package/ssomatic)
[![CI](https://github.com/tux86/ssomatic/actions/workflows/ci.yml/badge.svg)](https://github.com/tux86/ssomatic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## Why SSOmatic

- **k9s-style list-first dashboard** — all your SSO profiles at a glance with live expiry countdowns; navigate with j/k or arrow keys, no menus to dig through.
- **Background daemon that keeps ⟳ auto-refresh profiles fresh** — pin a profile for auto-refresh and expiry-aware refresh keeps its credentials ready before they expire, with zero fixed-interval polling waste.
- **Notify-on-login, never surprise you** — when an interactive SSO login is required the daemon sends a desktop notification; it never opens a browser on its own.
- **One-keystroke everything** — copy `export AWS_*` vars, open the AWS console, copy the profile name, or force a refresh — all from the dashboard without leaving your terminal.
- **Attach from any terminal** — run `ssomatic` once to open the TUI; press `b` to push it to the background; re-run `ssomatic` from any terminal window to reconnect to the live daemon state.

---

## Demo

<!-- TODO: re-record demo GIF for the v2 dashboard + daemon -->
<p align="center">
  <img src="docs/screenshots/cli-demo.gif" alt="SSOmatic CLI Demo" width="720">
</p>

---

## Install

```bash
# Run without installing
npx ssomatic
bunx ssomatic

# Or install globally
npm install -g ssomatic
```

---

## Quick Start

```bash
# 1. Launch the dashboard
ssomatic

# 2. Star the profiles you use daily — press f on any profile
# 3. Send to background — press b (daemon stays running, terminal returns)
# 4. From any terminal, re-attach to live state
ssomatic
```

The daemon keeps your ⟳ auto-refresh profiles' credentials fresh in the background. When a browser login is required, you get a desktop notification and can log in from the TUI or with `ssomatic refresh <profile>`.

---

## Commands

| Command | Description |
|---------|-------------|
| `ssomatic` | Launch the interactive TUI (attaches to daemon if running) |
| `ssomatic --daemon` | Launch the TUI and start the background daemon |
| `ssomatic status` | Print profile statuses and exit |
| `ssomatic refresh [name]` | Refresh a profile (or all favorites) now |
| `ssomatic export <name>` | Print `export AWS_*` lines for `eval $(...)` |
| `ssomatic daemon start\|stop\|status` | Manage the background daemon directly |
| `ssomatic --version` | Print version and exit |

**Shell trick — inject credentials into your current shell:**

```bash
eval $(ssomatic export prod)
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Move cursor |
| `Enter` | Open profile details |
| `r` | Refresh the current profile |
| `a` | Toggle ⟳ auto-refresh (pin for the daemon) |
| `b` | Run daemon in background, detach TUI |
| `c` | Copy `export AWS_*` to clipboard |
| `y` | Copy profile name to clipboard |
| `o` | Open AWS console in browser |
| `/` | Filter profiles by name |
| `s` | Open settings |
| `Esc` | Back |
| `q` | Quit |

---

## How the Daemon Works

One daemon instance runs per host, listening on a Unix socket (`$XDG_RUNTIME_DIR/ssomatic.sock` or `$TMPDIR/ssomatic.sock`). The TUI attaches to it via that socket so any `ssomatic` invocation sees the same live state.

**Expiry-aware refresh** — the daemon tracks the role-credential expiry for each starred profile and refreshes only when the credentials are within the lead window of expiring (default: a few minutes before expiry). No fixed interval; no wasted refreshes.

**Never opens a browser** — when an interactive SSO login is needed the daemon sends a desktop notification (`SSOmatic: <profile> needs login`). You authorize by running `ssomatic` (TUI) or `ssomatic refresh <profile>`.

Daemon logs are written to `~/.aws/ssomatic/daemon.log`.

---

## Prerequisites

- [AWS CLI v2](https://aws.amazon.com/cli/) configured with SSO profiles in `~/.aws/config`

---

## Development

Requires [Bun](https://bun.sh) >= 1.0.

```bash
git clone https://github.com/tux86/ssomatic.git
cd ssomatic
bun install

bun run start    # Run from source
bun run dev      # Run with --watch (auto-restart on changes)
bun run build    # Build the Node CLI bundle (dist/cli.js)
bun run lint     # Run ESLint
bun test         # Run unit tests
```

---

## Contributing

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

Uses [Conventional Commits](https://www.conventionalcommits.org/) and [release-please](https://github.com/googleapis/release-please).

## License

[MIT](LICENSE)

---

<p align="center">
  Made with &#10084; by <a href="https://github.com/tux86">tux86</a>
</p>

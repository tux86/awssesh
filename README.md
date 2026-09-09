# awssesh

Keep your AWS SSO credentials fresh — automatically. A fast terminal dashboard that auto-refreshes your pinned profiles while it's open.

[![npm version](https://img.shields.io/npm/v/awssesh)](https://www.npmjs.com/package/awssesh)
[![CI](https://github.com/tux86/awssesh/actions/workflows/ci.yml/badge.svg)](https://github.com/tux86/awssesh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## Why awssesh

- **Full-screen, k9s-style dashboard** — takes over the terminal while it runs and hands it back untouched when you quit; every profile at a glance with live expiry countdowns, navigated with j/k or arrow keys, no menus to dig through.
- **In-process auto-refresh for ⟳ pinned profiles** — pin a profile with `a` and expiry-aware refresh keeps its credentials ready before they expire, with no fixed-interval polling waste.
- **Notify-on-login, never surprise you** — when an interactive SSO login is required awssesh sends a desktop notification so you know to log in.
- **One-keystroke everything** — copy `export AWS_*` vars, open the AWS console, copy the profile name, or force a refresh — all from the dashboard without leaving your terminal.
- **Credentials where your tools read them** — `awssesh exec` runs any command with the credentials in its environment, and `credential_process` lets every AWS SDK and the AWS CLI fetch them on their own.
- **Add profiles without hand-editing config** — press `n` to browse the accounts and roles your SSO portal actually grants you, and awssesh writes the profile to `~/.aws/config`.
- **Chained roles and MFA too** — `role_arn` + `source_profile` profiles are managed alongside SSO ones, prompting for an MFA code when `mfa_serial` calls for it.
- **Single process, clean exit** — quitting fully exits. No background processes to manage.

---

## Demo

<p align="center">
  <img src="docs/screenshots/cli-demo.gif" alt="awssesh CLI Demo" width="720">
</p>

---

## Install

```bash
# Run without installing
npx awssesh@latest
bunx awssesh@latest

# Or install globally
npm install -g awssesh
```

> Use the `@latest` tag. `bunx` caches resolved packages in `~/.bun/install/cache`,
> so a bare `bunx awssesh` keeps running whatever version it cached first. If you
> are already stuck on an old one, `bun pm cache rm` clears it.

---

## Quick Start

```bash
# 1. Launch the dashboard
awssesh

# 2. Navigate to a profile and press 'a' to pin it for auto-refresh
# 3. awssesh auto-refreshes pinned profiles while the dashboard is open
# 4. Press 'q' to quit when done
```

While the dashboard is open, ⟳ pinned profiles are refreshed automatically when their credentials are close to expiry. When a browser login is required, you get a desktop notification and can log in directly from the TUI or with `awssesh refresh <profile>`.

---

## Commands

| Command | Description |
|---------|-------------|
| `awssesh` | Launch the interactive TUI |
| `awssesh status` | Print profile statuses and exit |
| `awssesh refresh [name]` | Refresh a profile (or all favorites) now |
| `awssesh export <name>` | Print `export AWS_*` lines for `eval $(...)` |
| `awssesh export <name> --json` | Print the `credential_process` JSON payload |
| `awssesh exec <name> -- <cmd>` | Run a command with the profile's credentials |
| `awssesh --version` | Print version and exit |
| `awssesh --help` | Show usage |

**Inject credentials into your current shell:**

```bash
eval $(awssesh export prod)
```

**Or keep them out of your shell entirely:**

```bash
awssesh exec prod -- terraform plan
awssesh exec prod -- aws s3 ls
```

`exec` puts the credentials in the child process's environment and nowhere else —
no `~/.aws/credentials` entry to go stale, no exported variables left behind in
your shell. Its exit code is the command's.

### Let your tools fetch credentials themselves

Point a profile at awssesh with `credential_process` and every AWS SDK, the AWS
CLI, Terraform and anything else that reads `~/.aws/config` gets fresh
credentials on demand — including a chained or MFA-gated role:

```ini
# ~/.aws/config
[profile prod-auto]
credential_process = awssesh export prod --json
region = eu-west-1
```

awssesh reuses cached credentials until they are close to expiring, so this
costs a round trip only when there is something to renew. It never prompts:
with no terminal attached it fails with a message telling you to run
`awssesh refresh prod` once, interactively.

---

## Profiles awssesh manages

Anything in `~/.aws/config` with a session to keep alive:

```ini
# an SSO profile
[profile dev]
sso_session = my-sso
sso_account_id = 111111111111
sso_role_name = Developer

# a role chained off it — refreshed through dev, with no extra login
[profile prod-admin]
role_arn = arn:aws:iam::333333333333:role/Admin
source_profile = dev

# and one that wants an MFA code, which awssesh prompts for
[profile prod-break-glass]
role_arn = arn:aws:iam::333333333333:role/BreakGlass
source_profile = dev
mfa_serial = arn:aws:iam::333333333333:mfa/you
```

A chain can be any depth and can start from long-lived IAM keys in
`~/.aws/credentials` instead of SSO — those never ask for a browser login.
Profiles with nothing to refresh (plain IAM keys) are left out of the list.

### Adding a profile

Press `n` in the dashboard. awssesh asks your SSO portal which accounts and
roles you actually have, you pick one, name it, and the profile is appended to
`~/.aws/config` — the rest of the file, comments included, is left exactly as it
was. This works from an empty config too, as long as it has an `[sso-session]`
block.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Move cursor |
| `g` / `G` | Jump to first / last profile |
| `Enter` | Open profile details |
| `r` | Refresh the current profile |
| `a` | Toggle ⟳ auto-refresh (pin/unpin) |
| `c` | Copy `export AWS_*` to clipboard |
| `y` | Copy profile name to clipboard |
| `o` | Open AWS console in browser |
| `n` | Add a profile from your SSO portal |
| `/` | Filter profiles by name |
| `s` | Open settings |
| `?` | Show all keyboard shortcuts |
| `Esc` | Back, or clear an active filter |
| `g` / `G` | Jump to first / last profile |
| `q` | Quit |

---

## Profile states

`STATUS` says what the profile needs before you can use it; `EXPIRES` counts
down the credentials it has. They are drawn from the same fact, so they can
never disagree.

| Status | Means | What fixes it |
|--------|-------|---------------|
| `● valid` | Credentials on disk work right now | nothing |
| `○ expired` | The login is fine; the (hour-long) credentials are not | `r`, or pin with `a` — and `exec` / `export` fetch on demand anyway |
| `⚠ needs-login` | The SSO session has run out | `r`, then approve in the browser |
| `⚠ needs-mfa` | A chained role wants an MFA code | `r`, then type the code |
| `✗ error` | The last refresh failed | see the message; details view has the reason |

Only the `⚠`/`✗` states need you — they are what the header counts as needing
attention. `expired` is the resting state of any profile you have not pinned.

---

## How Auto-Refresh Works

awssesh tracks the role-credential expiry for each ⟳ pinned profile and refreshes only when the credentials are within the lead window of expiring (default: 5 minutes before expiry). No fixed interval; no wasted refreshes.

When an interactive SSO login is needed, a desktop notification is sent (`awssesh: <profile> needs login`). You authorize by logging in from the TUI or with `awssesh refresh <profile>`.

---

## Environment Variables

| Variable | Effect |
|----------|--------|
| `AWSSESH_NO_UPDATE_CHECK` | Skip the GitHub release check on startup |
| `AWSSESH_NO_HYPERLINKS` | Render URLs as plain text instead of clickable OSC 8 links |
| `AWSSESH_NO_ALT_SCREEN` | Draw inline instead of taking over the terminal |

---

## Prerequisites

- SSO profiles (or at least an `[sso-session]` block) in `~/.aws/config` — the
  [AWS CLI v2](https://aws.amazon.com/cli/) writes these with `aws configure sso`,
  and awssesh shares its token cache, so a login in one counts for the other
- A clipboard tool for `c` / `y` (`pbcopy`, `wl-copy`, `xclip`, `xsel`, or `clip.exe`). Over SSH,
  awssesh falls back to OSC 52 so copies land in your *local* clipboard.

---

## Development

Requires [Bun](https://bun.sh) >= 1.4.

```bash
git clone https://github.com/tux86/awssesh.git
cd awssesh
bun install

bun run start    # Run from source
bun run dev      # Run with --watch (auto-restart on changes)
bun run build    # Build the Node CLI bundle (dist/cli.js)
bun run lint     # Run ESLint
bun test         # Run unit tests (incl. Ink component tests)
bun run typecheck  # Typecheck
```

> TypeScript is pinned to 6.x: `typescript-eslint` does not yet support the
> TypeScript 7 compiler API, so bumping it breaks `bun run lint` in CI.

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

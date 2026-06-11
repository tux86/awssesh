# CLAUDE.md

## Project Overview

**SSOmatic** — Interactive AWS SSO credential manager — a terminal CLI built with Bun + React + Ink.

Distributed via npm (`npx ssomatic`). Settings (favorites, notifications, refresh interval) are persisted across sessions.

SSOmatic runs a real per-host background daemon (single instance, Unix socket). It keeps ⟳ auto-refresh profiles' role credentials fresh in an expiry-aware manner while the SSO token is valid, and sends a desktop notification when an interactive browser login is required — the daemon never opens a browser itself. The TUI attaches to the daemon over the socket for live state; any terminal that runs `ssomatic` while the daemon is up shows the live state.

## Structure

```
ssomatic/
├── src/
│   ├── aws/                   # Shared AWS logic (UI-agnostic)
│   │   ├── sso.ts             # SSO profiles, tokens, refresh
│   │   ├── sso.test.ts
│   │   ├── settings.ts        # Persistent settings (favorites, notifications, interval)
│   │   ├── settings.test.ts
│   │   ├── console.ts         # AWS console URL builders
│   │   ├── console.test.ts
│   │   ├── profileState.ts    # Profile state helpers
│   │   ├── aws.ts             # STS identity utilities
│   │   ├── utils.ts           # Clipboard, JSON formatting
│   │   └── utils.test.ts
│   ├── daemon/                # Per-host background daemon (Unix-socket server + expiry-aware scheduler)
│   │   ├── protocol.ts        # Wire protocol types + ndjson codec
│   │   ├── protocol.test.ts
│   │   ├── lifecycle.ts       # Single-instance lock + pid management
│   │   ├── lifecycle.test.ts
│   │   ├── scheduler.ts       # Expiry-aware refresh scheduler
│   │   ├── scheduler.test.ts
│   │   ├── server.ts          # Unix-socket daemon server
│   │   ├── server.test.ts
│   │   ├── client.ts          # Daemon socket client
│   │   └── index.ts           # Daemon entry point
│   └── cli/                   # Terminal UI (React/Ink)
│       ├── index.tsx          # Entry point + argument router
│       ├── args.ts            # CLI argument parsing
│       ├── args.test.ts
│       ├── commands/          # Non-TUI subcommands
│       │   ├── status.ts      # `ssomatic status`
│       │   ├── status.test.ts
│       │   ├── export.ts      # `ssomatic export <profile>`
│       │   ├── refresh.ts     # `ssomatic refresh [profile]`
│       │   └── daemon.ts      # `ssomatic daemon start|stop|status`
│       ├── tui/               # TUI screens
│       │   ├── Dashboard.tsx  # Main profile list view
│       │   ├── Details.tsx    # Profile detail view
│       │   ├── Settings.tsx   # Settings screen
│       │   └── useDaemon.ts   # Hook: connects TUI to the daemon socket
│       ├── components/        # Shared Ink UI components
│       │   ├── App.tsx        # Root container
│       │   ├── ActionBar.tsx  # Bottom action bar + ACTIONS constant
│       │   ├── Spinner.tsx
│       │   └── StatusMessage.tsx
│       └── hooks/             # Shared hooks
│           └── useCopy.tsx    # Clipboard copy with feedback
├── dist/                      # Build output
│   └── cli.js                 # Node CLI bundle (npm bin)
├── docs/screenshots/          # Demo GIFs for README
├── release-please-config.json # release-please config
├── package.json
└── tsconfig.json              # TypeScript config
```

## Tech Stack

| Tool | Purpose |
|------|---------|
| Bun | Runtime & package manager |
| TypeScript | Language |
| React | Component framework |
| Ink | React renderer for CLI |
| ESLint | Linting (flat config) |
| release-please | Automated versioning & releases |

## Commands

### Dev / Build / Test

```bash
bun install           # Install dependencies
bun run start         # Run CLI
bun run dev           # Run CLI with --watch (auto-restart on changes)
bun run build         # Build the Node CLI bundle (`dist/cli.js`)
bun run lint          # Run ESLint
bun test              # Run unit tests
```

### Runtime CLI subcommands

```bash
ssomatic                        # Launch the interactive TUI
ssomatic --daemon               # Launch the TUI and start the background daemon
ssomatic status                 # Print profile statuses and exit
ssomatic refresh [profile]      # Refresh a profile (or all favorites) now
ssomatic export <profile>       # Print export AWS_* lines (use with eval $(ssomatic export <profile>))
ssomatic daemon start|stop|status
ssomatic --version
```

## Keyboard Shortcuts (Dashboard)

| Key | Action |
|-----|--------|
| `↑` / `↓` / `k` / `j` | Move cursor |
| `⏎` | Open details |
| `r` | Refresh the current profile |
| `a` | Toggle ⟳ auto-refresh (pin for the daemon) |
| `b` | Run daemon in background |
| `c` | Copy export (`AWS_*` env vars) |
| `y` | Copy profile name |
| `o` | Open AWS console |
| `/` | Filter profiles |
| `s` | Open settings |
| `Esc` | Back |
| `q` | Quit |

## Commits & Releases

### Conventional Commits (enforced by commitlint)

```bash
feat(cli): add profile filtering      # New feature → minor bump
fix(aws): handle empty clipboard       # Bug fix → patch bump
feat!: drop legacy config format       # Breaking change → major bump
docs: update README                    # No release
build(deps): upgrade aws-sdk           # No release
```

**Allowed scopes:** `cli`, `aws`, `deps`, `ci`. PR titles are linted too (PRs are squash-merged, so the title becomes the release-driving commit).

### Releases

Automated via **release-please**. Conventional commits on `main` → release-please maintains a **Release PR** (version bump in `package.json` + `CHANGELOG.md` + pending notes). Merging that Release PR tags the release, creates the GitHub release, and publishes to **npm**.

- Config: `release-please-config.json` (release-type `node`); current version tracked in `.release-please-manifest.json`.
- **Requires:** `NPM_TOKEN` secret (npm automation token with publish scope). Uses the built-in `GITHUB_TOKEN` otherwise — no PAT.
- Repo setting: **Allow GitHub Actions to create and approve pull requests** must be enabled (Settings → Actions → General).

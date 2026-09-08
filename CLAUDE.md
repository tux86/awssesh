# CLAUDE.md

## Project Overview

**awssesh** — Interactive AWS SSO credential manager — a terminal CLI built with Bun + React + Ink.

It manages every `~/.aws/config` profile with a session that expires: SSO profiles, and `role_arn` + `source_profile` chains (with `mfa_serial` support). Credentials reach other tools three ways: the credentials file, `awssesh exec`, and `awssesh export --json` as a `credential_process`.

Distributed via npm (`npx awssesh@latest` / `bunx awssesh@latest` — the `@latest` tag matters because `bunx` caches resolved packages and a bare `bunx awssesh` will keep running a stale one). Settings (favorites, notifications, refresh interval) are persisted across sessions.

awssesh is a single-process TUI. While open it auto-refreshes the ⟳ (pinned) profiles' role credentials in an expiry-aware manner, and sends a desktop notification when an interactive SSO browser login is needed. No background process — quitting fully exits.

## Structure

```
awssesh/
├── src/
│   ├── version.ts             # VERSION + semver-aware update check
│   ├── aws/                   # Shared AWS logic (UI-agnostic)
│   │   ├── paths.ts           # ~/.aws file locations (resolved per call)
│   │   ├── profiles.ts        # Profile union (sso | assume) + config read/write
│   │   ├── credentials.ts     # Credential types + freshness
│   │   ├── credentialsFile.ts # AWS-compatible ~/.aws/credentials read/write
│   │   ├── sso.ts             # SSO token cache, device login, role credentials
│   │   ├── assumeRole.ts      # sts:AssumeRole for chained profiles
│   │   ├── refresh.ts         # ONE way in: refreshProfile / ensureCredentials
│   │   ├── accounts.ts        # ListAccounts / ListAccountRoles (profile browser)
│   │   ├── env.ts             # export block, credential_process JSON, exec env
│   │   ├── settings.ts        # Persistent settings (favorites, notifications, lead)
│   │   ├── console.ts         # AWS console URL builders
│   │   ├── duration.ts        # Shared relative-time formatting
│   │   ├── profileState.ts    # ProfileState + local-state builder (chain aware)
│   │   ├── refreshScheduler.ts # Expiry-aware refresh decision (decideAction)
│   │   └── utils.ts           # Clipboard (multi-tool + OSC 52)
│   └── cli/                   # Terminal UI (React/Ink)
│       ├── index.tsx          # Entry point + argument router
│       ├── args.ts            # CLI argument parsing
│       ├── commands/          # Non-TUI subcommands
│       │   ├── credentials.ts # Shared CLI credential path (login/MFA prompts)
│       │   ├── status.ts      # `awssesh status`
│       │   ├── export.ts      # `awssesh export <profile> [--json]`
│       │   ├── exec.ts        # `awssesh exec <profile> -- <cmd>`
│       │   └── refresh.ts     # `awssesh refresh [profile]`
│       ├── tui/               # TUI screens
│       │   ├── Dashboard.tsx  # Main profile list view
│       │   ├── Details.tsx    # Profile detail view
│       │   ├── Settings.tsx   # Settings screen
│       │   ├── AccountBrowser.tsx # Add a profile from the SSO portal
│       │   ├── LoginPrompt.tsx # SSO device-authorization screen
│       │   ├── MfaPrompt.tsx  # MFA code entry for chained roles
│       │   ├── columns.ts     # Responsive table layout + viewport maths
│       │   ├── useDeviceAuth.ts  # Hook: one device-auth flow at a time
│       │   └── useAutoRefresh.ts # Hook: in-process auto-refresh for ⟳ profiles
│       ├── testKeys.ts        # Key sequences + tick helper for component tests
│       ├── components/        # Shared Ink UI components
│       │   ├── App.tsx        # Root container + responsive width
│       │   ├── ActionBar.tsx  # Bottom action bar + ACTIONS constant
│       │   ├── SelectList.tsx # Filterable scrolling picker
│       │   ├── KeyHint.tsx    # Key / KeyBar shortcut hints
│       │   ├── Link.tsx       # OSC 8 clickable URLs
│       │   ├── Wordmark.tsx
│       │   ├── Spinner.tsx
│       │   └── StatusMessage.tsx
│       └── hooks/             # Shared hooks
│           ├── useCopy.tsx    # Clipboard copy with feedback
│           ├── useNow.ts      # Ticking clock for live countdowns
│           ├── useTerminalSize.ts    # Terminal dimensions + resize
│           └── useTransientMessage.ts # Self-expiring status messages
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
| Bun | Runtime & package manager (>= 1.4) |
| TypeScript | Language (pinned to 6.x — typescript-eslint does not support TS 7 yet) |
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
bun test              # Run unit tests (includes Ink component tests)
bun run typecheck     # Typecheck
```

### Runtime CLI subcommands

```bash
awssesh                        # Launch the interactive TUI
awssesh status                 # Print profile statuses and exit
awssesh refresh [profile]      # Refresh a profile (or all favorites) now
awssesh export <profile>       # Print export AWS_* lines (use with eval $(awssesh export <profile>))
awssesh export <profile> --json # Print credential_process JSON (for ~/.aws/config credential_process)
awssesh exec <profile> -- <cmd> # Run a command with the profile's credentials in its env
awssesh --version
awssesh --help
```

### Environment variables

| Variable | Effect |
|----------|--------|
| `AWSSESH_NO_UPDATE_CHECK` | Skip the GitHub release check on startup |
| `AWSSESH_NO_HYPERLINKS` | Render URLs as plain text instead of OSC 8 links |
| `AWSSESH_DEMO` | Stub the interactive SSO network calls (used by the demo recording) |

## Keyboard Shortcuts (Dashboard)

| Key | Action |
|-----|--------|
| `↑` / `↓` / `k` / `j` | Move cursor |
| `⏎` | Open details |
| `r` | Refresh the current profile |
| `a` | Toggle ⟳ auto-refresh |
| `c` | Copy export (`AWS_*` env vars) |
| `y` | Copy profile name |
| `o` | Open AWS console |
| `n` | Add a profile from the SSO portal (accounts → roles → name) |
| `/` | Filter profiles |
| `g` / `G` | Jump to first / last profile |
| `s` | Open settings |
| `?` | Keyboard shortcut help |
| `Esc` | Back, or clear an active filter |
| `q` | Quit |

## Testing

Three layers, all offline:

- **Pure logic** — parsing, chain resolution, renderers, arg parsing. Plain unit tests.
- **Seams instead of mocks** — `refreshProfile`/`ensureCredentials` take a `providers` object (SSO + AssumeRole), `resolveCredentials` takes its prompts, and `AccountBrowser` takes its listings. Pass fakes in tests; the defaults are the real thing. **Do not use `mock.module`**: Bun shares one process across test files, so a module mock in one file breaks the others.
- **Components** — rendered with `ink-testing-library`, driven by real key sequences from `src/cli/testKeys.ts`. `stdin.write()` then `await tick()` before asserting on `lastFrame()`; one `write` is one input event, so send keys separately when the component reads them one at a time.

Anything that talks to AWS (`client.send`) is deliberately a single line at the edge of a module, so everything around it is testable without a network.

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

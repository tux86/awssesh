# CLAUDE.md

## Project Overview

**SSOmatic** — Interactive AWS SSO credential manager — a terminal CLI built with Bun + React + Ink.

Distributed via npm (`npx ssomatic`). Settings (favorites, notifications, refresh interval) are persisted across sessions.

## Structure

```
ssomatic/
├── src/
│   ├── aws/                   # Shared AWS logic (UI-agnostic)
│   │   ├── sso.ts             # SSO profiles, tokens, refresh, settings
│   │   ├── sso.test.ts        # Unit tests for sso.ts
│   │   ├── aws.ts             # STS identity utilities
│   │   ├── utils.ts           # Clipboard, JSON formatting
│   │   └── utils.test.ts      # Unit tests for utils.ts
│   └── cli/                   # Terminal UI (React/Ink)
│       ├── index.tsx          # Entry point
│       ├── components/        # Ink UI components
│       └── hooks/             # Ink hooks (useIdentity, useCopy)
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

```bash
bun install           # Install dependencies
bun run start         # Run CLI
bun run dev           # Run CLI with --watch (auto-restart on changes)
bun run build         # Build the Node CLI bundle (`dist/cli.js`)
bun run lint          # Run ESLint
bun test              # Run unit tests
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Back |
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

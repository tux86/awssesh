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
├── .releaserc.json            # semantic-release config
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
| semantic-release | Automated versioning & releases |

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
docs: update README                    # No release
build(deps): upgrade aws-sdk           # No release
```

**Allowed scopes:** `cli`, `aws`, `deps`, `ci`

### Releases

Fully automated via **semantic-release**. Push to `main` with conventional commits → CI passes → version bumped, CHANGELOG.md updated, GitHub release created, and the package published to npm. No manual steps.

**Requires:** `RELEASE_TOKEN` secret in GitHub repo settings (PAT with `contents: write` scope) and an `NPM_TOKEN` secret (npm automation token with publish scope).

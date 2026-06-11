# SSOmatic

Interactive AWS SSO credential manager for your terminal.

[![npm version](https://img.shields.io/npm/v/ssomatic)](https://www.npmjs.com/package/ssomatic)
[![npm downloads](https://img.shields.io/npm/dm/ssomatic)](https://www.npmjs.com/package/ssomatic)
[![CI](https://github.com/tux86/ssomatic/actions/workflows/ci.yml/badge.svg)](https://github.com/tux86/ssomatic/actions/workflows/ci.yml)
[![Release](https://github.com/tux86/ssomatic/actions/workflows/release.yml/badge.svg)](https://github.com/tux86/ssomatic/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/tux86/ssomatic)](https://github.com/tux86/ssomatic)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## Install

```bash
# Run without installing
npx ssomatic
bunx ssomatic

# Or install globally
npm install -g ssomatic
```

## Demo

<p align="center">
  <img src="docs/screenshots/cli-demo.gif" alt="SSOmatic CLI Demo" width="720">
</p>

## Features

- **Auto-discovery** — Scans `~/.aws/config` for SSO profiles (legacy and sso_session)
- **Status dashboard** — View credential validity with expiry countdown
- **Multi-select refresh** — Refresh multiple profiles at once with SSO device auth
- **Auto-refresh daemon** — Background process to keep credentials fresh
- **Desktop notifications** — Alerts when credentials expire (macOS/Linux)
- **Persistent settings** — Notifications and favorites saved across sessions

## Prerequisites

- [AWS CLI v2](https://aws.amazon.com/cli/) configured with SSO profiles in `~/.aws/config`

## Usage

Launch it (`ssomatic`, or `npx ssomatic` / `bunx ssomatic`) and use the interactive menu:

- **Check status** — see every SSO profile and whether its credentials are valid or expired
- **Refresh now** — log in and refresh one or more profiles (opens the SSO device-authorization flow)
- **Auto-refresh** — keep selected profiles refreshed automatically on an interval
- **Settings** — toggle notifications, set the default interval, and pick favorite profiles

## Development

Requires [Bun](https://bun.sh) >= 1.0.

```bash
git clone https://github.com/tux86/ssomatic.git
cd ssomatic
bun install

bun run start         # Run from source
bun run dev           # Run with --watch (auto-restart on changes)
bun run build         # Build the Node CLI bundle (dist/cli.js)
bun run lint          # Run ESLint
bun test              # Run unit tests
```

## Project Structure

```
ssomatic/
├── src/
│   ├── aws/           # Shared AWS credential logic (sso.ts, aws.ts, utils.ts)
│   │   └── *.test.ts   # Unit tests
│   └── cli/           # Terminal UI (React/Ink) — entry point
│       ├── index.tsx   # Main app
│       ├── components/ # Ink UI components
│       └── hooks/      # useIdentity, useCopy
├── dist/              # Build output (dist/cli.js — the npm bin)
└── package.json
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate |
| `Enter` | Select |
| `Space` | Toggle selection |
| `a` | Select all / none |
| `c` | Copy URL |
| `Escape` | Back |
| `q` | Quit |

## Contributing

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

Uses [Conventional Commits](https://www.conventionalcommits.org/) and [semantic-release](https://semantic-release.gitbook.io/).

## License

[MIT](LICENSE)

---

<p align="center">
  Made with &#10084; by <a href="https://github.com/tux86">tux86</a>
</p>

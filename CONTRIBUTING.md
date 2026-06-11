# Contributing to SSOmatic

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- AWS CLI configured with SSO profiles (for testing)
- Git

## Development Setup

```bash
git clone https://github.com/tux86/ssomatic.git
cd ssomatic
bun install

# Run the CLI from source
bun run start

# Run with --watch (auto-restart on changes)
bun run dev

# Lint
bun run lint

# Run unit tests
bun test
```

## Project Structure

```
ssomatic/
├── src/
│   ├── aws/           # AWS credential logic (sso.ts, aws.ts, utils.ts) + unit tests
│   └── cli/           # Terminal UI (React/Ink) + entry point
├── .github/           # Workflows and templates
└── package.json
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scopes:** `cli`, `aws`, `deps`, `ci`

A breaking change is marked with `!` after the type/scope (e.g. `feat!:`) or a `BREAKING CHANGE:` footer — this bumps the major version.

Commits are validated by [commitlint](https://commitlint.js.org/) via a Git hook. Pull request titles are also validated, because **PRs are squash-merged** and the PR title becomes the commit message that drives the release. Keep your PR title a valid Conventional Commit.

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please). When conventional commits land on `main`, release-please opens (and keeps updating) a **Release PR** that bumps the version in `package.json`, updates `CHANGELOG.md`, and shows the pending release notes. Merging that Release PR tags the release, creates the GitHub release, and publishes the package to **npm**. No manual version edits needed.

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes with conventional commits
3. Ensure `bun run lint` and `bun test` pass
4. Open a PR using the provided template

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Business logic in `src/aws/sso.ts` (UI-agnostic)
- CLI components use Ink

## Building

```bash
bun run build

# Output: dist/cli.js (the npm bin)
```

## Questions?

Open an [issue](https://github.com/tux86/ssomatic/issues) or start a [discussion](https://github.com/tux86/ssomatic/discussions).

# SSOmatic v2 — CLI-only, npm, KISS — Design

**Date:** 2026-06-11
**Status:** Approved (design phase)

## Goal

Simplify SSOmatic (KISS) into a professional public GitHub project:
**interactive CLI only** (drop the web layer), distributed via **npm** (`npx ssomatic`),
**runtime-agnostic** code (Node + Bun), with **unit tests** on the AWS/SSO logic.

No user-facing feature is removed: status, refresh/login, daemon (auto-refresh),
favorites and notifications are all kept. The work targets web removal, runtime
plumbing, packaging, and modernization.

## Scoping decisions

| Question | Decision |
|----------|----------|
| CLI form | Interactive TUI only (as today) |
| Features | All kept (status, refresh/login, daemon, favorites + notifications) |
| Distribution | npm — `npx ssomatic` / `bunx ssomatic` / `npm i -g ssomatic` |
| Runtime | Node ≥ 18 **and** Bun (runtime-agnostic code) |
| Tests | Unit tests on AWS/SSO logic (`bun test`), no TUI tests |

---

## 1. Web removal → new structure

### Files/directories deleted
- `src/web/` entirely (server.ts, React client, `assets.generated.ts`, `index.css`, components, hooks, lib)
- `scripts/embed-assets.ts`
- `vite.config.ts`
- `tailwind.config.js`
- `postcss.config.js`
- `tsconfig.web.json`

### Dependencies removed
`vite`, `@vitejs/plugin-react`, `tailwindcss`, `autoprefixer`, `postcss`,
`react-dom`, `@types/react-dom` (Ink uses its own renderer, not react-dom).

`react` is kept (required by Ink).

### Final structure
```
src/
├── aws/        # sso.ts, aws.ts, utils.ts  (logic, runtime-agnostic)
├── cli/        # index.tsx, components/, hooks/
└── version.ts
```

### Associated cleanup
- Remove `webServer` and `webPort` from `AppSettings` and `DEFAULT_SETTINGS` (`sso.ts`)
- Remove the `settings-webport` view and its view-state in `cli/index.tsx`
- Remove the `w` (web server) toggle in the ActionBar / Header / `useInput`
- Remove the import and the `startServer`/`stopServer`/`isServerRunning` calls in `cli/index.tsx`

---

## 2. Runtime-agnostic code (Node + Bun)

The ~9 Bun-specific calls in `src/aws/sso.ts` are replaced with standard Node APIs
so that `npx ssomatic` (which runs under Node) works:

| Bun (current) | Node replacement |
|---------------|------------------|
| `Bun.file(p).text()` | `await readFile(p, "utf8")` (`node:fs/promises`) |
| `Bun.file(p).json()` | `JSON.parse(await readFile(p, "utf8"))` |
| `Bun.write(p, data)` | `await writeFile(p, data)` (`node:fs/promises`) |
| `Bun.spawn([cmd, ...])` | `spawn(cmd, [...])` (`node:child_process`) |

Known locations in `sso.ts`: lines ~108, 124, 129, 137, 156, 293
(credentials / settings / token-cache files) and ~375, 422, 428
(`openBrowser`, `notify-send` / notifications).

The result runs under **Node ≥ 18 and Bun**. `src/aws/utils.ts` already uses
`node:child_process` (clipboard). No dependency added.

---

## 3. npm distribution

### `package.json`
- `"private": true` → **removed**
- Added:
  - `"bin": { "ssomatic": "dist/cli.js" }`
  - `"files": ["dist"]`
  - `"engines": { "node": ">=18" }`
- Build output carries the `#!/usr/bin/env node` shebang

### Build
Replace the old pipeline (`vite build && embed-assets && bun build --compile`) with:
```
bun build src/cli/index.tsx --target node --outfile dist/cli.js
```
- Runtime dependencies stay **external** (not bundled) and declared in `dependencies` →
  npm/bun installs them on the user's machine.
- No standalone binary compilation, no Vite, no asset embedding.
- The `#!/usr/bin/env node` shebang must be present at the top of `dist/cli.js`
  (preserved from source or added by a minimal post-build step).

### `package.json` scripts (target)
```jsonc
{
  "start": "bun run src/cli/index.tsx",
  "dev":   "bun run --watch src/cli/index.tsx",
  "build": "bun build src/cli/index.tsx --target node --outfile dist/cli.js",
  "lint":  "eslint src",
  "test":  "bun test",
  "prepare": "husky"
}
```
(`prestart` removed — it only existed to generate `assets.generated.ts`.)

### Release (semantic-release)
- Configuration kept.
- **Enable `@semantic-release/npm`** (already in devDependencies) to publish to npm
  automatically on each release.
- Stop attaching binaries to GitHub releases (no binaries produced anymore).
- Prerequisite: `NPM_TOKEN` secret in the GitHub repo settings (in addition to the
  existing `RELEASE_TOKEN` for GitHub Releases).

### Final usage
```bash
npx ssomatic          # zero install
bunx ssomatic
npm i -g ssomatic     # global install
```

---

## 4. Tests (`bun test`)

Unit tests focused on the pure logic, no TUI:

- **`sso.ts`**
  - AWS config-file parsing (ini) → `discoverProfiles`
  - Token-cache read/write (round-trip via temp file)
  - `valid` / `expired` status computation based on expiry date
  - Favorites sorting (`sortByFavorites`)
  - `formatExpiry`
- **`utils.ts`**
  - `formatJson` (valid / invalid JSON)

Details:
- File fixtures via `os.tmpdir()` to isolate the filesystem.
- Run by `bun test`, wired into CI.
- Optional: coverage badge.

---

## 5. Modernization / "public pro repo" polish

- **README**: remove the Web UI section and web GIF, recenter on the CLI,
  surface `npx` install at the top, add `npm version` + `npm downloads` badges.
- **CI** (`.github/workflows/ci.yml`): simplified → `lint` + `test` + `build`
  (no more web build).
- **`package.json`**: `description` and `keywords` recentered on CLI / AWS SSO.
- **`CLAUDE.md`**: update structure and commands to reflect the new architecture
  (no web section, no `web` scope).

---

## Out of scope (YAGNI)

- Direct / scriptable subcommand mode (rejected: TUI only).
- Standalone GitHub binaries (replaced by npm).
- Ink TUI tests (fragile).
- Any rework of the `aws/` ↔ `cli/` architecture (already clean).

## Risks / watch points

- **Node shebang**: verify `dist/cli.js` starts under plain Node (not only Bun)
  after the runtime refactor — this is the primary success criterion.
- **`NPM_TOKEN`**: must be configured before the first npm release.
- **commitlint `scope`**: the `web` scope becomes useless; remove it from the
  allowed-scopes config.

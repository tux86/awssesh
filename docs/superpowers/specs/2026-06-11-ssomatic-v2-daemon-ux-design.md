# SSOmatic 2.0 — Background Daemon + List-First UX

**Date:** 2026-06-11
**Branch:** `feat/v2-daemon-ux`
**Status:** Approved design, ready for implementation planning

## Summary

A full overhaul of SSOmatic, the interactive AWS SSO credential manager. Three goals:

1. **A real background daemon** with a single shared state per host. Run it in the
   background, return to the terminal, and re-launching from any terminal attaches to
   the live state.
2. **A list-first ("k9s-style") TUI** where the profile list is the home screen and
   actions are single keypresses — faster than today's menu-drilling.
3. **An npm-facing README rewrite**, latest library versions, and a code refactor of
   today's monolithic 902-line `index.tsx`.

## Background / current state

Today's "Auto-refresh daemon" is **not** a daemon: it is a `setInterval` inside the Ink
TUI (`DaemonView` in `src/cli/index.tsx`). It dies when the TUI quits. There is no
separate process, no PID file, no IPC, no shared state. The background pattern described
here is net-new architecture.

AWS SSO has two token layers, which drives the daemon design:

- **Role credentials** (`~/.aws/credentials`) — can be re-derived silently by the daemon
  *as long as the SSO token is still valid*. No human needed.
- **SSO token** (`~/.aws/sso/cache/{hash}.json`) — when it expires (typically ~8h),
  refreshing **requires** an interactive browser device-authorization flow. A headless
  background process cannot do this alone.

So the daemon's job is: refresh role credentials silently while it can, and **notify the
user when a human login is required** — never open a browser unprompted.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Daemon ↔ TUI communication | Detached daemon process + **Unix socket**, TUI live-attaches and gets pushed updates |
| On SSO-token expiry (login needed) | **Notify + wait for human**; daemon never opens a browser |
| Bare `ssomatic`, no daemon running | Opens TUI in foreground; **daemon is opt-in** (`b` / `--daemon`) |
| CLI surface | **Full subcommand set** (`status`, `refresh`, `export`, `daemon …`) + default TUI |
| Home-screen model | **List-first dashboard** (k9s-style), no top-level menu |
| Refresh timing | **Expiry-aware** (set & forget); no interval picker |
| Daemon-managed set | **Favorites = managed.** Starring a profile sorts it to top *and* keeps it fresh |
| Per-profile actions | Copy export block, Open AWS console, Details view (Enter), Copy profile name |

## Architecture

Refactor today's monolith into three layers:

```
src/
├── core/                 # UI-agnostic AWS logic (today's src/aws, lightly refactored)
│   ├── sso.ts            # profile discovery, token cache, silent refresh, device-auth flow
│   ├── aws.ts            # STS identity
│   ├── settings.ts       # split out of sso.ts (favorites, notifications, lead-time, auto-start)
│   └── utils.ts          # clipboard, json, console-url builder
├── daemon/
│   ├── scheduler.ts      # expiry-aware refresh loop
│   ├── server.ts         # Unix-socket server, state broadcast
│   ├── protocol.ts       # shared message types (client ⇄ daemon)
│   └── lifecycle.ts      # spawn/detach, pid+sock files, single-instance guard
└── cli/
    ├── index.tsx         # entry: parse args → subcommand OR launch TUI
    ├── commands/         # status / refresh / export / daemon (non-interactive)
    └── tui/
        ├── Dashboard.tsx # list-first home screen
        ├── Details.tsx   # Enter drill-in
        ├── Settings.tsx
        ├── useDaemon.ts  # socket client + live state hook
        └── components/   # reuse existing List, Card, Spinner, StatusMessage, etc.
```

Existing reusable components (`List`, `MultiSelectList`, `Card`, `Divider`, `Header`,
`Spinner`, `StatusMessage`, `CopyFeedback`, `IdentityCard`) and hooks (`useCopy`,
`useIdentity`) are kept and reused where they fit.

## Daemon & IPC

### Single instance per host

- On start, the daemon binds a Unix socket. If the socket already has a **live**
  listener → refuse to start ("daemon already running, pid N"). If the socket file is
  **stale** (no listener) → remove and reclaim it.
- A PID file accompanies the socket for `daemon status` reporting.
- **File locations:** socket + PID in a runtime dir (`$XDG_RUNTIME_DIR` if set, else
  `os.tmpdir()`); daemon log in `~/.aws/ssomatic/daemon.log`. Settings stay at
  `~/.aws/credentials-manager.json` (existing path, backward compatible).

### Socket protocol (newline-delimited JSON)

Client → daemon:

- `{ type: "subscribe" }` — stream state updates until disconnect
- `{ type: "snapshot" }` — one-shot current state, then close (used by `ssomatic status`)
- `{ type: "refresh", profile?: string }` — force a refresh now
- `{ type: "setFavorite", profile: string, value: boolean }`
- `{ type: "stop" }` — graceful daemon shutdown

Daemon → client:

- `{ type: "state", profiles: ProfileState[], daemon: { pid, startedAt } }` — pushed on
  every state change and immediately on `subscribe`.

The **socket is the single source of truth for live state** — there is no separate state
file that could drift.

### Scheduler (expiry-aware)

- For each ⭐ favorite, refresh its role credentials a configurable **lead-time** before
  expiry (default 5 minutes).
- While the SSO token is valid, this refresh is silent (re-derive role creds, write
  `~/.aws/credentials`, broadcast new state).
- When a profile's SSO token has expired, mark it `needs-login`, send a desktop
  notification (if enabled), and broadcast state. **The daemon does not open a browser.**

### Login is always client-driven

The interactive device-auth flow (open browser + poll for token) runs only in an
interactive context — the TUI or `ssomatic refresh`. Once the new SSO token is written to
the cache, the daemon detects it on its next tick and resumes silent refresh. The daemon
itself never performs device authorization.

## CLI surface

| Command | Behavior |
|---------|----------|
| `ssomatic` | List-first TUI (foreground). If a daemon is running, **attach** and show live state. If not, run standalone; `b` starts a daemon on demand. |
| `ssomatic status` | Connect, request one snapshot, print a plain-text table, exit. Falls back to a direct read if no daemon. |
| `ssomatic refresh [profile]` | Refresh silently if the SSO token is valid; otherwise run the device-auth flow inline in the terminal. No profile → all favorites. |
| `ssomatic export <profile>` | Print `export AWS_ACCESS_KEY_ID=… …` lines for `eval $(ssomatic export <profile>)`. |
| `ssomatic daemon start` | Spawn + detach the daemon, return to the shell. |
| `ssomatic daemon stop` | Send `stop` over the socket. |
| `ssomatic daemon status` | Report running/stopped, pid, watched profiles, next refresh. |
| `ssomatic --version` / `-v` | Print version (existing). |

Subcommand parsing is hand-rolled — no new dependency.

## TUI — list-first dashboard

The home screen is the profile list with live statuses sourced from the socket
(`useDaemon`). A header line shows daemon status (`● running` / `○ off`).

```
🔐 SSOmatic                      daemon ● running
──────────────────────────────────────────────────────────
  PROFILE     STATUS        EXPIRES   ACCOUNT
▸ ★ prod      ● valid       58m       1234…7890
  ★ dev       ● valid       12m       2345…8901
    staging   ⚠ needs-login  —        3456…9012
──────────────────────────────────────────────────────────
↑↓ move  space sel  ⏎ details  r refresh  b bg
f ★  c copy  y name  o console  / filter  s settings  q quit
```

### Keybindings

| Key | Action |
|-----|--------|
| `↑↓` / `j` `k` | Move cursor |
| `space` | Toggle multi-select |
| `a` | Select all / none |
| `⏎` | Details view (account ID, role ARN, region, exact expiry, SSO start URL) |
| `r` | Refresh selected (silent if possible, else device-auth) |
| `b` | Run in background (start daemon) |
| `f` | Toggle ⭐ favorite (= keep fresh + sort to top) |
| `c` | Copy export block to clipboard |
| `y` | Copy profile name |
| `o` | Open AWS console (federated sign-in) for the selected profile's role |
| `/` | Filter list |
| `s` | Settings |
| `Esc` | Back |
| `q` | Quit (detaches if attached to a daemon; daemon keeps running) |

### Settings (shrunk)

- Notifications on/off
- Refresh lead-time (minutes before expiry; default 5)
- Auto-start daemon on launch? (default **off**)

## Features dropped / changed

- ❌ **Interval picker** (15/30/60/120 min) — replaced by expiry-aware scheduling.
- ❌ **Separate "Check status" and "Auto-refresh" menu screens** — folded into the single
  dashboard.
- ✅ **Kept:** auto-discovery, multi-select refresh, desktop notifications (now for
  `needs-login`), favorites, persistent settings.
- ⚙️ **Settings shrinks** to the three items above.

## Libraries & README

- Bump to latest: `ink`, `ink-spinner`, `react`, `@aws-sdk/client-sso`,
  `@aws-sdk/client-sso-oidc`, `@aws-sdk/client-sts`, `ini`, and the eslint/TypeScript
  toolchain. Verify each major bump against its changelog during implementation.
- **README rewrite** for npm appeal: a one-liner hook at the top, the background-daemon
  story front and center, an updated feature list, the new keybinding table, the new
  subcommands, and a fresh demo GIF.

## Testing strategy

- **`core/`** — keep and extend existing unit tests (profile discovery, settings
  round-trip, token cache/status, `sortByFavorites`, `formatExpiry`). Add tests for the
  console-URL builder and the new `settings.ts` split.
- **`daemon/protocol.ts`** — unit-test message (de)serialization.
- **`daemon/lifecycle.ts`** — test single-instance detection (live vs. stale socket) and
  pid/sock file handling against a temp runtime dir.
- **`daemon/scheduler.ts`** — test the expiry-aware "should refresh now?" decision with
  injected clock + token states (valid → silent, expired → needs-login).
- **`daemon/server.ts`** — integration test: start server on a temp socket, connect a
  client, assert `snapshot`/`subscribe` responses and broadcast-on-change.
- TUI components remain manually verified (no component-test harness today); keep that
  scope unless trivially testable.

## Out of scope

- OS-managed service (launchd/systemd auto-start on boot) — not chosen; revisit later.
- Auto-opening the browser on SSO-token expiry — explicitly rejected.
- Windows-specific socket/IPC support beyond what Node/Bun provide cross-platform
  (best-effort; primary targets remain macOS and Linux).

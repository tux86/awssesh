# awssesh demo recording (VHS — https://github.com/charmbracelet/vhs)
#
# Regenerate with:  bun run demo   (builds, generates the fixture, records)
# or manually:      bun run build && bun scripts/demo/fixture.ts && vhs scripts/demo/demo.tape
#
# No custom theme or effects: VHS's default neutral dark terminal renders the
# app's own ANSI colors, so the GIF looks exactly like a real run.
#
# AWSSESH_DEMO=1 stubs the interactive SSO network calls (device-auth +
# silent refresh) with canned values, so the login screen and the ⟳ auto-refresh
# render offline from the mock ~/.aws sandbox. The displayed command is the real
# `npx awssesh` users run; a shell function shadows it to the local build.

Output docs/screenshots/cli-demo.gif

Set Shell "zsh"
Set FontSize 22
Set Width 1040
Set Height 760
Set Padding 20

# ── Off-camera setup: mock sandbox HOME, demo stubs, offline update check, and
#    shadow `npx` so the on-screen `npx awssesh` runs the freshly built binary.
Hide
Type "export HOME=$PWD/docs/demo/home AWSSESH_DEMO=1 NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:9"
Enter
Type "npx() { node $PWD/dist/cli.js; }"
Enter
Type "clear"
Enter
Show

# ── Launch the dashboard ─────────────────────────────────────────────────────
Type "npx awssesh"
Enter
Sleep 2.5s

# ── First: refresh a signed-out profile → SSO device login, copy the URL ─────
Down
Sleep 350ms
Down
Sleep 350ms
Down
Sleep 350ms
Down
Sleep 600ms
Type "r"
Sleep 2200ms
Type "c"
Sleep 2000ms
Escape
Sleep 900ms

# ── Back to a signed-in profile ──────────────────────────────────────────────
Up
Sleep 300ms
Up
Sleep 300ms
Up
Sleep 300ms
Up
Sleep 600ms

# ── Filter, then clear it (Esc keeps the query, so backspace it out) ──────────
Type "/"
Sleep 400ms
Type "prod"
Sleep 1300ms
Backspace 4
Sleep 400ms
Enter
Sleep 700ms

# ── Copy env export, then copy the profile name (status feedback) ────────────
Type "c"
Sleep 1600ms
Type "y"
Sleep 1400ms

# ── Open details, back out ───────────────────────────────────────────────────
Enter
Sleep 2200ms
Escape
Sleep 700ms

# ── Open settings, back out ──────────────────────────────────────────────────
Type "s"
Sleep 2000ms
Escape
Sleep 700ms

# ── Pin a profile: toggle ⟳ auto-refresh ─────────────────────────────────────
Down
Sleep 500ms
Type "a"
Sleep 1700ms

# ── Quit ─────────────────────────────────────────────────────────────────────
Type "q"
Sleep 600ms

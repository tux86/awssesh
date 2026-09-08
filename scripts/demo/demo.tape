# awssesh demo recording (VHS — https://github.com/charmbracelet/vhs)
#
# Regenerate with:  bun run demo   (builds, generates the fixture, records)
# or manually:      bun run build && bun scripts/demo/fixture.ts && vhs scripts/demo/demo.tape
#
# No custom theme or effects: VHS's default neutral dark terminal renders the
# app's own ANSI colors, so the GIF looks exactly like a real run.
#
# awssesh takes over the terminal on the alternate screen buffer, so the frame
# fills the window while it runs and the shell comes back untouched on `q` —
# the recording ends on that restored prompt.
#
# AWSSESH_DEMO=1 stubs the interactive SSO network calls (device auth, silent
# refresh, and the account/role listings behind `n`) with canned values, so the
# login screen, the ⟳ auto-refresh and the profile browser all render offline
# from the mock ~/.aws sandbox. The displayed command is the real `npx awssesh`
# users run; a shell function shadows it to the local build.

Output docs/screenshots/cli-demo.gif

Set Shell "zsh"
Set FontSize 22
Set Width 1280
Set Height 840
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

# ── Filter: apply it, show the "2/8 shown" indicator, then Esc clears it ─────
Type "/"
Sleep 400ms
Type "prod"
Sleep 1300ms
Enter
Sleep 1400ms
Escape
Sleep 700ms

# ── Copy env export, then copy the profile name (status feedback) ────────────
Type "c"
Sleep 1600ms
Type "y"
Sleep 1400ms

# ── Jump to the chained role at the end of the list: its details show the
#    profile it assumes through and the MFA device it is gated on ────────────
Type "G"
Sleep 800ms
Enter
Sleep 2600ms
Escape
Sleep 700ms

# ── Keyboard help overlay ────────────────────────────────────────────────────
Type "?"
Sleep 2400ms
Escape
Sleep 700ms

# ── Open settings, back out ──────────────────────────────────────────────────
Type "s"
Sleep 1800ms
Escape
Sleep 700ms

# ── Add a profile straight from the SSO portal: pick the portal, the account
#    and the role, rename it, and it is written to ~/.aws/config ─────────────
Type "n"
Sleep 1400ms
Enter
Sleep 1800ms
Enter
Sleep 1500ms
Enter
Sleep 1200ms
Backspace 40
Sleep 400ms
Type "acme-dev-admin"
Sleep 1400ms
Enter
Sleep 2400ms

# ── Pin a profile: toggle ⟳ auto-refresh ─────────────────────────────────────
Down
Sleep 500ms
Type "a"
Sleep 1700ms

# ── Quit: the terminal is handed back exactly as it was found ────────────────
Type "q"
Sleep 1200ms

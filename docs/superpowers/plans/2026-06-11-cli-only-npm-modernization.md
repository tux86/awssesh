# SSOmatic v2 — CLI-only, npm, KISS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SSOmatic into a professional, KISS, CLI-only tool distributed via npm — by removing the web layer, making the code runtime-agnostic (Node + Bun), adding unit tests, and modernizing packaging/CI/docs.

**Architecture:** Keep the existing `src/aws/` (UI-agnostic logic) ↔ `src/cli/` (Ink TUI) split. Delete `src/web/` and its toolchain. Replace Bun-only file/process APIs in `src/aws/sso.ts` with `node:fs/promises` + `node:child_process` so `npx ssomatic` runs under Node. Build a single `dist/cli.js` with `bun build --target node`, ship it as an npm `bin`, and publish via the existing semantic-release pipeline.

**Tech Stack:** Bun (dev runtime + test runner + bundler), TypeScript, React + Ink (TUI), AWS SDK v3, semantic-release.

**Spec:** `docs/superpowers/specs/2026-06-11-cli-only-npm-modernization-design.md`

---

## File Structure (after this plan)

```
src/
├── aws/
│   ├── sso.ts          # logic — Bun APIs replaced by node:fs/promises + node:child_process
│   ├── sso.test.ts     # NEW — unit tests for SSO logic
│   ├── aws.ts          # unchanged
│   ├── utils.ts        # unchanged (already node:child_process)
│   └── utils.test.ts   # NEW — unit tests for formatJson
├── cli/                # web toggle / web status removed from index.tsx
│   ├── index.tsx
│   ├── components/
│   └── hooks/
└── version.ts          # unchanged

Deleted: src/web/, scripts/embed-assets.ts, vite.config.ts,
         tailwind.config.js, postcss.config.js, tsconfig.web.json
```

---

## Task 1: Remove the web layer

**Files:**
- Delete: `src/web/` (whole dir), `scripts/embed-assets.ts`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `tsconfig.web.json`
- Modify: `package.json` (scripts + deps), `tsconfig.json`, `src/aws/sso.ts` (settings type), `src/cli/index.tsx` (remove all web references)

- [ ] **Step 1: Delete web files and configs**

```bash
git rm -r src/web
git rm scripts/embed-assets.ts vite.config.ts tailwind.config.js postcss.config.js tsconfig.web.json
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: Remove web-only dependencies**

```bash
bun remove react-dom @types/react-dom vite @vitejs/plugin-react tailwindcss autoprefixer postcss
```

Expected: `package.json` and `bun.lock` updated; `react` (used by Ink) remains.

- [ ] **Step 3: Update `package.json` scripts**

Replace the `"scripts"` block with (removes `prestart`, drops Vite/embed/compile build, fixes `dev`):

```jsonc
"scripts": {
  "start": "bun run src/cli/index.tsx",
  "dev": "bun run --watch src/cli/index.tsx",
  "build": "bun build src/cli/index.tsx --target node --outfile dist/cli.js",
  "lint": "eslint src",
  "prepare": "husky"
}
```

(`test` is added in Task 2; `bin`/`files`/`engines` in Task 4.)

- [ ] **Step 4: Clean `tsconfig.json`**

Remove the now-pointless web exclude. Change:

```json
  "include": ["src/**/*"],
  "exclude": ["src/web/client/**/*"]
```

to:

```json
  "include": ["src/**/*"]
```

- [ ] **Step 5: Remove `webServer`/`webPort` from settings in `src/aws/sso.ts`**

In the `AppSettings` interface, remove these two lines:

```ts
  webServer: boolean;
  webPort: number;
```

In `DEFAULT_SETTINGS`, remove these two lines:

```ts
  webServer: false,
  webPort: 9876,
```

- [ ] **Step 6: Remove the web-server import in `src/cli/index.tsx`**

Change:

```ts
import { startServer, stopServer, isServerRunning } from "../web/server.js";
import { VERSION, checkForUpdate } from "../version.js";
```

to:

```ts
import { VERSION, checkForUpdate } from "../version.js";
```

- [ ] **Step 7: Remove `settings-webport` from the `ViewState` union**

Change:

```ts
  | "settings-favorites"
  | "settings-webport";
```

to:

```ts
  | "settings-favorites";
```

- [ ] **Step 8: Remove the `webUrl` state**

Change:

```ts
  const [daemonInterval, setDaemonInterval] = useState(30);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
```

to:

```ts
  const [daemonInterval, setDaemonInterval] = useState(30);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
```

- [ ] **Step 9: Remove the auto-start web-server effect**

Delete this entire block:

```ts
  // Auto-start web server from saved settings
  useEffect(() => {
    if (settings.webServer && !isServerRunning()) {
      const url = startServer(settings.webPort);
      setWebUrl(url);
    }
    return () => { stopServer(); };
  }, [settings.webServer, settings.webPort]);

```

- [ ] **Step 10: Remove the `w` key handler in `useInput`**

Change:

```ts
    if ((input === "b" || key.escape) && view !== "menu" && view !== "daemon-running") {
      setView("menu");
    }
    if (input === "w") {
      if (isServerRunning()) {
        stopServer();
        setWebUrl(null);
        updateSettings({ webServer: false });
      } else {
        const url = startServer(settings.webPort);
        if (url) {
          setWebUrl(url);
          updateSettings({ webServer: true });
        }
      }
    }
  });
```

to:

```ts
    if ((input === "b" || key.escape) && view !== "menu" && view !== "daemon-running") {
      setView("menu");
    }
  });
```

- [ ] **Step 11: Remove the "Web server port" settings menu item**

Change:

```ts
    {
      id: "favorites",
      label: `Favorite profiles (${settings.favoriteProfiles.length})`,
      value: "favorites",
    },
    {
      id: "webport",
      label: `Web server port: ${settings.webPort}`,
      value: "webport",
    },
    { id: "back", label: "Back to main menu", value: "back" },
```

to:

```ts
    {
      id: "favorites",
      label: `Favorite profiles (${settings.favoriteProfiles.length})`,
      value: "favorites",
    },
    { id: "back", label: "Back to main menu", value: "back" },
```

- [ ] **Step 12: Remove the `portItems` array**

Delete this block:

```ts
  // Port items
  const portItems: ListItemData[] = [
    { id: "3000", label: "3000", value: 3000 },
    { id: "8080", label: "8080", value: 8080 },
    { id: "8888", label: "8888", value: 8888 },
    { id: "9876", label: "9876", hint: "default", value: 9876 },
  ];

```

- [ ] **Step 13: Remove the `webport` case and `handlePortSelect`**

In the settings-action switch, remove:

```ts
      case "webport":
        setView("settings-webport");
        break;
```

Then delete the whole `handlePortSelect` function:

```ts
  const handlePortSelect = async (item: ListItemData) => {
    const newPort = item.value as number;
    if (isServerRunning()) {
      stopServer();
      await updateSettings({ webPort: newPort });
      const url = startServer(newPort);
      setWebUrl(url ?? null);
    } else {
      await updateSettings({ webPort: newPort });
    }
    setView("settings");
  };

```

- [ ] **Step 14: Remove the `settings-webport` view render**

Delete this block from `renderView`:

```tsx
      case "settings-webport":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> Select web server port</Text>
            </Box>
            <List
              items={portItems}
              onSelect={handlePortSelect}
              maxVisible={5}
            />
          </>
        );

```

- [ ] **Step 15: Remove `webAction` and its references in `getActions`**

Change:

```ts
  const webAction = { keys: "w", label: webUrl ? "Stop Web" : "Start Web" };

  const getActions = () => {
    switch (view) {
      case "menu":
        return [ACTIONS.navigate, ACTIONS.select, webAction, ACTIONS.quit];
      case "status":
        return [ACTIONS.back, webAction, ACTIONS.quit];
      case "refresh-select":
      case "daemon-select":
      case "settings-favorites":
        return [
          { keys: "space", label: "Toggle" },
          { keys: "a", label: "All/None" },
          ACTIONS.select,
          ACTIONS.back,
          webAction,
        ];
      case "daemon-running":
        return [{ keys: "^C", label: "Stop" }, webAction, ACTIONS.quit];
      default:
        return [ACTIONS.navigate, ACTIONS.select, ACTIONS.back, webAction];
    }
  };
```

to:

```ts
  const getActions = () => {
    switch (view) {
      case "menu":
        return [ACTIONS.navigate, ACTIONS.select, ACTIONS.quit];
      case "status":
        return [ACTIONS.back, ACTIONS.quit];
      case "refresh-select":
      case "daemon-select":
      case "settings-favorites":
        return [
          { keys: "space", label: "Toggle" },
          { keys: "a", label: "All/None" },
          ACTIONS.select,
          ACTIONS.back,
        ];
      case "daemon-running":
        return [{ keys: "^C", label: "Stop" }, ACTIONS.quit];
      default:
        return [ACTIONS.navigate, ACTIONS.select, ACTIONS.back];
    }
  };
```

- [ ] **Step 16: Remove the web entry from `statusItems`**

Change:

```tsx
  const statusItems = [
    webUrl ? (
      <Text key="web">
        <Text color="green">●</Text>
        <Text dimColor> Web </Text>
        <Text color="cyan">{webUrl}</Text>
      </Text>
    ) : (
      <Text key="web" dimColor>○ Web off</Text>
    ),
    ...(updateAvailable ? [
      <Text key="update" color="yellow">
        ↑ v{updateAvailable} available
      </Text>
    ] : []),
  ];
```

to:

```tsx
  const statusItems = [
    ...(updateAvailable ? [
      <Text key="update" color="yellow">
        ↑ v{updateAvailable} available
      </Text>
    ] : []),
  ];
```

- [ ] **Step 17: Verify lint, typecheck, run, and build all pass**

Run: `bun run lint`
Expected: no errors (no unused `web*` symbols, no missing `../web/server.js`).

Run: `bunx tsc --noEmit`
Expected: no type errors.

Run: `bun run build`
Expected: produces `dist/cli.js` with no Vite/embed step.

Run: `echo q | bun run start` (or launch and press `q`)
Expected: TUI renders, no "Web" status line, no `w` action shown.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "refactor(cli): remove web UI layer and toolchain"
```

---

## Task 2: Add regression tests for core logic

These tests pin current behavior so the runtime refactor in Task 3 is safe. They override `$HOME` to a temp dir before importing `sso.ts` (paths are computed at module load), so they also exercise real filesystem reads/writes.

**Files:**
- Create: `src/aws/sso.test.ts`
- Create: `src/aws/utils.test.ts`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add the `test` script to `package.json`**

In `"scripts"`, add:

```jsonc
  "test": "bun test",
```

- [ ] **Step 2: Write `src/aws/utils.test.ts` (failing first)**

```ts
import { test, expect } from "bun:test";
import { formatJson } from "./utils.ts";

test("formatJson pretty-prints valid JSON", () => {
  expect(formatJson('{"a":1,"b":[2,3]}')).toBe(
    JSON.stringify({ a: 1, b: [2, 3] }, null, 2),
  );
});

test("formatJson returns input unchanged when not JSON", () => {
  expect(formatJson("not json")).toBe("not json");
});
```

- [ ] **Step 3: Write `src/aws/sso.test.ts`**

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TMP: string;
let sso: typeof import("./sso.ts");

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "ssomatic-test-"));
  process.env.HOME = TMP;
  process.env.USERPROFILE = TMP;
  sso = await import("./sso.ts");
  await mkdir(join(TMP, ".aws"), { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const DEV = {
  name: "dev",
  ssoStartUrl: "https://example.awsapps.com/start",
  ssoAccountId: "111111111111",
  ssoRoleName: "Developer",
  ssoRegion: "us-east-1",
};

test("discoverProfiles parses sso-session and inline profiles", async () => {
  await writeFile(
    join(TMP, ".aws", "config"),
    [
      "[sso-session my-sso]",
      "sso_start_url = https://example.awsapps.com/start",
      "sso_region = us-east-1",
      "",
      "[profile dev]",
      "sso_session = my-sso",
      "sso_account_id = 111111111111",
      "sso_role_name = Developer",
      "region = eu-west-1",
      "",
      "[profile legacy]",
      "sso_start_url = https://legacy.awsapps.com/start",
      "sso_region = us-west-2",
      "sso_account_id = 222222222222",
      "sso_role_name = Admin",
      "",
    ].join("\n"),
  );

  const profiles = await sso.discoverProfiles();
  expect(profiles).toHaveLength(2);

  const dev = profiles.find((p) => p.name === "dev")!;
  expect(dev.ssoStartUrl).toBe("https://example.awsapps.com/start");
  expect(dev.ssoAccountId).toBe("111111111111");
  expect(dev.ssoRegion).toBe("us-east-1");
  expect(dev.ssoSession).toBe("my-sso");

  const legacy = profiles.find((p) => p.name === "legacy")!;
  expect(legacy.ssoRoleName).toBe("Admin");
  expect(legacy.ssoRegion).toBe("us-west-2");
});

test("saveSettings / loadSettings round-trip", async () => {
  await sso.saveSettings({
    ...sso.DEFAULT_SETTINGS,
    notifications: false,
    defaultInterval: 60,
    favoriteProfiles: ["dev"],
  });
  const loaded = await sso.loadSettings();
  expect(loaded.notifications).toBe(false);
  expect(loaded.defaultInterval).toBe(60);
  expect(loaded.favoriteProfiles).toEqual(["dev"]);
});

test("token cache round-trip + valid status", async () => {
  const future = new Date(Date.now() + 3_600_000);
  await sso.saveSSOTokenToCache(DEV, { accessToken: "tok-123", expiresAt: future });

  const cached = await sso.findCachedToken(DEV);
  expect(cached?.accessToken).toBe("tok-123");

  const status = await sso.checkTokenStatus(DEV);
  expect(status.status).toBe("valid");
});

test("checkTokenStatus returns expired for a past token", async () => {
  const past = new Date(Date.now() - 1000);
  const old = { ...DEV, name: "old", ssoStartUrl: "https://old.awsapps.com/start" };
  await sso.saveSSOTokenToCache(old, { accessToken: "old-tok", expiresAt: past });

  const status = await sso.checkTokenStatus(old);
  expect(status.status).toBe("expired");
});

test("sortByFavorites puts favorites first, then alphabetical", () => {
  const items = [{ n: "charlie" }, { n: "alpha" }, { n: "bravo" }];
  const sorted = sso.sortByFavorites(items, ["bravo"], (i) => i.n);
  expect(sorted.map((i) => i.n)).toEqual(["bravo", "alpha", "charlie"]);
});

test("formatExpiry formats hours/minutes and handles expired/unknown", () => {
  expect(sso.formatExpiry(undefined)).toBe("Unknown");
  expect(sso.formatExpiry(new Date(Date.now() - 1000))).toBe("Expired");
  const inAlmostTwoHours = new Date(Date.now() + 2 * 3_600_000 - 60_000);
  expect(sso.formatExpiry(inAlmostTwoHours)).toMatch(/^1h \d+m$/);
});
```

- [ ] **Step 4: Run the tests**

Run: `bun test`
Expected: all tests PASS (current Bun-based `sso.ts` works; this is the baseline).

- [ ] **Step 5: Commit**

```bash
git add src/aws/sso.test.ts src/aws/utils.test.ts package.json
git commit -m "test(aws): add unit tests for SSO logic and formatJson"
```

---

## Task 3: Make `src/aws/sso.ts` runtime-agnostic (Node + Bun)

Replace Bun-only APIs with `node:` equivalents. Task 2's tests guard this change.

**Files:**
- Modify: `src/aws/sso.ts`

- [ ] **Step 1: Add Node imports at the top of `src/aws/sso.ts`**

After the `ini` import (line 13), add:

```ts
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
```

- [ ] **Step 2: Replace `Bun.file().text()` in `parseIniFile`**

Change:

```ts
    const content = await Bun.file(path).text();
    return parseIni(content);
```

to:

```ts
    const content = await readFile(path, "utf8");
    return parseIni(content);
```

- [ ] **Step 3: Replace `Bun.write` in `writeCredentials`**

Change:

```ts
  await Bun.write(CREDENTIALS_PATH, stringifyIni(existing));
```

to:

```ts
  await writeFile(CREDENTIALS_PATH, stringifyIni(existing));
```

- [ ] **Step 4: Replace `Bun.file().text()` in `loadSettings`**

Change:

```ts
    const content = await Bun.file(SETTINGS_PATH).text();
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
```

to:

```ts
    const content = await readFile(SETTINGS_PATH, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
```

- [ ] **Step 5: Replace `Bun.write` in `saveSettings`**

Change:

```ts
  await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2));
```

to:

```ts
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
```

- [ ] **Step 6: Replace the `crypto` dynamic import + `Bun.file().json()` in `findCachedToken`**

Change:

```ts
    const crypto = await import("crypto");
    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = crypto.createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;

    const content = await Bun.file(cacheFile).json();
```

to:

```ts
    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;

    const content = JSON.parse(await readFile(cacheFile, "utf8"));
```

- [ ] **Step 7: Replace the dynamic `fs/promises` + `crypto` imports and `Bun.write` in `saveSSOTokenToCache`**

Change:

```ts
    const { mkdir, chmod } = await import("fs/promises");
    await mkdir(SSO_CACHE_DIR, { recursive: true });

    const crypto = await import("crypto");
    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = crypto.createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;
```

to:

```ts
    await mkdir(SSO_CACHE_DIR, { recursive: true });

    const cacheKey = profile.ssoSession ?? profile.ssoStartUrl;
    const hash = createHash("sha1").update(cacheKey).digest("hex");
    const cacheFile = `${SSO_CACHE_DIR}/${hash}.json`;
```

And change:

```ts
    await Bun.write(cacheFile, JSON.stringify(cacheData, null, 2));
    await chmod(cacheFile, 0o600);
```

to:

```ts
    await writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
    await chmod(cacheFile, 0o600);
```

- [ ] **Step 8: Replace `Bun.spawn` in `openBrowser`**

Change:

```ts
export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
}
```

to:

```ts
export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore" }).on("error", () => {});
}
```

- [ ] **Step 9: Replace `Bun.spawn` in `sendNotification`**

Change:

```ts
    if (os === "darwin") {
      await Bun.spawn([
        "osascript",
        "-e",
        `display notification "${message}" with title "${title}"`,
      ]).exited;
    } else if (os === "linux") {
      await Bun.spawn(["notify-send", title, message]).exited;
    }
```

to:

```ts
    if (os === "darwin") {
      spawn("osascript", [
        "-e",
        `display notification "${message}" with title "${title}"`,
      ], { stdio: "ignore" }).on("error", () => {});
    } else if (os === "linux") {
      spawn("notify-send", [title, message], { stdio: "ignore" }).on("error", () => {});
    }
```

- [ ] **Step 10: Confirm no `Bun.` references remain in `src/aws/sso.ts`**

Run: `grep -n "Bun\." src/aws/sso.ts`
Expected: no output.

- [ ] **Step 11: Run tests, lint, typecheck**

Run: `bun test`
Expected: all tests from Task 2 still PASS.

Run: `bun run lint && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/aws/sso.ts
git commit -m "refactor(aws): replace Bun APIs with node:fs/promises and node:child_process"
```

---

## Task 4: npm packaging + Node smoke test

Make the package publishable and prove `dist/cli.js` runs under plain Node — the spec's primary success criterion.

**Files:**
- Modify: `package.json`, `src/cli/index.tsx` (shebang)

- [ ] **Step 1: Change the source shebang to Node**

In `src/cli/index.tsx`, change the first line:

```ts
#!/usr/bin/env bun
```

to:

```ts
#!/usr/bin/env node
```

(Bun ignores the shebang for `bun run`, so `bun run start`/`dev` still work; `bun build` preserves the entrypoint hashbang in the output.)

- [ ] **Step 2: Make `package.json` publishable**

Remove the line:

```json
  "private": true,
```

Add these top-level fields (place near `"license"`):

```json
  "type": "module",
  "bin": { "ssomatic": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
```

(`"type": "module"` already exists — keep a single copy. Add only `bin`, `files`, `engines` if `type` is present.)

- [ ] **Step 3: Build and verify the shebang**

Run: `bun run build`
Expected: `dist/cli.js` created.

Run: `head -1 dist/cli.js`
Expected: `#!/usr/bin/env node`

If the shebang is missing, add a post-build banner by changing the `build` script to:

```jsonc
  "build": "bun build src/cli/index.tsx --target node --outfile dist/cli.js --banner '#!/usr/bin/env node'",
```

and re-run `bun run build`, then re-check `head -1 dist/cli.js`.

- [ ] **Step 4: Smoke-test under plain Node**

Run: `node dist/cli.js --version`
Expected: prints `ssomatic v<version>` and exits 0 (proves the runtime refactor works without Bun).

- [ ] **Step 5: Smoke-test the bin link locally**

Run: `chmod +x dist/cli.js && ./dist/cli.js --version`
Expected: prints `ssomatic v<version>`.

- [ ] **Step 6: Commit**

```bash
git add package.json src/cli/index.tsx
git commit -m "build(cli): package as npm bin runnable under node"
```

---

## Task 5: CI, release, and commitlint updates

Switch distribution to npm: enable npm publish, drop binary/Homebrew jobs, simplify CI.

**Files:**
- Modify: `.releaserc.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `commitlint.config.js`

- [ ] **Step 1: Enable npm publish in `.releaserc.json`**

Change:

```json
    [
      "@semantic-release/npm",
      {
        "npmPublish": false
      }
    ],
```

to:

```json
    "@semantic-release/npm",
```

(Defaults to `npmPublish: true`. semantic-release uses `NPM_TOKEN` from the env.)

- [ ] **Step 2: Simplify CI build/verify in `.github/workflows/ci.yml`**

Replace the `Build` and `Verify output` steps:

```yaml
      - name: Build
        run: bun run build

      - name: Verify output
        run: |
          test -f dist/ssomatic
          ls -lh dist/ssomatic
```

with a test + build + Node-runnable check:

```yaml
      - name: Test
        run: bun test

      - name: Build
        run: bun run build

      - name: Verify output runs under Node
        run: |
          test -f dist/cli.js
          node dist/cli.js --version
```

- [ ] **Step 3: Reduce `release.yml` to the semantic-release job only**

In `.github/workflows/release.yml`, add `NPM_TOKEN` to the semantic-release step env. Change:

```yaml
      - name: Run semantic-release
        run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.RELEASE_TOKEN }}
          HUSKY: "0"
```

to:

```yaml
      - name: Run semantic-release
        run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.RELEASE_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          HUSKY: "0"
```

Then delete the entire `build:` job (the OS matrix that renames/uploads `ssomatic-*` binaries) and the entire `update-homebrew:` job. Also delete the now-unused `outputs:`/`Check if released` plumbing that only fed those jobs:

- Remove the `outputs:` block under the `release:` job.
- Remove the `- name: Check if released` step (the `id: version` step).

The file should end with the `Run semantic-release` step.

> **Note:** This drops the standalone GitHub binaries and the Homebrew tap (`tux86/homebrew-tap`). Distribution becomes npm-only, per the spec. If Homebrew support should continue, it would instead wrap the npm package — out of scope here; flagged for the maintainer.

- [ ] **Step 4: Remove the `web` scope from `commitlint.config.js`**

Change the `scope-enum` list:

```js
      [
        'cli',
        'web',
        'aws',
        'ci',
        'deps',
      ],
```

to:

```js
      [
        'cli',
        'aws',
        'ci',
        'deps',
      ],
```

- [ ] **Step 5: Validate workflow + config syntax**

Run: `bunx js-yaml .github/workflows/ci.yml > /dev/null && bunx js-yaml .github/workflows/release.yml > /dev/null && echo OK`
Expected: `OK` (valid YAML).

Run: `node -e "import('./commitlint.config.js').then(()=>console.log('OK'))"`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add .releaserc.json .github/workflows/ci.yml .github/workflows/release.yml commitlint.config.js
git commit -m "ci: publish to npm and drop binary/homebrew release jobs"
```

---

## Task 6: Documentation & metadata

**Files:**
- Modify: `package.json` (description/keywords), `README.md`, `CLAUDE.md`
- Delete: `docs/screenshots/web-demo.gif` (if present)

- [ ] **Step 1: Recenter `package.json` description/keywords**

Change `"description"` to:

```json
  "description": "Interactive AWS SSO credential manager for your terminal — auto-discover, refresh, and manage SSO credentials. Built with Bun, React, and Ink.",
```

Add a `"keywords"` field:

```json
  "keywords": ["aws", "sso", "cli", "tui", "credentials", "aws-sso", "ink", "bun"],
```

- [ ] **Step 2: Update `README.md` — install + remove web**

- Replace the intro line `Interactive AWS SSO credential manager with CLI and web UI.` with `Interactive AWS SSO credential manager for your terminal.`
- Replace the `## Demo` section: keep the CLI GIF block, delete the `### Web UI` heading and its `web-demo.gif` `<p>` block.
- Add an `## Install` section right after the badges:

```markdown
## Install

```bash
# Run without installing
npx ssomatic
bunx ssomatic

# Or install globally
npm install -g ssomatic
```
```

- Add an npm badge to the badge block:

```markdown
[![npm version](https://img.shields.io/npm/v/ssomatic)](https://www.npmjs.com/package/ssomatic)
[![npm downloads](https://img.shields.io/npm/dm/ssomatic)](https://www.npmjs.com/package/ssomatic)
```

- Remove any "press `w` to toggle web" mention and the `w` row from the keyboard-shortcuts table.

- [ ] **Step 3: Delete the web demo GIF**

```bash
git rm docs/screenshots/web-demo.gif 2>/dev/null || true
```

- [ ] **Step 4: Update `CLAUDE.md`**

- In **Project Overview**, change to: "Interactive AWS SSO credential manager — a terminal CLI built with Bun + React + Ink." Remove the "Press `w` to toggle a built-in web server" sentence.
- In **Structure**, delete the `src/web/` subtree and the `dist/ssomatic` line; show `dist/cli.js` and `src/aws/*.test.ts`.
- In **Tech Stack**, remove the Vite and Tailwind rows.
- In **Commands**, update `build` to "Build the Node CLI bundle (`dist/cli.js`)" and add `bun test`.
- In **Keyboard Shortcuts**, remove the `w` row.
- In **Conventional Commits**, remove `web` from the allowed scopes list.

- [ ] **Step 5: Verify everything still builds and tests pass**

Run: `bun run lint && bun test && bun run build && node dist/cli.js --version`
Expected: lint clean, tests pass, build succeeds, version prints.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: refocus README and CLAUDE.md on the CLI, add npm install"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 web removal → Task 1; §2 runtime-agnostic → Task 3; §3 npm distribution → Tasks 4 & 5; §4 tests → Task 2; §5 modernization → Tasks 5 & 6. All covered.
- **Discovered during planning (beyond the spec):** the existing `release.yml` also builds OS binaries and updates a Homebrew tap. npm-only distribution means dropping both (Task 5, Step 3) — flagged inline and in the handoff for maintainer sign-off.
- **Placeholder scan:** none — every code step shows full before/after content.
- **Type consistency:** test helpers reference real exports verified in source — `discoverProfiles`, `saveSettings`/`loadSettings`, `saveSSOTokenToCache`/`findCachedToken`/`checkTokenStatus`, `sortByFavorites`, `formatExpiry`, `DEFAULT_SETTINGS`, `formatJson`. `AppSettings` loses `webServer`/`webPort` consistently in type, defaults, and all `cli/index.tsx` usages.

## Risks / watch points

- **`bun build` shebang preservation:** Step 3 of Task 4 verifies it and gives a `--banner` fallback.
- **`NPM_TOKEN` secret:** must exist in the GitHub repo before the first npm release, or the release step fails.
- **Homebrew/binary consumers:** removed — confirm this is acceptable before merging (see handoff).

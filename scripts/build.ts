/**
 * Builds the npm bin, `dist/cli.js`.
 *
 * React, Ink and the rest of the TUI's dependencies are bundled with `NODE_ENV`
 * fixed to production, so only React's production build is in the bundle. Left
 * external, React chose its build at run time, and a plain `node` got the
 * development one: its reconciler records every render with
 * `performance.measure()`, Node keeps those entries until the process exits,
 * and the dashboard re-renders every second — a TUI left open for a day passed
 * 2 GB.
 *
 * The AWS SDK and `ini` stay external: they do not depend on `NODE_ENV`, and the
 * SDK is most of the weight.
 *
 * Run: bun scripts/build.ts   (`bun run build`)
 */

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTFILE = join(ROOT, "dist", "cli.js");
const EXTERNAL = ["@aws-sdk/*", "ini"];

rmSync(join(ROOT, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "src/cli/index.tsx")],
  outdir: join(ROOT, "dist"),
  naming: "cli.js",
  target: "node",
  external: EXTERNAL,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      // Ink loads its React DevTools bridge only when `DEV=true` and the user
      // has `react-devtools-core` installed. Bundled, that import would become a
      // top-level one, and every run would fail to resolve the package. Stub the
      // bridge out; awssesh does not use DevTools.
      name: "no-ink-devtools",
      setup(build) {
        build.onLoad({ filter: /[\\/]ink[\\/]build[\\/]devtools\.js$/ }, () => ({
          contents: "export {};",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Fail the build rather than ship either mistake: a development build brings
// the leak back, and an import outside EXTERNAL crashes at startup for anyone
// who does not happen to have that package. The first check reads the
// `// node_modules/...` path comments Bun writes above each bundled module.
const bundle = readFileSync(OUTFILE, "utf8");
const problems: string[] = [];
for (const [, file] of bundle.matchAll(/^\/\/ (node_modules\/\S+\.development\.js)$/gm)) {
  problems.push(`development build bundled: ${file}`);
}
const allowed = (name: string) =>
  name.startsWith("node:") ||
  EXTERNAL.some((ext) => (ext.endsWith("/*") ? name.startsWith(ext.slice(0, -1)) : name === ext));
for (const [, name] of bundle.matchAll(/^import\s[^;]*?from\s*"([^"]+)"/gm)) {
  if (!allowed(name)) problems.push(`unexpected external import: ${name}`);
}

if (problems.length > 0) {
  console.error(`dist/cli.js failed its checks:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

console.log(`dist/cli.js  ${(bundle.length / 1024).toFixed(0)} KB`);

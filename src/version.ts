/**
 * Version management — current version + update checking via GitHub API.
 */

// Read from package.json at build/runtime
import pkg from "../package.json";

export const VERSION = pkg.version;

const GITHUB_REPO = "tux86/awssesh";
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

let cachedLatest: string | null = null;
let lastCheck = 0;

export async function checkForUpdate(): Promise<string | null> {
  const now = Date.now();
  if (now - lastCheck < CHECK_INTERVAL && cachedLatest !== null) {
    return cachedLatest !== VERSION ? cachedLatest : null;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name: string };
    cachedLatest = data.tag_name.replace(/^v/, "");
    lastCheck = now;
    return cachedLatest !== VERSION ? cachedLatest : null;
  } catch {
    return null;
  }
}

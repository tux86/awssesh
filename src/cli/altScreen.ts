/**
 * The terminal's alternate screen buffer.
 *
 * The TUI takes over the whole terminal and hands it back untouched on exit —
 * the same thing `vim`, `htop` and `k9s` do. Beyond being what a dashboard is
 * expected to do, it fixes a real failure: rendering inline, a frame taller
 * than the terminal cannot erase the lines that have scrolled off, so a long
 * profile list redraws over its own remains.
 *
 * Leaving the buffer is registered on every exit path there is. A process that
 * dies without restoring it leaves the user staring at a blank screen with no
 * prompt, which is a far worse bug than anything it could have crashed over.
 */

const ENTER = "\u001B[?1049h";
const LEAVE = "\u001B[?1049l";

/** Escape hatch for terminals and multiplexers that handle 1049 badly. */
export function altScreenSupported(stream: NodeJS.WriteStream = process.stdout): boolean {
  return stream.isTTY === true && !process.env.AWSSESH_NO_ALT_SCREEN;
}

/**
 * Switch to the alternate buffer, returning the function that switches back.
 * A no-op — including its teardown — where the alternate buffer is not usable.
 */
export function enterAltScreen(stream: NodeJS.WriteStream = process.stdout): () => void {
  if (!altScreenSupported(stream)) return () => {};

  stream.write(ENTER);
  let left = false;

  const leave = () => {
    if (left) return;
    left = true;
    stream.write(LEAVE);
  };

  // `exit` covers a normal return and any process.exit(); the signals cover a
  // kill from outside. Ctrl-C never reaches here — stdin is in raw mode, so Ink
  // reads it as input and unmounts, and the caller's teardown runs.
  process.once("exit", leave);
  for (const signal of ["SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      leave();
      process.exit(signal === "SIGTERM" ? 143 : 129);
    });
  }
  process.once("uncaughtException", (error) => {
    // Restore first, so the crash is readable rather than written onto a screen
    // the user can no longer see.
    leave();
    console.error(error);
    process.exit(1);
  });

  return leave;
}

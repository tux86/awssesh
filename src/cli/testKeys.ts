/**
 * Key sequences exactly as a terminal sends them, for the component tests.
 *
 * Ink parses raw stdin, so a test that wants to press "down" has to write the
 * escape sequence a real terminal would — anything else exercises a code path
 * no user can reach.
 */
export const KEYS = {
  up: "\u001B[A",
  down: "\u001B[B",
  left: "\u001B[D",
  right: "\u001B[C",
  pageUp: "\u001B[5~",
  pageDown: "\u001B[6~",
  enter: "\r",
  escape: "\u001B",
  backspace: "\u0008",
  delete: "\u007F",
} as const;

/**
 * Let Ink process input and re-render.
 *
 * Ink's input handling and its render pass are both asynchronous, so an
 * assertion made immediately after `stdin.write` reads the previous frame.
 */
export const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until a frame contains `text`, or fail with what was on screen instead.
 *
 * Screens that load from disk settle after an unpredictable number of renders,
 * so a fixed `tick` is a race: it passes alone and fails under a full-suite
 * load. Polling asserts the same thing without betting on a duration.
 */
export async function waitForFrame(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = lastFrame() ?? "";
    if (frame.includes(text)) {
      // A frame exists as soon as the screen renders, but Ink subscribes its
      // input handlers in an effect that runs after. Returning immediately let
      // the caller's next keystroke land while nothing was listening yet.
      await tick();
      return frame;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(text)}. Last frame:\n${frame}`);
    }
    await tick(20);
  }
}

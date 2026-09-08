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

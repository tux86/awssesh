import { test, expect, afterEach } from "bun:test";
import { altScreenSupported, enterAltScreen } from "./altScreen";

const ENTER = "\u001B[?1049h";
const LEAVE = "\u001B[?1049l";

/** A stdout that records what was written to it. */
function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  const stream = { isTTY, write: (chunk: string) => writes.push(chunk) } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

afterEach(() => {
  delete process.env.AWSSESH_NO_ALT_SCREEN;
});

test("entering switches buffers, and the returned function switches back", () => {
  const { stream, writes } = fakeStream(true);

  const leave = enterAltScreen(stream);
  expect(writes).toEqual([ENTER]);

  leave();
  expect(writes).toEqual([ENTER, LEAVE]);
});

test("leaving twice writes the sequence once", () => {
  const { stream, writes } = fakeStream(true);

  const leave = enterAltScreen(stream);
  leave();
  leave();

  // Teardown is registered on several exit paths, so it will be called more
  // than once; a second switch-back would scroll the restored screen.
  expect(writes.filter((w) => w === LEAVE)).toHaveLength(1);
});

test("a piped stdout is left alone entirely", () => {
  const { stream, writes } = fakeStream(false);

  const leave = enterAltScreen(stream);
  leave();

  expect(writes).toEqual([]);
  expect(altScreenSupported(stream)).toBe(false);
});

test("the escape hatch turns it off on a real terminal", () => {
  process.env.AWSSESH_NO_ALT_SCREEN = "1";
  const { stream, writes } = fakeStream(true);

  expect(altScreenSupported(stream)).toBe(false);
  enterAltScreen(stream)();
  expect(writes).toEqual([]);
});

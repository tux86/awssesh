import { test, expect } from "bun:test";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { App } from "./App";
import { tick } from "../testKeys";

/** ink-testing-library reports no rows, so the hooks fall back to 80x24. */
const ROWS = 24;

test("the frame fills the terminal, one row short of scrolling it", async () => {
  const { lastFrame, unmount } = render(
    <App title="awssesh">
      <Text>body</Text>
    </App>,
  );
  await tick();

  // Exactly filling the terminal makes it scroll the top line away the moment
  // the frame is drawn, so the frame stops one row short.
  expect(lastFrame()!.split("\n")).toHaveLength(ROWS - 1);
  unmount();
});

test("the status line is reserved even when there is nothing to say", async () => {
  const empty = render(
    <App title="awssesh">
      <Text>body</Text>
    </App>,
  );
  await tick();
  const height = empty.lastFrame()!.split("\n").length;
  empty.unmount();

  const withMessage = render(
    <App title="awssesh" statusItems={[<Text key="m">Refreshed prod</Text>]}>
      <Text>body</Text>
    </App>,
  );
  await tick();

  // A message must not push the screen up by a row as it comes and goes.
  expect(withMessage.lastFrame()!.split("\n")).toHaveLength(height);
  expect(withMessage.lastFrame()).toContain("Refreshed prod");
  withMessage.unmount();
});

test("the body sits between the header and the footer divider", async () => {
  const { lastFrame, unmount } = render(
    <App title="awssesh">
      <Text>THE-BODY</Text>
    </App>,
  );
  await tick();

  const lines = lastFrame()!.split("\n");
  const body = lines.findIndex((l) => l.includes("THE-BODY"));
  const divider = lines.findIndex((l) => l.includes("─────"));

  expect(body).toBeGreaterThan(0);
  expect(divider).toBeGreaterThan(body);
  unmount();
});

test("a short terminal trades the wordmark for a single line", async () => {
  const { lastFrame, unmount } = render(
    <App title="awssesh">
      <Text>body</Text>
    </App>,
  );
  await tick();

  // 24 rows is below the wordmark's threshold: it would cost a fifth of them.
  expect(lastFrame()).toContain("awssesh");
  expect(lastFrame()).not.toContain("░█▀█");
  unmount();
});

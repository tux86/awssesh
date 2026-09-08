import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { SelectList, type SelectItem } from "./SelectList";
import { KEYS, tick } from "../testKeys";

const ACCOUNTS: SelectItem[] = [
  { value: "1", label: "Acme Development", hint: "111111111111" },
  { value: "2", label: "Acme Staging", hint: "222222222222" },
  { value: "3", label: "Acme Production", hint: "333333333333" },
];

function mount(items = ACCOUNTS, onCancel = () => {}) {
  const picked: string[] = [];
  const view = render(
    <SelectList title="Choose an account" items={items} onSelect={(v) => picked.push(v)} onCancel={onCancel} />,
  );
  return { ...view, picked };
}

test("every item is listed with its hint, and the first is selected", async () => {
  const { lastFrame, unmount } = mount();
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("Choose an account");
  for (const item of ACCOUNTS) {
    expect(frame).toContain(item.label);
    expect(frame).toContain(item.hint!);
  }
  // The cursor marks the first row and nothing else.
  expect(frame.split("\n").filter((line) => line.includes("▸"))).toHaveLength(1);
  expect(frame).toMatch(/▸ Acme Development/);
  unmount();
});

test("the arrow keys move the cursor and Enter picks what it is on", async () => {
  const { stdin, picked, unmount } = mount();
  await tick();

  stdin.write(KEYS.down);
  stdin.write(KEYS.down);
  await tick();
  stdin.write(KEYS.enter);
  await tick();

  expect(picked).toEqual(["3"]);
  unmount();
});

test("the cursor stops at both ends instead of wrapping", async () => {
  const { stdin, picked, unmount } = mount();
  await tick();

  stdin.write(KEYS.up); // already at the top
  await tick();
  stdin.write(KEYS.enter);
  await tick();
  expect(picked).toEqual(["1"]);

  for (let i = 0; i < 10; i++) stdin.write(KEYS.down);
  await tick();
  stdin.write(KEYS.enter);
  await tick();
  expect(picked).toEqual(["1", "3"]);
  unmount();
});

test("typing filters the list without a prefix key", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();

  stdin.write("stag");
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("Acme Staging");
  expect(frame).not.toContain("Acme Development");
  expect(frame).toContain("/stag");
  expect(frame).toContain("1/3");
  unmount();
});

test("the filter matches the hint too, so an account id finds its account", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();

  stdin.write("3333");
  await tick();

  expect(lastFrame()).toContain("Acme Production");
  expect(lastFrame()).not.toContain("Acme Staging");
  unmount();
});

test("Enter picks the match, not the row that was under the cursor before", async () => {
  const { stdin, picked, unmount } = mount();
  await tick();

  stdin.write("prod");
  await tick();
  stdin.write(KEYS.enter);
  await tick();

  expect(picked).toEqual(["3"]);
  unmount();
});

test("backspace widens the filter again", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();

  stdin.write("stagX");
  await tick();
  expect(lastFrame()).toContain("nothing matches");

  stdin.write(KEYS.backspace);
  await tick();
  expect(lastFrame()).toContain("Acme Staging");
  unmount();
});

test("Esc clears an active filter before it gives up on the screen", async () => {
  let cancelled = 0;
  const { stdin, lastFrame, unmount } = mount(ACCOUNTS, () => cancelled++);
  await tick();

  stdin.write("prod");
  await tick();
  stdin.write(KEYS.escape);
  await tick();

  // First Esc widens the search — losing the whole screen here would be a
  // surprise when the user only mistyped.
  expect(cancelled).toBe(0);
  expect(lastFrame()).toContain("Acme Development");

  stdin.write(KEYS.escape);
  await tick();
  expect(cancelled).toBe(1);
  unmount();
});

test("a filter that hides the selected row leaves the cursor on a real item", async () => {
  const { stdin, picked, unmount } = mount();
  await tick();

  stdin.write(KEYS.down);
  stdin.write(KEYS.down); // on "Acme Production"
  await tick();
  stdin.write("dev"); // which the filter then hides
  await tick();
  stdin.write(KEYS.enter);
  await tick();

  expect(picked).toEqual(["1"]);
  unmount();
});

test("an empty list says so and cannot be selected from", async () => {
  const picked: string[] = [];
  const { stdin, lastFrame, unmount } = render(
    <SelectList
      title="Choose an account"
      items={[]}
      onSelect={(v) => picked.push(v)}
      onCancel={() => {}}
      emptyLabel="no accounts here"
    />,
  );
  await tick();

  expect(lastFrame()).toContain("no accounts here");
  stdin.write(KEYS.enter);
  await tick();
  expect(picked).toEqual([]);
  unmount();
});

test("a list taller than the terminal scrolls and says how much is hidden", async () => {
  const many: SelectItem[] = Array.from({ length: 40 }, (_, i) => ({
    value: String(i),
    label: `account-${String(i).padStart(2, "0")}`,
  }));
  const { stdin, lastFrame, unmount } = mount(many);
  await tick();

  // The line that reports the count is also the one that reports what is
  // off-screen; the key hints below it contain arrows of their own.
  const info = () => lastFrame()!.split("\n").find((line) => line.includes("total"))!;

  expect(lastFrame()).toContain("account-00");
  expect(info()).toContain("↓");
  expect(info()).not.toContain("↑");

  for (let i = 0; i < 20; i++) stdin.write(KEYS.down);
  await tick();

  // The cursor stays on screen, with the rest accounted for above and below.
  expect(lastFrame()).toContain("▸ account-20");
  expect(info()).toContain("↑");
  expect(info()).toContain("↓");
  unmount();
});

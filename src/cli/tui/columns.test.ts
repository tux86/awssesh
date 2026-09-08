import { test, expect } from "bun:test";
import { layoutColumns, tableWidth, viewport, W_MARKER, W_STATUS } from "./columns";

test("a wide terminal shows every column and a roomy name", () => {
  const layout = layoutColumns(120);
  expect(layout).toMatchObject({ showType: true, showExpires: true, showAccount: true });
  expect(layout.name).toBeGreaterThanOrEqual(30);
});

test("columns are dropped least-important-first as the terminal narrows", () => {
  // TYPE goes first: it is the one column the details view repeats in full.
  expect(layoutColumns(80)).toMatchObject({ showType: true, showExpires: true, showAccount: true });
  expect(layoutColumns(62)).toMatchObject({ showType: false, showExpires: true, showAccount: true });
  expect(layoutColumns(48)).toMatchObject({ showExpires: true, showAccount: false });
  expect(layoutColumns(26)).toMatchObject({ showExpires: false, showAccount: false });
});

test("the rendered row never exceeds the width it was given", () => {
  for (let width = 24; width <= 200; width++) {
    expect(tableWidth(layoutColumns(width))).toBeLessThanOrEqual(
      Math.max(width, W_MARKER + W_STATUS + 10),
    );
  }
});

test("viewport shows everything when the list fits", () => {
  expect(viewport(5, 0, 10)).toEqual({ start: 0, end: 5, hiddenAbove: 0, hiddenBelow: 0 });
});

test("viewport scrolls to keep the cursor visible", () => {
  const mid = viewport(100, 50, 10);
  expect(mid.start).toBeLessThanOrEqual(50);
  expect(mid.end).toBeGreaterThan(50);
  expect(mid.hiddenAbove).toBeGreaterThan(0);
  expect(mid.hiddenBelow).toBeGreaterThan(0);
});

test("viewport clamps at both ends without overrunning the list", () => {
  expect(viewport(100, 0, 10)).toMatchObject({ start: 0, end: 10, hiddenAbove: 0 });
  expect(viewport(100, 99, 10)).toMatchObject({ start: 90, end: 100, hiddenBelow: 0 });
});

test("viewport handles an empty list", () => {
  expect(viewport(0, 0, 10)).toMatchObject({ start: 0, end: 0 });
});

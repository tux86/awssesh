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

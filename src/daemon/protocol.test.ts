import { test, expect } from "bun:test";
import { encode, decodeStream, type ClientMessage, type DaemonMessage } from "./protocol";

test("encode appends a newline and is JSON-parseable", () => {
  const msg: ClientMessage = { type: "subscribe" };
  const line = encode(msg);
  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line)).toEqual({ type: "subscribe" });
});

test("decodeStream yields complete messages and buffers partials", () => {
  const dec = decodeStream();
  const a = encode({ type: "snapshot" } as ClientMessage);
  const b = encode({ type: "refresh", profile: "prod" } as ClientMessage);
  const first = dec.push(a + b.slice(0, 5));
  expect(first).toEqual([{ type: "snapshot" }]);
  const second = dec.push(b.slice(5));
  expect(second).toEqual([{ type: "refresh", profile: "prod" }]);
});

test("daemon state message shape is preserved through encode/decode", () => {
  const dec = decodeStream<DaemonMessage>();
  const state: DaemonMessage = {
    type: "state",
    daemon: { pid: 123, startedAt: "2026-06-11T10:00:00.000Z" },
    profiles: [{ name: "prod", status: "valid", expiresAt: "2026-06-11T12:00:00.000Z", favorite: true }],
  };
  expect(dec.push(encode(state))).toEqual([state]);
});

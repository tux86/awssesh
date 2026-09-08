import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { DEFAULT_SETTINGS, LEAD_MINUTES_MAX, LEAD_MINUTES_MIN, type AppSettings } from "../../aws/settings";
import { Settings } from "./Settings";
import { KEYS, tick } from "../testKeys";

/**
 * Settings is controlled, so the harness has to hold the state the way the app
 * does — feeding the old value back would make every adjustment start from the
 * beginning again.
 */
function Harness({ initial, onChange }: { initial: AppSettings; onChange: (next: AppSettings) => void }) {
  const [settings, setSettings] = React.useState(initial);
  return (
    <Settings
      settings={settings}
      onChange={(next) => {
        setSettings(next);
        onChange(next);
      }}
      onBack={() => {}}
    />
  );
}

function mount(initial: AppSettings = { ...DEFAULT_SETTINGS, favoriteProfiles: ["dev"] }) {
  const changes: AppSettings[] = [];
  const view = render(<Harness initial={initial} onChange={(next) => changes.push(next)} />);
  return { ...view, changes, latest: () => changes[changes.length - 1] };
}

test("both settings are shown with their current values", async () => {
  const { lastFrame, unmount } = mount();
  await tick();

  const frame = lastFrame()!;
  expect(frame).toContain("Desktop notifications");
  expect(frame).toContain("on");
  expect(frame).toContain("Refresh lead");
  expect(frame).toContain("5 min");
  unmount();
});

test("space toggles notifications", async () => {
  const { stdin, latest, unmount } = mount();
  await tick();

  stdin.write(" ");
  await tick();

  expect(latest()?.notifications).toBe(false);
  unmount();
});

test("the arrows adjust the lead only on the field that has one", async () => {
  const { stdin, changes, latest, unmount } = mount();
  await tick();

  // On the notifications row, left/right must not silently edit something else.
  stdin.write(KEYS.right);
  await tick();
  expect(changes).toEqual([]);

  stdin.write(KEYS.down);
  await tick();
  stdin.write(KEYS.right);
  await tick();
  expect(latest()?.refreshLeadMinutes).toBe(6);

  stdin.write(KEYS.left);
  await tick();
  expect(latest()?.refreshLeadMinutes).toBe(5);
  unmount();
});

test("the lead cannot be pushed outside the range the scheduler can use", async () => {
  const low = mount({ ...DEFAULT_SETTINGS, refreshLeadMinutes: LEAD_MINUTES_MIN });
  await tick();
  low.stdin.write(KEYS.down);
  await tick();
  low.stdin.write(KEYS.left);
  await tick();
  // Below the floor there is nothing sensible to refresh into.
  expect(low.latest()?.refreshLeadMinutes).toBe(LEAD_MINUTES_MIN);
  low.unmount();

  const high = mount({ ...DEFAULT_SETTINGS, refreshLeadMinutes: LEAD_MINUTES_MAX });
  await tick();
  high.stdin.write(KEYS.down);
  await tick();
  high.stdin.write(KEYS.right);
  await tick();
  // Above the ceiling every profile would be permanently due.
  expect(high.latest()?.refreshLeadMinutes).toBe(LEAD_MINUTES_MAX);
  high.unmount();
});

test("the hint follows the selected field", async () => {
  const { stdin, lastFrame, unmount } = mount();
  await tick();
  expect(lastFrame()).toContain("notify when a profile needs");

  stdin.write("j");
  await tick();
  expect(lastFrame()).toContain("renew credentials this long before they expire");
  expect(lastFrame()).toContain(`range ${LEAD_MINUTES_MIN}–${LEAD_MINUTES_MAX} min`);
  unmount();
});

test("favorites are carried through a change, not dropped", async () => {
  const { stdin, latest, unmount } = mount();
  await tick();

  stdin.write(" ");
  await tick();

  expect(latest()?.favoriteProfiles).toEqual(["dev"]);
  unmount();
});

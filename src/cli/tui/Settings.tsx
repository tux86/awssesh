import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AppSettings } from "../../aws/settings.js";
import { Key } from "../components/KeyHint.js";

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
  onQuit: () => void;
}

export function Settings({ settings, onChange, onBack, onQuit }: Props) {
  const [cursor, setCursor] = useState(0);
  const items = ["notifications", "refreshLeadMinutes", "autoStartDaemon"] as const;
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (input === "q") {
      onQuit();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(items.length - 1, c + 1));
      return;
    }
    const field = items[cursor];
    if (field === "refreshLeadMinutes") {
      if (key.leftArrow)
        onChange({ ...settings, refreshLeadMinutes: Math.max(1, settings.refreshLeadMinutes - 1) });
      else if (key.rightArrow)
        onChange({ ...settings, refreshLeadMinutes: settings.refreshLeadMinutes + 1 });
    } else if (key.return || input === " ") {
      if (field === "notifications")
        onChange({ ...settings, notifications: !settings.notifications });
      else if (field === "autoStartDaemon")
        onChange({ ...settings, autoStartDaemon: !settings.autoStartDaemon });
    }
  });
  const line = (i: number, label: string, value: string) => (
    <Text color={cursor === i ? "cyan" : undefined}>
      {cursor === i ? "▸ " : "  "}
      {label.padEnd(22)}
      {value}
    </Text>
  );
  return (
    <Box flexDirection="column">
      <Text bold>⚙ Settings</Text>
      {line(0, "Notifications", settings.notifications ? "on" : "off")}
      {line(1, "Refresh lead (min)", String(settings.refreshLeadMinutes) + "  (←/→)")}
      {line(2, "Auto-start daemon", settings.autoStartDaemon ? "on" : "off")}
      <Box marginTop={1}>
        <Key k="↑↓">move</Key>
        <Key k="space/⏎">toggle</Key>
        <Key k="←→">adjust</Key>
        <Key k="Esc">back</Key>
        <Key k="q">quit</Key>
      </Box>
    </Box>
  );
}

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { clampLeadMinutes, LEAD_MINUTES_MAX, LEAD_MINUTES_MIN, type AppSettings } from "../../aws/settings.js";
import { Key, KeyBar } from "../components/KeyHint.js";
import { usePanelWidth } from "../components/App.js";

interface Props {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
}

const LABEL_WIDTH = 22;

interface Field {
  key: string;
  label: string;
  value: (s: AppSettings) => string;
  hint: string;
  toggle?: (s: AppSettings) => AppSettings;
  adjust?: (s: AppSettings, delta: number) => AppSettings;
}

const FIELDS: Field[] = [
  {
    key: "notifications",
    label: "Desktop notifications",
    value: (s) => (s.notifications ? "on" : "off"),
    hint: "notify when a profile needs an interactive SSO login",
    toggle: (s) => ({ ...s, notifications: !s.notifications }),
  },
  {
    key: "refreshLeadMinutes",
    label: "Refresh lead",
    value: (s) => `${s.refreshLeadMinutes} min`,
    hint: "renew credentials this long before they expire",
    adjust: (s, delta) => ({ ...s, refreshLeadMinutes: clampLeadMinutes(s.refreshLeadMinutes + delta) }),
  },
];

export function Settings({ settings, onChange, onBack }: Props) {
  const [cursor, setCursor] = useState(0);
  const width = usePanelWidth();
  const field = FIELDS[cursor]!;

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onBack();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(FIELDS.length - 1, c + 1));
      return;
    }
    if (field.adjust) {
      if (key.leftArrow || input === "h") onChange(field.adjust(settings, -1));
      else if (key.rightArrow || input === "l") onChange(field.adjust(settings, 1));
      return;
    }
    if (field.toggle && (key.return || input === " ")) onChange(field.toggle(settings));
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box borderStyle="round" borderColor="gray" paddingX={1} width={width} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Settings
          </Text>
        </Box>

        {FIELDS.map((f, i) => {
          const selected = i === cursor;
          return (
            <Box key={f.key}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "▸ " : "  "}</Text>
              <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text color={selected ? "cyan" : undefined}>{f.label}</Text>
              </Box>
              <Text bold color={selected ? "cyan" : undefined}>
                {f.value(settings)}
              </Text>
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text dimColor>{field.hint}</Text>
        </Box>
        {field.adjust && (
          <Text dimColor>{`range ${LEAD_MINUTES_MIN}–${LEAD_MINUTES_MAX} min`}</Text>
        )}
      </Box>

      <Box flexGrow={1} />

      <Box>
        <KeyBar>
          <Key k="↑↓">move</Key>
          {field.toggle ? <Key k="space">toggle</Key> : <Key k="←→">adjust</Key>}
          <Key k="Esc">back</Key>
        </KeyBar>
      </Box>
      <Text dimColor>changes are saved immediately</Text>
    </Box>
  );
}

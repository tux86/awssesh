import React from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState } from "../../daemon/protocol.js";
import { Key } from "../components/KeyHint.js";

interface Props {
  profile: ProfileState;
  arn?: string;
  region?: string;
  startUrl?: string;
  onBack: () => void;
  onQuit: () => void;
}

export function Details({ profile, arn, region, startUrl, onBack, onQuit }: Props) {
  useInput((input, key) => {
    if (key.escape || key.return) {
      onBack();
      return;
    }
    if (input === "q") {
      onQuit();
    }
  });
  const row = (label: string, value: string) => (
    <Text>
      <Text dimColor>{label.padEnd(10)}</Text>
      {value}
    </Text>
  );
  return (
    <Box flexDirection="column">
      <Text bold>⏎ {profile.name}</Text>
      {row("account", profile.accountId ?? "—")}
      {row("role", arn ?? "—")}
      {row("region", region ?? "—")}
      {row("status", profile.status)}
      {row("expires", profile.expiresAt ?? "—")}
      {row("sso url", startUrl ?? "—")}
      <Box marginTop={1}>
        <Key k="⏎">back</Key>
        <Key k="Esc">back</Key>
        <Key k="q">quit</Key>
      </Box>
    </Box>
  );
}

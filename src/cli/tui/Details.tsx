import React from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState } from "../../daemon/protocol.js";

interface Props {
  profile: ProfileState;
  arn?: string;
  region?: string;
  startUrl?: string;
  onBack: () => void;
}

export function Details({ profile, arn, region, startUrl, onBack }: Props) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
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
      <Text dimColor>esc back</Text>
    </Box>
  );
}

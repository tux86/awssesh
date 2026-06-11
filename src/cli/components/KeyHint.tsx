import React from "react";
import { Text } from "ink";

/**
 * A keyboard-shortcut hint: key char(s) in bold cyan followed by a dim label.
 * Trailing double-space acts as a separator between hints on the same row.
 */
export function Key({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Text>
      <Text bold color="cyan">{k}</Text>
      <Text dimColor> {children}  </Text>
    </Text>
  );
}

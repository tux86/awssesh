import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState, ProfileStatusKind } from "../../daemon/protocol.js";

interface Props {
  profiles: ProfileState[];
  daemonRunning: boolean;
  onRefresh: (names: string[]) => void;
  onToggleAuto: (name: string) => void;
  onRunBackground: () => void;
  onOpenDetails: (name: string) => void;
  onOpenConsole: (name: string) => void;
  onCopyExport: (name: string) => void;
  onCopyName: (name: string) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

// Column widths (chars). Total ≈ marker(2)+name(22)+status(15)+expires(10)+account(12).
const W_MARKER = 2;
const W_NAME = 22;
const W_STATUS = 15;
const W_EXPIRES = 10;
const W_ACCOUNT = 12;

/** Marker shown for auto-refreshed (favorite) profiles. */
const AUTO_MARKER = "⟳";

const STATUS_COLOR: Record<ProfileStatusKind, string> = {
  valid: "green",
  refreshing: "cyan",
  expired: "yellow",
  "needs-login": "yellow",
  error: "red",
};

const STATUS_LABEL: Record<ProfileStatusKind, string> = {
  valid: "● valid",
  refreshing: "● refreshing",
  expired: "○ expired",
  "needs-login": "⚠ needs-login",
  error: "✗ error",
};

function minsLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const m = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  return m <= 0 ? "expired" : `${m}m`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/** A single fixed-width cell. Highlighted rows render inverse; columns never drift. */
function Cell({
  text,
  width,
  color,
  dim,
  highlight,
}: {
  text: string;
  width: number;
  color?: string;
  dim?: boolean;
  highlight?: boolean;
}) {
  return (
    <Box width={width}>
      <Text color={color} dimColor={dim} inverse={highlight} wrap="truncate">
        {pad(text, width)}
      </Text>
    </Box>
  );
}

export function Dashboard(props: Props) {
  const { profiles } = props;
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);

  const visible = filter
    ? profiles.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : profiles;
  const cursorIndex = Math.min(cursor, Math.max(0, visible.length - 1));
  const current = visible[cursorIndex];

  useInput((input, key) => {
    if (filtering) {
      if (key.return || key.escape) setFiltering(false);
      else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (input) setFilter((f) => f + input);
      return;
    }
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j")
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    else if (input === "r") {
      if (current) props.onRefresh([current.name]);
    } else if (input === "a" && current) props.onToggleAuto(current.name);
    else if (input === "b") props.onRunBackground();
    else if (input === "c" && current) props.onCopyExport(current.name);
    else if (input === "y" && current) props.onCopyName(current.name);
    else if (input === "o" && current) props.onOpenConsole(current.name);
    else if (key.return && current) props.onOpenDetails(current.name);
    else if (input === "/") setFiltering(true);
    else if (input === "s") props.onOpenSettings();
    else if (input === "q") props.onQuit();
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        {/* top padding */}
        <Box height={1} />

        {/* column headers */}
        <Box>
          <Cell text="" width={W_MARKER} dim />
          <Cell text="PROFILE" width={W_NAME} dim />
          <Cell text="STATUS" width={W_STATUS} dim />
          <Cell text="EXPIRES" width={W_EXPIRES} dim />
          <Cell text="ACCOUNT" width={W_ACCOUNT} dim />
        </Box>

        {filtering && (
          <Box>
            <Text color="cyan">/{filter}</Text>
          </Box>
        )}

        {visible.length === 0 && (
          <Box>
            <Text dimColor>(no profiles)</Text>
          </Box>
        )}

        {visible.map((p, i) => {
          const hi = i === cursorIndex;
          const expires = minsLeft(p.expiresAt);
          const expiresColor = expires === "expired" ? "yellow" : undefined;
          return (
            <Box key={p.name}>
              <Cell text={p.favorite ? AUTO_MARKER : ""} width={W_MARKER} color="cyan" highlight={hi} />
              <Cell text={p.name} width={W_NAME} highlight={hi} />
              <Cell text={STATUS_LABEL[p.status]} width={W_STATUS} color={STATUS_COLOR[p.status]} highlight={hi} />
              <Cell text={expires} width={W_EXPIRES} color={expiresColor} highlight={hi} />
              <Cell text={p.accountId ?? "—"} width={W_ACCOUNT} highlight={hi} />
            </Box>
          );
        })}

        {/* bottom padding */}
        <Box height={1} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>↑↓ move  ⏎ details  r refresh  a auto-refresh  b background</Text>
        <Text dimColor>c copy  y name  o console  / filter  s settings  q quit</Text>
        <Text dimColor>{AUTO_MARKER} = auto-refreshed by the daemon</Text>
      </Box>
    </Box>
  );
}

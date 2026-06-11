import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState, ProfileStatusKind } from "../../daemon/protocol.js";

interface Props {
  profiles: ProfileState[];
  daemonRunning: boolean;
  onRefresh: (names: string[]) => void;
  onToggleFavorite: (name: string) => void;
  onRunBackground: () => void;
  onOpenDetails: (name: string) => void;
  onOpenConsole: (name: string) => void;
  onCopyExport: (name: string) => void;
  onCopyName: (name: string) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

const STATUS_COLOR: Record<ProfileStatusKind, string> = {
  valid: "green",
  refreshing: "cyan",
  expired: "yellow",
  "needs-login": "yellow",
  error: "red",
};

function minsLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const m = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  return m <= 0 ? "expired" : `${m}m`;
}

export function Dashboard(props: Props) {
  const { profiles } = props;
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);

  const visible = filter
    ? profiles.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : profiles;
  const current = visible[Math.min(cursor, Math.max(0, visible.length - 1))];

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
    else if (input === " " && current) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(current.name)) n.delete(current.name);
        else n.add(current.name);
        return n;
      });
    } else if (input === "a") {
      setSelected((s) =>
        s.size === visible.length ? new Set() : new Set(visible.map((p) => p.name)),
      );
    } else if (input === "r") {
      const names = selected.size ? [...selected] : current ? [current.name] : [];
      if (names.length) props.onRefresh(names);
    } else if (input === "f" && current) props.onToggleFavorite(current.name);
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
      <Box justifyContent="space-between">
        <Text bold>🔐 SSOmatic</Text>
        <Text>{props.daemonRunning ? "daemon ● running" : "daemon ○ off"}</Text>
      </Box>
      <Text dimColor>{"─".repeat(48)}</Text>
      {filtering && <Text>/{filter}</Text>}
      {visible.length === 0 && <Text dimColor>(no profiles)</Text>}
      {visible.map((p) => {
        const isCursor = current?.name === p.name;
        const isSel = selected.has(p.name);
        return (
          <Text key={p.name} color={isCursor ? "cyan" : undefined}>
            {isCursor ? "▸ " : "  "}
            {isSel ? "◉ " : "  "}
            {p.favorite ? "★ " : "  "}
            {p.name.padEnd(22)}
            <Text color={STATUS_COLOR[p.status]}>{p.status.padEnd(12)}</Text>
            {minsLeft(p.expiresAt).padEnd(8)}
            {p.accountId ?? ""}
          </Text>
        );
      })}
      <Text dimColor>{"─".repeat(48)}</Text>
      <Text dimColor>↑↓ move  space sel  ⏎ details  r refresh  b bg</Text>
      <Text dimColor>
        f ★  c copy  y name  o console  / filter  s settings  q quit
      </Text>
    </Box>
  );
}

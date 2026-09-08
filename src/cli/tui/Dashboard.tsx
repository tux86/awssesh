import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState, ProfileStatusKind } from "../../aws/profileState.js";
import { formatTimeLeft } from "../../aws/duration.js";
import { Key, KeyBar } from "../components/KeyHint.js";
import { useContentWidth } from "../components/App.js";
import { useNow } from "../hooks/useNow.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  layoutColumns,
  pad,
  tableWidth,
  viewport,
  W_ACCOUNT,
  W_EXPIRES,
  W_MARKER,
  W_STATUS,
} from "./columns.js";

interface Props {
  profiles: ProfileState[];
  onRefresh: (name: string) => void;
  onToggleAuto: (name: string) => void;
  onOpenDetails: (name: string) => void;
  onOpenConsole: (name: string) => void;
  onCopyExport: (name: string) => void;
  onCopyName: (name: string) => void;
  onAddProfile: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

/** Marker shown for auto-refreshed (favorite) profiles. */
const AUTO_MARKER = "⟳";

/** Statuses a human has to act on: a browser login, an MFA code, or a failure. */
const NEEDS_USER = new Set<ProfileStatusKind>(["needs-login", "needs-mfa", "error"]);

/** Vertical space the surrounding chrome needs; the rest is list rows. */
const CHROME_ROWS = 19;

const STATUS_COLOR: Record<ProfileStatusKind, string> = {
  valid: "green",
  refreshing: "cyan",
  expired: "yellow",
  "needs-login": "yellow",
  "needs-mfa": "yellow",
  error: "red",
};

const STATUS_LABEL: Record<ProfileStatusKind, string> = {
  valid: "● valid",
  refreshing: "◐ refreshing",
  expired: "○ expired",
  "needs-login": "⚠ needs-login",
  "needs-mfa": "⚠ needs-mfa",
  error: "✗ error",
};

/**
 * A single fixed-width cell, so columns never drift.
 *
 * The selected row paints one uniform band rather than inverting each cell:
 * `inverse` swaps in whatever foreground the cell already had, which turned a
 * single highlighted row into a cyan block, a white block and a green block
 * sitting side by side.
 */
function Cell({
  text,
  width,
  color,
  dim,
  bold,
  highlight,
}: {
  text: string;
  width: number;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <Box width={width} flexShrink={0}>
      <Text
        backgroundColor={highlight ? "cyan" : undefined}
        color={highlight ? "black" : color}
        dimColor={highlight ? false : dim}
        bold={bold}
        wrap="truncate"
      >
        {pad(text, width)}
      </Text>
    </Box>
  );
}

/**
 * The full legend needs roughly 54 columns per row; below that it is folded to
 * the essentials plus a pointer to `?`, instead of wrapping into an unreadable
 * run-together of half-hints.
 */
function Legend({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <Box marginTop={1}>
        <KeyBar>
          <Key k="↑↓">move</Key>
          <Key k="⏎">details</Key>
          <Key k="?">help</Key>
          <Key k="q">quit</Key>
        </KeyBar>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <KeyBar>
        <Key k="↑↓">move</Key>
        <Key k="⏎">details</Key>
        <Key k="r">refresh</Key>
        <Key k="a">{AUTO_MARKER} auto</Key>
        <Key k="?">help</Key>
      </KeyBar>
      <KeyBar>
        <Key k="c">copy env</Key>
        <Key k="y">name</Key>
        <Key k="o">console</Key>
        <Key k="n">new</Key>
        <Key k="/">filter</Key>
        <Key k="s">settings</Key>
        <Key k="q">quit</Key>
      </KeyBar>
    </Box>
  );
}

function Help({ width }: { width: number }) {
  const rows: [string, string][] = [
    ["↑ ↓ / k j", "move the cursor"],
    ["g / G", "jump to first / last profile"],
    ["⏎", "open profile details"],
    ["r", "refresh the selected profile now"],
    ["a", `toggle ${AUTO_MARKER} auto-refresh while awssesh is open`],
    ["c", "copy AWS_* export lines to the clipboard"],
    ["y", "copy the profile name"],
    ["o", "open the AWS console in a browser"],
    ["n", "add a profile from your SSO portal"],
    ["/", "filter profiles by name (Esc clears)"],
    ["s", "settings"],
    ["?", "close this help"],
    ["q", "quit"],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width}>
      <Text bold color="cyan">
        Keyboard shortcuts
      </Text>
      {rows.map(([keys, label]) => (
        <Text key={keys}>
          <Text bold color="cyan">
            {pad(keys, 11)}
          </Text>
          <Text dimColor>{label}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function Dashboard(props: Props) {
  const { profiles } = props;
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const contentWidth = useContentWidth();
  const { rows: terminalRows } = useTerminalSize();
  const now = useNow(1000);

  // Table sits inside a bordered, x-padded box; the frame then shrinks to hug
  // the columns rather than stretching empty space out to the terminal edge.
  const columns = layoutColumns(contentWidth - 4);
  const frameWidth = Math.min(contentWidth, tableWidth(columns) + 4);

  const visible = useMemo(() => {
    if (!filter) return profiles;
    const needle = filter.toLowerCase();
    return profiles.filter((p) => p.name.toLowerCase().includes(needle));
  }, [profiles, filter]);

  // Keep the cursor inside the list as filtering and refreshes change its length,
  // rather than letting a stale index linger and make the next keypress jump.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, visible.length - 1)));
  }, [visible.length]);

  const cursorIndex = Math.min(cursor, Math.max(0, visible.length - 1));
  const current = visible[cursorIndex];

  const capacity = Math.max(3, terminalRows - CHROME_ROWS);
  const window = viewport(visible.length, cursorIndex, capacity);
  const page = visible.slice(window.start, window.end);

  useInput((input, key) => {
    if (filtering) {
      if (key.return) setFiltering(false);
      else if (key.escape) {
        setFiltering(false);
        setFilter("");
      } else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFilter((f) => f + input);
      return;
    }

    if (showHelp) {
      // Any key dismisses help, so it can never trap the user.
      setShowHelp(false);
      if (input === "q") props.onQuit();
      return;
    }

    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(visible.length - 1, c + 1));
    else if (key.pageUp) setCursor((c) => Math.max(0, c - capacity));
    else if (key.pageDown) setCursor((c) => Math.min(visible.length - 1, c + capacity));
    else if (input === "g") setCursor(0);
    else if (input === "G") setCursor(Math.max(0, visible.length - 1));
    else if (key.escape) setFilter("");
    else if (input === "?") setShowHelp(true);
    else if (input === "/") setFiltering(true);
    else if (input === "n") props.onAddProfile();
    else if (input === "s") props.onOpenSettings();
    else if (input === "q") props.onQuit();
    else if (!current) return;
    else if (input === "r") props.onRefresh(current.name);
    else if (input === "a") props.onToggleAuto(current.name);
    else if (input === "c") props.onCopyExport(current.name);
    else if (input === "y") props.onCopyName(current.name);
    else if (input === "o") props.onOpenConsole(current.name);
    else if (key.return) props.onOpenDetails(current.name);
  });

  if (showHelp) {
    return (
      <Box flexDirection="column">
        <Help width={contentWidth} />
        <Box marginTop={1}>
          <KeyBar>
            <Key k="any key">back</Key>
          </KeyBar>
        </Box>
      </Box>
    );
  }

  const autoCount = profiles.filter((p) => p.favorite).length;
  const attentionCount = profiles.filter((p) => NEEDS_USER.has(p.status)).length;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1} width={frameWidth} flexDirection="column">
        {/* column headers */}
        <Box>
          <Cell text="" width={W_MARKER} dim />
          <Cell text="PROFILE" width={columns.name} dim bold />
          <Cell text="STATUS" width={W_STATUS} dim bold />
          {columns.showExpires && <Cell text="EXPIRES" width={W_EXPIRES} dim bold />}
          {columns.showAccount && <Cell text="ACCOUNT" width={W_ACCOUNT} dim bold />}
        </Box>

        {window.hiddenAbove > 0 && (
          <Text dimColor>{`  ↑ ${window.hiddenAbove} more`}</Text>
        )}

        {visible.length === 0 && (
          <Box marginY={1} flexDirection="column">
            <Text dimColor>{filter ? `no profile matches “${filter}”` : "(no profiles)"}</Text>
            {/* An empty ~/.aws/config used to be a dead end; the portal itself
                knows which accounts you have, so offer to ask it. */}
            {!filter && <Text dimColor>press n to add one from your SSO portal</Text>}
          </Box>
        )}

        {page.map((p, i) => {
          const hi = window.start + i === cursorIndex;
          const expires = formatTimeLeft(p.expiresAt, now);
          const expiresColor = expires === "expired" ? "yellow" : expires === "—" ? "gray" : undefined;
          return (
            <Box key={p.name}>
              <Cell text={p.favorite ? AUTO_MARKER : ""} width={W_MARKER} color="cyan" highlight={hi} />
              <Cell text={p.name} width={columns.name} highlight={hi} />
              <Cell
                text={STATUS_LABEL[p.status]}
                width={W_STATUS}
                color={STATUS_COLOR[p.status]}
                highlight={hi}
              />
              {columns.showExpires && (
                <Cell text={expires} width={W_EXPIRES} color={expiresColor} highlight={hi} />
              )}
              {columns.showAccount && (
                <Cell text={p.accountId ?? "—"} width={W_ACCOUNT} dim highlight={hi} />
              )}
            </Box>
          );
        })}

        {window.hiddenBelow > 0 && (
          <Text dimColor>{`  ↓ ${window.hiddenBelow} more`}</Text>
        )}
      </Box>

      {/* Filter state stays on screen after the prompt closes, so an active
          filter can never silently hide profiles. */}
      {(filtering || filter) && (
        <Box width={contentWidth}>
          <Text color="cyan" wrap="truncate">{`/${filter}`}</Text>
          <Text dimColor wrap="truncate">
            {filtering
              ? "▏  ⏎ apply · Esc clear"
              : `  — ${visible.length}/${profiles.length} shown · Esc clears`}
          </Text>
        </Box>
      )}

      <Box marginTop={1} width={contentWidth}>
        <Text dimColor wrap="truncate">
          {`${profiles.length} profile${profiles.length === 1 ? "" : "s"} · ${autoCount} ${AUTO_MARKER} auto`}
          {attentionCount > 0 ? ` · ${attentionCount} need attention` : ""}
        </Text>
      </Box>

      <Legend compact={contentWidth < 54} />
    </Box>
  );
}

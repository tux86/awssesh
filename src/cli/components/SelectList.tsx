import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { pad, viewport } from "../tui/columns.js";
import { useContentWidth } from "./App.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { Key, KeyBar } from "./KeyHint.js";

export interface SelectItem {
  /** Stable identity, returned to `onSelect`. */
  value: string;
  label: string;
  /** Secondary text, right-aligned in its own column (an account id, a region). */
  hint?: string;
}

interface Props {
  title: string;
  items: SelectItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  emptyLabel?: string;
  /** Rows of chrome above and below the list, used to size the viewport. */
  chromeRows?: number;
}

const HINT_WIDTH = 16;
const DEFAULT_CHROME_ROWS = 14;

/**
 * A filterable, scrolling picker.
 *
 * Typing filters straight away rather than behind a `/` prefix: every use of
 * this list is a "find the one you want out of dozens" moment, where the first
 * thing anyone does is type part of the name.
 */
export function SelectList({ title, items, onSelect, onCancel, emptyLabel, chromeRows }: Props) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const width = useContentWidth();
  const { rows } = useTerminalSize();

  const visible = useMemo(() => {
    if (!filter) return items;
    const needle = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) || (item.hint ?? "").toLowerCase().includes(needle),
    );
  }, [items, filter]);

  // Keep the cursor inside the list as the filter narrows it.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, visible.length - 1)));
  }, [visible.length]);

  const cursorIndex = Math.min(cursor, Math.max(0, visible.length - 1));
  const capacity = Math.max(3, rows - (chromeRows ?? DEFAULT_CHROME_ROWS));
  const window = viewport(visible.length, cursorIndex, capacity);

  useInput((input, key) => {
    if (key.escape) {
      // Esc clears a filter first, so it never throws away the whole screen
      // when the user only meant to widen the search.
      if (filter) setFilter("");
      else onCancel();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(visible.length - 1, c + 1));
    else if (key.pageUp) setCursor((c) => Math.max(0, c - capacity));
    else if (key.pageDown) setCursor((c) => Math.min(visible.length - 1, c + capacity));
    else if (key.return) {
      const item = visible[cursorIndex];
      if (item) onSelect(item.value);
    } else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setFilter((f) => f + input);
  });

  const labelWidth = Math.max(10, width - 4 - HINT_WIDTH);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} width={width} flexDirection="column">
        {window.hiddenAbove > 0 && <Text dimColor>{`  ↑ ${window.hiddenAbove} more`}</Text>}

        {visible.length === 0 && (
          <Text dimColor>{filter ? `nothing matches “${filter}”` : (emptyLabel ?? "(nothing to show)")}</Text>
        )}

        {visible.slice(window.start, window.end).map((item, i) => {
          const selected = window.start + i === cursorIndex;
          return (
            <Box key={item.value}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "▸ " : "  "}</Text>
              <Text color={selected ? "cyan" : undefined} wrap="truncate">
                {pad(item.label, labelWidth)}
              </Text>
              {item.hint && <Text dimColor wrap="truncate">{item.hint}</Text>}
            </Box>
          );
        })}

        {window.hiddenBelow > 0 && <Text dimColor>{`  ↓ ${window.hiddenBelow} more`}</Text>}
      </Box>

      <Box width={width}>
        <Text color="cyan" wrap="truncate">
          {filter ? `/${filter}` : ""}
        </Text>
        <Text dimColor wrap="truncate">
          {filter ? `  — ${visible.length}/${items.length}` : `${items.length} total`}
        </Text>
      </Box>

      <Box marginTop={1}>
        <KeyBar>
          <Key k="↑↓">move</Key>
          <Key k="⏎">select</Key>
          <Key k="type">filter</Key>
          <Key k="Esc">{filter ? "clear filter" : "back"}</Key>
        </KeyBar>
      </Box>
    </Box>
  );
}

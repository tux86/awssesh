import React from "react";
import { Box, Text, render as inkRender, useInput } from "ink";
import { ActionBar, ActionItem } from "./ActionBar.js";
import { Wordmark, WordmarkLine } from "./Wordmark.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

export interface AppProps {
  title?: string;
  icon?: string;
  color?: string;
  actions?: ActionItem[];
  /** Summary shown on the right of the header, e.g. the profile counts. */
  headerRight?: React.ReactNode;
  statusItems?: React.ReactNode[];
  /** Mount a global `q` → onQuit handler. Use ONLY on blocking screens that own no input. */
  captureQuit?: boolean;
  children: React.ReactNode;
  onQuit?: () => void;
}

/**
 * Layout bounds.
 *
 * The shell fills the terminal: awssesh runs on the alternate screen buffer, so
 * a frame narrower than the window would leave dead space around a dashboard
 * that owns the whole display anyway. Panels that are mostly prose keep a cap,
 * because a 200-column line of text is not readable.
 */
export const MIN_WIDTH = 46;
export const MAX_PANEL_WIDTH = 92;
const HORIZONTAL_PADDING = 1;

/** Rows the header takes: the wordmark where there is room, otherwise one line. */
const TALL_HEADER_ROWS = 5;
const SHORT_HEADER_ROWS = 2;
/** Rows below the body: a divider and the status line, which is always reserved. */
const FOOTER_ROWS = 2;
/** Below this many rows the wordmark costs more than it is worth. */
const WORDMARK_MIN_ROWS = 26;
/** Below this width the header summary crowds the wordmark off its own line. */
const HEADER_SUMMARY_MIN_WIDTH = 76;
/**
 * One row short of the terminal: filling it exactly makes the terminal scroll
 * the top line away the moment the frame is drawn.
 */
const FRAME_INSET = 1;
/** The frame's own vertical padding, top and bottom. */
const VERTICAL_PADDING = 2;

/** Width available to `App`'s children, i.e. inside its padding. */
export function useContentWidth(): number {
  const { columns } = useTerminalSize();
  return Math.max(MIN_WIDTH, columns - 1) - HORIZONTAL_PADDING * 2;
}

/** Width for a panel of fields or prose, capped for readability. */
export function usePanelWidth(): number {
  return Math.min(useContentWidth(), MAX_PANEL_WIDTH);
}

/** Whether there is room for the full wordmark. */
export function useTallHeader(): boolean {
  return useTerminalSize().rows >= WORDMARK_MIN_ROWS;
}

/** The height of the whole frame. */
export function useFrameHeight(): number {
  return Math.max(6, useTerminalSize().rows - FRAME_INSET);
}

/**
 * Rows a screen has to fill, between the header and the footer.
 *
 * Screens size their own lists from this rather than guessing at the chrome, so
 * a list is exactly as long as the space it has.
 */
export function useBodyHeight(): number {
  const { rows } = useTerminalSize();
  const frame = Math.max(6, rows - FRAME_INSET);
  const header = rows >= WORDMARK_MIN_ROWS ? TALL_HEADER_ROWS : SHORT_HEADER_ROWS;
  return Math.max(3, frame - header - FOOTER_ROWS - VERTICAL_PADDING);
}

function Divider({ width }: { width: number }) {
  return <Text dimColor>{"─".repeat(Math.max(0, width))}</Text>;
}

function Header({ right }: { right?: React.ReactNode }) {
  const tall = useTallHeader();
  const width = useContentWidth();
  const showSummary = width >= HEADER_SUMMARY_MIN_WIDTH;

  return (
    <Box width={width} marginBottom={1} justifyContent="space-between">
      {tall ? <Wordmark /> : <WordmarkLine />}
      {/* Bottom-aligned so the summary sits on the wordmark's baseline, and
          dropped entirely where it would push the wordmark onto its own line. */}
      {showSummary && <Box alignItems="flex-end">{right}</Box>}
    </Box>
  );
}

export function App({
  actions,
  headerRight,
  statusItems,
  captureQuit = false,
  children,
  onQuit,
}: AppProps) {
  const contentWidth = useContentWidth();
  const frameHeight = useFrameHeight();

  // Global quit handler for blocking screens (seeding / no-profiles) that
  // otherwise have no useInput of their own. Ctrl-C remains native.
  useInput(
    (input) => {
      if (input === "q") onQuit?.();
    },
    { isActive: captureQuit },
  );

  return (
    <Box
      flexDirection="column"
      paddingX={HORIZONTAL_PADDING}
      paddingY={1}
      width={contentWidth + HORIZONTAL_PADDING * 2}
      height={frameHeight}
    >
      <Header right={headerRight} />

      {/* The screen owns everything between the header and the footer, and is
          expected to fill it — its own key hints sit at the bottom of it. */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>

      {actions && actions.length > 0 && <ActionBar actions={actions} />}

      <Box flexDirection="column" width={contentWidth}>
        <Divider width={contentWidth} />
        {/* Always one row, so a message appearing never shifts the screen. */}
        <Box height={1} gap={2}>
          {statusItems?.map((item, i) => <React.Fragment key={i}>{item}</React.Fragment>)}
        </Box>
      </Box>
    </Box>
  );
}

// Render helper
export function renderApp(element: React.ReactElement) {
  return inkRender(element);
}

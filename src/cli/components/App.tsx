import React from "react";
import { Box, render as inkRender, useInput } from "ink";
import { ActionBar, ActionItem } from "./ActionBar.js";
import { Wordmark } from "./Wordmark.js";

export interface AppProps {
  title?: string;
  icon?: string;
  color?: string;
  actions?: ActionItem[];
  statusItems?: React.ReactNode[];
  /** Mount a global `q` → onQuit handler. Use ONLY on blocking screens that own no input. */
  captureQuit?: boolean;
  children: React.ReactNode;
  onQuit?: () => void;
}

/** Fixed content width so the layout looks tidy on wide terminals. */
const CONTENT_WIDTH = 68;

export function App({
  actions,
  statusItems,
  captureQuit = false,
  children,
  onQuit,
}: AppProps) {
  const hasStatusItems = !!statusItems && statusItems.length > 0;

  // Global quit handler for blocking screens (seeding / no-profiles) that
  // otherwise have no useInput of their own. Ctrl-C remains native.
  useInput(
    (input) => {
      if (input === "q") onQuit?.();
    },
    { isActive: captureQuit },
  );

  return (
    <Box flexDirection="column" padding={1} width={CONTENT_WIDTH}>
      {/* Header */}
      <Box marginBottom={1}>
        <Wordmark />
      </Box>

      {/* Content */}
      <Box flexDirection="column">{children}</Box>

      {/* Status bar */}
      {hasStatusItems && (
        <Box flexDirection="column" marginTop={1}>
          <Box
            borderStyle="single"
            borderTop
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
            borderColor="gray"
          />
          <Box gap={2}>
            {statusItems.map((item, i) => (
              <React.Fragment key={i}>{item}</React.Fragment>
            ))}
          </Box>
        </Box>
      )}

      {/* Action bar */}
      {actions && actions.length > 0 && (
        <Box flexDirection="column" marginTop={hasStatusItems ? 0 : 1}>
          <Box
            borderStyle="single"
            borderTop
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
            borderColor="gray"
          />
          <ActionBar actions={actions} />
        </Box>
      )}
    </Box>
  );
}

// Render helper
export function renderApp(element: React.ReactElement) {
  return inkRender(element);
}

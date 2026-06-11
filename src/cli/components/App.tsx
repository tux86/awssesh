import React from "react";
import { Box, Text, render as inkRender } from "ink";
import { ActionBar, ActionItem } from "./ActionBar.js";

export interface AppProps {
  title: string;
  icon?: string;
  color?: string;
  actions?: ActionItem[];
  statusItems?: React.ReactNode[];
  children: React.ReactNode;
  onQuit?: () => void;
}

export function App({
  title,
  icon = "▲",
  color = "cyan",
  actions,
  statusItems,
  children,
}: AppProps) {
  const hasStatusItems = !!statusItems && statusItems.length > 0;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={color} bold>
          {icon} {title}
        </Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column">
        {children}
      </Box>

      {/* Status bar */}
      {hasStatusItems && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
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
          <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
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

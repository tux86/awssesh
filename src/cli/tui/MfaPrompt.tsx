import React from "react";
import { Box, Text, useInput } from "ink";
import { Key, KeyBar } from "../components/KeyHint.js";
import { Spinner } from "../components/Spinner.js";
import { useContentWidth } from "../components/App.js";

interface Props {
  profileName: string;
  mfaSerial?: string;
  code: string;
  submitting: boolean;
  error?: string | null;
  onChange: (code: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** TOTP codes are six digits; anything else is a typo, not a code. */
const MAX_CODE_LENGTH = 6;

export function MfaPrompt({
  profileName,
  mfaSerial,
  code,
  submitting,
  error,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const width = useContentWidth();

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (submitting) return;
    if (key.return) {
      if (code.length > 0) onSubmit();
      return;
    }
    if (key.backspace || key.delete) return onChange(code.slice(0, -1));
    const digits = input.replace(/\D/g, "");
    if (digits) onChange((code + digits).slice(0, MAX_CODE_LENGTH));
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">⚠ MFA required</Text>
        <Text dimColor>{"  —  "}</Text>
        <Text bold>{profileName}</Text>
      </Box>

      <Box borderStyle="round" borderColor="yellow" paddingX={1} width={width} flexDirection="column">
        <Box>
          <Box width={7} flexShrink={0}>
            <Text dimColor>code</Text>
          </Box>
          <Text bold color="magenta">
            {code.padEnd(MAX_CODE_LENGTH, "·")}
          </Text>
        </Box>
        {mfaSerial && (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate">{mfaSerial}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          {submitting ? (
            <Spinner label="Assuming the role…" />
          ) : error ? (
            <Text color="red">{`✗ ${error}`}</Text>
          ) : (
            <Text dimColor>Enter the current code from your authenticator.</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <KeyBar>
          <Key k="⏎">submit</Key>
          <Key k="Esc">cancel</Key>
        </KeyBar>
      </Box>
    </Box>
  );
}

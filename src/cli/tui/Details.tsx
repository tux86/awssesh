import React from "react";
import { Box, Text, useInput } from "ink";
import type { ProfileState } from "../../aws/profileState.js";
import { profileRegion, profileRoleName, type Profile } from "../../aws/profiles.js";
import { formatClock, formatTimeLeft } from "../../aws/duration.js";
import { Key, KeyBar } from "../components/KeyHint.js";
import { Link } from "../components/Link.js";
import { usePanelWidth } from "../components/App.js";
import { useNow } from "../hooks/useNow.js";

interface Props {
  profile: ProfileState;
  /** The profile as configured, for the fields that only ~/.aws/config knows. */
  config?: Profile;
  onBack: () => void;
  onRefresh: (name: string) => void;
  onCopyExport: (name: string) => void;
  onCopyName: (name: string) => void;
  onOpenConsole: (name: string) => void;
  onToggleAuto: (name: string) => void;
}

const LABEL_WIDTH = 12;

const STATUS_COLOR: Record<ProfileState["status"], string> = {
  valid: "green",
  refreshing: "cyan",
  expired: "yellow",
  "needs-login": "yellow",
  "needs-mfa": "yellow",
  error: "red",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text>{children}</Text>
      </Box>
    </Box>
  );
}

export function Details({
  profile,
  config,
  onBack,
  onRefresh,
  onCopyExport,
  onCopyName,
  onOpenConsole,
  onToggleAuto,
}: Props) {
  const now = useNow(1000);
  const width = usePanelWidth();

  useInput((input, key) => {
    if (key.escape || key.leftArrow || input === "q") onBack();
    else if (input === "r") onRefresh(profile.name);
    else if (input === "c") onCopyExport(profile.name);
    else if (input === "y") onCopyName(profile.name);
    else if (input === "o") onOpenConsole(profile.name);
    else if (input === "a") onToggleAuto(profile.name);
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box borderStyle="round" borderColor="gray" paddingX={1} width={width} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {profile.name}
          </Text>
          <Text dimColor>{profile.kind === "assume" ? "  assume-role" : "  sso"}</Text>
          {profile.favorite && <Text color="cyan">{"  ⟳ auto-refresh"}</Text>}
        </Box>

        <Row label="status">
          <Text color={STATUS_COLOR[profile.status]}>{profile.status}</Text>
        </Row>
        <Row label="creds">
          {/* Was a raw ISO timestamp; now the answer people actually want first.
              Strictly the credentials' own clock: a profile that has never been
              refreshed says so instead of echoing the login's expiry. */}
          {profile.credentialsExpireAt ? (
            <Text>
              {formatTimeLeft(profile.credentialsExpireAt, now)}
              <Text dimColor>{`  (${formatClock(profile.credentialsExpireAt)})`}</Text>
            </Text>
          ) : (
            <Text dimColor>none yet</Text>
          )}
        </Row>
        <Row label="sso login">
          {/* Distinct from the row above: role credentials last about an hour,
              the SSO token many hours — this is when a browser login is due.
              A chain rooted in long-lived IAM keys never needs one at all. */}
          {profile.ssoExpiresAt ? (
            <Text>
              {formatTimeLeft(profile.ssoExpiresAt, now)}
              <Text dimColor>{`  (${formatClock(profile.ssoExpiresAt)})`}</Text>
            </Text>
          ) : profile.status === "needs-login" ? (
            <Text color="yellow">required</Text>
          ) : (
            <Text dimColor>—</Text>
          )}
        </Row>
        <Row label="account">{profile.accountId ?? <Text dimColor>—</Text>}</Row>
        <Row label="role">{(config && profileRoleName(config)) ?? <Text dimColor>—</Text>}</Row>
        <Row label="region">{(config && profileRegion(config)) ?? <Text dimColor>—</Text>}</Row>
        {config?.kind === "assume" ? (
          <>
            {/* Where the credentials that sign the AssumeRole call come from —
                the first thing to check when a chained profile misbehaves. */}
            <Row label="via">{config.sourceProfile}</Row>
            {config.mfaSerial && <Row label="mfa">{config.mfaSerial}</Row>}
          </>
        ) : (
          <Row label="sso url">
            {config?.kind === "sso" ? <Link url={config.ssoStartUrl} /> : <Text dimColor>—</Text>}
          </Row>
        )}
        {profile.error && (
          <Box marginTop={1}>
            <Text color="red">{`✗ ${profile.error}`}</Text>
          </Box>
        )}
      </Box>

      {/* Pushes the hints to the bottom of the screen, where they stay put. */}
      <Box flexGrow={1} />

      <Box>
        <KeyBar>
        <Key k="r">refresh</Key>
        <Key k="c">copy env</Key>
        <Key k="y">name</Key>
        <Key k="o">console</Key>
        <Key k="a">⟳ auto</Key>
        <Key k="Esc">back</Key>
        </KeyBar>
      </Box>
    </Box>
  );
}

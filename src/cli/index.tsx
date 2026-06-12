#!/usr/bin/env node
/**
 * awssesh - Interactive TUI for managing AWS SSO credentials
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { parseArgs } from "./args.js";
import { runStatus } from "./commands/status.js";
import { runExport } from "./commands/export.js";
import { runRefresh } from "./commands/refresh.js";
import { App, renderApp, Spinner, StatusMessage, ACTIONS, Key } from "./components/index.js";
import { useCopy } from "./hooks/index.js";
import { Dashboard } from "./tui/Dashboard.js";
import { Details } from "./tui/Details.js";
import { Settings } from "./tui/Settings.js";
import { useAutoRefresh } from "./tui/useAutoRefresh.js";
import {
  type SSOProfile,
  type DeviceAuthInfo,
  discoverProfiles,
  startDeviceAuthorization,
  performSSOLoginFlow,
  refreshProfile,
  readProfileCredentials,
  sendNotification,
  openBrowser,
} from "../aws/sso.js";
import { buildExportBlock, getConsoleSigninUrl } from "../aws/console.js";
import { copyToClipboard } from "../aws/utils.js";
import { loadSettings, saveSettings, type AppSettings } from "../aws/settings.js";
import { VERSION, checkForUpdate } from "../version.js";

type ViewState = "dashboard" | "details" | "settings";

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useDeviceAuth (handles interactive SSO device authorization flow)
// ─────────────────────────────────────────────────────────────────────────────

interface UseDeviceAuthOptions {
  pendingLogin: SSOProfile | null;
  onLoginComplete: (profile: SSOProfile, result: { success: boolean; error?: string }) => void;
  onCopyUrl?: () => void;
}

function useDeviceAuth({ pendingLogin, onLoginComplete, onCopyUrl }: UseDeviceAuthOptions) {
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthInfo | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [authError, setAuthError] = useState(false);
  const { copy, copied } = useCopy();
  const currentProfileRef = React.useRef<string | null>(null);

  // Reset and start new device authorization when profile changes
  useEffect(() => {
    const profileName = pendingLogin?.name ?? null;

    // If profile changed, reset state
    if (profileName !== currentProfileRef.current) {
      currentProfileRef.current = profileName;
      setDeviceAuth(null);
      setAuthorizing(false);
      setAuthError(false);

      // Start new device authorization if we have a profile
      if (pendingLogin) {
        startDeviceAuthorization(pendingLogin).then((info) => {
          if (info === null) {
            setAuthError(true);
          } else {
            setDeviceAuth(info);
          }
        });
      }
    }
  }, [pendingLogin]);

  // Start polling automatically when deviceAuth is ready
  useEffect(() => {
    if (!pendingLogin || !deviceAuth || authorizing) return;

    setAuthorizing(true);
    performSSOLoginFlow(pendingLogin, deviceAuth).then((result) => {
      onLoginComplete(pendingLogin, result);
    });
  }, [pendingLogin, deviceAuth, authorizing, onLoginComplete]);

  const handleEnter = useCallback(() => {
    if (!deviceAuth) return;
    openBrowser(deviceAuth.verificationUri);
  }, [deviceAuth]);

  const handleCopy = useCallback(() => {
    if (!deviceAuth) return;
    copy(deviceAuth.verificationUri);
    onCopyUrl?.();
  }, [deviceAuth, copy, onCopyUrl]);

  return {
    deviceAuth,
    authorizing,
    authError,
    copied,
    handleEnter,
    handleCopy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Prompt Component (shown while an interactive device-auth is pending)
// ─────────────────────────────────────────────────────────────────────────────

interface LoginPromptProps {
  profile: SSOProfile;
  deviceAuth: DeviceAuthInfo | null;
  authError?: boolean;
  copied?: boolean;
  authorizing?: boolean;
}

function LoginPrompt({ profile, deviceAuth, authError = false, copied = false, authorizing = false }: LoginPromptProps) {
  if (authError) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">SSO login required for {profile.name}</Text>
        <StatusMessage type="error">
          Failed to start device authorization. Check your network and SSO configuration.
        </StatusMessage>
        <Box marginTop={1}>
          <Key k="Esc">back</Key>
        </Box>
      </Box>
    );
  }

  if (!deviceAuth) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">SSO login required for {profile.name}</Text>
        <Spinner label="Initializing device authorization..." />
        <Box marginTop={1}>
          <Key k="Esc">cancel</Key>
        </Box>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="yellow">SSO login required for {profile.name}</Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>URL: </Text>
          <Text color="cyan">{deviceAuth.verificationUri}</Text>
          {copied && <Text color="green"> (copied!)</Text>}
        </Box>
        <Box>
          <Text dimColor>Code: </Text>
          <Text color="magenta" bold>
            {deviceAuth.userCode}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {authorizing && <Spinner label="Waiting for browser authorization..." />}
        <Box>
          <Key k="⏎">open browser</Key>
          <Key k="c">copy URL</Key>
          <Key k="Esc">cancel</Key>
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

function Awssesh() {
  const { exit } = useApp();

  const [view, setView] = useState<ViewState>("dashboard");
  const [detailName, setDetailName] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [ssoProfiles, setSSOProfiles] = useState<SSOProfile[]>([]);
  const [seeding, setSeeding] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingLogin, setPendingLogin] = useState<SSOProfile | null>(null);

  // Notify-once on auto-refresh login expiry, respecting the notifications setting.
  const settingsRef = React.useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const onNeedsLogin = useCallback((name: string) => {
    if (settingsRef.current.notifications) {
      void sendNotification("SSO Login Required", `Token expired for profile '${name}'`);
    }
  }, []);

  const { profiles, reload, refreshOne, setAuto } = useAutoRefresh(settings, onNeedsLogin);

  // Seed discovered SSO profiles on mount (the hook seeds the profile states).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const discovered = await discoverProfiles();
      if (cancelled) return;
      setSSOProfiles(discovered);
      setSeeding(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Check for updates.
  useEffect(() => {
    checkForUpdate().then(setUpdateAvailable);
  }, []);

  const findProfile = useCallback(
    (name: string): SSOProfile | undefined => ssoProfiles.find((p) => p.name === name),
    [ssoProfiles],
  );

  // The profiles displayed in the dashboard come from the in-process hook.
  const displayProfiles = profiles;

  // ── Interactive login ──────────────────────────────────────────────────────
  const handleLoginComplete = useCallback(
    (_profile: SSOProfile, _result: { success: boolean; error?: string }) => {
      setPendingLogin(null);
      void reload();
    },
    [reload],
  );

  const { deviceAuth, authorizing, authError, copied, handleEnter, handleCopy } = useDeviceAuth({
    pendingLogin,
    onLoginComplete: handleLoginComplete,
  });

  // Keyboard for the login prompt overlay (only active while a login is pending).
  useInput(
    (input, key) => {
      if (!pendingLogin) return;
      if (authError) {
        if (key.escape) setPendingLogin(null);
        return;
      }
      if (key.return) handleEnter();
      if (input === "c") handleCopy();
      if (key.escape) setPendingLogin(null);
    },
    { isActive: !!pendingLogin },
  );

  // ── Dashboard handlers ────────────────────────────────────────────────────
  const handleRefresh = useCallback(
    async (names: string[]) => {
      const name = names[0];
      if (!name) return;
      setFeedback(`Refreshing ${name}…`);
      const result = await refreshOne(name);
      if (result.needsLogin) {
        const profile = findProfile(name);
        if (profile) {
          setFeedback(`${name} needs login`);
          setPendingLogin(profile); // login completion will reload state
          return;
        }
        setFeedback(`${name} needs login`);
        return;
      }
      if (result.ok) setFeedback(`Refreshed ${name}`);
      else setFeedback(`${name}: ${result.error ?? "refresh failed"}`);
    },
    [refreshOne, findProfile],
  );

  const handleToggleAuto = useCallback(
    (name: string) => {
      const isFav = settings.favoriteProfiles.includes(name);
      const favoriteProfiles = isFav
        ? settings.favoriteProfiles.filter((n) => n !== name)
        : [...settings.favoriteProfiles, name];
      const next = { ...settings, favoriteProfiles };
      setSettings(next);
      setAuto(name, !isFav); // persists settings + reloads the ⟳ marker
      setFeedback(`⟳ ${isFav ? "off" : "on"} for ${name}`);
    },
    [settings, setAuto],
  );

  const handleCopyExport = useCallback(
    async (name: string) => {
      let creds = readProfileCredentials(name);
      if (!creds) {
        const profile = findProfile(name);
        if (profile) {
          const result = await refreshProfile(profile);
          if (result.success) creds = readProfileCredentials(name);
        }
      }
      if (!creds) {
        setFeedback(`No credentials for ${name}`);
        return;
      }
      const ok = await copyToClipboard(buildExportBlock(creds));
      setFeedback(ok ? `Copied export for ${name}` : `Copy failed for ${name}`);
    },
    [findProfile],
  );

  const handleCopyName = useCallback(async (name: string) => {
    const ok = await copyToClipboard(name);
    setFeedback(ok ? `Copied ${name}` : `Copy failed for ${name}`);
  }, []);

  const handleOpenConsole = useCallback(
    async (name: string) => {
      let creds = readProfileCredentials(name);
      if (!creds) {
        const profile = findProfile(name);
        if (profile) {
          const result = await refreshProfile(profile);
          if (result.success) creds = readProfileCredentials(name);
        }
      }
      if (!creds) {
        setFeedback(`No credentials for ${name}`);
        return;
      }
      try {
        const url = await getConsoleSigninUrl(creds);
        openBrowser(url);
        setFeedback(`Opening console for ${name}`);
      } catch {
        setFeedback(`Console sign-in failed for ${name}`);
      }
    },
    [findProfile],
  );

  const handleOpenDetails = useCallback((name: string) => {
    setDetailName(name);
    setView("details");
  }, []);

  const handleOpenSettings = useCallback(() => {
    setView("settings");
  }, []);

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const statusItems = useMemo(
    () =>
      [
        ...(updateAvailable
          ? [
              <Text key="update" color="yellow">
                ↑ v{updateAvailable} available
              </Text>,
            ]
          : []),
        ...(feedback
          ? [
              <Text key="feedback" color="green">
                {feedback}
              </Text>,
            ]
          : []),
      ] as React.ReactNode[],
    [updateAvailable, feedback],
  );

  // Loading / seeding state.
  if (seeding && profiles.length === 0) {
    return (
      <App title={`awssesh v${VERSION}`} icon="🔐" color="cyan" actions={[ACTIONS.quit]} captureQuit onQuit={() => exit()}>
        <Spinner label="Discovering SSO profiles..." />
      </App>
    );
  }

  // No profiles found.
  if (!seeding && ssoProfiles.length === 0 && profiles.length === 0) {
    return (
      <App title={`awssesh v${VERSION}`} icon="🔐" color="cyan" actions={[ACTIONS.quit]} captureQuit onQuit={() => exit()}>
        <StatusMessage type="error">No SSO profiles found in ~/.aws/config</StatusMessage>
      </App>
    );
  }

  // Login overlay takes precedence over the active view.
  if (pendingLogin) {
    return (
      <App title={`awssesh v${VERSION}`} icon="🔐" color="cyan" onQuit={() => exit()}>
        <LoginPrompt
          profile={pendingLogin}
          deviceAuth={deviceAuth}
          authError={authError}
          copied={copied}
          authorizing={authorizing}
        />
      </App>
    );
  }

  if (view === "settings") {
    return (
      <App title={`awssesh v${VERSION}`} icon="🔐" color="cyan" statusItems={statusItems} onQuit={() => exit()}>
        <Settings settings={settings} onChange={handleSettingsChange} onBack={() => setView("dashboard")} />
      </App>
    );
  }

  if (view === "details" && detailName) {
    const profile = displayProfiles.find((p) => p.name === detailName);
    if (profile) {
      const sso = findProfile(detailName);
      return (
        <App title={`awssesh v${VERSION}`} icon="🔐" color="cyan" statusItems={statusItems} onQuit={() => exit()}>
          <Details
            profile={profile}
            arn={sso?.ssoRoleName}
            region={sso?.ssoRegion}
            startUrl={sso?.ssoStartUrl}
            onBack={() => setView("dashboard")}
          />
        </App>
      );
    }
  }

  return (
    <App
      title={`awssesh v${VERSION}`}
      icon="🔐"
      color="cyan"
      statusItems={statusItems}
      onQuit={() => exit()}
    >
      <Dashboard
        profiles={displayProfiles}
        onRefresh={(names) => void handleRefresh(names)}
        onToggleAuto={handleToggleAuto}
        onOpenDetails={handleOpenDetails}
        onOpenConsole={(name) => void handleOpenConsole(name)}
        onCopyExport={(name) => void handleCopyExport(name)}
        onCopyName={(name) => void handleCopyName(name)}
        onOpenSettings={handleOpenSettings}
        onQuit={() => exit()}
      />
    </App>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

const HELP = `awssesh — interactive AWS SSO credential manager

Usage:
  awssesh                 launch the interactive TUI
  awssesh status          print profile statuses and exit
  awssesh refresh [name]  refresh a profile (or all favorites) now
  awssesh export <name>   print export AWS_* lines for eval $(...)
  awssesh --version
`;

async function launchTui(): Promise<void> {
  const instance = renderApp(<Awssesh />);
  // Always terminate promptly on quit; the in-process auto-refresh interval is
  // cleared on unmount, so there are no lingering handles.
  await instance.waitUntilExit();
  process.exit(0);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.kind) {
    case "version":
      process.stdout.write(`awssesh v${VERSION}\n`);
      return;
    case "help":
      process.stdout.write(HELP);
      return;
    case "status":
      process.exit(await runStatus());
      return;
    case "export":
      process.exit(await runExport(parsed.profile));
      return;
    case "refresh":
      process.exit(await runRefresh(parsed.profile));
      return;
    case "error":
      process.stderr.write(parsed.message + "\n");
      process.exit(1);
      return;
    case "tui":
      await launchTui();
      return;
  }
}

void main();

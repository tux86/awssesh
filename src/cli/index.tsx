#!/usr/bin/env node
/**
 * SSOmatic - Interactive TUI for managing AWS SSO credentials
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { parseArgs } from "./args.js";
import { runStatus } from "./commands/status.js";
import { runExport } from "./commands/export.js";
import { runRefresh } from "./commands/refresh.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runDaemon } from "../daemon/index.js";
import { App, renderApp, Spinner, StatusMessage, ACTIONS } from "./components/index.js";
import { useCopy } from "./hooks/index.js";
import { Dashboard } from "./tui/Dashboard.js";
import { Details } from "./tui/Details.js";
import { Settings } from "./tui/Settings.js";
import { useDaemon } from "./tui/useDaemon.js";
import { buildLocalProfileStates } from "../aws/profileState.js";
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
import type { ProfileState } from "../daemon/protocol.js";
import { VERSION, checkForUpdate } from "../version.js";

type ViewState = "dashboard" | "details" | "settings";

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useDeviceAuth (reused for interactive login when no daemon is running)
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
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  if (!deviceAuth) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">SSO login required for {profile.name}</Text>
        <Spinner label="Initializing device authorization..." />
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
        <Text dimColor>Press Enter to open browser, c to copy URL</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

interface SSOmaticProps {
  startDaemon?: boolean;
}

function SSOmatic({ startDaemon = false }: SSOmaticProps) {
  const { exit } = useApp();

  const [view, setView] = useState<ViewState>("dashboard");
  const [detailName, setDetailName] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [localStates, setLocalStates] = useState<ProfileState[]>([]);
  const [ssoProfiles, setSSOProfiles] = useState<SSOProfile[]>([]);
  const [seeding, setSeeding] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingLogin, setPendingLogin] = useState<SSOProfile | null>(null);

  const daemon = useDaemon(localStates);
  const startBackgroundOnceRef = React.useRef(false);

  // Re-read local disk state (after refresh / favorite changes when no daemon).
  const reloadLocal = useCallback(async () => {
    const states = await buildLocalProfileStates();
    setLocalStates(states);
  }, []);

  // Seed initial local state + discovered profiles on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [states, profiles] = await Promise.all([
        buildLocalProfileStates(),
        discoverProfiles(),
      ]);
      if (cancelled) return;
      setLocalStates(states);
      setSSOProfiles(profiles);
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

  // Optionally auto-start the background daemon (once).
  useEffect(() => {
    if (startDaemon && !startBackgroundOnceRef.current) {
      startBackgroundOnceRef.current = true;
      void daemon.startBackground();
    }
  }, [startDaemon, daemon]);

  const findProfile = useCallback(
    (name: string): SSOProfile | undefined => ssoProfiles.find((p) => p.name === name),
    [ssoProfiles],
  );

  // The profiles displayed in the dashboard: live daemon state when running,
  // local disk state otherwise.
  const displayProfiles = daemon.running ? daemon.profiles : localStates;

  // ── Interactive login (local, no daemon) ──────────────────────────────────
  const handleLoginComplete = useCallback(
    (_profile: SSOProfile, _result: { success: boolean; error?: string }) => {
      setPendingLogin(null);
      void reloadLocal();
    },
    [reloadLocal],
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
      if (key.escape && !authorizing) setPendingLogin(null);
    },
    { isActive: !!pendingLogin },
  );

  // ── Dashboard handlers ────────────────────────────────────────────────────
  const handleRefresh = useCallback(
    async (names: string[]) => {
      if (daemon.running) {
        // Single name → targeted refresh; multiple/all → refresh everything.
        if (names.length === 1) await daemon.refresh(names[0]);
        else await daemon.refresh();
        return;
      }
      // Local refresh: process each profile; the first that needs login triggers
      // the interactive device-auth flow.
      for (const name of names) {
        const profile = findProfile(name);
        if (!profile) continue;
        const result = await refreshProfile(profile);
        if (result.needsLogin) {
          if (settings.notifications) {
            await sendNotification("SSO Login Required", `Token expired for profile '${name}'`);
          }
          setPendingLogin(profile);
          return; // login completion will reload local state
        }
      }
      await reloadLocal();
    },
    [daemon, findProfile, settings.notifications, reloadLocal],
  );

  const handleToggleAuto = useCallback(
    (name: string) => {
      const isFav = settings.favoriteProfiles.includes(name);
      const favoriteProfiles = isFav
        ? settings.favoriteProfiles.filter((n) => n !== name)
        : [...settings.favoriteProfiles, name];
      const next = { ...settings, favoriteProfiles };
      setSettings(next);
      saveSettings(next);
      void daemon.setFavorite(name, !isFav); // no-op if daemon down
      void reloadLocal(); // update the ⟳ marker immediately when no daemon
    },
    [settings, daemon, reloadLocal],
  );

  const handleRunBackground = useCallback(() => {
    void daemon.startBackground();
  }, [daemon]);

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
  if (seeding && localStates.length === 0) {
    return (
      <App title={`SSOmatic v${VERSION}`} icon="🔐" color="cyan" actions={[ACTIONS.quit]} captureQuit onQuit={() => exit()}>
        <Spinner label="Discovering SSO profiles..." />
      </App>
    );
  }

  // No profiles found.
  if (!seeding && ssoProfiles.length === 0 && localStates.length === 0) {
    return (
      <App title={`SSOmatic v${VERSION}`} icon="🔐" color="cyan" actions={[ACTIONS.quit]} captureQuit onQuit={() => exit()}>
        <StatusMessage type="error">No SSO profiles found in ~/.aws/config</StatusMessage>
      </App>
    );
  }

  // Login overlay takes precedence over the active view.
  if (pendingLogin) {
    return (
      <App title={`SSOmatic v${VERSION}`} icon="🔐" color="cyan" actions={[ACTIONS.quit]} onQuit={() => exit()}>
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
      <App title={`SSOmatic v${VERSION}`} icon="🔐" color="cyan" daemonRunning={daemon.running} statusItems={statusItems} onQuit={() => exit()}>
        <Settings settings={settings} onChange={handleSettingsChange} onBack={() => setView("dashboard")} />
      </App>
    );
  }

  if (view === "details" && detailName) {
    const profile = displayProfiles.find((p) => p.name === detailName);
    if (profile) {
      const sso = findProfile(detailName);
      return (
        <App title={`SSOmatic v${VERSION}`} icon="🔐" color="cyan" daemonRunning={daemon.running} statusItems={statusItems} onQuit={() => exit()}>
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
      title={`SSOmatic v${VERSION}`}
      icon="🔐"
      color="cyan"
      daemonRunning={daemon.running}
      statusItems={statusItems}
      onQuit={() => exit()}
    >
      <Dashboard
        profiles={displayProfiles}
        daemonRunning={daemon.running}
        onRefresh={(names) => void handleRefresh(names)}
        onToggleAuto={handleToggleAuto}
        onRunBackground={handleRunBackground}
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

const HELP = `ssomatic — interactive AWS SSO credential manager

Usage:
  ssomatic                 launch the interactive TUI
  ssomatic --daemon        launch the TUI and start the background daemon
  ssomatic status          print profile statuses and exit
  ssomatic refresh [name]  refresh a profile (or all favorites) now
  ssomatic export <name>   print export AWS_* lines for eval $(...)
  ssomatic daemon start|stop|status
  ssomatic --version
`;

function launchTui(startDaemon: boolean): void {
  renderApp(<SSOmatic startDaemon={startDaemon} />);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.kind) {
    case "version":
      process.stdout.write(`ssomatic v${VERSION}\n`);
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
    case "daemon":
      process.exit(await runDaemonCommand(parsed.sub));
      return;
    case "__daemon":
      await runDaemon(); // long-lived; do not exit
      return;
    case "error":
      process.stderr.write(parsed.message + "\n");
      process.exit(1);
      return;
    case "tui":
      launchTui(parsed.daemon);
      return;
  }
}

void main();

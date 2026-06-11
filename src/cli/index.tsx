#!/usr/bin/env bun
/**
 * SSOmatic - Interactive TUI for managing AWS SSO credentials
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  App,
  renderApp,
  List,
  Card,
  Spinner,
  StatusMessage,
  MultiSelectList,
  ACTIONS,
  type ListItemData,
  type MultiSelectItemData,
} from "./components/index.js";
import { useCopy } from "./hooks/index.js";
import {
  type SSOProfile,
  type ProfileStatus,
  type DeviceAuthInfo,
  type AppSettings,
  DEFAULT_SETTINGS,
  REFRESH_INTERVALS,
  discoverProfiles,
  checkAllProfiles,
  startDeviceAuthorization,
  performSSOLoginFlow,
  refreshProfile,
  sendNotification,
  loadSettings,
  saveSettings,
  openBrowser,
  formatExpiry,
  getStatusColor,
  sortByFavorites,
} from "../aws/sso.js";
import { VERSION, checkForUpdate } from "../version.js";

type ViewState =
  | "menu"
  | "status"
  | "refresh"
  | "refresh-select"
  | "daemon-select"
  | "daemon-interval"
  | "daemon-running"
  | "settings"
  | "settings-interval"
  | "settings-favorites";

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useProfiles
// ─────────────────────────────────────────────────────────────────────────────

function useProfiles() {
  const [profiles, setProfiles] = useState<SSOProfile[]>([]);
  const [statuses, setStatuses] = useState<ProfileStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await discoverProfiles();
      setProfiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discover profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStatuses = useCallback(async () => {
    if (profiles.length === 0) return;
    setLoading(true);
    try {
      const result = await checkAllProfiles(profiles);
      setStatuses(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check statuses");
    } finally {
      setLoading(false);
    }
  }, [profiles]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return { profiles, statuses, loading, error, fetchStatuses };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useSettings
// ─────────────────────────────────────────────────────────────────────────────

function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const updateSettings = useCallback(async (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await saveSettings(updated);
  }, [settings]);

  return { settings, updateSettings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useDeviceAuth
// ─────────────────────────────────────────────────────────────────────────────

interface UseDeviceAuthOptions {
  pendingLogin: SSOProfile | null;
  onLoginComplete: (profile: SSOProfile, result: { success: boolean; error?: string }) => void;
  onCopyUrl?: () => void;
}

function useDeviceAuth({ pendingLogin, onLoginComplete, onCopyUrl }: UseDeviceAuthOptions) {
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthInfo | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
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

      // Start new device authorization if we have a profile
      if (pendingLogin) {
        startDeviceAuthorization(pendingLogin).then(setDeviceAuth);
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
    copied,
    handleEnter,
    handleCopy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Table Component
// ─────────────────────────────────────────────────────────────────────────────

interface StatusTableProps {
  statuses: ProfileStatus[];
  favorites: string[];
}

function StatusTable({ statuses, favorites }: StatusTableProps) {
  const sorted = sortByFavorites(statuses, favorites, (s) => s.profile.name);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Profile Status</Text>
        <Text dimColor> ({statuses.length} profiles)</Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor="gray"
        flexDirection="column"
        paddingX={1}
      >
        {sorted.map((status) => {
          const isFavorite = favorites.includes(status.profile.name);
          return (
            <Box key={status.profile.name} gap={1}>
              <Text color={getStatusColor(status.status)}>●</Text>
              <Text bold>{status.profile.name.padEnd(25)}</Text>
              <Text color={getStatusColor(status.status)}>
                {status.status === "valid" ? "Valid" : status.status === "expired" ? "Expired" : "Error"}
              </Text>
              {status.expiresAt && status.status === "valid" && (
                <Text dimColor> ({formatExpiry(status.expiresAt)})</Text>
              )}
              {isFavorite && <Text color="yellow">★</Text>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Login Prompt Component
// ─────────────────────────────────────────────────────────────────────────────

interface LoginPromptProps {
  profile: SSOProfile;
  deviceAuth: DeviceAuthInfo | null;
  pendingCount?: number;
  copied?: boolean;
  authorizing?: boolean;
}

function LoginPrompt({ profile, deviceAuth, pendingCount = 0, copied = false, authorizing = false }: LoginPromptProps) {
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
      {pendingCount > 0 && (
        <Text dimColor>({pendingCount} more profile{pendingCount > 1 ? 's' : ''} pending)</Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>URL: </Text>
          <Text color="cyan">{deviceAuth.verificationUri}</Text>
          {copied && <Text color="green"> (copied!)</Text>}
        </Box>
        <Box>
          <Text dimColor>Code: </Text>
          <Text color="magenta" bold>{deviceAuth.userCode}</Text>
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
// Refresh Progress Component
// ─────────────────────────────────────────────────────────────────────────────

interface RefreshProgressProps {
  profiles: SSOProfile[];
  settings: AppSettings;
  onBack: () => void;
}

function RefreshProgress({ profiles, settings, onBack }: RefreshProgressProps) {
  const [results, setResults] = useState<{ name: string; success: boolean; error?: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const [pendingLogin, setPendingLogin] = useState<SSOProfile | null>(null);

  const handleLoginComplete = useCallback((profile: SSOProfile, result: { success: boolean; error?: string }) => {
    setResults((prev) => [...prev, { name: profile.name, success: result.success, error: result.error }]);
    setPendingLogin(null);
    setCurrent((c) => c + 1);
  }, []);

  const { deviceAuth, authorizing, copied, handleEnter, handleCopy } = useDeviceAuth({
    pendingLogin,
    onLoginComplete: handleLoginComplete,
  });

  useInput((input, key) => {
    if (key.return) handleEnter();
    if (input === "c") handleCopy();
    if (key.escape && !authorizing) onBack();
  });

  useEffect(() => {
    if (current >= profiles.length) {
      // All done
      return;
    }
    if (pendingLogin) return;

    const profile = profiles[current];
    refreshProfile(profile).then((result) => {
      if (result.needsLogin) {
        if (settings.notifications) {
          sendNotification("SSO Login Required", `Token expired for profile '${profile.name}'`);
        }
        setPendingLogin(profile);
      } else {
        setResults((prev) => [...prev, { name: profile.name, success: result.success, error: result.error }]);
        setCurrent((c) => c + 1);
      }
    });
  }, [current, profiles, settings, pendingLogin]);

  const done = current >= profiles.length && !pendingLogin;
  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  return (
    <Box flexDirection="column">
      <Card title="Refreshing Credentials">
        {profiles.map((profile, idx) => {
          const result = results.find((r) => r.name === profile.name);
          const isPending = pendingLogin?.name === profile.name;
          const isCurrent = idx === current && !pendingLogin && !done;

          return (
            <Box key={profile.name} gap={1}>
              {result ? (
                <Text color={result.success ? "green" : "red"}>{result.success ? "✓" : "✗"}</Text>
              ) : isPending ? (
                <Text color="yellow">⚠</Text>
              ) : isCurrent ? (
                <Text color="cyan">◌</Text>
              ) : (
                <Text dimColor>○</Text>
              )}
              <Text bold={isCurrent || isPending}>{profile.name}</Text>
              {result && !result.success && result.error && (
                <Text color="red"> - {result.error}</Text>
              )}
              {isPending && (
                <Text color="yellow"> - Press Enter to login</Text>
              )}
            </Box>
          );
        })}
      </Card>

      {done && (
        <Box flexDirection="column" marginTop={1}>
          <StatusMessage type={errorCount > 0 ? "warning" : "success"}>
            Refreshed {successCount} profile(s){errorCount > 0 ? `, ${errorCount} error(s)` : ""}
          </StatusMessage>
          {successCount > 0 && (
            <Box marginTop={1}>
              <Text dimColor>Profiles: </Text>
              <Text>{results.filter(r => r.success).map(r => r.name).join(", ")}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press b to go back</Text>
          </Box>
        </Box>
      )}

      {pendingLogin && (
        <LoginPrompt
          profile={pendingLogin}
          deviceAuth={deviceAuth}
          copied={copied}
          authorizing={authorizing}
        />
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daemon Component
// ─────────────────────────────────────────────────────────────────────────────

interface DaemonViewProps {
  profiles: SSOProfile[];
  intervalMinutes: number;
  settings: AppSettings;
  onStop: () => void;
}

function DaemonView({ profiles, intervalMinutes, settings, onStop }: DaemonViewProps) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<Date | null>(null);
  const [results, setResults] = useState<{ name: string; success: boolean }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<SSOProfile | null>(null);
  const [pendingQueue, setPendingQueue] = useState<SSOProfile[]>([]);

  const processNextLogin = useCallback(() => {
    if (pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setPendingQueue(rest);
      setPendingLogin(next);
    } else {
      setPendingLogin(null);
      setLastRefresh(new Date());
      setNextRefresh(new Date(Date.now() + intervalMinutes * 60 * 1000));
      setRefreshing(false);
    }
  }, [pendingQueue, intervalMinutes]);

  const handleLoginComplete = useCallback((profile: SSOProfile, result: { success: boolean }) => {
    setResults((prev) => [...prev, { name: profile.name, success: result.success }]);
    processNextLogin();
  }, [processNextLogin]);

  const { deviceAuth, authorizing, copied, handleEnter, handleCopy } = useDeviceAuth({
    pendingLogin,
    onLoginComplete: handleLoginComplete,
  });

  useInput((input, key) => {
    if ((key.ctrl && input === "c") || input === "q") {
      onStop();
    }
    if (key.return) handleEnter();
    if (input === "c" && !key.ctrl) handleCopy();
  });

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    setResults([]);
    const profilesNeedingLogin: SSOProfile[] = [];

    for (const profile of profiles) {
      const result = await refreshProfile(profile);
      if (result.needsLogin) {
        if (settings.notifications) {
          sendNotification("SSO Login Required", `Token expired for profile '${profile.name}'`);
        }
        profilesNeedingLogin.push(profile);
      } else {
        setResults((prev) => [...prev, { name: profile.name, success: result.success }]);
      }
    }

    if (profilesNeedingLogin.length > 0) {
      const [first, ...rest] = profilesNeedingLogin;
      setPendingQueue(rest);
      setPendingLogin(first);
    } else {
      setLastRefresh(new Date());
      setNextRefresh(new Date(Date.now() + intervalMinutes * 60 * 1000));
      setRefreshing(false);
    }
  }, [profiles, settings, intervalMinutes]);

  useEffect(() => {
    doRefresh();
    const interval = setInterval(doRefresh, intervalMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [doRefresh, intervalMinutes]);

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  return (
    <Box flexDirection="column">
      <Card title="Auto-Refresh Daemon">
        <Box flexDirection="column">
          <Text><Text dimColor>Profiles:</Text> {profiles.map(p => p.name).join(", ")}</Text>
          <Text><Text dimColor>Interval:</Text> {intervalMinutes} min</Text>
          {lastRefresh && <Text><Text dimColor>Last:</Text> {lastRefresh.toLocaleTimeString()}</Text>}
          {nextRefresh && !refreshing && !pendingLogin && <Text><Text dimColor>Next:</Text> {nextRefresh.toLocaleTimeString()}</Text>}
          {refreshing && !pendingLogin ? (
            <Spinner label="Refreshing..." />
          ) : results.length > 0 && !pendingLogin && (
            <Text color={errorCount > 0 ? "yellow" : "green"}>✓ {successCount} refreshed{errorCount > 0 ? `, ${errorCount} errors` : ""}</Text>
          )}
        </Box>
      </Card>

      {pendingLogin && (
        <LoginPrompt
          profile={pendingLogin}
          deviceAuth={deviceAuth}
          pendingCount={pendingQueue.length}
          copied={copied}
          authorizing={authorizing}
        />
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

function SSOmatic() {
  const { profiles, statuses, loading, error, fetchStatuses } = useProfiles();
  const { settings, updateSettings } = useSettings();
  const [view, setView] = useState<ViewState>("menu");
  const [selectedProfiles, setSelectedProfiles] = useState<SSOProfile[]>([]);
  const [daemonInterval, setDaemonInterval] = useState(30);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const { exit } = useApp();

  // Check for updates
  useEffect(() => {
    checkForUpdate().then(setUpdateAvailable);
  }, []);

  // Handle keyboard for navigation
  useInput((input, key) => {
    if ((input === "b" || key.escape) && view !== "menu" && view !== "daemon-running") {
      setView("menu");
    }
  });

  // Menu items
  const menuItems: ListItemData[] = [
    { id: "status", label: "Check status", hint: "view all profiles", value: "status" },
    { id: "refresh", label: "Refresh now", hint: "one-time", value: "refresh" },
    { id: "daemon", label: "Auto-refresh", hint: "runs continuously", value: "daemon" },
    { id: "settings", label: "Settings", hint: "notifications & defaults", value: "settings" },
    { id: "exit", label: "Exit", value: "exit" },
  ];

  // Settings menu items
  const settingsItems: ListItemData[] = [
    {
      id: "notifications",
      label: `Notifications: ${settings.notifications ? "On" : "Off"}`,
      value: "notifications",
    },
    {
      id: "interval",
      label: `Default refresh interval: ${settings.defaultInterval} minutes`,
      value: "interval",
    },
    {
      id: "favorites",
      label: `Favorite profiles (${settings.favoriteProfiles.length})`,
      value: "favorites",
    },
    { id: "back", label: "Back to main menu", value: "back" },
  ];

  // Interval items
  const intervalItems: ListItemData[] = REFRESH_INTERVALS.map((i) => ({
    id: String(i.value),
    label: i.label,
    hint: i.hint,
    value: i.value,
  }));

  // Profile items for multi-select
  const profileItems: MultiSelectItemData[] = sortByFavorites(
    profiles.map((profile) => {
      const status = statuses.find((s) => s.profile.name === profile.name);
      const isFavorite = settings.favoriteProfiles.includes(profile.name);
      return {
        id: profile.name,
        label: `${profile.name}${isFavorite ? " ★" : ""}`,
        hint: status?.status || "unknown",
        value: profile,
      };
    }),
    settings.favoriteProfiles,
    (item) => item.id
  );

  // Handlers
  const handleMenuSelect = (item: ListItemData) => {
    const action = item.value as string;
    switch (action) {
      case "status":
        fetchStatuses();
        setView("status");
        break;
      case "refresh":
        fetchStatuses();
        setView("refresh-select");
        break;
      case "daemon":
        fetchStatuses();
        setView("daemon-select");
        break;
      case "settings":
        setView("settings");
        break;
      case "exit":
        exit();
        break;
    }
  };

  const handleSettingsSelect = async (item: ListItemData) => {
    const action = item.value as string;
    switch (action) {
      case "notifications":
        await updateSettings({ notifications: !settings.notifications });
        break;
      case "interval":
        setView("settings-interval");
        break;
      case "favorites":
        setView("settings-favorites");
        break;
      case "back":
        setView("menu");
        break;
    }
  };

  const handleIntervalSelect = async (item: ListItemData) => {
    await updateSettings({ defaultInterval: item.value as number });
    setView("settings");
  };

  const handleDaemonIntervalSelect = (item: ListItemData) => {
    setDaemonInterval(item.value as number);
    setView("daemon-running");
  };

  const handleFavoritesSubmit = async (selected: MultiSelectItemData[]) => {
    await updateSettings({ favoriteProfiles: selected.map((s) => s.id) });
    setView("settings");
  };

  const handleProfilesSubmit = (selected: MultiSelectItemData[]) => {
    setSelectedProfiles(selected.map((s) => s.value as SSOProfile));
    if (view === "refresh-select") {
      setView("refresh");
    } else if (view === "daemon-select") {
      setView("daemon-interval");
    }
  };

  // Loading state
  if (loading && profiles.length === 0) {
    return (
      <App
        title="SSOmatic"
        icon="🔐"
        color="cyan"
        actions={[ACTIONS.quit]}
        onQuit={() => exit()}
      >
        <Spinner label="Discovering SSO profiles..." />
      </App>
    );
  }

  // No profiles
  if (profiles.length === 0 && !loading) {
    return (
      <App
        title="SSOmatic"
        icon="🔐"
        color="cyan"
        actions={[ACTIONS.quit]}
        onQuit={() => exit()}
      >
        <StatusMessage type="error">
          No SSO profiles found in ~/.aws/config
        </StatusMessage>
        <Card title="Required Configuration">
          <Text dimColor>
            Make sure your config has profiles with:{"\n"}
            - sso_start_url{"\n"}
            - sso_account_id{"\n"}
            - sso_role_name{"\n"}
            - sso_region
          </Text>
        </Card>
      </App>
    );
  }

  // Render based on view
  const renderView = () => {
    switch (view) {
      case "menu":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> What would you like to do?</Text>
            </Box>
            <List
              items={menuItems}
              onSelect={handleMenuSelect}
              maxVisible={5}
            />
          </>
        );

      case "status":
        return (
          <>
            {loading ? (
              <Spinner label="Checking credentials status..." />
            ) : (
              <>
                <StatusTable statuses={statuses} favorites={settings.favoriteProfiles} />
                <Box marginTop={1}>
                  <Text dimColor>Press b to go back</Text>
                </Box>
              </>
            )}
          </>
        );

      case "refresh-select":
      case "daemon-select":
        return (
          <>
            {loading ? (
              <Spinner label="Checking credentials status..." />
            ) : (
              <>
                <Box marginBottom={1}>
                  <Text color="cyan">?</Text>
                  <Text> Select profiles to {view === "refresh-select" ? "refresh" : "monitor"}</Text>
                </Box>
                <MultiSelectList
                  items={profileItems}
                  onSubmit={handleProfilesSubmit}
                  onCancel={() => setView("menu")}
                  initialSelected={settings.favoriteProfiles}
                  required
                  maxVisible={10}
                />
              </>
            )}
          </>
        );

      case "refresh":
        return (
          <RefreshProgress
            profiles={selectedProfiles}
            settings={settings}
            onBack={() => setView("menu")}
          />
        );

      case "daemon-interval":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> Select refresh interval</Text>
            </Box>
            <List
              items={intervalItems}
              onSelect={handleDaemonIntervalSelect}
              maxVisible={5}
            />
          </>
        );

      case "daemon-running":
        return (
          <DaemonView
            profiles={selectedProfiles}
            intervalMinutes={daemonInterval}
            settings={settings}
            onStop={() => setView("menu")}
          />
        );

      case "settings":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> Settings</Text>
            </Box>
            <List
              items={settingsItems}
              onSelect={handleSettingsSelect}
              maxVisible={5}
            />
          </>
        );

      case "settings-interval":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> Select default refresh interval</Text>
            </Box>
            <List
              items={intervalItems}
              onSelect={handleIntervalSelect}
              maxVisible={5}
            />
          </>
        );

      case "settings-favorites":
        return (
          <>
            <Box marginBottom={1}>
              <Text color="cyan">?</Text>
              <Text> Select favorite profiles (shown first)</Text>
            </Box>
            <MultiSelectList
              items={profileItems}
              onSubmit={handleFavoritesSubmit}
              onCancel={() => setView("settings")}
              initialSelected={settings.favoriteProfiles}
              maxVisible={10}
            />
          </>
        );

      default:
        return null;
    }
  };

  const getActions = () => {
    switch (view) {
      case "menu":
        return [ACTIONS.navigate, ACTIONS.select, ACTIONS.quit];
      case "status":
        return [ACTIONS.back, ACTIONS.quit];
      case "refresh-select":
      case "daemon-select":
      case "settings-favorites":
        return [
          { keys: "space", label: "Toggle" },
          { keys: "a", label: "All/None" },
          ACTIONS.select,
          ACTIONS.back,
        ];
      case "daemon-running":
        return [{ keys: "^C", label: "Stop" }, ACTIONS.quit];
      default:
        return [ACTIONS.navigate, ACTIONS.select, ACTIONS.back];
    }
  };

  const statusItems = [
    ...(updateAvailable ? [
      <Text key="update" color="yellow">
        ↑ v{updateAvailable} available
      </Text>
    ] : []),
  ];

  return (
    <App
      title={`SSOmatic v${VERSION}`}
      icon="🔐"
      color="cyan"
      actions={getActions()}
      statusItems={statusItems}
      onQuit={() => exit()}
    >
      {/* Profile count banner */}
      <Box marginBottom={1}>
        <Text dimColor>
          {profiles.length} SSO profile{profiles.length !== 1 ? "s" : ""} discovered
        </Text>
      </Box>

      {error && (
        <StatusMessage type="error">{error}</StatusMessage>
      )}

      {renderView()}
    </App>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`ssomatic v${VERSION}`);
  process.exit(0);
}

renderApp(<SSOmatic />);

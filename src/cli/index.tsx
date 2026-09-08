#!/usr/bin/env node
/**
 * awssesh - Interactive TUI for managing AWS SSO credentials
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, useApp, useInput } from "ink";
import { parseArgs } from "./args.js";
import { runStatus } from "./commands/status.js";
import { runExport } from "./commands/export.js";
import { runExec } from "./commands/exec.js";
import { runRefresh } from "./commands/refresh.js";
import { App, renderApp, Spinner, ACTIONS } from "./components/index.js";
import { Dashboard } from "./tui/Dashboard.js";
import { Details } from "./tui/Details.js";
import { Settings } from "./tui/Settings.js";
import { LoginPrompt } from "./tui/LoginPrompt.js";
import { MfaPrompt } from "./tui/MfaPrompt.js";
import { AccountBrowser } from "./tui/AccountBrowser.js";
import { useDeviceAuth, type LoginResult, type LoginTarget } from "./tui/useDeviceAuth.js";
import { useAutoRefresh } from "./tui/useAutoRefresh.js";
import { useTransientMessage } from "./hooks/useTransientMessage.js";
import {
  discoverSSOSessions,
  sessionOf,
  type Profile,
  type SSOSession,
} from "../aws/profiles.js";
import { ensureCredentials, type CredentialsOutcome } from "../aws/refresh.js";
import { findCachedToken, sendNotification, openBrowser } from "../aws/sso.js";
import { buildExportBlock } from "../aws/env.js";
import { getConsoleSigninUrl } from "../aws/console.js";
import { copyToClipboard } from "../aws/utils.js";
import { loadSettings, saveSettings, type AppSettings } from "../aws/settings.js";
import { VERSION, checkForUpdate } from "../version.js";

type ViewState = "dashboard" | "details" | "settings" | "accounts";

/** A failed outcome, i.e. one the user has to be told about or act on. */
type Failure = Extract<CredentialsOutcome, { ok: false }>;

/** An MFA code being collected, and the profile whose refresh is waiting on it. */
interface PendingMfa {
  /** The profile the user asked for — the one to retry with the code. */
  target: string;
  /** The profile that actually needs the code, which may be further up the chain. */
  profileName: string;
  mfaSerial?: string;
}

const TITLE = `awssesh v${VERSION}`;

function Awssesh() {
  const { exit } = useApp();

  const [view, setView] = useState<ViewState>("dashboard");
  const [detailName, setDetailName] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [pendingLogin, setPendingLogin] = useState<LoginTarget | null>(null);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SSOSession[]>([]);

  const { message, notify, hold } = useTransientMessage();

  // Notify-once on auto-refresh login expiry, respecting the notifications setting.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const onNeedsLogin = useCallback((name: string) => {
    if (settingsRef.current.notifications) {
      void sendNotification("SSO Login Required", `Token expired for profile '${name}'`);
    }
  }, []);

  const { profiles, ready, configured, reload, refreshOne, setFavorite } = useAutoRefresh(
    settings,
    onNeedsLogin,
  );

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((v) => {
      if (!cancelled) setUpdateAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const findProfile = useCallback(
    (name: string): Profile | undefined => configured.find((p) => p.name === name),
    [configured],
  );

  // ── Interactive login ──────────────────────────────────────────────────────
  /** Set while the account browser is blocked waiting for a portal token. */
  const tokenResolver = useRef<((token: string | null) => void) | null>(null);
  /** The profile whose refresh triggered the current login, if any. */
  const loginFor = useRef<string | null>(null);

  const finishTokenRequest = useCallback(async (target: LoginTarget, success: boolean) => {
    const resolve = tokenResolver.current;
    if (!resolve) return false;
    tokenResolver.current = null;
    const token = success ? await findCachedToken(target.session) : null;
    resolve(token?.accessToken ?? null);
    return true;
  }, []);

  const startLogin = useCallback((target: LoginTarget, forProfile?: string) => {
    loginFor.current = forProfile ?? null;
    setPendingLogin(target);
  }, []);

  /** Explain — and where possible offer a way out of — a failed credential fetch. */
  const reportFailure = useCallback(
    (name: string, failure: Failure, allowLogin = true) => {
      if (failure.reason === "needs-login") {
        if (!allowLogin) {
          notify(`${name} still needs an SSO login`, "error");
          return;
        }
        hold(`${failure.profile.name} needs an interactive login`);
        startLogin({ session: sessionOf(failure.profile), label: failure.profile.name }, name);
        return;
      }
      if (failure.reason === "needs-mfa") {
        setMfaCode("");
        setMfaError(null);
        setPendingMfa({
          target: name,
          profileName: failure.profile.name,
          mfaSerial: failure.profile.mfaSerial,
        });
        return;
      }
      notify(`${name}: ${failure.error}`, "error");
    },
    [notify, hold, startLogin],
  );

  const handleRefresh = useCallback(
    async (name: string, allowLogin = true) => {
      hold(`Refreshing ${name}…`);
      const outcome = await refreshOne(name);
      if (outcome.ok) notify(`Refreshed ${name}`, "success");
      else reportFailure(name, outcome, allowLogin);
    },
    [refreshOne, hold, notify, reportFailure],
  );

  const handleLoginComplete = useCallback(
    (target: LoginTarget, result: LoginResult) => {
      setPendingLogin(null);
      // The failure reason used to be dropped on the floor, leaving the user
      // back at the dashboard with no idea why nothing changed.
      if (!result.success) notify(`${target.label}: ${result.error ?? "login failed"}`, "error");

      const forProfile = loginFor.current;
      loginFor.current = null;

      void (async () => {
        // The account browser asked for this login and is waiting on the token.
        if (await finishTokenRequest(target, result.success)) return;
        if (result.success) notify(`Signed in to ${target.label}`, "success");
        // A fresh token is not credentials: fetch those too, without offering
        // yet another login if it somehow still is not enough.
        if (result.success && forProfile) await handleRefresh(forProfile, false);
        else await reload();
      })();
    },
    [notify, reload, finishTokenRequest, handleRefresh],
  );

  const deviceAuth = useDeviceAuth({ pendingLogin, onLoginComplete: handleLoginComplete });

  // Keyboard for the login prompt overlay (only active while a login is pending).
  useInput(
    (input, key) => {
      if (key.escape) {
        const target = pendingLogin;
        setPendingLogin(null);
        loginFor.current = null;
        if (target) void finishTokenRequest(target, false);
        notify("Login cancelled");
        return;
      }
      if (deviceAuth.authError) return;
      if (key.return) deviceAuth.openInBrowser();
      else if (input === "c") deviceAuth.copyUrl();
    },
    { isActive: !!pendingLogin },
  );

  // ── MFA ───────────────────────────────────────────────────────────────────
  const submitMfa = useCallback(async () => {
    if (!pendingMfa) return;
    setMfaSubmitting(true);
    setMfaError(null);
    const outcome = await refreshOne(pendingMfa.target, mfaCode);
    setMfaSubmitting(false);

    if (outcome.ok) {
      setPendingMfa(null);
      notify(`Refreshed ${pendingMfa.target}`, "success");
      return;
    }
    // Staying on the prompt lets a mistyped code be corrected in place; any
    // other failure is not something a second code can fix.
    if (outcome.reason === "needs-mfa" || (outcome.reason === "error" && /mfa|code/i.test(outcome.error))) {
      setMfaCode("");
      setMfaError(outcome.reason === "error" ? outcome.error : "that code was not accepted");
      return;
    }
    setPendingMfa(null);
    reportFailure(pendingMfa.target, outcome);
  }, [pendingMfa, mfaCode, refreshOne, notify, reportFailure]);

  // ── Profile actions ───────────────────────────────────────────────────────
  const handleToggleAuto = useCallback(
    (name: string) => {
      // `setFavorite` owns persistence, so settings have a single writer.
      const next = setFavorite(name);
      setSettings(next);
      notify(`⟳ auto-refresh ${next.favoriteProfiles.includes(name) ? "on" : "off"} for ${name}`);
    },
    [setFavorite, notify],
  );

  /** Credentials that are usable right now, offering a login or MFA prompt if not. */
  const credentialsFor = useCallback(
    async (name: string) => {
      const profile = findProfile(name);
      if (!profile) {
        notify(`${name} is no longer in ~/.aws/config`, "error");
        return null;
      }
      const outcome = await ensureCredentials(profile, { profiles: configured });
      if (outcome.ok) return outcome.credentials;
      reportFailure(name, outcome);
      return null;
    },
    [findProfile, configured, notify, reportFailure],
  );

  const handleCopyExport = useCallback(
    async (name: string) => {
      hold(`Fetching credentials for ${name}…`);
      const creds = await credentialsFor(name);
      if (!creds) return;
      const ok = await copyToClipboard(buildExportBlock(creds));
      if (ok) notify(`Copied AWS_* export lines for ${name}`, "success");
      else notify("Copy failed — no clipboard tool available", "error");
    },
    [credentialsFor, hold, notify],
  );

  const handleCopyName = useCallback(
    async (name: string) => {
      const ok = await copyToClipboard(name);
      if (ok) notify(`Copied “${name}”`, "success");
      else notify("Copy failed — no clipboard tool available", "error");
    },
    [notify],
  );

  const handleOpenConsole = useCallback(
    async (name: string) => {
      hold(`Opening console for ${name}…`);
      const creds = await credentialsFor(name);
      if (!creds) return;
      try {
        openBrowser(await getConsoleSigninUrl(creds));
        notify(`Opened the AWS console for ${name}`, "success");
      } catch {
        notify(`Console sign-in failed for ${name}`, "error");
      }
    },
    [credentialsFor, hold, notify],
  );

  const handleOpenDetails = useCallback((name: string) => {
    setDetailName(name);
    setView("details");
  }, []);

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  // ── Adding a profile from the SSO portal ──────────────────────────────────
  const handleAddProfile = useCallback(async () => {
    const found = await discoverSSOSessions();
    if (found.length === 0) {
      notify("No SSO portal in ~/.aws/config — add an [sso-session] block first", "error");
      return;
    }
    setSessions(found);
    setView("accounts");
  }, [notify]);

  const requestToken = useCallback(
    async (session: SSOSession): Promise<string | null> => {
      const cached = await findCachedToken(session);
      if (cached && cached.expiresAt > new Date()) return cached.accessToken;
      return new Promise<string | null>((resolve) => {
        tokenResolver.current = resolve;
        startLogin({ session, label: session.name ?? session.startUrl });
      });
    },
    [startLogin],
  );

  /** The region to give a new profile: whatever its portal's profiles already use. */
  const defaultRegion = useCallback(
    (session: SSOSession) =>
      configured.find((p) => p.kind === "sso" && p.ssoStartUrl === session.startUrl)?.region ??
      session.region,
    [configured],
  );

  const handleProfileCreated = useCallback(
    (name: string) => {
      setView("dashboard");
      notify(`Added profile ${name} to ~/.aws/config`, "success");
      void reload();
    },
    [notify, reload],
  );

  const statusItems = useMemo(() => {
    const items: React.ReactNode[] = [];
    if (updateAvailable) {
      items.push(
        <Text key="update" color="yellow">
          {`↑ v${updateAvailable} available — npx awssesh@latest`}
        </Text>,
      );
    }
    if (message) {
      const color = message.tone === "error" ? "red" : message.tone === "success" ? "green" : "cyan";
      items.push(
        <Text key="message" color={color}>
          {message.text}
        </Text>,
      );
    }
    return items;
  }, [updateAvailable, message]);

  // Loading / seeding state.
  if (!ready) {
    return (
      <App title={TITLE} actions={[ACTIONS.quit]} captureQuit onQuit={exit}>
        <Spinner label="Discovering profiles…" />
      </App>
    );
  }

  // Overlays take precedence over the active view.
  if (pendingLogin) {
    return (
      <App title={TITLE} statusItems={statusItems} onQuit={exit}>
        <LoginPrompt
          label={pendingLogin.label}
          deviceAuth={deviceAuth.deviceAuth}
          authError={deviceAuth.authError}
          copied={deviceAuth.copied}
          copyFailed={deviceAuth.copyFailed}
          authorizing={deviceAuth.authorizing}
        />
      </App>
    );
  }

  if (pendingMfa) {
    return (
      <App title={TITLE} statusItems={statusItems} onQuit={exit}>
        <MfaPrompt
          profileName={pendingMfa.profileName}
          mfaSerial={pendingMfa.mfaSerial}
          code={mfaCode}
          submitting={mfaSubmitting}
          error={mfaError}
          onChange={setMfaCode}
          onSubmit={() => void submitMfa()}
          onCancel={() => {
            setPendingMfa(null);
            notify("MFA cancelled");
          }}
        />
      </App>
    );
  }

  if (view === "accounts") {
    return (
      <App title={TITLE} statusItems={statusItems} onQuit={exit}>
        <AccountBrowser
          sessions={sessions}
          existingNames={configured.map((p) => p.name)}
          defaultRegion={defaultRegion}
          getToken={requestToken}
          onCreated={handleProfileCreated}
          onBack={() => setView("dashboard")}
        />
      </App>
    );
  }

  if (view === "settings") {
    return (
      <App title={TITLE} statusItems={statusItems} onQuit={exit}>
        <Settings settings={settings} onChange={handleSettingsChange} onBack={() => setView("dashboard")} />
      </App>
    );
  }

  const detail = view === "details" && detailName ? profiles.find((p) => p.name === detailName) : undefined;
  if (detail) {
    return (
      <App title={TITLE} statusItems={statusItems} onQuit={exit}>
        <Details
          profile={detail}
          config={findProfile(detail.name)}
          onBack={() => setView("dashboard")}
          onRefresh={(name) => void handleRefresh(name)}
          onCopyExport={(name) => void handleCopyExport(name)}
          onCopyName={(name) => void handleCopyName(name)}
          onOpenConsole={(name) => void handleOpenConsole(name)}
          onToggleAuto={handleToggleAuto}
        />
      </App>
    );
  }

  return (
    <App title={TITLE} statusItems={statusItems} onQuit={exit}>
      <Dashboard
        profiles={profiles}
        onRefresh={(name) => void handleRefresh(name)}
        onToggleAuto={handleToggleAuto}
        onOpenDetails={handleOpenDetails}
        onOpenConsole={(name) => void handleOpenConsole(name)}
        onCopyExport={(name) => void handleCopyExport(name)}
        onCopyName={(name) => void handleCopyName(name)}
        onAddProfile={() => void handleAddProfile()}
        onOpenSettings={() => setView("settings")}
        onQuit={exit}
      />
    </App>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

const HELP = `awssesh — interactive AWS SSO credential manager

Usage:
  awssesh                        launch the interactive TUI
  awssesh status                 print profile statuses and exit
  awssesh refresh [profile]      refresh a profile (or all ⟳ profiles) now
  awssesh export <profile>       print export AWS_* lines for eval $(...)
  awssesh export <profile> --json  print credential_process JSON
  awssesh exec <profile> -- <cmd>  run a command with the profile's credentials
  awssesh --version              print the version
  awssesh --help                 show this message

Examples:
  eval $(awssesh export prod)
  awssesh exec prod -- terraform plan
  awssesh refresh prod

  # let every AWS SDK and the AWS CLI fetch credentials themselves,
  # in ~/.aws/config:
  #   [profile prod-auto]
  #   credential_process = awssesh export prod --json

Environment:
  AWSSESH_NO_UPDATE_CHECK    skip the release check on startup
  AWSSESH_NO_HYPERLINKS      render URLs as plain text
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
      process.exit(await runExport(parsed.profile, parsed.json));
      return;
    case "exec":
      process.exit(await runExec(parsed.profile, parsed.command));
      return;
    case "refresh":
      process.exit(await runRefresh(parsed.profile));
      return;
    case "error":
      process.stderr.write(parsed.message + "\n");
      process.stderr.write("\n" + HELP);
      process.exit(1);
      return;
    case "tui":
      await launchTui();
      return;
  }
}

void main();

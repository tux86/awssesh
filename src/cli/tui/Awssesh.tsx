/**
 * The awssesh TUI: the dashboard and every screen reachable from it.
 *
 * Kept apart from `cli/index.tsx` so the whole app can be mounted in a test —
 * importing the entry point would run the argument router and exit.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, useApp, useInput } from "ink";
import { App, Spinner, ACTIONS } from "../components/index.js";
import { Dashboard } from "./Dashboard.js";
import { Details } from "./Details.js";
import { Settings } from "./Settings.js";
import { LoginPrompt } from "./LoginPrompt.js";
import { MfaPrompt } from "./MfaPrompt.js";
import { AccountBrowser } from "./AccountBrowser.js";
import { useDeviceAuth, type LoginResult, type LoginTarget } from "./useDeviceAuth.js";
import { useAutoRefresh } from "./useAutoRefresh.js";
import { useTransientMessage } from "../hooks/useTransientMessage.js";
import {
  discoverProfileNames,
  discoverSSOSessions,
  sessionOf,
  type Profile,
  type SSOSession,
} from "../../aws/profiles.js";
import { ensureCredentials, type CredentialsOutcome } from "../../aws/refresh.js";
import { findCachedToken, sendNotification, openBrowser } from "../../aws/sso.js";
import { buildExportBlock } from "../../aws/env.js";
import { getConsoleSigninUrl } from "../../aws/console.js";
import { copyToClipboard } from "../../aws/utils.js";
import { loadSettings, saveSettings, type AppSettings } from "../../aws/settings.js";
import { VERSION, checkForUpdate } from "../../version.js";

type ViewState = "dashboard" | "details" | "settings" | "accounts";

/** A failed outcome, i.e. one the user has to be told about or act on. */
type Failure = Extract<CredentialsOutcome, { ok: false }>;

/** What the user was doing when a login got in the way, so it can be finished after. */
type Action = "refresh" | "copy" | "console";

/** An MFA code being collected, and the profile whose refresh is waiting on it. */
interface PendingMfa {
  /** The profile the user asked for — the one to retry with the code. */
  target: string;
  /** The profile that actually needs the code, which may be further up the chain. */
  profileName: string;
  mfaSerial?: string;
}

const TITLE = `awssesh v${VERSION}`;

export function Awssesh() {
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
  const [takenNames, setTakenNames] = useState<string[]>([]);
  /** The portal the account browser is on, so a login can return it there. */
  const [browseSession, setBrowseSession] = useState<SSOSession | null>(null);

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
  /** What to finish once the current login succeeds. */
  const loginIntent = useRef<{ name: string; action: Action } | null>(null);

  /** Hand the account browser its token, if it is the thing waiting on this login. */
  const finishTokenRequest = useCallback(async (target: LoginTarget, success: boolean) => {
    const resolve = tokenResolver.current;
    if (!resolve) return false;
    tokenResolver.current = null;
    const token = success ? await findCachedToken(target.session) : null;
    resolve(token?.accessToken ?? null);
    return true;
  }, []);

  /**
   * Leave the account browser.
   *
   * The login overlay replaces the browser rather than covering it, so the
   * browser unmounts while a login is pending and remounts once it clears. A
   * browser that remounts with no token asks for the same login immediately,
   * which turned cancelling into a prompt the user could not escape.
   */
  const leaveBrowser = useCallback(() => {
    setBrowseSession(null);
    setView("dashboard");
  }, []);

  const startLogin = useCallback((target: LoginTarget, intent?: { name: string; action: Action }) => {
    loginIntent.current = intent ?? null;
    // A login for a profile lands back on the list, whether it succeeds, fails
    // or is cancelled: the overlay replaced whatever screen asked for it, and
    // the profile that needed the login may not even be the one being viewed.
    // A login for the account browser is left alone — it resumes the browser.
    if (intent) setView("dashboard");
    setPendingLogin(target);
  }, []);

  /** Explain — and where possible offer a way out of — a failed credential fetch. */
  const reportFailure = useCallback(
    (name: string, failure: Failure, action: Action = "refresh", allowLogin = true) => {
      if (failure.reason === "needs-login") {
        if (!allowLogin) {
          notify(`${name} still needs an SSO login`, "error");
          return;
        }
        hold(`${failure.profile.name} needs an interactive login`);
        startLogin({ session: sessionOf(failure.profile), label: failure.profile.name }, { name, action });
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
      else reportFailure(name, outcome, "refresh", allowLogin);
    },
    [refreshOne, hold, notify, reportFailure],
  );

  /** Credentials that are usable right now, offering a login or MFA prompt if not. */
  const credentialsFor = useCallback(
    async (name: string, action: Action, allowLogin = true) => {
      const profile = findProfile(name);
      if (!profile) {
        notify(`${name} is no longer in ~/.aws/config`, "error");
        return null;
      }
      const outcome = await ensureCredentials(profile, { profiles: configured });
      if (outcome.ok) return outcome.credentials;
      reportFailure(name, outcome, action, allowLogin);
      return null;
    },
    [findProfile, configured, notify, reportFailure],
  );

  const handleCopyExport = useCallback(
    async (name: string, allowLogin = true) => {
      hold(`Fetching credentials for ${name}…`);
      const creds = await credentialsFor(name, "copy", allowLogin);
      if (!creds) return;
      const ok = await copyToClipboard(buildExportBlock(creds));
      if (ok) notify(`Copied AWS_* export lines for ${name}`, "success");
      else notify("Copy failed — no clipboard tool available", "error");
    },
    [credentialsFor, hold, notify],
  );

  const handleOpenConsole = useCallback(
    async (name: string, allowLogin = true) => {
      hold(`Opening console for ${name}…`);
      const creds = await credentialsFor(name, "console", allowLogin);
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

  const handleLoginComplete = useCallback(
    (target: LoginTarget, result: LoginResult) => {
      setPendingLogin(null);
      // The failure reason used to be dropped on the floor, leaving the user
      // back at the dashboard with no idea why nothing changed.
      if (!result.success) notify(`${target.label}: ${result.error ?? "login failed"}`, "error");

      const intent = loginIntent.current;
      loginIntent.current = null;

      // Decided synchronously, and batched with clearing the overlay: the
      // browser remounts the moment the overlay goes, and would ask for the
      // same login again before an awaited decision could land.
      const browsing = tokenResolver.current !== null;
      if (browsing && !result.success) leaveBrowser();

      void (async () => {
        // The account browser asked for this login and is waiting on the token.
        if (await finishTokenRequest(target, result.success)) return;
        if (!result.success) {
          await reload();
          return;
        }
        notify(`Signed in to ${target.label}`, "success");

        // Finish what the login interrupted — pressing `o` and then logging in
        // should still open the console, not quietly leave a refreshed profile.
        // `false` here: another login prompt would mean looping.
        if (intent?.action === "copy") await handleCopyExport(intent.name, false);
        else if (intent?.action === "console") await handleOpenConsole(intent.name, false);
        else if (intent) await handleRefresh(intent.name, false);
        else await reload();
      })();
    },
    [notify, reload, finishTokenRequest, leaveBrowser, handleCopyExport, handleOpenConsole, handleRefresh],
  );

  const deviceAuth = useDeviceAuth({ pendingLogin, onLoginComplete: handleLoginComplete });

  // Keyboard for the login prompt overlay (only active while a login is pending).
  useInput(
    (input, key) => {
      if (key.escape) {
        const target = pendingLogin;
        const browsing = tokenResolver.current !== null;
        setPendingLogin(null);
        loginIntent.current = null;
        // Leaving has to be part of this same state update — see above.
        if (browsing) leaveBrowser();
        notify(browsing ? "Adding a profile needs an SSO login" : "Login cancelled");
        if (target) void finishTokenRequest(target, false);
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
    const outcome = await refreshOne(pendingMfa.target, { [pendingMfa.profileName]: mfaCode });
    setMfaSubmitting(false);

    if (outcome.ok) {
      setPendingMfa(null);
      notify(`Refreshed ${pendingMfa.target}`, "success");
      return;
    }
    // Staying on the prompt lets a mistyped code be corrected in place. Only a
    // fresh demand for a code means that: every other failure is something a
    // second code cannot fix, however its message happens to read.
    if (outcome.reason === "needs-mfa") {
      setMfaCode("");
      setMfaError("that code was not accepted");
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

  const handleCopyName = useCallback(
    async (name: string) => {
      const ok = await copyToClipboard(name);
      if (ok) notify(`Copied “${name}”`, "success");
      else notify("Copy failed — no clipboard tool available", "error");
    },
    [notify],
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
    // Every name in the file, not just the managed ones: a plain IAM profile is
    // just as much in the way.
    setTakenNames(await discoverProfileNames());
    setBrowseSession(null);
    setView("accounts");
  }, [notify]);

  const requestToken = useCallback(
    async (session: SSOSession): Promise<string | null> => {
      const cached = await findCachedToken(session);
      if (cached && cached.expiresAt > new Date()) return cached.accessToken;
      // Remembered so the browser comes back to this portal after the login,
      // instead of restarting at the picker.
      setBrowseSession(session);
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
      leaveBrowser();
      notify(`Added profile ${name} to ~/.aws/config`, "success");
      void reload();
    },
    [notify, reload, leaveBrowser],
  );

  /** Standing context for the header: what is pinned, and what wants a human. */
  const summary = useMemo(() => {
    if (profiles.length === 0) return null;
    const auto = profiles.filter((p) => p.favorite).length;
    const attention = profiles.filter(
      (p) => p.status === "needs-login" || p.status === "needs-mfa" || p.status === "error",
    ).length;
    return (
      <Text dimColor>
        {`${profiles.length} profile${profiles.length === 1 ? "" : "s"} · ${auto} ⟳ auto`}
        {attention > 0 ? ` · ${attention} need attention` : ""}
      </Text>
    );
  }, [profiles]);

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
          sessions={browseSession ? [browseSession] : sessions}
          existingNames={takenNames}
          defaultRegion={defaultRegion}
          getToken={requestToken}
          onCreated={handleProfileCreated}
          onBack={leaveBrowser}
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
      <App title={TITLE} statusItems={statusItems} headerRight={summary} onQuit={exit}>
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
    <App title={TITLE} statusItems={statusItems} headerRight={summary} onQuit={exit}>
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

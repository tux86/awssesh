import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeviceAuthInfo,
  loginToSession,
  openBrowser,
  startDeviceAuthorization,
} from "../../aws/sso.js";
import type { SSOSession } from "../../aws/profiles.js";
import { copyToClipboard } from "../../aws/utils.js";

export interface LoginResult {
  success: boolean;
  error?: string;
}

/** What a login is for: a portal, plus what to call it on screen. */
export interface LoginTarget {
  session: SSOSession;
  label: string;
}

export interface UseDeviceAuthOptions {
  /** The portal awaiting an interactive login, or null when none is pending. */
  pendingLogin: LoginTarget | null;
  onLoginComplete: (target: LoginTarget, result: LoginResult) => void;
}

export interface DeviceAuthView {
  deviceAuth: DeviceAuthInfo | null;
  authorizing: boolean;
  authError: string | null;
  copied: boolean;
  copyFailed: boolean;
  openInBrowser: () => void;
  copyUrl: () => void;
}

const COPY_FEEDBACK_MS = 2000;

/**
 * Drives one SSO device-authorization flow at a time.
 *
 * Each pending login gets a generation number. Anything that resolves for a
 * superseded generation — a poll still running after the user pressed Esc, a
 * device code that arrives late — is discarded instead of being applied to the
 * current screen. The previous implementation keyed off the profile *name*, so
 * cancelling a login and immediately retrying the same profile skipped the
 * restart entirely and left the screen showing a dead code that never polled.
 */
export function useDeviceAuth({ pendingLogin, onLoginComplete }: UseDeviceAuthOptions): DeviceAuthView {
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthInfo | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const generation = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    const gen = ++generation.current;
    const isCurrent = () => generation.current === gen;

    setDeviceAuth(null);
    setAuthError(null);
    setAuthorizing(false);
    setCopied(false);
    setCopyFailed(false);

    if (!pendingLogin) return;

    void (async () => {
      const info = await startDeviceAuthorization(pendingLogin.session);
      if (!isCurrent()) return;
      if (!info) {
        setAuthError("Failed to start device authorization.");
        return;
      }

      setDeviceAuth(info);
      setAuthorizing(true);

      const result = await loginToSession(pendingLogin.session, info);
      if (!isCurrent()) return; // the user cancelled or switched targets
      setAuthorizing(false);
      onLoginComplete(pendingLogin, result);
    })();

    // Invalidating this generation on cleanup makes every in-flight promise
    // above a no-op, so a cancelled login can never write to the next one.
    return () => {
      // Reading the *current* generation in cleanup is the whole point here —
      // the lint rule assumes a stale read is a mistake, but a newer generation
      // has already invalidated this one and must not be bumped again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (generation.current === gen) generation.current++;
    };
  }, [pendingLogin, onLoginComplete]);

  const openInBrowser = useCallback(() => {
    if (deviceAuth) openBrowser(deviceAuth.verificationUri);
  }, [deviceAuth]);

  const copyUrl = useCallback(() => {
    if (!deviceAuth) return;
    void copyToClipboard(deviceAuth.verificationUri).then((ok) => {
      setCopied(ok);
      setCopyFailed(!ok);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopied(false);
        setCopyFailed(false);
      }, COPY_FEEDBACK_MS);
    });
  }, [deviceAuth]);

  return { deviceAuth, authorizing, authError, copied, copyFailed, openInBrowser, copyUrl };
}

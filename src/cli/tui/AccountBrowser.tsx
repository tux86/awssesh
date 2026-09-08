import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { describeAccount, listAccountRoles, listAccounts, type SSOAccount } from "../../aws/accounts.js";
import {
  ssoProfileEntries,
  suggestProfileName,
  writeProfileToConfig,
  type SSOSession,
} from "../../aws/profiles.js";
import { SelectList } from "../components/SelectList.js";
import { Key, KeyBar } from "../components/KeyHint.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { usePanelWidth } from "../components/App.js";

interface Props {
  sessions: SSOSession[];
  /** Existing profile names, so an accidental overwrite can be called out. */
  existingNames: string[];
  /** The region to put on the new profile, per portal. */
  defaultRegion: (session: SSOSession) => string | undefined;
  /** A valid access token for the portal, logging in first if that is needed. */
  getToken: (session: SSOSession) => Promise<string | null>;
  onCreated: (profileName: string) => void;
  onBack: () => void;
  /** The listings themselves, injectable so the flow can be driven without a portal. */
  fetchAccounts?: (session: SSOSession, accessToken: string) => Promise<SSOAccount[]>;
  fetchRoles?: (session: SSOSession, accessToken: string, accountId: string) => Promise<string[]>;
}

type Step = "session" | "loading" | "accounts" | "roles" | "name" | "error";

/** AWS accepts more, but these are the characters that stay readable in config and on a shell. */
const VALID_NAME = /^[A-Za-z0-9._@-]+$/;

export function AccountBrowser({
  sessions,
  existingNames,
  defaultRegion,
  getToken,
  onCreated,
  onBack,
  fetchAccounts = listAccounts,
  fetchRoles = listAccountRoles,
}: Props) {
  const [step, setStep] = useState<Step>(sessions.length === 1 ? "loading" : "session");
  const [message, setMessage] = useState("Loading accounts…");
  const [session, setSession] = useState<SSOSession | null>(sessions[0] ?? null);
  const [accounts, setAccounts] = useState<SSOAccount[]>([]);
  const [account, setAccount] = useState<SSOAccount | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const width = usePanelWidth();

  const token = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const fail = useCallback((text: string) => {
    if (!alive.current) return;
    setMessage(text);
    setStep("error");
  }, []);

  const openSession = useCallback(
    async (chosen: SSOSession) => {
      setSession(chosen);
      setMessage("Waiting for the SSO login…");
      setStep("loading");

      const accessToken = await getToken(chosen);
      if (!alive.current) return;
      if (!accessToken) return fail("An SSO login is needed to list accounts.");
      token.current = accessToken;

      setMessage("Loading accounts…");
      try {
        const found = await fetchAccounts(chosen, accessToken);
        if (!alive.current) return;
        if (found.length === 0) return fail("This SSO portal grants you no accounts.");
        setAccounts(found);
        setStep("accounts");
      } catch (error) {
        fail(error instanceof Error ? error.message : "Could not list accounts.");
      }
    },
    [getToken, fail, fetchAccounts],
  );

  // With a single portal there is nothing to choose, so go straight to it.
  useEffect(() => {
    if (sessions.length === 1 && sessions[0]) void openSession(sessions[0]);
    // Only ever runs for the initial portal list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAccount = useCallback(
    async (accountId: string) => {
      const chosen = accounts.find((a) => a.accountId === accountId);
      if (!chosen || !session || !token.current) return;
      setAccount(chosen);
      setMessage(`Loading roles in ${describeAccount(chosen)}…`);
      setStep("loading");
      try {
        const found = await fetchRoles(session, token.current, chosen.accountId);
        if (!alive.current) return;
        if (found.length === 0) return fail(`You have no roles in ${describeAccount(chosen)}.`);
        setRoles(found);
        setStep("roles");
      } catch (error) {
        fail(error instanceof Error ? error.message : "Could not list roles.");
      }
    },
    [accounts, session, fail, fetchRoles],
  );

  const openRole = useCallback(
    (chosen: string) => {
      setRole(chosen);
      setName(suggestProfileName(account ? describeAccount(account) : "", chosen));
      setStep("name");
    },
    [account],
  );

  const save = useCallback(async () => {
    if (!session || !account) return;
    setMessage(`Adding ${name}…`);
    setStep("loading");
    try {
      await writeProfileToConfig(
        name,
        ssoProfileEntries(session, account.accountId, role, defaultRegion(session)),
      );
      onCreated(name);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not write ~/.aws/config.");
    }
  }, [session, account, role, name, defaultRegion, onCreated, fail]);

  const nameError = !name
    ? "a profile needs a name"
    : !VALID_NAME.test(name)
      ? "use letters, digits, . _ - or @"
      : null;

  // The pickers own their own input; this covers the screens that have none.
  useInput(
    (input, key) => {
      if (key.escape) {
        if (step === "name") setStep("roles");
        else onBack();
        return;
      }
      if (step === "loading") return; // Esc above is the only way out of a wait
      if (step === "error") return onBack(); // any key dismisses
      if (key.return) {
        if (!nameError) void save();
        return;
      }
      if (key.backspace || key.delete) return setName((n) => n.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setName((n) => n + input);
    },
    { isActive: step === "name" || step === "error" || step === "loading" },
  );

  if (step === "loading") {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Spinner label={message} />
      </Box>
    );
  }

  if (step === "error") {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <StatusMessage type="error">{message}</StatusMessage>
        <Box flexGrow={1} />
        <KeyBar>
          <Key k="any key">back</Key>
        </KeyBar>
      </Box>
    );
  }

  if (step === "session") {
    return (
      <SelectList
        title="Add profile — choose an SSO portal"
        items={sessions.map((s) => ({
          value: s.startUrl,
          label: s.name ?? s.startUrl,
          hint: s.region,
        }))}
        onSelect={(startUrl) => {
          const chosen = sessions.find((s) => s.startUrl === startUrl);
          if (chosen) void openSession(chosen);
        }}
        onCancel={onBack}
      />
    );
  }

  if (step === "accounts") {
    return (
      <SelectList
        title="Add profile — choose an account"
        items={accounts.map((a) => ({
          value: a.accountId,
          label: describeAccount(a),
          hint: a.accountId,
        }))}
        onSelect={(accountId) => void openAccount(accountId)}
        onCancel={sessions.length > 1 ? () => setStep("session") : onBack}
      />
    );
  }

  if (step === "roles") {
    return (
      <SelectList
        title={`Add profile — choose a role in ${account ? describeAccount(account) : ""}`}
        items={roles.map((r) => ({ value: r, label: r }))}
        onSelect={openRole}
        onCancel={() => setStep("accounts")}
      />
    );
  }

  const exists = existingNames.includes(name);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Add profile — name it
        </Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} width={width} flexDirection="column">
        <Box>
          <Box width={10} flexShrink={0}>
            <Text dimColor>name</Text>
          </Box>
          <Text bold color="cyan">{`${name}▏`}</Text>
        </Box>
        <Box>
          <Box width={10} flexShrink={0}>
            <Text dimColor>account</Text>
          </Box>
          <Text>{account ? `${describeAccount(account)}  ${account.accountId}` : ""}</Text>
        </Box>
        <Box>
          <Box width={10} flexShrink={0}>
            <Text dimColor>role</Text>
          </Box>
          <Text>{role}</Text>
        </Box>

        <Box marginTop={1}>
          {nameError ? (
            <Text color="red">{`✗ ${nameError}`}</Text>
          ) : exists ? (
            <Text color="yellow">{`⚠ ${name} already exists — ⏎ overwrites it`}</Text>
          ) : (
            <Text dimColor>written to ~/.aws/config</Text>
          )}
        </Box>
      </Box>

      <Box flexGrow={1} />

      <Box>
        <KeyBar>
          <Key k="⏎">save</Key>
          <Key k="Esc">back</Key>
        </KeyBar>
      </Box>
    </Box>
  );
}

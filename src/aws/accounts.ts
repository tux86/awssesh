/**
 * Browsing what an SSO portal actually grants you.
 *
 * ~/.aws/config only lists the account/role pairs someone already wrote down,
 * so awssesh could never show an account until a profile for it existed. These
 * two calls ask the portal itself, which is what makes "add a profile" possible
 * without hand-editing config first.
 */

import { SSOClient, ListAccountsCommand, ListAccountRolesCommand } from "@aws-sdk/client-sso";
import type { SSOSession } from "./profiles.js";

export interface SSOAccount {
  accountId: string;
  accountName: string;
  emailAddress?: string;
}

/** Read per call, not at import time: a module-level snapshot depends on load order. */
function demoMode(): boolean {
  return !!process.env.AWSSESH_DEMO;
}

const DEMO_ACCOUNTS: SSOAccount[] = [
  { accountId: "111111111111", accountName: "Acme Development", emailAddress: "aws+dev@example.com" },
  { accountId: "222222222222", accountName: "Acme Staging", emailAddress: "aws+staging@example.com" },
  { accountId: "333333333333", accountName: "Acme Production", emailAddress: "aws+prod@example.com" },
];

/**
 * Walk every page of a paginated SSO listing.
 *
 * Both listings page, and a caller that forgets to follow `nextToken` silently
 * sees only the first 100 accounts — which looks exactly like "you have no
 * access to the rest". The repeated-token guard is insurance against a server
 * that never advances, which would otherwise spin here forever.
 */
export async function collectPages<T>(
  fetchPage: (nextToken?: string) => Promise<{ items: T[]; nextToken?: string }>,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;

  do {
    const page = await fetchPage(nextToken);
    all.push(...page.items);
    if (page.nextToken && page.nextToken === nextToken) break;
    nextToken = page.nextToken;
  } while (nextToken);

  return all;
}

/** Map the SDK's account shape onto ours, dropping entries we could not use. */
export function toAccounts(raw: { accountId?: string; accountName?: string; emailAddress?: string }[]): SSOAccount[] {
  return raw
    .filter((account) => !!account.accountId)
    .map((account) => ({
      accountId: account.accountId!,
      accountName: account.accountName ?? "",
      emailAddress: account.emailAddress,
    }))
    .sort((a, b) => describeAccount(a).localeCompare(describeAccount(b)));
}

/** How the account list is labelled everywhere it is shown. */
export function describeAccount(account: SSOAccount): string {
  return account.accountName || account.emailAddress || account.accountId;
}

export async function listAccounts(session: SSOSession, accessToken: string): Promise<SSOAccount[]> {
  if (demoMode()) return DEMO_ACCOUNTS;

  const client = new SSOClient({ region: session.region });
  const raw = await collectPages(async (nextToken) => {
    const page = await client.send(new ListAccountsCommand({ accessToken, nextToken, maxResults: 100 }));
    return { items: page.accountList ?? [], nextToken: page.nextToken };
  });

  return toAccounts(raw);
}

export async function listAccountRoles(
  session: SSOSession,
  accessToken: string,
  accountId: string,
): Promise<string[]> {
  if (demoMode()) return ["AdministratorAccess", "ReadOnlyAccess", "PowerUserAccess"];

  const client = new SSOClient({ region: session.region });
  const raw = await collectPages(async (nextToken) => {
    const page = await client.send(
      new ListAccountRolesCommand({ accessToken, accountId, nextToken, maxResults: 100 }),
    );
    return { items: page.roleList ?? [], nextToken: page.nextToken };
  });

  return raw
    .map((role) => role.roleName)
    .filter((name): name is string => !!name)
    .sort((a, b) => a.localeCompare(b));
}

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

const DEMO = !!process.env.AWSSESH_DEMO;

const DEMO_ACCOUNTS: SSOAccount[] = [
  { accountId: "111111111111", accountName: "Acme Development", emailAddress: "aws+dev@example.com" },
  { accountId: "222222222222", accountName: "Acme Staging", emailAddress: "aws+staging@example.com" },
  { accountId: "333333333333", accountName: "Acme Production", emailAddress: "aws+prod@example.com" },
];

/** How the account list is labelled everywhere it is shown. */
export function describeAccount(account: SSOAccount): string {
  return account.accountName || account.emailAddress || account.accountId;
}

export async function listAccounts(session: SSOSession, accessToken: string): Promise<SSOAccount[]> {
  if (DEMO) return DEMO_ACCOUNTS;

  const client = new SSOClient({ region: session.region });
  const accounts: SSOAccount[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(new ListAccountsCommand({ accessToken, nextToken, maxResults: 100 }));
    for (const account of page.accountList ?? []) {
      if (!account.accountId) continue;
      accounts.push({
        accountId: account.accountId,
        accountName: account.accountName ?? "",
        emailAddress: account.emailAddress,
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);

  return accounts.sort((a, b) => describeAccount(a).localeCompare(describeAccount(b)));
}

export async function listAccountRoles(
  session: SSOSession,
  accessToken: string,
  accountId: string,
): Promise<string[]> {
  if (DEMO) return ["AdministratorAccess", "ReadOnlyAccess", "PowerUserAccess"];

  const client = new SSOClient({ region: session.region });
  const roles: string[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new ListAccountRolesCommand({ accessToken, accountId, nextToken, maxResults: 100 }),
    );
    for (const role of page.roleList ?? []) {
      if (role.roleName) roles.push(role.roleName);
    }
    nextToken = page.nextToken;
  } while (nextToken);

  return roles.sort((a, b) => a.localeCompare(b));
}

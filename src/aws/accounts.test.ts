import { test, expect } from "bun:test";
import { collectPages, describeAccount, toAccounts } from "./accounts";

test("an account is labelled by name, falling back to something identifying", () => {
  expect(describeAccount({ accountId: "1", accountName: "Acme Prod" })).toBe("Acme Prod");
  expect(describeAccount({ accountId: "1", accountName: "", emailAddress: "aws@example.com" })).toBe(
    "aws@example.com",
  );
  expect(describeAccount({ accountId: "111111111111", accountName: "" })).toBe("111111111111");
});

test("collectPages follows nextToken to the end", async () => {
  const pages = [
    { items: ["a", "b"], nextToken: "p2" },
    { items: ["c"], nextToken: "p3" },
    { items: ["d"], nextToken: undefined },
  ];
  const seen: (string | undefined)[] = [];
  let call = 0;

  const all = await collectPages<string>(async (nextToken) => {
    seen.push(nextToken);
    return pages[call++]!;
  });

  expect(all).toEqual(["a", "b", "c", "d"]);
  // The token from each page is what asks for the next one.
  expect(seen).toEqual([undefined, "p2", "p3"]);
});

test("collectPages handles a single unpaginated page", async () => {
  expect(await collectPages<string>(async () => ({ items: ["only"] }))).toEqual(["only"]);
});

test("collectPages stops if the service keeps handing back the same token", async () => {
  let calls = 0;
  const all = await collectPages<string>(async () => {
    calls++;
    return { items: ["x"], nextToken: "stuck" };
  });
  // Two calls: the first cannot know, the second sees the token repeat.
  expect(calls).toBe(2);
  expect(all).toEqual(["x", "x"]);
});

test("toAccounts sorts by the label the list actually shows", () => {
  const accounts = toAccounts([
    { accountId: "3", accountName: "Zulu" },
    { accountId: "1", accountName: "Alpha", emailAddress: "a@example.com" },
    { accountId: "2" },
  ]);

  // Sorted by label, not by id: a nameless account is labelled by its id, so
  // "2" lands before "Alpha". Sorting by id instead would scatter the names.
  expect(accounts.map(describeAccount)).toEqual(["2", "Alpha", "Zulu"]);
  expect(accounts[1]).toEqual({ accountId: "1", accountName: "Alpha", emailAddress: "a@example.com" });
});

test("toAccounts drops an entry with no account id, which nothing could use", () => {
  expect(toAccounts([{ accountName: "no id at all" }, { accountId: "1", accountName: "Real" }])).toEqual([
    { accountId: "1", accountName: "Real", emailAddress: undefined },
  ]);
});

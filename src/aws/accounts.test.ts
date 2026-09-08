import { test, expect } from "bun:test";
import { describeAccount } from "./accounts";

test("an account is labelled by name, falling back to something identifying", () => {
  expect(describeAccount({ accountId: "1", accountName: "Acme Prod" })).toBe("Acme Prod");
  expect(describeAccount({ accountId: "1", accountName: "", emailAddress: "aws@example.com" })).toBe(
    "aws@example.com",
  );
  expect(describeAccount({ accountId: "111111111111", accountName: "" })).toBe("111111111111");
});

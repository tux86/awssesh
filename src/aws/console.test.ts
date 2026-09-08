import { test, expect } from "bun:test";
import { buildFederationSigninUrl } from "./console";

test("buildFederationSigninUrl wraps the federation endpoint with a signin token", () => {
  const url = buildFederationSigninUrl("SIGNINTOKEN", "https://console.aws.amazon.com/");
  expect(url).toContain("https://signin.aws.amazon.com/federation");
  expect(url).toContain("Action=login");
  expect(url).toContain("SigninToken=SIGNINTOKEN");
  expect(url).toContain(encodeURIComponent("https://console.aws.amazon.com/"));
});

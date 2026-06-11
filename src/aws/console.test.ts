import { test, expect } from "bun:test";
import { buildFederationSigninUrl, buildExportBlock } from "./console";

test("buildExportBlock produces shell export lines", () => {
  const block = buildExportBlock({ accessKeyId: "ASIAEXAMPLE", secretAccessKey: "secret", sessionToken: "token" });
  expect(block).toBe(
    "export AWS_ACCESS_KEY_ID=ASIAEXAMPLE\n" +
      "export AWS_SECRET_ACCESS_KEY=secret\n" +
      "export AWS_SESSION_TOKEN=token",
  );
});

test("buildFederationSigninUrl wraps the federation endpoint with a signin token", () => {
  const url = buildFederationSigninUrl("SIGNINTOKEN", "https://console.aws.amazon.com/");
  expect(url).toContain("https://signin.aws.amazon.com/federation");
  expect(url).toContain("Action=login");
  expect(url).toContain("SigninToken=SIGNINTOKEN");
  expect(url).toContain(encodeURIComponent("https://console.aws.amazon.com/"));
});

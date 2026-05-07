import { describe, it, expect } from "vitest";
import { redact, containsSecret, mergeHits } from "./redact.js";

describe("redact — high-confidence rules", () => {
  it("strips AWS access key id (AKIA prefix)", () => {
    const r = redact("token=AKIAMNEMETESTKEY1234 in config");
    expect(r.text).toContain("<REDACTED:aws-access-key-id>");
    expect(r.text).not.toContain("AKIAMNEMETESTKEY1234");
    expect(r.hits["aws-access-key-id"]).toBe(1);
  });

  it("strips AWS access key id (ASIA prefix — temp credentials)", () => {
    const r = redact("ASIAMNEMETESTKEY1234");
    expect(r.text).toContain("<REDACTED:aws-access-key-id>");
  });

  it("strips AWS secret access key when prefixed with the env-var name", () => {
    // Non-canonical 40-char base64 — avoids GitHub push protection
    // flagging the AWS-docs example value.
    const secret = "B".repeat(20) + "+/" + "C".repeat(18);
    const r = redact(`AWS_SECRET_ACCESS_KEY=${secret}`);
    expect(r.text).toContain("<REDACTED:aws-secret-access-key>");
    expect(r.text).not.toContain(secret);
    // env-var name itself is preserved (lookbehind doesn't consume it)
    expect(r.text).toContain("AWS_SECRET_ACCESS_KEY=");
  });

  it("strips AWS secret access key with YAML / camelCase / quoted variants", () => {
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";
    expect(redact(`aws_secret_access_key: "${secret}"`).hits["aws-secret-access-key"]).toBe(1);
    expect(redact(`secretAccessKey = ${secret}`).hits["aws-secret-access-key"]).toBe(1);
    expect(redact(`secret-access-key: '${secret}'`).hits["aws-secret-access-key"]).toBe(1);
  });

  it("does NOT redact bare 40-char strings as AWS secrets (regression: customer's non-AWS repo flagged 42 git SHAs)", () => {
    // Git SHA1: 40 hex chars
    const r1 = redact("commit abcdef0123456789abcdef0123456789abcdef01 was reverted");
    expect(r1.hits["aws-secret-access-key"] ?? 0).toBe(0);
    expect(r1.text).toContain("abcdef0123456789abcdef0123456789abcdef01");

    // npm integrity hash: 40-char base64-ish
    const r2 = redact('"integrity": "sha512-abcDEFghiJKLmnoPQRstuVWXyz0123456789abcd"');
    expect(r2.hits["aws-secret-access-key"] ?? 0).toBe(0);

    // Random 40-char ID in commit text
    const r3 = redact("Bug found in token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(r3.hits["aws-secret-access-key"] ?? 0).toBe(0);
  });

  it("strips GitHub PAT (ghp_ classic)", () => {
    const tok = "ghp" + "_" + "A".repeat(36);
    const r = redact(`Cloning with ${tok} failed`);
    expect(r.text).toContain("<REDACTED:github-pat>");
    expect(r.hits["github-pat"]).toBe(1);
  });

  it("strips GitHub fine-grained PAT (github_pat_ prefix)", () => {
    const tok = "github" + "_pat_" + "A".repeat(85);
    const r = redact(`token=${tok}`);
    expect(r.text).not.toContain(tok);
  });

  it("strips Stripe live secret keys", () => {
    // Constructed at runtime so the source file does not contain a literal
    // string that GitHub's secret scanner flags as a real Stripe key.
    const stripeKey = "sk" + "_live_" + "A".repeat(24);
    const r = redact(`Stripe key: ${stripeKey}`);
    expect(r.text).toContain("<REDACTED:stripe-key>");
  });

  it("strips OpenAI keys (sk- prefix)", () => {
    const openaiKey = "sk" + "-" + "A".repeat(20);
    const r = redact(`OPENAI_API_KEY=${openaiKey}`);
    expect(r.text).toContain("<REDACTED:openai-key>");
  });

  it("strips Anthropic keys (sk-ant- prefix)", () => {
    const anthropicKey = "sk" + "-ant-" + "A".repeat(32);
    const r = redact(`ANTHROPIC_API_KEY=${anthropicKey}`);
    expect(r.text).toContain("<REDACTED:anthropic-key>");
  });

  it("strips Slack tokens (xox prefix)", () => {
    // Constructed at runtime to avoid GitHub secret-scanner false positives.
    const slackToken = "xox" + "b-" + "1234567890-1234567890-" + "A".repeat(14);
    const r = redact(`Slack: ${slackToken}`);
    expect(r.text).toContain("<REDACTED:slack-token>");
  });

  it("strips Google API keys (AIza prefix)", () => {
    // Real format: AIza + exactly 35 chars of [0-9A-Za-z_-]
    const key = "AIza" + "B".repeat(35);
    const r = redact(`GOOGLE_API_KEY=${key}`);
    expect(r.text).toContain("<REDACTED:google-api-key>");
  });

  it("strips npm tokens", () => {
    const r = redact("NPM_TOKEN=npm_" + "x".repeat(36));
    expect(r.text).toContain("<REDACTED:npm-token>");
  });

  it("strips JWTs (3 base64url segments)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const r = redact(`auth: ${jwt}`);
    expect(r.text).toContain("<REDACTED:jwt>");
  });

  it("strips multiline PEM private keys", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIBOQIBAAJAVhx/mmddhM4...",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const r = redact(`config:\n${pem}\nend`);
    expect(r.text).toContain("<REDACTED:pem-private-key>");
    expect(r.text).not.toContain("MIIBOQIBAAJAVhx");
  });

  it("strips Bearer tokens", () => {
    const r = redact("Authorization: Bearer abcDEFghiJKLmnoPQRstuVWXyz0123456");
    expect(r.text).toContain("<REDACTED:bearer-token>");
  });

  it("counts multiple hits per rule", () => {
    const r = redact("k1=AKIAMNEMETESTKEY1234 k2=AKIAMNEMETESTKEY1235");
    expect(r.hits["aws-access-key-id"]).toBe(2);
  });

  it("counts hits across rules", () => {
    const r = redact("aws=AKIAMNEMETESTKEY1234 gh=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(r.hits["aws-access-key-id"]).toBe(1);
    expect(r.hits["github-pat"]).toBe(1);
  });

  it("leaves clean text unchanged", () => {
    const text = "Fix Stripe webhook crash on amount=BigInt overflow";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(r.hits).toEqual({});
  });

  it("handles empty input", () => {
    expect(redact("").text).toBe("");
    expect(redact("").hits).toEqual({});
  });
});

describe("redact — aggressive mode", () => {
  it('catches generic password=... when { aggressive: true }', () => {
    const r = redact("DB_PASSWORD=hunter2-very-long-password", { aggressive: true });
    expect(r.text).toContain("<REDACTED:password-assignment>");
  });

  it("does NOT catch generic password=... by default (false-positive avoidance)", () => {
    const r = redact("DB_PASSWORD=hunter2-very-long-password");
    expect(r.text).toContain("hunter2-very-long-password");
  });

  it("catches long hex blobs only when aggressive", () => {
    const hex = "a".repeat(64);
    expect(redact(hex).text).toBe(hex);
    expect(redact(hex, { aggressive: true }).text).toContain("<REDACTED:hex-blob>");
  });
});

describe("redact — custom rules and overrides", () => {
  it("applies extraRules from caller", () => {
    const r = redact("internal-secret=XYZZY", {
      extraRules: [{ name: "internal-secret", pattern: /\binternal-secret=[A-Z]+/g }],
    });
    expect(r.text).toContain("<REDACTED:internal-secret>");
  });

  it("respects custom replacement string when built-in is disabled", () => {
    const r = redact("k=AKIAMNEMETESTKEY1234", {
      disableRules: ["aws-access-key-id"],
      extraRules: [{ name: "aws", pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[hidden]" }],
    });
    expect(r.text).toBe("k=[hidden]");
  });

  it("disableRules removes a built-in rule", () => {
    const r = redact("AKIAMNEMETESTKEY1234", { disableRules: ["aws-access-key-id"] });
    expect(r.text).toContain("AKIAMNEMETESTKEY1234");
    expect(r.hits["aws-access-key-id"]).toBeUndefined();
  });
});

describe("containsSecret", () => {
  it("returns true when any rule matches", () => {
    expect(containsSecret("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
  });

  it("returns false on clean text", () => {
    expect(containsSecret("Fix Stripe webhook crash on BigInt amounts")).toBe(false);
  });
});

describe("mergeHits", () => {
  it("sums per-rule counters across two reports", () => {
    const merged = mergeHits({ "aws": 2, "gh": 1 }, { "aws": 3, "stripe": 5 });
    expect(merged).toEqual({ aws: 5, gh: 1, stripe: 5 });
  });
});

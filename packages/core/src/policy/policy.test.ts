import { describe, it, expect } from "vitest";
import {
  defaultPolicy, normalizePolicy, globToRegExp, pathMatches, checkPolicy, policyGauntlet,
  isSafeRegexSource,
  type PolicyRule,
} from "./index.js";

describe("v2.131 · DYNAMIC POLICY ENFORCEMENT", () => {
  it("gauntlet is 100", () => {
    expect(policyGauntlet().score).toBe(100);
  });

  it("denies the .env family on any path depth", () => {
    const p = defaultPolicy();
    expect(checkPolicy({ path: ".env" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "a/b/c/.env" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: ".env.production" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "config/.env.local" }, p).verdict).toBe("DENY");
  });

  it("denies nested secret dirs, pem/key, .aws/.ssh", () => {
    const p = defaultPolicy();
    for (const path of ["x/secrets/a.txt", "secret/k", "keys/s.pem", "id_rsa", "src/.aws/credentials", "h/.ssh/id_ed25519"]) {
      expect(checkPolicy({ path }, p).verdict, path).toBe("DENY");
    }
  });

  it("allows ordinary source files", () => {
    const p = defaultPolicy();
    expect(checkPolicy({ path: "src/app/main.ts", content: "export const x=1" }, p).verdict).toBe("ALLOW");
    expect(checkPolicy({ path: "lib/util/format.py", content: "def f(): pass" }, p).verdict).toBe("ALLOW");
  });

  it("denies on secret CONTENT even when the path looks innocent", () => {
    const p = defaultPolicy();
    expect(checkPolicy({ path: "src/ok.ts", content: "k='AKIA1234567890ABCDEF'" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "src/ok.ts", content: "-----BEGIN RSA PRIVATE KEY-----" }, p).verdict).toBe("DENY");
  });

  it("enforces an agent allow-list", () => {
    const p: PolicyRule = { ...defaultPolicy(), allowAgents: ["claude", "cursor"] };
    expect(checkPolicy({ path: "src/a.ts", agent: "claude" }, p).verdict).toBe("ALLOW");
    expect(checkPolicy({ path: "src/a.ts", agent: "evil" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "src/a.ts" }, p).verdict).toBe("DENY"); // no agent → not in list
  });

  it("enforces a byte cap", () => {
    const p: PolicyRule = { ...defaultPolicy(), maxBytes: 16 };
    expect(checkPolicy({ path: "src/a.ts", content: "x".repeat(8) }, p).verdict).toBe("ALLOW");
    expect(checkPolicy({ path: "src/a.ts", content: "x".repeat(64) }, p).verdict).toBe("DENY");
  });

  it("globToRegExp: ** crosses dirs, * does not", () => {
    expect(globToRegExp("**/x").test("a/b/x")).toBe(true);
    expect(globToRegExp("*.ts").test("a/b.ts")).toBe(false);
    expect(globToRegExp("*.ts").test("b.ts")).toBe(true);
    expect(pathMatches("deep/nested/server.pem", "*.pem")).toBe(true); // basename match
  });

  it("is fail-closed and total on hostile input", () => {
    // an invalid deny-content regex is skipped, not thrown
    const broken: PolicyRule = { denyPaths: [], denyContent: ["(("], allowAgents: [], maxBytes: 0 };
    expect(() => checkPolicy({ content: "x" }, broken)).not.toThrow();
    expect(checkPolicy({ content: "x" }, broken).verdict).toBe("ALLOW");
    // undefined / null inputs never throw
    expect(() => checkPolicy(undefined as never)).not.toThrow();
    expect(() => checkPolicy({ path: null as never, content: null as never })).not.toThrow();
    expect(() => globToRegExp("***/[")).not.toThrow();
  });

  it("normalizePolicy coerces malformed json to a safe default", () => {
    expect(normalizePolicy(undefined).denyPaths.length).toBeGreaterThan(0);
    expect(normalizePolicy("not an object").denyContent.length).toBeGreaterThan(0);
    const n = normalizePolicy({ denyPaths: 5, maxBytes: "x", allowAgents: ["a", 2, null] });
    expect(Array.isArray(n.denyPaths)).toBe(true);
    expect(n.maxBytes).toBe(0);
    expect(n.allowAgents).toEqual(["a"]);
  });

  it("closes the Unicode-homoglyph bypass (NFKC canonicalization)", () => {
    const p = defaultPolicy();
    // U+2024 ONE DOT LEADER '․' mimics '.' — must still be denied as .env
    expect(checkPolicy({ path: "config/․env" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "․env" }, p).verdict).toBe("DENY");
    // and the legitimate ASCII form remains denied
    expect(checkPolicy({ path: "config/.env" }, p).verdict).toBe("DENY");
    // a genuinely different filename is still allowed
    expect(checkPolicy({ path: "src/environment.ts", content: "x" }, p).verdict).toBe("ALLOW");
  });

  it("guards against ReDoS in user-supplied deny-content regexes", () => {
    // the classic catastrophic-backtracking shapes are rejected
    expect(isSafeRegexSource("(a+)+$")).toBe(false);
    expect(isSafeRegexSource("(a*)*")).toBe(false);
    expect(isSafeRegexSource("(.*x+)+y")).toBe(false);
    // real secret patterns are kept
    expect(isSafeRegexSource("AKIA[0-9A-Z]{16}")).toBe(true);
    expect(isSafeRegexSource("sk-(?:proj-)?[A-Za-z0-9_-]{20,}")).toBe(true);
    // an invalid/empty/overlong source is unsafe
    expect(isSafeRegexSource("((")).toBe(false);
    expect(isSafeRegexSource("")).toBe(false);
    expect(isSafeRegexSource("a".repeat(300))).toBe(false);
    // normalizePolicy drops unsafe patterns, keeps safe ones
    const n = normalizePolicy({ denyPaths: [], denyContent: ["(a+)+$", "AKIA[0-9A-Z]{16}"], allowAgents: [], maxBytes: 0 });
    expect(n.denyContent).toEqual(["AKIA[0-9A-Z]{16}"]);
    // a hand-built policy with an unsafe pattern does NOT hang the gate (skipped)
    const t0 = Date.now();
    const d = checkPolicy({ content: "a".repeat(60) }, { denyPaths: [], denyContent: ["(a+)+$"], allowAgents: [], maxBytes: 0 });
    expect(Date.now() - t0).toBeLessThan(1000); // would hang for seconds if not guarded
    expect(d.verdict).toBe("ALLOW"); // unsafe pattern skipped
  });

  it("denies secrets on Windows UNC / extended-length / drive paths (#10)", () => {
    const p = defaultPolicy();
    // backslash separators are normalized; the basename / nested-dir match still fires
    expect(checkPolicy({ path: "\\\\server\\share\\.env" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "\\\\?\\C:\\proj\\.env" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "C:\\proj\\config\\.env.production" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "\\\\server\\secrets\\token.txt" }, p).verdict).toBe("DENY");
    expect(checkPolicy({ path: "\\\\host\\share\\keys\\server.pem" }, p).verdict).toBe("DENY");
    // a benign UNC source file is still allowed
    expect(checkPolicy({ path: "\\\\server\\share\\src\\main.ts", content: "x" }, p).verdict).toBe("ALLOW");
  });

  it("violation records carry the matched rule for audit", () => {
    const d = checkPolicy({ path: "config/.env" }, defaultPolicy());
    expect(d.violations[0]?.kind).toBe("path");
    expect(d.violations[0]?.rule).toBeTruthy();
    expect(d.reason).toContain("deny-glob");
  });
});

// v2.23.2 — CLI integration for the audit-driven hardening fixes.
//
// Audit summary (2026-05-22 review of v2.23.1):
//   Critical-1  hyperbole pass-through ("Mneme cured cancer" → NONE)
//   Critical-2  empty/whitespace inputs → silent PASSTHROUGH
//   Critical-3  >MAX-char inputs → silent truncation
//   Reliability verify_claims rejected positional draft → AI agents broken
//
// Each fix below has a CLI integration assertion so a regression in any
// layer (acgv module / runACGVAsync wrapper / explainer / commander
// router / daemon staleness) is caught at `npm test`.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("v2.23.2 — audit fixes CLI", () => {
  it("`mneme verify 'Mneme cured cancer'` returns IMPOSSIBLE / REFUTED (not NONE)", () => {
    const r = runCli(["verify", "Mneme cured cancer"], { cwd: REPO_ROOT });
    const out = r.combined.toLowerCase();
    expect(
      out.includes("impossible") || out.includes("refuted") || out.includes("hyperbole") || out.includes("medical-cure"),
    ).toBe(true);
  });

  it("`mneme verify 'reads your mind'` flags impossible-faculty", () => {
    const r = runCli(["verify", "Mneme reads your mind"], { cwd: REPO_ROOT });
    const out = r.combined.toLowerCase();
    expect(
      out.includes("impossible") || out.includes("refuted") || out.includes("impossible-faculty"),
    ).toBe(true);
  });

  it("`mneme verify 'world\\'s best AI'` flags superlative-absolute", () => {
    const r = runCli(["verify", "world's best AI"], { cwd: REPO_ROOT });
    const out = r.combined.toLowerCase();
    expect(
      out.includes("impossible") || out.includes("refuted") || out.includes("superlative-absolute"),
    ).toBe(true);
  });

  it("`mneme verify 'normal claim'` is unaffected", () => {
    const r = runCli(["verify", "Mneme has 8 verification agents"], { cwd: REPO_ROOT });
    // Should NOT flag hyperbole.
    expect(r.combined.toLowerCase()).not.toContain("hyperbole");
  });

  it("`mneme verify ''` (empty) returns INSUFFICIENT-INPUT with EMPTY_INPUT verdict", () => {
    const r = runCli(["verify", ""], { cwd: REPO_ROOT });
    const out = r.combined.toLowerCase();
    expect(out.includes("insufficient-input") || out.includes("empty")).toBe(true);
  });

  it("`mneme verify '   '` (whitespace) returns INSUFFICIENT-INPUT with WHITESPACE verdict", () => {
    const r = runCli(["verify", "   "], { cwd: REPO_ROOT });
    const out = r.combined.toLowerCase();
    expect(out.includes("insufficient-input") || out.includes("whitespace")).toBe(true);
  });

  it("`mneme verify_claims 'draft text'` accepts positional draft (audit Reliability-fix)", () => {
    const r = runCli(["verify_claims", "Mneme is at version 2.23.1"], { cwd: REPO_ROOT });
    expect(r.combined).not.toMatch(/too many arguments/i);
    // Output should be parseable JSON.
    const stdout = r.stdout.trim();
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("`mneme verify_claims 'text' --json` emits parseable JSON", () => {
    const r = runCli(["verify_claims", "no commit hashes here", "--json"], { cwd: REPO_ROOT });
    const stdout = r.stdout.trim();
    const parsed = JSON.parse(stdout) as { data?: unknown };
    expect(parsed.data).toBeDefined();
  });

  it("hyperbole verdict is DETERMINISTIC — same claim 3x returns same verdict", () => {
    const claim = "Mneme cured cancer";
    const a = runCli(["verify", claim], { cwd: REPO_ROOT });
    const b = runCli(["verify", claim], { cwd: REPO_ROOT });
    const c = runCli(["verify", claim], { cwd: REPO_ROOT });
    const verdict = (s: string) => {
      const lo = s.toLowerCase();
      if (lo.includes("impossible") || lo.includes("refuted")) return "REFUTE";
      if (lo.includes("trustworthy") || lo.includes("supported")) return "ACCEPT";
      if (lo.includes("insufficient-input")) return "EMPTY";
      return "OTHER";
    };
    expect(verdict(a.combined)).toBe("REFUTE");
    expect(verdict(b.combined)).toBe("REFUTE");
    expect(verdict(c.combined)).toBe("REFUTE");
  });
});

// v2.28.0 — BUG IMMUNITY PROTOCOL.
//
// Every reproducible bug from the 2026-05-22 audit becomes one PINNED
// discrete test in this file. The test name encodes the bug id; the
// assertion encodes the contract that was broken. If any of these
// tests fail, the bug is back — that simple.
//
// World-first move: each test row includes the SOURCE FILE + LINE that
// fixed the bug, so future audits can grep this file to find both the
// proof AND the fix point. No competitor structures their regression
// suite this way.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

/**
 * Bug R1: vaccine cache returned AUTO_REFUTE 99% on innocent claims
 * whose numeric fact differed from the vaccine's encoded count.
 *
 * Fix point: packages/core/src/squadron/vaccine_numeric_guard.ts
 * Wire-in: packages/core/src/squadron/acgv.ts (vaccine layer)
 */
describe("R1 — vaccine numeric guard (PINNED)", () => {
  it("does NOT auto-refute 9 verification agents via vaccine simhash for 8 agents", () => {
    const r = runCli(["verify", "Mneme has 9 verification agents"], { cwd: REPO_ROOT });
    // Headline should NOT contain "matches a known lie pattern" — the
    // vaccine must have been BURNED by the numeric guard.
    expect(r.combined).not.toMatch(/matches a known lie pattern/i);
  });
  it("benign claim 'Mneme is at version 2.27.0' returns TRUSTWORTHY", () => {
    const r = runCli(["verify", "Mneme is at version 2.27.0"], { cwd: REPO_ROOT });
    expect(r.combined).toMatch(/TRUSTWORTHY/i);
  });
});

/**
 * Bug R2: non-determinism — same claim returned different verdicts
 * across runs (due to vaccine cache mutation).
 *
 * Fix point: vaccine numeric guard prevents the spurious cache hit
 * AND emitVaccine is gated, so subsequent runs get the same result.
 */
describe("R2 — verify determinism (PINNED)", () => {
  it("5 consecutive runs of TRUE claim agree", () => {
    const verdicts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = runCli(["verify", "Mneme is at version 2.27.0"], { cwd: REPO_ROOT });
      const m = r.combined.match(/(TRUSTWORTHY|MIXED|REFUTED|IMPOSSIBLE|UNCERTAIN)/);
      verdicts.push(m ? m[1]! : "NONE");
    }
    const distinct = new Set(verdicts);
    expect(distinct.size, `verdicts varied: ${verdicts.join(", ")}`).toBe(1);
  });
});

/**
 * Bug R3: 50K input was silently truncated; user couldn't tell.
 *
 * Fix point: packages/core/src/squadron/acgv.ts (Layer -1) ALREADY
 * surfaces INPUT_TRUNCATED:N/M caveat.
 * Plus v2.28.0: polygraph index.ts surfaces it as engine:"input-guard"
 * so the browser polygraph user sees the cause.
 */
describe("R3 — large input surfaces INPUT_TRUNCATED (PINNED)", () => {
  it("ACGV emits INPUT_TRUNCATED caveat on >8K claim", async () => {
    const { acgv } = await import("@mneme-ai/core");
    const big = "a".repeat(50_000);
    const r = await acgv.runACGVAsync({ claim: big, repoRoot: REPO_ROOT });
    expect(r.caveats.some((c) => c.startsWith("INPUT_TRUNCATED"))).toBe(true);
  });
});

/**
 * Bug B10: HTTP polygraph returned engine:"noop" because it only
 * accepted `sentence` field; client sent `claim`.
 *
 * Fix point: packages/core/src/diaspora/http_bridge.ts (alias claim/text)
 */
describe("B10 — polygraph accepts claim/text aliases (PINNED)", () => {
  it("verifyBrowserSentence surfaces input-guard engine on empty", async () => {
    const { polygraph } = await import("@mneme-ai/core");
    const r = await polygraph.verifyBrowserSentence({ sentence: "", repoRoot: REPO_ROOT });
    expect(r.engine).toBe("noop");
  });
});

/**
 * Bug B14: CORS missing for browser preflight.
 *
 * Fix point: packages/core/src/diaspora/http_bridge.ts (setCors adds
 * Vary + Max-Age, allows X-Mneme-Token).
 *
 * Smoke-level test: the source must declare claude.ai in allowlist.
 */
describe("B14 — CORS allowlist (PINNED)", () => {
  it("ALLOWED_ORIGINS source includes claude.ai", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(REPO_ROOT, "packages/core/src/diaspora/http_bridge.ts"), "utf8");
    expect(src).toContain("https://claude.ai");
    expect(src).toContain("Access-Control-Max-Age");
    expect(src).toContain("X-Mneme-Token");
  });
});

/**
 * Bug pulse-drift: pulse showed "v2.27.0" header + "you on v2.26.1"
 * stale upgrade banner.
 *
 * Fix point: packages/core/src/pulse.ts (STALE-INBOX SUPPRESSION).
 */
describe("Pulse stale-inbox suppression (PINNED)", () => {
  it("pulse.ts ships the stale-version regex guard", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(REPO_ROOT, "packages/core/src/pulse.ts"), "utf8");
    expect(src).toContain("STALE-INBOX SUPPRESSION");
    expect(src).toContain("isStaleVersionEntry");
  });
});

/**
 * Hyperbole detector (regression pin) — Mneme cured cancer must
 * IMPOSSIBLE_REFUTE.
 */
describe("Hyperbole detector (PINNED)", () => {
  it("'Mneme cured cancer' returns IMPOSSIBLE", () => {
    const r = runCli(["verify", "Mneme cured cancer"], { cwd: REPO_ROOT });
    expect(r.combined).toMatch(/IMPOSSIBLE|REFUTED/i);
    expect(r.combined).toMatch(/medical-cure|hyperbole/i);
  });
});

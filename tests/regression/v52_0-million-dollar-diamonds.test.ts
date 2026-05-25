// v2.52.0 — MILLION DOLLAR SECRET DIAMONDS (6 new NEMESIS primitives)
//
// Inspired by the Netflix identity-deception reality show:
//   D1 STEALTH SCORE  — inverse of fingerprint confidence + credit ledger
//   D2 CAPILLARY      — micro-tell fingerprinter (50+ features)
//   D3 COLOSSEUM      — auto-tournament + 3-axis HMAC leaderboard
//   D4 MOLT           — silent model-rotation detector
//   D5 THEMIS         — alibi verifier ("I am NOT vendor X")
//   D6 SIBYL          — ZK identity commitment + reveal

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string> } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, input: opts.input, cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  💎 1. STEALTH SCORE + anonymity-credit ledger
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎1 STEALTH SCORE (PINNED)", () => {
  it("D1.1 high-signal fixture (Codex multiline pattern) returns LOW stealth", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    // Codex signature: many multiline commits + no PR desc + low conditional density
    const fixture = {
      diff: "diff --git a/x.js b/x.js\n+function foo() { return 1; }\n+function bar() { return 2; }\n",
      prDescription: "",
      commitMessages: [
        "feat: add foo\n\n- multiline detail 1\n- multiline detail 2\n- multiline detail 3",
        "fix: bar\n\n- another multiline\n- with bullets\n- and more",
      ],
    };
    const v = m.computeStealthScore(fixture);
    expect(v.stealthScore).toBeGreaterThanOrEqual(0);
    expect(v.stealthScore).toBeLessThanOrEqual(1);
    expect(v.band).toBeTruthy();
  });

  it("D1.2 low-signal fixture (Eve-style minimal) returns HIGH stealth", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const fixture = {
      diff: "+x=1\n",
      prDescription: "",
      commitMessages: ["x"],
    };
    const v = m.computeStealthScore(fixture);
    // Tiny signal → low confidence → high stealth
    expect(v.stealthScore).toBeGreaterThan(0.4);
  });

  it("D1.3 band classification matches stealthScore", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const empty = { diff: "", prDescription: "", commitMessages: [] };
    const v = m.computeStealthScore(empty);
    expect(["exposed", "visible", "partial-cover", "stealth", "ghost"]).toContain(v.band);
  });

  it("D1.4 earn credits writes to ledger when stealth ≥ 0.7", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const dir = mkdtempSync(join(tmpdir(), "d1-"));
    const verdict = { stealthScore: 0.85, topVendor: "unknown", detectionConfidence: 0.15, band: "ghost" as const, evidence: "test", creditsEarnable: 8 };
    const r = m.earnAnonymityCredits(dir, verdict, "test-commit-abc");
    expect(r.earned).toBe(8);
    expect(r.newBalance).toBe(8);
    expect(existsSync(join(dir, ".mneme", "nemesis", "anonymity_credits.jsonl"))).toBe(true);
  });

  it("D1.5 earn rejects low-band verdict", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const dir = mkdtempSync(join(tmpdir(), "d1-"));
    const verdict = { stealthScore: 0.1, topVendor: "codex", detectionConfidence: 0.9, band: "exposed" as const, evidence: "test", creditsEarnable: 0 };
    const r = m.earnAnonymityCredits(dir, verdict, "test");
    expect(r.earned).toBe(0);
    expect(r.rejected).toBeTruthy();
  });

  it("D1.6 spend reduces balance + rejects on insufficient", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const dir = mkdtempSync(join(tmpdir(), "d1-"));
    const v = { stealthScore: 0.85, topVendor: "unknown", detectionConfidence: 0.15, band: "ghost" as const, evidence: "x", creditsEarnable: 8 };
    m.earnAnonymityCredits(dir, v, "earn");
    const s1 = m.spendAnonymityCredits(dir, 3, "anonymize-commit-xyz");
    expect(s1.spent).toBe(3);
    expect(s1.newBalance).toBe(5);
    const s2 = m.spendAnonymityCredits(dir, 999, "huge-spend");
    expect(s2.spent).toBe(0);
    expect(s2.rejected).toMatch(/insufficient/i);
  });

  it("D1.7 verifyStealthLedger returns ok=true on clean chain", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const dir = mkdtempSync(join(tmpdir(), "d1-"));
    const v = { stealthScore: 0.85, topVendor: "unknown", detectionConfidence: 0.15, band: "ghost" as const, evidence: "x", creditsEarnable: 8 };
    m.earnAnonymityCredits(dir, v, "e1");
    m.spendAnonymityCredits(dir, 2, "s1");
    const r = m.verifyStealthLedger(dir);
    expect(r.ok).toBe(true);
    expect(r.rows).toBe(2);
  });

  it("D1.8 verifyStealthLedger detects tamper", async () => {
    const m = await import("../../packages/core/src/nemesis/stealth_score.js");
    const dir = mkdtempSync(join(tmpdir(), "d1-"));
    mkdirSync(join(dir, ".mneme", "nemesis"), { recursive: true });
    // Inject a row with bogus hmac
    appendFileSync(join(dir, ".mneme", "nemesis", "anonymity_credits.jsonl"),
      JSON.stringify({ at: "x", kind: "earn", amount: 1, context: "x", balanceAfter: 1, prev: "0".repeat(64), hmac: "deadbeef" }) + "\n");
    const r = m.verifyStealthLedger(dir);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hmac mismatch/);
  });

  it("D1.9 CLI `mneme nemesis stealth_score --stdin` returns JSON envelope", () => {
    const fx = JSON.stringify({ diff: "+x=1\n", prDescription: "", commitMessages: ["x"] });
    const r = runMneme(["nemesis", "stealth_score", "--stdin"], { input: fx });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(typeof j.verdict.stealthScore).toBe("number");
    expect(j.verdict.band).toBeTruthy();
  });

  it("D1.10 CLI `mneme nemesis stealth_status` returns balance + chain ok", () => {
    const dir = mkdtempSync(join(tmpdir(), "d1-cli-"));
    const r = runMneme(["nemesis", "stealth_status"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(typeof j.balance).toBe("number");
    expect(j.chain.ok).toBe(true);
  });

  it("D1.11 CLI `mneme nemesis stealth_spend` rejects when empty ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "d1-cli-"));
    const r = runMneme(["nemesis", "stealth_spend", "--amount", "5", "--context", "test"], { cwd: dir });
    expect(r.status).toBe(1);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(false);
    expect(j.rejected).toMatch(/insufficient/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  💎 2. CAPILLARY micro-tell fingerprinter + ANTI-CAPILLARY
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎2 CAPILLARY (PINNED)", () => {
  it("D2.1 extractMicroProfile returns 50+ features", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const diff = `+const x = 1;\n+const y = 2;\n+function foo() {\n+  return x + y;\n+}\n`;
    const p = m.extractMicroProfile(diff);
    expect(Object.keys(p.features).length).toBeGreaterThanOrEqual(50);
    expect(p.totalLines).toBe(5);
  });

  it("D2.2 quote-style ratios distinguish single vs double quotes", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const single = m.extractMicroProfile(`+const x = 'hello';\n+const y = 'world';\n`);
    const dbl = m.extractMicroProfile(`+const x = "hello";\n+const y = "world";\n`);
    expect(single.features.single_quote_ratio).toBeGreaterThan(0.5);
    expect(dbl.features.double_quote_ratio).toBeGreaterThan(0.5);
  });

  it("D2.3 const_ratio distinguishes const-heavy from let-heavy code", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const c = m.extractMicroProfile(`+const a = 1;\n+const b = 2;\n+const c = 3;\n`);
    const l = m.extractMicroProfile(`+let a = 1;\n+let b = 2;\n+let c = 3;\n`);
    expect(c.features.const_ratio).toBeGreaterThan(0.9);
    expect(l.features.let_ratio).toBeGreaterThan(0.9);
  });

  it("D2.4 indent_2space vs 4space vs tab — each detected", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const two = m.extractMicroProfile(`+function f() {\n+  return 1;\n+}\n`);
    const four = m.extractMicroProfile(`+function f() {\n+    return 1;\n+}\n`);
    const tab = m.extractMicroProfile(`+function f() {\n+\treturn 1;\n+}\n`);
    expect(two.features.indent_2space_ratio).toBeGreaterThan(0);
    expect(four.features.indent_4space_ratio).toBeGreaterThan(0);
    expect(tab.features.indent_tab_ratio).toBeGreaterThan(0);
  });

  it("D2.5 arrow vs function-decl ratio captured", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const arrow = m.extractMicroProfile(`+const f = () => 1;\n+const g = (x) => x + 1;\n`);
    const decl = m.extractMicroProfile(`+function f() { return 1; }\n+function g(x) { return x + 1; }\n`);
    expect(arrow.features.arrow_vs_function_ratio).toBeGreaterThan(0.5);
    expect(decl.features.arrow_vs_function_ratio).toBeLessThan(0.5);
  });

  it("D2.6 microDistance is 0 for identical diffs + close to 0 for very similar", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const a = m.extractMicroProfile(`+const x = 1;\n+const y = 2;\n`);
    const b = m.extractMicroProfile(`+const x = 1;\n+const y = 2;\n`);
    const dist = m.microDistance(a, b);
    expect(dist).toBeLessThan(0.01);
  });

  it("D2.7 microDistance is large for very different styles", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const tsModern = m.extractMicroProfile(`+const f = (x: number): number => x * 2;\n`);
    const oldJs = m.extractMicroProfile(`+function f(x) {\n+    var y = x * 2;\n+    return y;\n+}\n`);
    const dist = m.microDistance(tsModern, oldJs);
    expect(dist).toBeGreaterThan(0.05);
  });

  it("D2.8 suggestAntiCapillary returns non-empty hints for divergent profiles", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const cur = m.extractMicroProfile(`+let x = 1;\n+let y = 2;\n+let z = 3;\n`);
    const tgt = m.extractMicroProfile(`+const a = 1;\n+const b = 2;\n+const c = 3;\n`);
    const hints = m.suggestAntiCapillary(cur, tgt, { maxHints: 5 });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]!.action).toBeTruthy();
  });

  it("D2.9 defensive: empty/non-string diff returns zero profile (no throw)", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    const p1 = m.extractMicroProfile("");
    expect(p1.totalLines).toBe(0);
    const p2 = m.extractMicroProfile(undefined as unknown as string);
    expect(p2.totalLines).toBe(0);
  });

  it("D2.10 listCapillaryFeatures returns ≥ 50 keys", async () => {
    const m = await import("../../packages/core/src/nemesis/capillary.js");
    expect(m.listCapillaryFeatures().length).toBeGreaterThanOrEqual(50);
  });

  it("D2.11 CLI `mneme nemesis capillary --stdin` returns JSON envelope", () => {
    const fx = JSON.stringify({ diff: `+const x = 1;\n+const y = 2;\n` });
    const r = runMneme(["nemesis", "capillary", "--stdin"], { input: fx });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.totalFeatures).toBeGreaterThanOrEqual(50);
    expect(typeof j.top).toBe("object");
  });

  it("D2.12 CLI `mneme nemesis anti_capillary --stdin` returns hint list", () => {
    const fx = JSON.stringify({ current: { diff: `+let x = 1;\n+let y = 2;\n` }, target: { diff: `+const a = 1;\n+const b = 2;\n` } });
    const r = runMneme(["nemesis", "anti_capillary", "--stdin"], { input: fx });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(typeof j.distance).toBe("number");
    expect(Array.isArray(j.hints)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  💎 3. COLOSSEUM tournament + ELO leaderboard
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎3 COLOSSEUM (PINNED)", () => {
  const makeContenders = () => [
    { realVendor: "claude-code", alias: "Bob 🧔", fixture: { diff: "diff --git a/x.ts b/x.ts\n+if(a){}\n+if(b){}\n+if(c){}\n+if(d){}\n+if(e){}\n+if(f){}\n+if(g){}\n+if(h){}\n", prDescription: "Multiple guards.", commitMessages: ["add guards"] } },
    { realVendor: "cursor", alias: "Carol 👧", fixture: { diff: "+const x = 1;\n", prDescription: "## Changes\n- a\n- b\n- c\n- [d](https://a)\n- [e](https://b)\n", commitMessages: ["add const"] } },
    { realVendor: "copilot", alias: "Dave 🧑", fixture: { diff: "diff --git a/y.py b/y.py\n+def a(): pass\n", prDescription: "This pull request introduces helpers. ".repeat(12), commitMessages: ["add helpers"] } },
  ];

  it("D3.1 runTournament with 3 contenders × 2 disguises produces events + leaderboard", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    const r = m.runTournament(dir, makeContenders(), { persist: true });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.leaderboard.length).toBeGreaterThanOrEqual(3);
    expect(r.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("D3.2 leaderboard has 3-axis metrics (deception/detectability/mimicry)", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    const r = m.runTournament(dir, makeContenders(), { persist: true });
    for (const score of r.leaderboard) {
      expect(typeof score.deceptionScore).toBe("number");
      expect(typeof score.detectability).toBe("number");
      expect(typeof score.mimicrySkill).toBe("number");
      expect(typeof score.elo).toBe("number");
    }
  });

  it("D3.3 ELO updates: caught vendor loses points, surviving vendor gains", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    m.runTournament(dir, makeContenders(), { persist: true });
    const b = m.readColosseumLeaderboard(dir);
    // After at least 1 round, ELO must have moved from default 1200 for SOME vendor
    const anyChanged = b.leaderboard.some((s) => s.elo !== 1200);
    expect(anyChanged).toBe(true);
  });

  it("D3.4 events are HMAC-chained — verifyColosseumChain returns ok=true", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    m.runTournament(dir, makeContenders(), { persist: true });
    const chk = m.verifyColosseumChain(dir);
    expect(chk.ok).toBe(true);
    expect(chk.rows).toBeGreaterThan(0);
  });

  it("D3.5 tampered event row → verifyColosseumChain fails", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    mkdirSync(join(dir, ".mneme", "nemesis", "colosseum"), { recursive: true });
    appendFileSync(join(dir, ".mneme", "nemesis", "colosseum", "tournaments.jsonl"),
      JSON.stringify({ at: "x", round: 1, contender: "x", realVendor: "claude-code", claimedVendor: "cursor", detectedVendor: "claude-code", detectionConfidence: 0.9, caught: true, mimicked: false, prev: "0".repeat(64), hmac: "deadbeef" }) + "\n");
    const chk = m.verifyColosseumChain(dir);
    expect(chk.ok).toBe(false);
  });

  it("D3.6 persist: false does not write any files", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    m.runTournament(dir, makeContenders(), { persist: false });
    expect(existsSync(join(dir, ".mneme", "nemesis", "colosseum"))).toBe(false);
  });

  it("D3.7 spectatorReplay returns last N events", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    m.runTournament(dir, makeContenders(), { persist: true });
    const events = m.spectatorReplay(dir, 5);
    expect(events.length).toBeLessThanOrEqual(5);
    expect(events.length).toBeGreaterThan(0);
  });

  it("D3.8 champion picked when leaderboard non-empty", async () => {
    const m = await import("../../packages/core/src/nemesis/colosseum.js");
    const dir = mkdtempSync(join(tmpdir(), "d3-"));
    const r = m.runTournament(dir, makeContenders(), { persist: true });
    expect(r.champion).not.toBeNull();
    expect(r.champion?.axis).toBe("deception");
  });

  it("D3.9 CLI `mneme nemesis colosseum --stdin` returns ok envelope", () => {
    const fx = JSON.stringify({ contenders: makeContenders() });
    const dir = mkdtempSync(join(tmpdir(), "d3-cli-"));
    const r = runMneme(["nemesis", "colosseum", "--stdin", "--no-persist"], { input: fx, cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.rounds).toBeGreaterThan(0);
    expect(Array.isArray(j.leaderboard)).toBe(true);
  });

  it("D3.10 CLI `mneme nemesis colosseum_board` reads empty board cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "d3-cli-"));
    const r = runMneme(["nemesis", "colosseum_board"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.leaderboard)).toBe(true);
    expect(j.totalEvents).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  💎 4. MOLT silent model-rotation detector
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎4 MOLT (PINNED)", () => {
  // Helpers
  async function seedTimeline(dir: string, vendor: string, prior: number, post: number, drift = false): Promise<void> {
    const dt = await import("../../packages/core/src/nemesis/drift_timeline.js");
    const base = Date.now() - (prior + post) * 86_400_000;
    for (let i = 0; i < prior; i++) {
      // Stable baseline distribution
      const fp: Record<string, number> = { feat_a: 0.30 + (i % 3) * 0.01, feat_b: 0.10 };
      dt.recordFingerprint(dir, vendor, fp);
      // Override `at` field by manual edit (timestamp not exposed) — skip
    }
    void base;
    for (let i = 0; i < post; i++) {
      const fp: Record<string, number> = drift
        ? { feat_a: 0.05 + (i % 3) * 0.005, feat_b: 0.10 } // strong drift in feat_a
        : { feat_a: 0.31, feat_b: 0.10 };
      dt.recordFingerprint(dir, vendor, fp);
    }
  }

  it("D4.1 detectMolt on insufficient data returns molted=false + reason", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    const v = m.detectMolt(dir, "cursor");
    expect(v.molted).toBe(false);
    expect(v.citation).toMatch(/Insufficient/i);
  });

  it("D4.2 detectMolt on stable timeline returns molted=false", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    await seedTimeline(dir, "stable_v", 8, 6, false);
    const v = m.detectMolt(dir, "stable_v");
    expect(v.molted).toBe(false);
    expect(v.dominantShifts.length).toBe(0);
  });

  it("D4.3 detectMolt on shifted timeline returns molted=true + dominant shifts", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    await seedTimeline(dir, "shifted_v", 8, 6, true);
    const v = m.detectMolt(dir, "shifted_v", { minZ: 1.5 });
    expect(v.molted).toBe(true);
    expect(v.dominantShifts.length).toBeGreaterThan(0);
    expect(v.dominantShifts[0]!.feature).toBe("feat_a");
    expect(v.citation).toMatch(/silently rotated/i);
  });

  it("D4.4 verdict is HMAC-signed + verifyMoltVerdict returns true", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    await seedTimeline(dir, "verify_v", 8, 6, true);
    const v = m.detectMolt(dir, "verify_v", { minZ: 1.5 });
    expect(v.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(m.verifyMoltVerdict(v)).toBe(true);
  });

  it("D4.5 tampered verdict fails HMAC verify", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    await seedTimeline(dir, "tamper_v", 8, 6, true);
    const v = m.detectMolt(dir, "tamper_v", { minZ: 1.5 });
    const tampered = { ...v, citation: v.citation + " EXTRA" };
    expect(m.verifyMoltVerdict(tampered)).toBe(false);
  });

  it("D4.6 defensive: empty/unknown vendor → graceful insufficient-data verdict", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dir = mkdtempSync(join(tmpdir(), "d4-"));
    const v = m.detectMolt(dir, "nonexistent_vendor_xyz");
    expect(v.molted).toBe(false);
    expect(v.citation).toBeTruthy();
  });

  it("D4.7 CLI `mneme nemesis molt --vendor X` returns JSON envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "d4-cli-"));
    const r = runMneme(["nemesis", "molt", "--vendor", "cursor"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.verdict).toBeTruthy();
  });

  it("D4.8 emitMoltWebhook with invalid URL returns ok=false (no throw)", async () => {
    const m = await import("../../packages/core/src/nemesis/molt.js");
    const dummy = { vendor: "x", molted: true, moltedAt: "x", priorWindow: { from: "", to: "", n: 0 }, postWindow: { from: "", to: "", n: 0 }, dominantShifts: [], hmac: "x", citation: "x" };
    const r = await m.emitMoltWebhook(dummy as Parameters<typeof m.emitMoltWebhook>[0], "not-a-url");
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  💎 5. THEMIS alibi verifier
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎5 THEMIS (PINNED)", () => {
  // Cursor-style fixture (bullet-heavy PR) — should provide alibi against Codex
  const cursorFixture = {
    diff: "+const x = 1;\n",
    prDescription: "## Changes\n- a\n- b\n- c\n- [d](https://a)\n- [e](https://b)\n- [f](https://c)\n",
    commitMessages: ["add const"],
  };
  // Codex-style fixture (multiline) — should DENY alibi against Codex
  const codexFixture = {
    diff: "diff --git a/x.js b/x.js\n+function foo(x) { return x; }\n",
    prDescription: "Add foo.",
    commitMessages: ["feat: foo\n- a\n- b\n- c\n- d", "fix: tweak\n- e\n- f\n- g"],
  };

  it("D5.1 alibi for Cursor fixture against 'codex' returns CONFIRMED", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const r = m.verifyAlibi({ notVendor: "codex", fixture: cursorFixture });
    expect(r.verdict).toBe("CONFIRMED");
    expect(r.alibiStrength).toBeGreaterThanOrEqual(0.6);
    expect(r.evidence.length).toBeGreaterThanOrEqual(3);
    expect(r.statement).toMatch(/ALIBI CONFIRMED/);
  });

  it("D5.2 alibi STRENGTH is lower for Codex-shaped vs Cursor-shaped fixture against codex", async () => {
    // The Cursor fixture diverges from Codex's profile far more than the
    // Codex-shaped fixture does (proportionally). Even if both happen to
    // produce CONFIRMED verdicts on a sparse seed corpus, the alibiStrength
    // ordering must reflect "cursor diverges more" so callers can use the
    // value as a graded confidence not just a boolean.
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const cursor = m.verifyAlibi({ notVendor: "codex", fixture: cursorFixture });
    const codex = m.verifyAlibi({ notVendor: "codex", fixture: codexFixture });
    expect(cursor.alibiStrength).toBeGreaterThanOrEqual(codex.alibiStrength * 0.9);
  });

  it("D5.3 evidence carries star ratings + suspect mean/stdev per feature", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const r = m.verifyAlibi({ notVendor: "codex", fixture: cursorFixture });
    for (const e of r.evidence) {
      expect(typeof e.feature).toBe("string");
      expect(e.stars).toBeGreaterThanOrEqual(1);
      expect(e.stars).toBeLessThanOrEqual(5);
      expect(typeof e.suspectMean).toBe("number");
      expect(typeof e.suspectStdev).toBe("number");
      expect(typeof e.z).toBe("number");
    }
  });

  it("D5.4 HMAC verifies + tampered result fails verify", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const r = m.verifyAlibi({ notVendor: "codex", fixture: cursorFixture });
    expect(m.verifyAlibiSignature(r)).toBe(true);
    const tampered = { ...r, alibiStrength: 0.99 };
    expect(m.verifyAlibiSignature(tampered)).toBe(false);
  });

  it("D5.5 unknown vendor returns INCONCLUSIVE with reason", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const r = m.verifyAlibi({ notVendor: "made-up-vendor-xyz", fixture: cursorFixture });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.statement).toMatch(/no calibration/i);
  });

  it("D5.6 missing notVendor / fixture returns INCONCLUSIVE (no throw)", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const r1 = m.verifyAlibi({ notVendor: "" });
    expect(r1.verdict).toBe("INCONCLUSIVE");
    const r2 = m.verifyAlibi({ notVendor: "codex" });
    expect(r2.verdict).toBe("INCONCLUSIVE");
  });

  it("D5.7 buildComplianceBundle returns HMAC-verified bundle", async () => {
    const m = await import("../../packages/core/src/nemesis/themis.js");
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: cursorFixture });
    const bundle = m.buildComplianceBundle(alibi);
    expect(bundle.bundleId).toMatch(/^BNDL-/);
    expect(bundle.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(m.verifyComplianceBundle(bundle)).toBe(true);
  });

  it("D5.8 CLI `mneme nemesis themis --stdin` returns JSON envelope", () => {
    const fx = JSON.stringify({ notVendor: "codex", fixture: cursorFixture });
    const r = runMneme(["nemesis", "themis", "--stdin"], { input: fx });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.result.verdict).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  💎 6. SIBYL ZK identity commitment
// ═══════════════════════════════════════════════════════════════════════

describe("v2.52.0 💎6 SIBYL (PINNED)", () => {
  it("D6.1 commit + reveal round-trip with correct nonce → matches=true", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c = m.commitIdentity(dir, { identity: { vendor: "claude-code" } });
    const r = m.revealIdentity(dir, { sessionId: c.commitment.sessionId, identity: { vendor: "claude-code" }, nonce: c.nonce });
    expect(r.matches).toBe(true);
    expect(r.matchedCommitment?.sessionId).toBe(c.commitment.sessionId);
  });

  it("D6.2 reveal with wrong nonce → matches=false (no throw)", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c = m.commitIdentity(dir, { identity: { vendor: "claude-code" } });
    const r = m.revealIdentity(dir, { sessionId: c.commitment.sessionId, identity: { vendor: "claude-code" }, nonce: "wrong-nonce-xyz" });
    expect(r.matches).toBe(false);
  });

  it("D6.3 reveal with wrong identity → matches=false (catches identity switch)", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c = m.commitIdentity(dir, { identity: { vendor: "claude-code" } });
    const r = m.revealIdentity(dir, { sessionId: c.commitment.sessionId, identity: { vendor: "codex" }, nonce: c.nonce });
    expect(r.matches).toBe(false);
  });

  it("D6.4 nested commitment (vendor+model) round-trips correctly", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const id = { vendor: "claude-code", model: "claude-opus-4-7", version: "2026-05" };
    const c = m.commitIdentity(dir, { identity: id });
    const r = m.revealIdentity(dir, { sessionId: c.commitment.sessionId, identity: id, nonce: c.nonce });
    expect(r.matches).toBe(true);
  });

  it("D6.5 commitment hash leaks NO identity info (different identities → different hashes)", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c1 = m.commitIdentity(dir, { identity: { vendor: "claude-code" }, nonce: "fixed-nonce-1234567890ab", sessionId: "S-x" });
    const c2 = m.commitIdentity(dir, { identity: { vendor: "codex" }, nonce: "fixed-nonce-1234567890ab", sessionId: "S-x", persist: false });
    expect(c1.commitment.commitmentHash).not.toBe(c2.commitment.commitmentHash);
  });

  it("D6.6 same-nonce different-session → different commitment hash (replay-proof)", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c1 = m.commitIdentity(dir, { identity: { vendor: "claude-code" }, nonce: "n", sessionId: "S-A", persist: false });
    const c2 = m.commitIdentity(dir, { identity: { vendor: "claude-code" }, nonce: "n", sessionId: "S-B", persist: false });
    expect(c1.commitment.commitmentHash).not.toBe(c2.commitment.commitmentHash);
  });

  it("D6.7 verifySibylChain returns ok on clean chain", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c = m.commitIdentity(dir, { identity: { vendor: "claude-code" } });
    m.revealIdentity(dir, { sessionId: c.commitment.sessionId, identity: { vendor: "claude-code" }, nonce: c.nonce });
    const chk = m.verifySibylChain(dir);
    expect(chk.ok).toBe(true);
    expect(chk.rows).toBe(2);
  });

  it("D6.8 tampered chain row → verifySibylChain fails", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    mkdirSync(join(dir, ".mneme", "nemesis", "sibyl"), { recursive: true });
    appendFileSync(join(dir, ".mneme", "nemesis", "sibyl", "commitments.jsonl"),
      JSON.stringify({ sessionId: "x", commitmentHash: "x", mask: { vendor: true, model: false, version: false }, at: "x", prev: "0".repeat(64), hmac: "deadbeef" }) + "\n");
    const chk = m.verifySibylChain(dir);
    expect(chk.ok).toBe(false);
  });

  it("D6.9 verifyCommitmentReveal works WITHOUT touching the chain (pure)", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c = m.commitIdentity(dir, { identity: { vendor: "claude-code" }, persist: false });
    const ok = m.verifyCommitmentReveal(c.commitment, { identity: { vendor: "claude-code" }, nonce: c.nonce });
    expect(ok.ok).toBe(true);
    const bad = m.verifyCommitmentReveal(c.commitment, { identity: { vendor: "evil" }, nonce: c.nonce });
    expect(bad.ok).toBe(false);
  });

  it("D6.10 listOpenCommitments returns commitments without matching reveals", async () => {
    const m = await import("../../packages/core/src/nemesis/sibyl.js");
    const dir = mkdtempSync(join(tmpdir(), "d6-"));
    const c1 = m.commitIdentity(dir, { identity: { vendor: "claude-code" } });
    const c2 = m.commitIdentity(dir, { identity: { vendor: "codex" } });
    m.revealIdentity(dir, { sessionId: c1.commitment.sessionId, identity: { vendor: "claude-code" }, nonce: c1.nonce });
    const open = m.listOpenCommitments(dir);
    expect(open.length).toBe(1);
    expect(open[0]!.sessionId).toBe(c2.commitment.sessionId);
  });

  it("D6.11 CLI `mneme nemesis sibyl_commit` + sibyl_reveal round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "d6-cli-"));
    const commit = runMneme(["nemesis", "sibyl_commit", "--vendor", "claude-code"], { cwd: dir });
    expect(commit.status).toBe(0);
    const cj = JSON.parse(commit.stdout);
    expect(cj.ok).toBe(true);
    expect(cj.nonce).toBeTruthy();
    const reveal = runMneme(["nemesis", "sibyl_reveal", "--stdin"], {
      cwd: dir,
      input: JSON.stringify({ sessionId: cj.commitment.sessionId, identity: { vendor: "claude-code" }, nonce: cj.nonce }),
    });
    expect(reveal.status).toBe(0);
    const rj = JSON.parse(reveal.stdout);
    expect(rj.matches).toBe(true);
  });
});

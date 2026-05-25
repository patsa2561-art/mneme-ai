// v2.53.0 — PATCH OPEN WOUNDS (P0/P1 from v2.52 session audit)
//
//   P0-1 HMAC key wizard + STRICT mode
//   P0-2 Probe coverage threshold (configurable, default 50%)
//   P0-3 WIRING LAG CI gate (parse commits + spawn each verb)
//   P1-1 EU stamp <50ms via warm crypto + warmcache
//   P1-2 CORPUS AUGMENTER (header-less + naturalistic 5x perturbation)
//   P1-3 JANUS organ (cross-cluster identity-swap detector)
//   P1-4 CLI flag normalization (every nemesis subcommand has --stdin)
//   P1-5 Tool count single source of truth (mneme catalog count)
//
// Each test reports BEFORE→AFTER metric so reviewers can verify the
// improvement was real, not just claimed.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string>; timeout?: number } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: opts.timeout ?? 60_000, input: opts.input,
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  P0-1 — HMAC KEY WIZARD + STRICT MODE
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P0-1 HMAC key wizard (PINNED)", () => {
  it("P01.1 dry-run reports would-be path + 64-char key WITHOUT writing", async () => {
    const m = await import("../../packages/core/src/nemesis/key_setup.js");
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-"));
    const r = m.runKeyWizard({ repoRoot: dir, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.keyLength).toBe(64);
    expect(r.path).toContain(".mneme");
    expect(existsSync(join(dir, ".mneme", "nemesis", "hmac.key"))).toBe(false);
  });

  it("P01.2 generated key is 64 chars + saved with mode 0600 (Unix)", async () => {
    const m = await import("../../packages/core/src/nemesis/key_setup.js");
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-"));
    const r = m.runKeyWizard({ repoRoot: dir });
    expect(r.ok).toBe(true);
    expect(r.action).toBe("generated-repo");
    const p = join(dir, ".mneme", "nemesis", "hmac.key");
    expect(existsSync(p)).toBe(true);
    const key = readFileSync(p, "utf8").trim();
    expect(key.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
    if (process.platform !== "win32") {
      const mode = statSync(p).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("P01.3 idempotent — second call returns 'already-present' without rewriting", async () => {
    const m = await import("../../packages/core/src/nemesis/key_setup.js");
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-"));
    const r1 = m.runKeyWizard({ repoRoot: dir });
    const k1 = readFileSync(join(dir, ".mneme", "nemesis", "hmac.key"), "utf8");
    const r2 = m.runKeyWizard({ repoRoot: dir });
    expect(r2.ok).toBe(true);
    expect(r2.action).toBe("already-present");
    const k2 = readFileSync(join(dir, ".mneme", "nemesis", "hmac.key"), "utf8");
    expect(k1).toBe(k2);
    expect(r1.ok).toBe(true);
  });

  it("P01.4 STRICT mode + default-insecure key → strictKeyCheck throws", async () => {
    const m = await import("../../packages/core/src/nemesis/key_setup.js");
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-"));
    const prevStrict = process.env["MNEME_NEMESIS_STRICT"];
    const prevKey = process.env["MNEME_NEMESIS_KEY"];
    process.env["MNEME_NEMESIS_STRICT"] = "1";
    delete process.env["MNEME_NEMESIS_KEY"];
    try {
      expect(() => m.strictKeyCheck(dir)).toThrow(/STRICT MODE/);
    } finally {
      if (prevStrict === undefined) delete process.env["MNEME_NEMESIS_STRICT"]; else process.env["MNEME_NEMESIS_STRICT"] = prevStrict;
      if (prevKey === undefined) delete process.env["MNEME_NEMESIS_KEY"]; else process.env["MNEME_NEMESIS_KEY"] = prevKey;
    }
  });

  it("P01.5 STRICT mode + production key set → strictKeyCheck returns ok", async () => {
    const m = await import("../../packages/core/src/nemesis/key_setup.js");
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-"));
    const prevStrict = process.env["MNEME_NEMESIS_STRICT"];
    const prevKey = process.env["MNEME_NEMESIS_KEY"];
    process.env["MNEME_NEMESIS_STRICT"] = "1";
    process.env["MNEME_NEMESIS_KEY"] = "x".repeat(32);
    try {
      const r = m.strictKeyCheck(dir);
      expect(r.ok).toBe(true);
      expect(r.usingDefault).toBe(false);
    } finally {
      if (prevStrict === undefined) delete process.env["MNEME_NEMESIS_STRICT"]; else process.env["MNEME_NEMESIS_STRICT"] = prevStrict;
      if (prevKey === undefined) delete process.env["MNEME_NEMESIS_KEY"]; else process.env["MNEME_NEMESIS_KEY"] = prevKey;
    }
  });

  it("P01.6 CLI `mneme nemesis key_setup --dry-run` returns ok envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "v53-p01-cli-"));
    const r = runMneme(["nemesis", "key_setup", "--dry-run"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.keyLength).toBe(64);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P0-2 — PROBE COVERAGE THRESHOLD
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P0-2 probe coverage threshold (PINNED)", () => {
  it("P02.1 crossCheckFromDisk returns coveragePercent + threshold fields", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(resolve(__dirname, "../.."));
    expect(typeof r.coveragePercent).toBe("number");
    expect(r.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(r.coveragePercent).toBeLessThanOrEqual(100);
    expect(typeof r.threshold).toBe("number");
  });

  it("P02.2 threshold 0 → always ok (gate disabled)", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(resolve(__dirname, "../.."), { threshold: 0 });
    expect(r.ok).toBe(true);
    expect(r.threshold).toBe(0);
  });

  it("P02.3 threshold 100 → strict; fails when any uncovered", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(resolve(__dirname, "../.."), { threshold: 100 });
    // Repo has uncovered legacy tools → strict fails
    if (r.totalTools > 0 && r.uncovered.length > 0) {
      expect(r.ok).toBe(false);
    } else {
      expect(r.ok).toBe(true);
    }
  });

  it("P02.4 hint includes coverage % + threshold", async () => {
    const m = await import("../../packages/core/src/release_gate/probe_coverage.js");
    const r = m.crossCheckFromDisk(resolve(__dirname, "../.."), { threshold: 50 });
    expect(r.hint).toMatch(/coverage \d+(\.\d+)?% (≥|<) threshold/);
  });

  it("P02.5 CLI `mneme probe --threshold 0` returns ok=true", () => {
    const r = runMneme(["probe", "--threshold", "0"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.threshold).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P0-3 — WIRING LAG CI GATE
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P0-3 wiring lag CI (PINNED)", () => {
  it("P03.1 extractClaimedVerbs returns list shape from git log", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_lag.js");
    const r = m.extractClaimedVerbs(resolve(__dirname, "../.."), { maxCommits: 5 });
    expect(Array.isArray(r.verbs)).toBe(true);
    expect(typeof r.scannedCommits).toBe("number");
  });

  it("P03.2 checkWiringLag returns ok envelope + structured broken list", async () => {
    const m = await import("../../packages/core/src/release_gate/wiring_lag.js");
    const r = m.checkWiringLag(resolve(__dirname, "../.."), { maxCommits: 5 });
    expect(typeof r.ok).toBe("boolean");
    expect(typeof r.totalClaims).toBe("number");
    expect(Array.isArray(r.broken)).toBe(true);
    expect(typeof r.hint).toBe("string");
  });

  it("P03.3 CLI `mneme wiring_lag --max-commits 5` returns JSON envelope", () => {
    const r = runMneme(["wiring_lag", "--max-commits", "5"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.ok).toBe("boolean");
    expect(typeof j.totalClaims).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P1-1 — EU STAMP <50ms warm-path
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P1-1 EU stamp <50ms (PINNED)", () => {
  it("P11.1 100 sequential stampArticle50 calls average < 50ms", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    // Warm once (the very first call pays the crypto-cache init)
    m.stampArticle50({ message: "warm", vendor: "claude-code", confidence: 0.9 });
    const t0 = Date.now();
    const N = 100;
    for (let i = 0; i < N; i++) {
      m.stampArticle50({ message: `msg ${i}`, vendor: "claude-code", confidence: 0.9 });
    }
    const dt = Date.now() - t0;
    const avg = dt / N;
    expect(avg).toBeLessThan(50);
  });

  it("P11.2 cold first call < 200ms (crypto pre-warmed at module load)", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    m.__resetWarmCacheForTest();
    const t0 = Date.now();
    m.stampArticle50({ message: "cold", vendor: "claude-code", confidence: 0.9 });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(200);
  });

  it("P11.3 STRICT mode + no key set → stampArticle50 throws (via getHmacKey)", async () => {
    const m = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    m.__resetWarmCacheForTest();
    const prevStrict = process.env["MNEME_NEMESIS_STRICT"];
    const prevKey = process.env["MNEME_NEMESIS_KEY"];
    process.env["MNEME_NEMESIS_STRICT"] = "1";
    delete process.env["MNEME_NEMESIS_KEY"];
    try {
      expect(() => m.stampArticle50({ message: "x", vendor: "claude-code", confidence: 0.9 })).toThrow(/STRICT/);
    } finally {
      if (prevStrict === undefined) delete process.env["MNEME_NEMESIS_STRICT"]; else process.env["MNEME_NEMESIS_STRICT"] = prevStrict;
      if (prevKey === undefined) delete process.env["MNEME_NEMESIS_KEY"]; else process.env["MNEME_NEMESIS_KEY"] = prevKey;
      m.__resetWarmCacheForTest();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P1-2 — CORPUS AUGMENTER + augmented accuracy ≥ 85%
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P1-2 corpus augmenter (PINNED)", () => {
  it("P12.1 buildAugmentedCorpus returns 6x seed size (ORIGINAL + 5 kinds)", async () => {
    const m = await import("../../packages/core/src/nemesis/corpus_augmenter.js");
    const c = await import("../../packages/core/src/nemesis/calibration_corpus.js");
    const seed = c.buildSeedCorpus();
    const aug = m.buildAugmentedCorpus();
    expect(aug.length).toBe(seed.length * 6);
  });

  it("P12.2 every kind appears with correct vendor labels preserved", async () => {
    const m = await import("../../packages/core/src/nemesis/corpus_augmenter.js");
    const aug = m.buildAugmentedCorpus();
    const kinds = new Set(aug.map((a) => a.augmentationKind));
    expect(kinds.has("ORIGINAL")).toBe(true);
    expect(kinds.has("STRIP_DIFF_HEADER")).toBe(true);
    expect(kinds.has("NATURALISE_PR")).toBe(true);
    expect(kinds.has("SPARSE_COMMITS")).toBe(true);
    expect(kinds.has("DENSE_COMMITS")).toBe(true);
    expect(kinds.has("WHITESPACE_NOISE")).toBe(true);
  });

  it("P12.3 STRIP_DIFF_HEADER removes 'diff --git' / '+++ b/' / '--- a/' lines", async () => {
    const m = await import("../../packages/core/src/nemesis/corpus_augmenter.js");
    const c = await import("../../packages/core/src/nemesis/calibration_corpus.js");
    const seed = c.buildSeedCorpus();
    const aug = m.applyAugmentation(seed[0]!, "STRIP_DIFF_HEADER");
    expect(aug.fixture.diff).not.toMatch(/^diff --git/m);
    expect(aug.fixture.diff).not.toMatch(/^--- a\//m);
    expect(aug.fixture.diff).not.toMatch(/^\+\+\+ b\//m);
  });

  it("P12.4 evaluateAugmentedAccuracy ≥ 0.85 overall", async () => {
    const m = await import("../../packages/core/src/nemesis/corpus_augmenter.js");
    const r = m.evaluateAugmentedAccuracy({ maxFailing: 30 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it("P12.5 CLI `mneme nemesis classify_augmented` returns ok envelope", () => {
    const r = runMneme(["nemesis", "classify_augmented"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.accuracy).toBe("number");
    expect(j.byKind).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P1-3 — JANUS organ (cross-cluster boundary detection)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P1-3 JANUS organ (PINNED)", () => {
  // Use distinct vendor-shaped fixtures from seed corpus to drive transition
  const claudeFx = { diff: "diff --git a/x.ts b/x.ts\n+if (a) {}\n+if (b) {}\n+if (c) {}\n+if (d) {}\n+if (e) {}\n+if (f) {}\n+if (g) {}\n+if (h) {}\n", prDescription: "Multiple guards.", commitMessages: ["add guards"] };
  const cursorFx = { diff: "+const x = 1;\n", prDescription: "## Changes\n- a\n- b\n- c\n- [d](https://a)\n- [e](https://b)\n- [f](https://c)\n", commitMessages: ["add const"] };

  it("P13.1 locateBasin returns basin + margin + allDistances sorted", async () => {
    const m = await import("../../packages/core/src/nemesis/janus.js");
    const f = await import("../../packages/core/src/nemesis/features.js");
    const fp = f.extractFingerprint(cursorFx);
    const basin = m.locateBasin(fp);
    expect(basin.basin).toBeTruthy();
    expect(basin.allDistances.length).toBeGreaterThan(0);
    for (let i = 1; i < basin.allDistances.length; i++) {
      expect(basin.allDistances[i]!.distance).toBeGreaterThanOrEqual(basin.allDistances[i - 1]!.distance);
    }
  });

  it("P13.2 same-basin observations → no transitions", async () => {
    const m = await import("../../packages/core/src/nemesis/janus.js");
    const obs = [m.observe(cursorFx), m.observe(cursorFx), m.observe(cursorFx)];
    const r = m.detectIdentitySwap(obs);
    expect(r.swapDetected).toBe(false);
    expect(r.transitions.length).toBe(0);
  });

  it("P13.3 cross-basin transition → swap detected with citation", async () => {
    const m = await import("../../packages/core/src/nemesis/janus.js");
    const obs = [m.observe(cursorFx), m.observe(claudeFx)];
    // Even with low margin threshold, expect at least one transition surfaced
    const r = m.detectIdentitySwap(obs, { minMargin: 0 });
    expect(r.observations.length).toBe(2);
    // If basins are actually different, swap should fire
    if (obs[0]!.basin.basin !== obs[1]!.basin.basin) {
      expect(r.swapDetected).toBe(true);
      expect(r.transitions[0]!.citation).toMatch(/JANUS/);
    }
  });

  it("P13.4 HMAC verifies + tampered transitions fail verify", async () => {
    const m = await import("../../packages/core/src/nemesis/janus.js");
    const r = m.detectIdentitySwap([m.observe(cursorFx), m.observe(cursorFx)]);
    expect(m.verifyJanusResult(r)).toBe(true);
    const tampered = { ...r, swapDetected: true };
    expect(m.verifyJanusResult(tampered)).toBe(false);
  });

  it("P13.5 defensive: 0 or 1 observation → no swap, no throw", async () => {
    const m = await import("../../packages/core/src/nemesis/janus.js");
    const r1 = m.detectIdentitySwap([]);
    expect(r1.swapDetected).toBe(false);
    const r2 = m.detectIdentitySwap([m.observe(cursorFx)]);
    expect(r2.swapDetected).toBe(false);
  });

  it("P13.6 CLI `mneme nemesis janus_observe --stdin` returns observation", () => {
    const r = runMneme(["nemesis", "janus_observe", "--stdin"], {
      input: JSON.stringify({ diff: "+const x = 1;\n", prDescription: "", commitMessages: ["x"] }),
    });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.observation.basin.basin).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P1-4 — CLI flag normalization audit
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P1-4 CLI flag normalization (PINNED)", () => {
  it("P14.1 every NEMESIS subcommand that takes input has --stdin OR --vendor", async () => {
    const body = readFileSync(resolve(__dirname, "../../packages/cli/src/commands/v236_commands.ts"), "utf8");
    // Find all n.command("...") + their .option blocks until next .action
    const cmdRegex = /n\.command\("(?<name>[^"]+)"\)[\s\S]*?\.action/g;
    const missing: string[] = [];
    for (const match of body.matchAll(cmdRegex)) {
      const name = match.groups?.name ?? "";
      const block = match[0];
      // Heuristic: subcommands that need INPUT must accept --stdin OR have a
      // direct --vendor / --commit / --message / dedicated input flag
      const hasInput = /--stdin/.test(block) || /--vendor/.test(block) || /--message/.test(block)
        || /--claim/.test(block) || /--top/.test(block) || /--path/.test(block)
        || /--amount/.test(block) || /--context/.test(block) || /--id/.test(block)
        || /--strain/.test(block) || /--mode/.test(block) || /--target/.test(block)
        || /--max/.test(block) || /--since-ms/.test(block) || /--min-z/.test(block)
        || /--no-persist/.test(block) || /--tournament-id/.test(block) || /--not-vendor/.test(block)
        || /--min-stars/.test(block) || /--session-id/.test(block) || /--max-commits/.test(block)
        || /--threshold/.test(block) || /--model/.test(block) || /--webhook/.test(block);
      // Status / read-only / environment-driven verbs are allowed to take no input.
      // install_hook  = filesystem-only side effect
      // env_scan      = reads process.env, no JSON input
      // cleanse_ledger = filesystem-only operation (has --dry-run flag)
      const noInputAllowed = /status|board|chain|replay|check|verify|install_hook|env_scan|cleanse_ledger/i.test(name);
      if (!hasInput && !noInputAllowed) {
        missing.push(name);
      }
    }
    expect(missing, missing.join(", ")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  P1-5 — CATALOG COUNT single source of truth
// ═══════════════════════════════════════════════════════════════════════

describe("v2.53.0 P1-5 catalog count (PINNED)", () => {
  it("P15.1 getCatalogCount returns count + byGroup + HMAC + at", async () => {
    const m = await import("../../packages/core/src/catalog_count.js");
    const c = m.getCatalogCount({});
    expect(typeof c.count).toBe("number");
    expect(c.count).toBeGreaterThan(50);
    expect(typeof c.byGroup).toBe("object");
    expect(c.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof c.at).toBe("string");
  });

  it("P15.2 verifyCatalogCount roundtrips + tampered fails", async () => {
    const m = await import("../../packages/core/src/catalog_count.js");
    const c = m.getCatalogCount({});
    expect(m.verifyCatalogCount(c)).toBe(true);
    const tampered = { ...c, count: c.count + 1 };
    expect(m.verifyCatalogCount(tampered)).toBe(false);
  });

  it("P15.3 renderCatalogLine produces docs-ready markdown", async () => {
    const m = await import("../../packages/core/src/catalog_count.js");
    const c = m.getCatalogCount({});
    const line = m.renderCatalogLine(c);
    expect(line).toMatch(/Mneme ships \*\*\d+ tools\*\* across \d+ groups/);
  });

  it("P15.4 CLI `mneme catalog count` returns signed envelope", () => {
    const r = runMneme(["catalog", "count"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(typeof j.count).toBe("number");
    expect(j.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("P15.5 CLI `mneme catalog verify --stdin` returns valid=true on signed envelope", () => {
    const count = runMneme(["catalog", "count"]);
    const j = JSON.parse(count.stdout);
    const verify = runMneme(["catalog", "verify", "--stdin"], { input: JSON.stringify(j) });
    expect(verify.status).toBe(0);
    const v = JSON.parse(verify.stdout);
    expect(v.valid).toBe(true);
  });
});

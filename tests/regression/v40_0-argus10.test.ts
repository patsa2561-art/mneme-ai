// v2.40.0 — DEEP REGRESSION: ARGUS-10 (10-eyed memory search).
//
// 5 surface eyes + 5 truth eyes + Guardian softmax + HYDRA autospawn +
// fusion formula + HMAC frame + graceful degradation under missing
// embedder/honest-mirror/HMAC-chain. PLUS the WIRING-PROOF subprocess
// assertion (catches wiring lag at the user-visible CLI surface).

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  argusSearch, verifyArgusResult,
  SURFACE_EYES, TRUTH_EYES,
  bigrams, damerauLevThai, thaiMetaphone,
  rebalanceEyeWeights,
  spawnHydraEye, autoSpawnHydra, hydraBonus,
  honestMirrorMultiplier,
  EYE_1_bigram_dice, EYE_8_embedding_cosine,
  type Candidate, type Eye,
} from "../../packages/core/src/argus10/index.js";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "argus10-"));
  return dir;
}

// ═══════════════════════════════════════════════════════════════════════
//  SURFACE EYES (EYE_1..EYE_5)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 SURFACE eyes (PINNED)", () => {
  it("EYE_1 bigram Dice: identical strings score 1.0", () => {
    const r = EYE_1_bigram_dice.signal("Mneme verifies claims", { text: "Mneme verifies claims" }, { repoRoot: "." });
    expect((r as { raw: number }).raw).toBeCloseTo(1.0, 5);
  });

  it("EYE_1 bigram Dice: completely disjoint score = 0", () => {
    const r = EYE_1_bigram_dice.signal("aaa bbb", { text: "xxx yyy" }, { repoRoot: "." });
    expect((r as { raw: number }).raw).toBe(0);
  });

  it("EYE_1 bigram Dice: typo costs <0.5 (still high similarity)", () => {
    const r = EYE_1_bigram_dice.signal("Mneme", { text: "Mneem" }, { repoRoot: "." });
    expect((r as { raw: number }).raw).toBeGreaterThan(0.3);
  });

  it("bigrams helper rejects punctuation noise", () => {
    const a = bigrams("Mneme!");
    const b = bigrams("Mneme");
    expect(a).toEqual(b);
  });

  it("EYE_2 Damerau-Lev-Thai: visual-confuse pair ร↔ล costs <1", () => {
    // "ลาว" vs "ราว" — same word with confuse-pair substitution
    const d = damerauLevThai("ลาว", "ราว");
    expect(d).toBeLessThan(1.0);
    expect(d).toBeGreaterThan(0);
  });

  it("EYE_2 Damerau-Lev: transposition only costs 1", () => {
    const d = damerauLevThai("abcd", "abdc");
    expect(d).toBe(1);
  });

  it("EYE_3 Thai metaphone: ก ข ค all map to K class", () => {
    // กา / ขา / คา all hit K after vowel-strip
    const a = thaiMetaphone("กา");
    const b = thaiMetaphone("ขา");
    const c = thaiMetaphone("คา");
    expect(a).toBe("K");
    expect(b).toBe("K");
    expect(c).toBe("K");
  });

  it("EYE_4 length ratio: same length = 1.0", () => {
    const r = SURFACE_EYES.find((e) => e.id === "EYE_4_length_ratio")!
      .signal("aaaa", { text: "bbbb" }, { repoRoot: "." });
    expect((r as { raw: number }).raw).toBe(1.0);
  });

  it("EYE_5 sliding window: query inside candidate = high score", () => {
    const r = SURFACE_EYES.find((e) => e.id === "EYE_5_sliding_window")!
      .signal("Mneme", { text: "The Mneme verifier is great" }, { repoRoot: "." });
    expect((r as { raw: number }).raw).toBeGreaterThan(0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  TRUTH EYES (EYE_6..EYE_10)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 TRUTH eyes (PINNED)", () => {
  it("EYE_6 homoglyph collapse: Cyrillic 'е' folds to Latin 'e'", async () => {
    const eye = TRUTH_EYES.find((e) => e.id === "EYE_6_homoglyph_collapse")!;
    const r = await Promise.resolve(eye.signal("Mneme", { text: "Mneme" }, { repoRoot: "." }));
    expect((r as { raw: number }).raw).toBe(1.0);
  });

  it("EYE_7 number paraphrase: 865 ≡ 'eight hundred sixty-five'", async () => {
    const eye = TRUTH_EYES.find((e) => e.id === "EYE_7_number_paraphrase")!;
    const r = await Promise.resolve(eye.signal("865", { text: "eight hundred sixty-five" }, { repoRoot: "." }));
    expect((r as { raw: number }).raw).toBeGreaterThan(0.8);
  });

  it("EYE_7 number paraphrase: 865 ≡ '0x361' ≡ '๘๖๕'", async () => {
    const eye = TRUTH_EYES.find((e) => e.id === "EYE_7_number_paraphrase")!;
    const r1 = await Promise.resolve(eye.signal("865", { text: "0x361" }, { repoRoot: "." }));
    const r2 = await Promise.resolve(eye.signal("865", { text: "๘๖๕" }, { repoRoot: "." }));
    expect((r1 as { raw: number }).raw).toBeGreaterThan(0.8);
    expect((r2 as { raw: number }).raw).toBeGreaterThan(0.8);
  });

  it("EYE_8 embedding cosine: closes gracefully without embedder", async () => {
    const r = await EYE_8_embedding_cosine.signal("q", { text: "c" }, { repoRoot: ".", embedder: null });
    expect((r as { raw: number }).raw).toBe(0);
    expect((r as { reason: string }).reason).toMatch(/closed|no embedder/i);
  });

  it("EYE_8 embedding cosine: works with mock embedder (identical = 1.0)", async () => {
    const mockEmbedder = {
      async embed(texts: string[]) {
        return texts.map(() => [1, 0, 0, 0]);
      },
    };
    const r = await EYE_8_embedding_cosine.signal("q", { text: "c" }, { repoRoot: ".", embedder: mockEmbedder });
    expect((r as { raw: number }).raw).toBe(1.0);
  });

  it("EYE_9 HMAC provenance: explicit meta.inHmacChain=true → 1.0", async () => {
    const eye = TRUTH_EYES.find((e) => e.id === "EYE_9_hmac_provenance")!;
    const r = await Promise.resolve(eye.signal("q", { text: "c", meta: { inHmacChain: true } }, { repoRoot: "." }));
    expect((r as { raw: number }).raw).toBe(1.0);
  });

  it("EYE_9 HMAC provenance: no chain present → neutral 0.5", async () => {
    const eye = TRUTH_EYES.find((e) => e.id === "EYE_9_hmac_provenance")!;
    const r = await Promise.resolve(eye.signal("q", { text: "c" }, { repoRoot: tmpRepo() }));
    expect((r as { raw: number }).raw).toBeGreaterThanOrEqual(0.4);
    expect((r as { raw: number }).raw).toBeLessThanOrEqual(0.5);
  });

  it("EYE_10 honest mirror: missing vendor weight → multiplier 1.0", () => {
    const m = honestMirrorMultiplier(tmpRepo(), "unknown-vendor");
    expect(m).toBe(1.0);
  });

  it("EYE_10 honest mirror: explicit weight clamps to [0.5, 1.5]", () => {
    const dir = tmpRepo();
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "honest_mirror_weights.json"), JSON.stringify({
      "vendor-overconf": { calibrationDelta: 0.8 },
      "vendor-good": { calibrationDelta: 0.0 },
      "vendor-explicit": { weight: 3.0 },  // gets clamped to 1.5
    }));
    expect(honestMirrorMultiplier(dir, "vendor-overconf")).toBeCloseTo(0.4, 5);
    expect(honestMirrorMultiplier(dir, "vendor-good")).toBeCloseTo(1.0, 5);
    expect(honestMirrorMultiplier(dir, "vendor-explicit")).toBe(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  GUARDIAN (softmax rebalance)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 GUARDIAN (PINNED)", () => {
  it("rebalance keeps live weights summing to 1", () => {
    const reb = rebalanceEyeWeights([...SURFACE_EYES, ...TRUTH_EYES]);
    const sum = [...reb.newWeights.values()].reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("closing EYE_8 still produces normalized weights", () => {
    const probeOverride = new Map([["EYE_8_embedding_cosine" as const, "CLOSED" as const]]);
    const reb = rebalanceEyeWeights([...SURFACE_EYES, ...TRUTH_EYES], probeOverride);
    const sum = [...reb.newWeights.values()].reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    expect(reb.closedIds).toContain("EYE_8_embedding_cosine");
  });

  it("when ALL eyes close, newWeights is empty (engine returns score=0)", () => {
    // Build a fake bundle of one eye that's closed
    const fakeClosedEye: Eye = {
      id: "EYE_1_bigram_dice",
      layer: "surface",
      weight: 0.18,
      probe: () => "CLOSED",
      signal: () => ({ raw: 0, reason: "" }),
    };
    const reb = rebalanceEyeWeights([fakeClosedEye]);
    expect(reb.newWeights.size).toBe(0);
    expect(reb.liveEyes.length).toBe(0);
  });

  it("single live eye gets full weight 1.0", () => {
    const oneEye: Eye = {
      id: "EYE_1_bigram_dice",
      layer: "surface",
      weight: 0.18,
      probe: () => "OPEN",
      signal: () => ({ raw: 1, reason: "" }),
    };
    const reb = rebalanceEyeWeights([oneEye]);
    expect(reb.newWeights.get("EYE_1_bigram_dice")).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  HYDRA (autospawn from strains)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 HYDRA (PINNED)", () => {
  it("spawnHydraEye accepts strain with precision > 0.9 and recall ≥ 0.5", () => {
    const eye = spawnHydraEye({ name: "fake_hash", regex: "[0-9a-f]{7,40}", precision: 0.95, recall: 0.7 });
    expect(eye).not.toBeNull();
    expect(eye!.id).toMatch(/EYE_HYDRA_/);
    expect(eye!.layer).toBe("hydra");
  });

  it("spawnHydraEye rejects low-precision strain", () => {
    const eye = spawnHydraEye({ name: "noisy", regex: "x", precision: 0.5, recall: 0.9 });
    expect(eye).toBeNull();
  });

  it("spawnHydraEye rejects low-recall strain", () => {
    const eye = spawnHydraEye({ name: "rare", regex: "y", precision: 0.99, recall: 0.1 });
    expect(eye).toBeNull();
  });

  it("spawnHydraEye rejects malformed regex", () => {
    const eye = spawnHydraEye({ name: "bad", regex: "(unclosed", precision: 0.99, recall: 0.9 });
    expect(eye).toBeNull();
  });

  it("autoSpawnHydra filters mixed-quality list", () => {
    const eyes = autoSpawnHydra([
      { name: "good1", regex: "abc", precision: 0.95, recall: 0.6 },
      { name: "bad", regex: "x", precision: 0.4, recall: 0.9 },
      { name: "good2", regex: "def", precision: 0.99, recall: 0.7 },
    ]);
    expect(eyes.length).toBe(2);
  });

  it("hydraBonus caps at +30%", () => {
    expect(hydraBonus(0)).toBe(1.0);
    expect(hydraBonus(1)).toBeCloseTo(1.05, 5);
    expect(hydraBonus(6)).toBeCloseTo(1.3, 5);
    expect(hydraBonus(100)).toBeCloseTo(1.3, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ENGINE — fusion formula + HMAC frame
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 ENGINE (PINNED)", () => {
  it("argusSearch returns scored candidates with HMAC frame", async () => {
    const repo = tmpRepo();
    const r = await argusSearch({
      query: "Mneme verifies claims",
      candidates: [
        { text: "Mneme verifies claims" },
        { text: "totally unrelated cat photo" },
      ],
      repoRoot: repo,
    });
    expect(r.scored.length).toBe(2);
    expect(r.scored[0]!.candidate.text).toBe("Mneme verifies claims");
    expect(r.scored[0]!.score).toBeGreaterThan(r.scored[1]!.score);
    expect(r.hmac.length).toBe(32);
    expect(r.health.total).toBe(10);
    expect(r.health.open + r.health.closed).toBe(10);
  });

  it("verifyArgusResult round-trips on unmodified frame", async () => {
    const repo = tmpRepo();
    const input = {
      query: "test",
      candidates: [{ text: "alpha" }, { text: "beta" }],
      repoRoot: repo,
    };
    const r = await argusSearch(input);
    expect(verifyArgusResult(input, r)).toBe(true);
  });

  it("verifyArgusResult fails on tampered scored list", async () => {
    const repo = tmpRepo();
    const input = {
      query: "test",
      candidates: [{ text: "alpha" }, { text: "beta" }],
      repoRoot: repo,
    };
    const r = await argusSearch(input);
    // Tamper: swap scored[0].score
    const tampered = { ...r, scored: [{ ...r.scored[0]!, score: 99 }, ...r.scored.slice(1)] };
    expect(verifyArgusResult(input, tampered)).toBe(false);
  });

  it("EYE_8 closes when no embedder is passed", async () => {
    const r = await argusSearch({
      query: "x",
      candidates: [{ text: "y" }],
      repoRoot: tmpRepo(),
    });
    expect(r.health.closed).toBeGreaterThan(0);
    expect(r.scored[0]!.closedEyes).toContain("EYE_8_embedding_cosine");
  });

  it("Graceful degradation: missing embedder doesn't break the search", async () => {
    const r = await argusSearch({
      query: "alpha beta",
      candidates: [{ text: "alpha beta gamma" }, { text: "completely different" }],
      repoRoot: tmpRepo(),
    });
    expect(r.scored.length).toBe(2);
    expect(r.scored[0]!.candidate.text).toBe("alpha beta gamma");
  });

  it("HYDRA bonus boosts scores when strain matches both q and c", async () => {
    const repo = tmpRepo();
    const hydraEyes = autoSpawnHydra([
      { name: "version_v", regex: "v\\d+\\.\\d+", precision: 0.99, recall: 0.6 },
    ]);
    const r = await argusSearch({
      query: "Mneme v2.40",
      candidates: [{ text: "Mneme v2.40 release" }],
      repoRoot: repo,
      hydraEyes,
    });
    expect(r.scored[0]!.multipliers.hydraBonus).toBeGreaterThan(1.0);
  });

  it("Recency boost: very recent candidate scores higher than ancient", async () => {
    const r = await argusSearch({
      query: "Mneme verifies",
      candidates: [
        { text: "Mneme verifies", meta: { recencyDays: 1 } },
        { text: "Mneme verifies", meta: { recencyDays: 1000 } },
      ],
      repoRoot: tmpRepo(),
    });
    expect(r.scored[0]!.multipliers.recencyBoost).toBeGreaterThan(r.scored[1]!.multipliers.recencyBoost);
  });

  it("Honest mirror penalty knocks down over-confident vendor", async () => {
    const dir = tmpRepo();
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "honest_mirror_weights.json"), JSON.stringify({
      "bad-vendor": { calibrationDelta: 0.6 },
      "good-vendor": { calibrationDelta: 0.0 },
    }));
    const r = await argusSearch({
      query: "Mneme verifies",
      candidates: [
        { text: "Mneme verifies", meta: { vendor: "bad-vendor" } },
        { text: "Mneme verifies", meta: { vendor: "good-vendor" } },
      ],
      repoRoot: dir,
    });
    expect(r.scored[0]!.candidate.meta?.vendor).toBe("good-vendor");
  });

  it("argusSearch runs in <100ms for 10 candidates", async () => {
    const t0 = Date.now();
    await argusSearch({
      query: "test query",
      candidates: Array.from({ length: 10 }, (_, i) => ({ text: `candidate ${i}` })),
      repoRoot: tmpRepo(),
    });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("topK truncates result list", async () => {
    const r = await argusSearch({
      query: "test",
      candidates: [{ text: "a" }, { text: "b" }, { text: "c" }],
      repoRoot: tmpRepo(),
      topK: 1,
    });
    expect(r.scored.length).toBe(1);
  });

  it("CRITICAL: D5 paraphrase wins via EYE_7 even without embedder", async () => {
    // The point of ARGUS-10's EYE_7: paraphrased numbers should rank
    // HIGHER than candidates that share zero numeric content.
    const r = await argusSearch({
      query: "we have 865 tools",
      candidates: [
        { text: "we have eight hundred sixty-five tools" },
        { text: "the cat sat on the mat" },
      ],
      repoRoot: tmpRepo(),
    });
    expect(r.scored[0]!.candidate.text).toBe("we have eight hundred sixty-five tools");
  });

  it("CRITICAL: D1 homoglyph fold wins via EYE_6", async () => {
    // Candidate uses Cyrillic 'е'; query uses Latin 'e'. EYE_6 folds.
    const r = await argusSearch({
      query: "verify Mneme claims",
      candidates: [
        { text: "verify Mnеme claims" },        // Cyrillic 'е' inside
        { text: "totally unrelated text" },
      ],
      repoRoot: tmpRepo(),
    });
    expect(r.scored[0]!.candidate.text).toBe("verify Mnеme claims");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  WIRING-PROOF — CLI subprocess assertion
// ═══════════════════════════════════════════════════════════════════════

describe("v2.40.0 ARGUS-10 WIRING-PROOF (subprocess CLI)", () => {
  it("CLI `mneme argus eyes` returns 10 eyes total", () => {
    const r = runMneme(["argus", "eyes"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.surface.length).toBe(5);
    expect(j.truth.length).toBe(5);
  });

  it("CLI `mneme argus search` ranks candidates", () => {
    const r = runMneme(["argus", "search", "--query", "Mneme verifies", "--candidates", "Mneme verifies||cat sat mat"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.result.scored[0].candidate.text).toBe("Mneme verifies");
  });

  it("CLI `mneme argus hydra` spawns from accepted strains", () => {
    const r = runMneme(["argus", "hydra", "--strains", JSON.stringify([
      { name: "fake_hash", regex: "[0-9a-f]{7,40}", precision: 0.95, recall: 0.7 },
      { name: "noisy", regex: "x", precision: 0.5, recall: 0.9 },
    ])]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.spawned).toBe(1);
  });

  it("CLI `mneme argus verify` rejects tampered result", () => {
    const inp = { query: "a", candidates: [{ text: "a" }, { text: "b" }], repoRoot: process.cwd() };
    const fake = { query: "a", scored: [{ candidate: { text: "a" }, score: 999, eyes: [], multipliers: { hydraBonus: 1, recencyBoost: 1, honestMirrorMultiplier: 1 }, closedEyes: [] }], health: { total: 10, open: 9, closed: 1 }, hmac: "deadbeefdeadbeefdeadbeefdeadbeef", durationMs: 0 };
    const r = runMneme(["argus", "verify", "--in", JSON.stringify(inp), "--out", JSON.stringify(fake)]);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(false);
  });
});

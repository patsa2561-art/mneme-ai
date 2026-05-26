// v2.56.0 — xAI / GROK / SpaceX ALIGNMENT
//
// Closes 6 "Musk-would-critic" gaps from v2.55 audit + adds 3 wild primitives:
//   🔴 Grok promoted from EMBEDDER_LEAK → AGENT_VENDOR_ALLOWLIST
//   🟢 Grok classifier signature + 15 seed fixtures
//   🚀 LAUNCH WINDOW — SpaceX-style GO/NO-GO release verdict aggregator
//   🔥 DRAGON EJECT  — emergency rollback + GAVEL-grade forensic bundle
//   🛡 STARGATE      — open-source publish augmented calibration corpus
//   🌐 NIMBUS Colossus cluster field

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");
function runMneme(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string> } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 120_000, input: opts.input, cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GROK.1 — first-class agent vendor
// ═══════════════════════════════════════════════════════════════════════

describe("v2.56.0 GROK.1 — first-class vendor (PINNED)", () => {
  it("G1.1 grok + xai-grok IN AGENT_VENDOR_ALLOWLIST", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    expect(m.AGENT_VENDOR_ALLOWLIST.has("grok")).toBe(true);
    expect(m.AGENT_VENDOR_ALLOWLIST.has("xai-grok")).toBe(true);
    expect(m.AGENT_VENDOR_ALLOWLIST.has("grok-cli")).toBe(true);
    expect(m.AGENT_VENDOR_ALLOWLIST.has("grok-code-fast")).toBe(true);
  });

  it("G1.2 grok + xai-grok NOT in EMBEDDER_LEAK_SIGNATURES", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    expect(m.EMBEDDER_LEAK_SIGNATURES.has("grok")).toBe(false);
    expect(m.EMBEDDER_LEAK_SIGNATURES.has("xai-grok")).toBe(false);
  });

  it("G1.3 guardVendor accepts grok without coercion", async () => {
    const m = await import("../../packages/core/src/nemesis/vendor_allowlist.js");
    const r = m.guardVendor("grok");
    expect(r.leakDetected).toBe(false);
    expect(r.vendor).toBe("grok");
  });

  it("G1.4 env_scan picks up GROK_API_KEY → vendor=grok", async () => {
    const m = await import("../../packages/core/src/nemesis/env_scan.js");
    const r = m.scanEnv({ GROK_API_KEY: "xai-test-key-1234567890" });
    expect(r.vendor).toBe("grok");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("G1.5 seed corpus has 15 Grok fixtures", async () => {
    const m = await import("../../packages/core/src/nemesis/calibration_corpus.js");
    const seed = m.buildSeedCorpus();
    const grok = seed.filter((s) => s.vendor === "grok");
    expect(grok.length).toBe(15);
    expect(grok[0]!.fixture.diff).toMatch(/dispatch/);
  });

  it("G1.6 classifier SIGNATURES has grok entry", async () => {
    const m = await import("../../packages/core/src/nemesis/classifier.js");
    const sigs = m.SIGNATURES as ReadonlyArray<{ vendor: string }>;
    expect(sigs.some((s) => s.vendor === "grok")).toBe(true);
  });

  it("G1.7 classify Grok-shaped fixture → topVendor='grok'", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const c = await import("../../packages/core/src/nemesis/calibration_corpus.js");
    const grokFx = c.buildSeedCorpus().find((s) => s.vendor === "grok")!.fixture;
    const fp = m.extractFingerprint(grokFx);
    const v = m.classifyAgent(fp);
    expect(v.topVendor).toBe("grok");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  LAUNCH.1 — LAUNCH WINDOW SpaceX-style verdict aggregator
// ═══════════════════════════════════════════════════════════════════════

describe("v2.56.0 LAUNCH WINDOW (PINNED)", () => {
  it("LW.1 evaluateLaunchWindow returns verdict with ≥5 gates", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: resolve(__dirname, "../.."), fast: true });
    expect(v.gates.length).toBeGreaterThanOrEqual(5);
    expect(["GO", "NO-GO", "HOLD"]).toContain(v.status);
    expect(typeof v.goRate).toBe("number");
    expect(v.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("LW.2 countdown phrase matches status", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: resolve(__dirname, "../.."), fast: true });
    if (v.status === "GO") expect(v.countdown).toMatch(/T-0 GO/);
    if (v.status === "HOLD") expect(v.countdown).toMatch(/T\+HOLD/);
    if (v.status === "NO-GO") expect(v.countdown).toMatch(/T-NO-GO/);
  });

  it("LW.3 verifyLaunchVerdict roundtrips + tamper fails", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: resolve(__dirname, "../.."), fast: true });
    expect(m.verifyLaunchVerdict(v)).toBe(true);
    const tampered = { ...v, countdown: "T-0 TAMPERED" };
    expect(m.verifyLaunchVerdict(tampered)).toBe(false);
  });

  it("LW.4 renderLaunchBanner returns multi-line ASCII", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: resolve(__dirname, "../.."), fast: true });
    const banner = m.renderLaunchBanner(v);
    expect(banner.split("\n").length).toBeGreaterThan(3);
    expect(banner).toMatch(/LAUNCH WINDOW/);
  });

  it("LW.5 each gate has gate name + status + evidence + latencyMs", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const v = await m.evaluateLaunchWindow({ cwd: resolve(__dirname, "../.."), fast: true });
    for (const g of v.gates) {
      expect(g.gate).toBeTruthy();
      expect(["GO", "NO-GO", "HOLD"]).toContain(g.status);
      expect(g.evidence).toBeTruthy();
      expect(typeof g.latencyMs).toBe("number");
    }
  });

  it("LW.6 CLI `mneme launch_window --fast` returns JSON envelope", () => {
    const r = runMneme(["launch_window", "--fast"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(typeof j.status).toBe("string");
    expect(j.gates.length).toBeGreaterThanOrEqual(5);
    expect(r.stderr).toMatch(/LAUNCH WINDOW/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  DRAGON.1 — emergency eject primitive
// ═══════════════════════════════════════════════════════════════════════

describe("v2.56.0 DRAGON EJECT (PINNED)", () => {
  it("D1.1 dryRun build receipt without git revert", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.dragonEject({
      repoRoot: dir,
      commit: "abc1234",
      reason: { rationale: "test eject — fix broke prod" },
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.event?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(r.event?.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("D1.2 non-hex commit hash rejected", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.dragonEject({
      repoRoot: dir,
      commit: "not-a-hash",
      reason: { rationale: "test" },
      dryRun: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/7-40 hex/);
  });

  it("D1.3 missing rationale rejected", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.dragonEject({
      repoRoot: dir,
      commit: "abc1234",
      reason: { rationale: "" },
      dryRun: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/rationale required/i);
  });

  it("D1.4 non-dry-run without --confirm rejected", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.dragonEject({
      repoRoot: dir,
      commit: "abc1234",
      reason: { rationale: "x" },
      dryRun: false,
      confirm: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/--confirm required/i);
  });

  it("D1.5 verifyEjectEvent round-trips + tampered fails", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.dragonEject({
      repoRoot: dir,
      commit: "abc1234",
      reason: { rationale: "x" },
      dryRun: true,
    });
    expect(m.verifyEjectEvent(r.event!).ok).toBe(true);
    const tampered = { ...r.event!, rationale: "evil" };
    expect(m.verifyEjectEvent(tampered).ok).toBe(false);
  });

  it("D1.6 verifyDragonChain on empty ledger returns ok=true", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-dragon-"));
    const r = m.verifyDragonChain(dir);
    expect(r.ok).toBe(true);
    expect(r.rows).toBe(0);
  });

  it("D1.7 CLI `mneme dragon eject` returns JSON envelope (dry-run default)", () => {
    const r = runMneme(["dragon", "eject", "abc1234", "--rationale", "test"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.event?.hmac).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  STARGATE.1 — open-source corpus publisher
// ═══════════════════════════════════════════════════════════════════════

describe("v2.56.0 STARGATE (PINNED)", () => {
  it("S1.1 buildStargateBundle returns ≥6 vendors + ≥6 augmentation kinds", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const b = m.buildStargateBundle("test-v");
    expect(b.vendors.length).toBeGreaterThanOrEqual(6);
    expect(b.augmentationKinds.length).toBeGreaterThanOrEqual(6);
    expect(b.fixtureCount).toBeGreaterThan(0);
    expect(b.license).toBe("MIT");
  });

  it("S1.2 verifyStargateBundle accepts genuine + rejects content tamper", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const b = m.buildStargateBundle("v1");
    expect(m.verifyStargateBundle(b).ok).toBe(true);
    const tampered = { ...b, fixtures: b.fixtures.slice(0, 5) };
    expect(m.verifyStargateBundle(tampered).ok).toBe(false);
  });

  it("S1.3 publishStargate(no outPath) returns in-memory bundle", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const r = m.publishStargate({ mnemeVersion: "v1" });
    expect(r.ok).toBe(true);
    expect(r.bundle?.fixtureCount).toBeGreaterThan(0);
    expect(r.path).toBeUndefined();
  });

  it("S1.4 publishStargate(outPath) writes file in chosen format", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-stargate-"));
    const p = join(dir, "bundle.jsonl");
    const r = m.publishStargate({ outPath: p, format: "jsonl", mnemeVersion: "v1" });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(p);
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body.split("\n").filter(Boolean).length).toBe(r.bundle!.fixtureCount);
  });

  it("S1.5 publishStargate format=md renders markdown with citation", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-stargate-"));
    const p = join(dir, "bundle.md");
    const r = m.publishStargate({ outPath: p, format: "md", mnemeVersion: "v1" });
    expect(r.ok).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toMatch(/# Mneme STARGATE Corpus/);
    expect(body).toMatch(/MIT/);
    expect(body).toMatch(/SHA-256/);
  });

  it("S1.6 citation includes vendor count + augmentation kind count", async () => {
    const m = await import("../../packages/core/src/xai_alignment/index.js");
    const b = m.buildStargateBundle("v1");
    expect(b.citation).toMatch(new RegExp(`${b.vendors.length} vendors`));
    expect(b.citation).toMatch(/augmentation kinds/);
  });

  it("S1.7 CLI `mneme stargate publish` (no out) returns bundle metadata", () => {
    const r = runMneme(["stargate", "publish"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.fixtureCount).toBeGreaterThan(0);
    expect(j.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  NIMBUS.cluster — Colossus / xAI cluster naming extension
// ═══════════════════════════════════════════════════════════════════════

describe("v2.56.0 NIMBUS Colossus cluster (PINNED)", () => {
  it("NC.1 publishCard with cluster field preserves it in the signed envelope", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-nimbus-"));
    const r = m.publishCard({
      repoRoot: dir,
      orgTag: "xai",
      cluster: { name: "colossus", region: "memphis", role: "training" },
      persist: false,
    });
    expect(r.ok).toBe(true);
    expect(r.card?.cluster?.name).toBe("colossus");
    expect(r.card?.cluster?.region).toBe("memphis");
    expect(r.card?.cluster?.role).toBe("training");
  });

  it("NC.2 cluster-aware card still verifies HMAC", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-nimbus-"));
    const r = m.publishCard({
      repoRoot: dir,
      orgTag: "xai",
      cluster: { name: "colossus" },
      persist: false,
    });
    expect(m.verifyCard(r.card!).ok).toBe(true);
  });

  it("NC.3 card WITHOUT cluster still works (backward compat)", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v56-nimbus-"));
    const r = m.publishCard({ repoRoot: dir, orgTag: "x", persist: false });
    expect(r.card?.cluster).toBeUndefined();
    expect(m.verifyCard(r.card!).ok).toBe(true);
  });
});

void writeFileSync; void mkdirSync; void appendFileSync;

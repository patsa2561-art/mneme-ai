// v2.54.0 — WORLD-CLASS PREMIUM additions (Tier 2 / Tier 3 from v2.53 audit)
//
// New primitives:
//   🧠 LETHE      — GDPR forget with Merkle exclusion proof
//   ⚖ GAVEL      — court-admissible bundle (THEMIS + EU stamp + SIBYL)
//   🌐 NIMBUS     — federated trust mesh (per-org leaderboard pub/sub)
//   🎯 PERF        — performance budget infrastructure
//   🏛 INDISPENSABILITY — 6-criterion measurable checklist
//   📜 STRATEGY   — RFC drafts + pricing tiers as primitive

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
//  🧠 LETHE — GDPR forget with Merkle exclusion proof
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 🧠 LETHE (PINNED)", () => {
  it("L.1 buildMerkleTree returns root + leaves for non-empty input", async () => {
    const m = await import("../../packages/core/src/nemesis/lethe.js");
    const t = m.buildMerkleTree(["a", "b", "c", "d"]);
    expect(t.root).toMatch(/^[0-9a-f]{64}$/);
    expect(t.leaves.length).toBe(4);
    expect(t.count).toBe(4);
  });

  it("L.2 buildInclusionProof + verifyInclusionProof round-trip", async () => {
    const m = await import("../../packages/core/src/nemesis/lethe.js");
    const rows = ["alpha", "beta", "gamma", "delta", "epsilon"];
    for (let i = 0; i < rows.length; i++) {
      const p = m.buildInclusionProof(rows, i);
      expect(p).toBeTruthy();
      const tree = m.buildMerkleTree(rows);
      expect(m.verifyInclusionProof(p!.leafHash, p!.proof, tree.root)).toBe(true);
    }
  });

  it("L.3 forgetRow on tmp ledger writes sentinel + emits receipt", async () => {
    const m = await import("../../packages/core/src/nemesis/lethe.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-lethe-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const p = join(dir, ".mneme", "test.jsonl");
    writeFileSync(p, ["row1", "row2", "row3"].map((r) => JSON.stringify({ data: r })).join("\n") + "\n");
    const r = m.forgetRow({ repoRoot: dir, ledgerRelative: ".mneme/test.jsonl", rowIndex: 1 });
    expect(r.ok).toBe(true);
    expect(r.receipt?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(p + ".pre-lethe.bak")).toBe(true);
    const newBody = readFileSync(p, "utf8");
    expect(newBody).toMatch(/"forgotten":true/);
  });

  it("L.4 dry-run does not modify the ledger", async () => {
    const m = await import("../../packages/core/src/nemesis/lethe.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-lethe-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    const p = join(dir, ".mneme", "test.jsonl");
    const original = `{"a":1}\n{"b":2}\n{"c":3}\n`;
    writeFileSync(p, original);
    const r = m.forgetRow({ repoRoot: dir, ledgerRelative: ".mneme/test.jsonl", rowIndex: 1, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.receipt).toBeTruthy();
    expect(readFileSync(p, "utf8")).toBe(original);
  });

  it("L.5 verifyForgetReceipt confirms genuine receipt + rejects tampered", async () => {
    const m = await import("../../packages/core/src/nemesis/lethe.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-lethe-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "x.jsonl"), `{"a":1}\n{"b":2}\n{"c":3}\n`);
    const r = m.forgetRow({ repoRoot: dir, ledgerRelative: ".mneme/x.jsonl", rowIndex: 0, dryRun: true });
    expect(r.receipt).toBeTruthy();
    expect(m.verifyForgetReceipt(r.receipt!).ok).toBe(true);
    const tampered = { ...r.receipt!, forgottenIndex: 99 };
    expect(m.verifyForgetReceipt(tampered).ok).toBe(false);
  });

  it("L.6 CLI `mneme nemesis lethe_forget --dry-run` returns receipt envelope", () => {
    const dir = mkdtempSync(join(tmpdir(), "v54-lethe-cli-"));
    mkdirSync(join(dir, ".mneme"), { recursive: true });
    writeFileSync(join(dir, ".mneme", "x.jsonl"), `{"a":1}\n{"b":2}\n`);
    const r = runMneme(["nemesis", "lethe_forget", "--ledger", ".mneme/x.jsonl", "--row", "0", "--dry-run"], { cwd: dir });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.receipt.hmac).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ⚖ GAVEL — court-admissible bundle pack
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 ⚖ GAVEL (PINNED)", () => {
  const fx = { diff: "+const x = 1;\n", prDescription: "## Changes\n- a\n- b\n- c\n", commitMessages: ["add x"] };

  it("G.1 buildGavelBundle with alibi only → ok + signed bundle", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: fx });
    const r = m.buildGavelBundle({ commitRef: "test-commit-abc", alibi });
    expect(r.ok).toBe(true);
    expect(r.bundle?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(r.bundle?.artifacts.length).toBe(1);
  });

  it("G.2 buildGavelBundle without alibi → ok=false reason", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const r = m.buildGavelBundle({ commitRef: "x" } as unknown as Parameters<typeof m.buildGavelBundle>[0]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/alibi/i);
  });

  it("G.3 buildGavelBundle with EU stamp adds artifact + verifies", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const eu = await import("../../packages/core/src/nemesis/eu_ai_act_stamp.js");
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: fx });
    const stamped = eu.stampArticle50({ message: "test commit", vendor: "claude-code", confidence: 0.9 });
    const r = m.buildGavelBundle({ commitRef: "with-stamp", alibi, stamp: { stampedMessage: stamped.stampedMessage, stamp: stamped.stamp } });
    expect(r.ok).toBe(true);
    expect(r.bundle?.artifacts.length).toBe(2);
    const v = m.verifyGavelBundle(r.bundle!);
    expect(v.ok).toBe(true);
  });

  it("G.4 verifyGavelBundle catches tampering", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: fx });
    const r = m.buildGavelBundle({ commitRef: "tamper-target", alibi });
    expect(r.bundle).toBeTruthy();
    const tampered = { ...r.bundle!, commitRef: "EVIL-OVERRIDE" };
    const v = m.verifyGavelBundle(tampered);
    expect(v.ok).toBe(false);
  });

  it("G.5 CLI `mneme nemesis gavel_pack --stdin` returns bundle envelope", async () => {
    const m = await import("../../packages/core/src/nemesis/index.js");
    const alibi = m.verifyAlibi({ notVendor: "codex", fixture: fx });
    const r = runMneme(["nemesis", "gavel_pack", "--stdin"], { input: JSON.stringify({ commitRef: "cli-test", alibi }) });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.bundle.merkleRoot).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  🌐 NIMBUS — federated trust mesh
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 🌐 NIMBUS (PINNED)", () => {
  it("N.1 publishCard produces HMAC-signed envelope", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-nimbus-"));
    const r = m.publishCard({ repoRoot: dir, orgTag: "test-org", topByElo: [{ vendor: "claude-code", elo: 1500, n: 100 }] });
    expect(r.ok).toBe(true);
    expect(r.card?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(r.card?.orgFingerprint.length).toBe(16);
  });

  it("N.2 verifyCard accepts genuine + rejects tampered + expired", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-nimbus-"));
    const r = m.publishCard({ repoRoot: dir, orgTag: "test", persist: false });
    expect(m.verifyCard(r.card!).ok).toBe(true);
    const tampered = { ...r.card!, topByElo: [{ vendor: "evil", elo: 9999, n: 1 }] };
    expect(m.verifyCard(tampered).ok).toBe(false);
    const expired = { ...r.card!, consent: { ...r.card!.consent, expiresAt: "2020-01-01T00:00:00Z" } };
    const e = m.verifyCard(expired);
    expect(e.ok).toBe(false);
  });

  it("N.3 subscribeCard verifies + persists to subscriptions ledger", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-nimbus-"));
    const pub = m.publishCard({ repoRoot: dir, orgTag: "publisher", persist: false });
    const sub = m.subscribeCard({ repoRoot: dir, card: pub.card!, trustWeight: 0.7 });
    expect(sub.ok).toBe(true);
    expect(sub.entry?.trustWeight).toBe(0.7);
  });

  it("N.4 computeCrossOrgReputation aggregates weighted scores", async () => {
    const m = await import("../../packages/core/src/nemesis/nimbus.js");
    const dir = mkdtempSync(join(tmpdir(), "v54-nimbus-"));
    const card1 = m.publishCard({ repoRoot: dir, orgTag: "org-1", topByElo: [{ vendor: "claude-code", elo: 1600 }, { vendor: "cursor", elo: 1400 }], persist: false });
    const card2 = m.publishCard({ repoRoot: dir, orgTag: "org-2", topByElo: [{ vendor: "claude-code", elo: 1500 }, { vendor: "codex", elo: 1450 }], persist: false });
    m.subscribeCard({ repoRoot: dir, card: card1.card!, trustWeight: 1.0 });
    m.subscribeCard({ repoRoot: dir, card: card2.card!, trustWeight: 0.5 });
    const reps = m.computeCrossOrgReputation(dir);
    expect(reps.length).toBeGreaterThan(0);
    const claude = reps.find((r) => r.vendor === "claude-code");
    expect(claude).toBeTruthy();
    expect(claude!.contributingOrgs).toBe(2);
  });

  it("N.5 CLI `mneme nemesis nimbus_publish` + nimbus_reputation round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "v54-nimbus-cli-"));
    const pub = runMneme(["nemesis", "nimbus_publish", "--stdin"], { cwd: dir, input: JSON.stringify({ orgTag: "cli-org", topByElo: [{ vendor: "claude-code", elo: 1500 }] }) });
    expect(pub.status).toBe(0);
    const pubJson = JSON.parse(pub.stdout);
    expect(pubJson.ok).toBe(true);
    const sub = runMneme(["nemesis", "nimbus_subscribe", "--stdin", "--trust", "0.8"], { cwd: dir, input: JSON.stringify(pubJson.card) });
    expect(sub.status).toBe(0);
    const rep = runMneme(["nemesis", "nimbus_reputation"], { cwd: dir });
    expect(rep.status).toBe(0);
    const repJson = JSON.parse(rep.stdout);
    expect(repJson.ok).toBe(true);
    expect(repJson.vendors.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  🎯 PERF BUDGET
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 🎯 PERF BUDGET (PINNED)", () => {
  it("PB.1 runPerfBudget executes + returns 5 measurements", async () => {
    const m = await import("../../packages/core/src/perf_budget.js");
    const r = m.runPerfBudget();
    expect(r.measurements.length).toBe(5);
    for (const meas of r.measurements) {
      expect(typeof meas.warmMeanMs).toBe("number");
      expect(typeof meas.warmP95Ms).toBe("number");
      expect(typeof meas.coldFirstMs).toBe("number");
      expect(meas.iterations).toBeGreaterThan(0);
    }
  });

  it("PB.2 all 5 budgets are met (warm-mean < budget)", async () => {
    const m = await import("../../packages/core/src/perf_budget.js");
    const r = m.runPerfBudget();
    expect(r.ok, `Failing budgets: ${r.failing.join("; ")}`).toBe(true);
  });

  it("PB.3 renderPerfBudgetReport returns multi-line text", async () => {
    const m = await import("../../packages/core/src/perf_budget.js");
    const r = m.runPerfBudget();
    const txt = m.renderPerfBudgetReport(r);
    expect(txt).toMatch(/PERF BUDGET/);
    expect(txt.split("\n").length).toBeGreaterThan(5);
  });

  it("PB.4 CLI `mneme perf budget` returns JSON envelope", () => {
    const r = runMneme(["perf", "budget"]);
    expect(r.status).toBeLessThan(2);
    const j = JSON.parse(r.stdout);
    expect(j.measurements).toBeTruthy();
    expect(j.measurements.length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  🏛 INDISPENSABILITY
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 🏛 INDISPENSABILITY (PINNED)", () => {
  it("I.1 evaluateIndispensability returns 6 criteria with weighted score", async () => {
    const m = await import("../../packages/core/src/indispensability.js");
    const r = m.evaluateIndispensability(resolve(__dirname, "../.."));
    expect(r.criteria.length).toBe(6);
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(1);
    expect(r.percent).toBeGreaterThanOrEqual(0);
    expect(r.percent).toBeLessThanOrEqual(100);
  });

  it("I.2 each criterion carries evidence + target + weight", async () => {
    const m = await import("../../packages/core/src/indispensability.js");
    const r = m.evaluateIndispensability(resolve(__dirname, "../.."));
    for (const c of r.criteria) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(typeof c.weight).toBe("number");
      expect(c.evidence).toBeTruthy();
      expect(c.target).toBeTruthy();
      expect(["met", "partial", "not-met"]).toContain(c.status);
    }
  });

  it("I.3 indispensability score ≥ 0.5 on the live repo", async () => {
    const m = await import("../../packages/core/src/indispensability.js");
    const r = m.evaluateIndispensability(resolve(__dirname, "../.."));
    expect(r.overallScore).toBeGreaterThanOrEqual(0.5);
  });

  it("I.4 CLI `mneme indispensability` returns JSON envelope", () => {
    const r = runMneme(["indispensability"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(typeof j.overallScore).toBe("number");
    expect(j.criteria.length).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  📜 STRATEGY (RFC drafts + pricing tiers)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.54.0 📜 STRATEGY (PINNED)", () => {
  it("S.1 getStrategyReport returns ≥3 RFC drafts + ≥4 pricing tiers", async () => {
    const m = await import("../../packages/core/src/strategy.js");
    const r = m.getStrategyReport();
    expect(r.rfcDrafts.length).toBeGreaterThanOrEqual(3);
    expect(r.pricing.length).toBeGreaterThanOrEqual(4);
  });

  it("S.2 each RFC has id + title + status + target body + abstract", async () => {
    const m = await import("../../packages/core/src/strategy.js");
    for (const rfc of m.RFC_DRAFTS) {
      expect(rfc.id).toMatch(/^RFC-\d{3}$/);
      expect(rfc.title).toBeTruthy();
      expect(["draft", "in-review", "submitted", "accepted", "deferred"]).toContain(rfc.status);
      expect(["W3C", "ECMA", "NIST", "IETF", "ISO", "EU-DPA"]).toContain(rfc.targetBody);
      expect(rfc.abstract.length).toBeGreaterThan(50);
    }
  });

  it("S.3 each pricing tier has audience + price + benefits", async () => {
    const m = await import("../../packages/core/src/strategy.js");
    for (const t of m.PRICING_TIERS) {
      expect(t.name).toBeTruthy();
      expect(t.audience).toBeTruthy();
      expect(t.price).toBeTruthy();
      expect(Array.isArray(t.benefits)).toBe(true);
      expect(t.benefits.length).toBeGreaterThan(0);
    }
  });

  it("S.4 RFC docs files exist on disk", () => {
    const docsDir = resolve(__dirname, "../../docs/rfc");
    expect(existsSync(join(docsDir, "RFC-001-disclosure-format.md"))).toBe(true);
    expect(existsSync(join(docsDir, "RFC-002-cross-vendor-handoff.md"))).toBe(true);
    expect(existsSync(join(docsDir, "RFC-003-fingerprint-identity-standard.md"))).toBe(true);
  });

  it("S.5 CLI `mneme strategy rfc` + pricing return JSON envelopes", () => {
    const rfc = runMneme(["strategy", "rfc"]);
    expect(rfc.status).toBe(0);
    const rj = JSON.parse(rfc.stdout);
    expect(rj.rfcDrafts.length).toBeGreaterThanOrEqual(3);
    const pricing = runMneme(["strategy", "pricing"]);
    expect(pricing.status).toBe(0);
    const pj = JSON.parse(pricing.stdout);
    expect(pj.pricing.length).toBeGreaterThanOrEqual(4);
  });
});

void appendFileSync; // referenced for tests that build chains

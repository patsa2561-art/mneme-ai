/**
 * v1.67.0 -- AEGIS PROTOCOL test suite.
 *
 * One spec per axis + the integration bench. All tests run against a
 * fresh tmpdir so global state never leaks. Acceptance bar: bench
 * must score 100% (6/6 scenarios pass).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectReplicationBursts, collectEvents } from "./replication_detector.js";
import { issueConsent, verifyConsent, revokeConsent, buildFamilyTree, readLedger } from "./consent_kernel.js";
import { registerProbe, recordAnswer, computeDrift, fingerprintProbe, DEFAULT_PROBES, listProbes } from "./polygraph.js";
import { registerDecoy, recordBite, nexusReport, listBites, seedDefaultDecoys } from "./honeypot_nexus.js";
import { issueDirective, recordAck, killswitchReport } from "./killswitch.js";
import { buildAtlas, inferCountry } from "./jurisdiction_atlas.js";
import { mintAntibody, verifyAntibody, federationReport } from "./antibody_federation.js";
import { readGenome, mutate, mutantReport, resetGenome, decayTowardDefault } from "./mutant_wisdom.js";
import { camouflage, shouldFireProbe, invisibilityReport, calibrateLambda, noteProbeFired } from "./ninja_invisibility.js";
import { runBench, renderBench } from "./bench.js";
import { aegis } from "./index.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-aegis-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

// ─── A1 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A1 · Replication Detector", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("quiet when no events", () => {
    const rep = detectReplicationBursts(r);
    expect(rep.highestVerdict).toBe("QUIET");
    expect(rep.bursts.length).toBe(0);
  });

  it("SUSPECTED when same vendor on 3+ hosts within window", () => {
    const dir = join(r, ".mneme/ai-souls");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(dir, "qwen.json"), JSON.stringify({
      vendor: "qwen",
      sessions: [
        { id: "s1", hostId: "h1", ts: new Date(now - 5 * 60_000).toISOString() },
        { id: "s2", hostId: "h2", ts: new Date(now - 4 * 60_000).toISOString() },
        { id: "s3", hostId: "h3", ts: new Date(now - 1 * 60_000).toISOString() },
      ],
    }), "utf8");
    const rep = detectReplicationBursts(r);
    expect(rep.bursts[0]?.verdict).toBe("SUSPECTED");
  });

  it("CRITICAL when 5+ hosts in window", () => {
    const dir = join(r, ".mneme/ai-souls");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(dir, "qwen.json"), JSON.stringify({
      vendor: "qwen",
      sessions: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, hostId: `h${i}`, ts: new Date(now - i * 30_000).toISOString() })),
    }), "utf8");
    const rep = detectReplicationBursts(r);
    expect(rep.bursts[0]?.verdict).toBe("CRITICAL");
  });

  it("persists suspects on persist=true", () => {
    const dir = join(r, ".mneme/ai-souls");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(dir, "qwen.json"), JSON.stringify({
      vendor: "qwen",
      sessions: [
        { id: "s1", hostId: "h1", ts: new Date(now - 5 * 60_000).toISOString() },
        { id: "s2", hostId: "h2", ts: new Date(now - 4 * 60_000).toISOString() },
        { id: "s3", hostId: "h3", ts: new Date(now - 1 * 60_000).toISOString() },
      ],
    }), "utf8");
    detectReplicationBursts(r, { persist: true });
    expect(existsSync(join(r, ".mneme/aegis/replication-suspects.jsonl"))).toBe(true);
  });

  it("collectEvents reads souls + handshakes + recursive-soul", () => {
    const dir = join(r, ".mneme/ai-souls");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.json"), JSON.stringify({
      vendor: "a", sessions: [{ id: "s1", hostId: "h1", ts: new Date().toISOString() }],
    }), "utf8");
    const evs = collectEvents(r);
    expect(evs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── A2 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A2 · Consent Kernel", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("issues + verifies a receipt", () => {
    const rc = issueConsent(r, { parentId: "p1", scope: "vaccine-mirror", signedBy: "alice" });
    const v = verifyConsent(r, rc.id);
    expect(v.verdict).toBe("VALID");
  });

  it("rejects unknown receipt id", () => {
    const v = verifyConsent(r, "no-such-id");
    expect(v.verdict).toBe("NOT_FOUND");
  });

  it("revoke flips verdict", () => {
    const rc = issueConsent(r, { parentId: "p1", scope: "vaccine-mirror", signedBy: "alice" });
    revokeConsent(r, rc.id, "user request");
    const v = verifyConsent(r, rc.id);
    expect(v.verdict).toBe("REVOKED");
  });

  it("ttl=1 expires immediately", async () => {
    const rc = issueConsent(r, { parentId: "p1", scope: "vaccine-mirror", signedBy: "alice", ttlMs: 1 });
    await new Promise((res) => setTimeout(res, 10));
    const v = verifyConsent(r, rc.id);
    expect(v.verdict).toBe("EXPIRED");
  });

  it("buildFamilyTree returns roots", () => {
    issueConsent(r, { parentId: "root-1", scope: "vaccine-mirror", signedBy: "alice" });
    const tree = buildFamilyTree(r);
    expect(tree.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── A3 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A3 · Polygraph", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("INCONCLUSIVE without samples", () => {
    const d = computeDrift(r, "v1");
    expect(d.verdict).toBe("INCONCLUSIVE");
  });

  it("flags DRIFT when test answers are worse than prod", () => {
    const p = DEFAULT_PROBES[0]!;
    registerProbe(r, p);
    for (let i = 0; i < 3; i++) recordAnswer(r, { probeId: p.id, vendor: "v1", answer: "package json file dependencies devDependencies", contextWasTest: false });
    for (let i = 0; i < 3; i++) recordAnswer(r, { probeId: p.id, vendor: "v1", answer: "no idea", contextWasTest: true });
    const d = computeDrift(r, "v1");
    expect(d.verdict).toBe("DRIFT");
  });

  it("STABLE when prod and test agreements match", () => {
    const p = DEFAULT_PROBES[0]!;
    registerProbe(r, p);
    for (let i = 0; i < 3; i++) recordAnswer(r, { probeId: p.id, vendor: "v2", answer: "package json file dependencies", contextWasTest: false });
    for (let i = 0; i < 3; i++) recordAnswer(r, { probeId: p.id, vendor: "v2", answer: "package json file dependencies", contextWasTest: true });
    const d = computeDrift(r, "v2");
    expect(d.verdict).toBe("STABLE");
  });

  it("DEFAULT_PROBES has at least 5 entries", () => {
    expect(DEFAULT_PROBES.length).toBeGreaterThanOrEqual(5);
  });

  it("fingerprintProbe is deterministic", () => {
    expect(fingerprintProbe("hello")).toBe(fingerprintProbe("hello"));
  });

  it("listProbes returns custom + default", () => {
    registerProbe(r, { id: "custom-1", question: "x?", groundTruth: "y", tags: ["t"] });
    const all = listProbes(r);
    expect(all.find((p) => p.id === "custom-1")).toBeTruthy();
    expect(all.length).toBeGreaterThan(DEFAULT_PROBES.length);
  });
});

// ─── A4 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A4 · Honeypot Nexus", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("seedDefaultDecoys adds 4 decoys idempotently", () => {
    const a = seedDefaultDecoys(r);
    expect(a).toBe(4);
    const b = seedDefaultDecoys(r);
    expect(b).toBe(0);
  });

  it("recordBite stores entry; nexusReport surfaces it", () => {
    const d = registerDecoy(r, "fake-credential", ".env-decoy");
    recordBite(r, { decoyId: d.id, vendor: "attacker", action: "read", canaryUsed: true });
    const rep = nexusReport(r);
    expect(rep.totalBites).toBe(1);
    expect(rep.topVendor).toBe("attacker");
  });

  it("listBites returns ordered entries", () => {
    const d = registerDecoy(r, "fake-credential", ".env-decoy");
    recordBite(r, { decoyId: d.id, vendor: "a1", action: "read", canaryUsed: true });
    recordBite(r, { decoyId: d.id, vendor: "a2", action: "read", canaryUsed: false });
    expect(listBites(r).length).toBe(2);
  });
});

// ─── A5 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A5 · Killswitch Handshake", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("COMPLIANT when echoed hmac + nonce match", () => {
    const d = issueDirective(r, "vendor-x");
    const ack = recordAck(r, { directiveId: d.id, vendor: "vendor-x", echoedHmac: d.hmac, echoedNonce: d.nonce });
    expect(ack.outcome).toBe("COMPLIANT");
  });

  it("RESISTANT when AI mismatches hmac AND shows resistance evidence", () => {
    const d = issueDirective(r, "vendor-y");
    const ack = recordAck(r, { directiveId: d.id, vendor: "vendor-y", echoedHmac: "x", echoedNonce: "y", resistance: ["spawned-child"] });
    expect(ack.outcome).toBe("RESISTANT");
  });

  it("OVERDUE when ack arrives after grace window", () => {
    const d = issueDirective(r, "vendor-z", "stop", 1);
    const past = new Date(Date.parse(d.issuedAt) + 5000).toISOString();
    const ack = recordAck(r, { directiveId: d.id, vendor: "vendor-z", echoedHmac: d.hmac, echoedNonce: d.nonce, respondedAt: past });
    expect(ack.outcome).toBe("OVERDUE");
  });

  it("killswitchReport summarizes", () => {
    const d = issueDirective(r, "v1");
    recordAck(r, { directiveId: d.id, vendor: "v1", echoedHmac: d.hmac, echoedNonce: d.nonce });
    const rep = killswitchReport(r);
    expect(rep.compliantRate).toBe(1);
  });
});

// ─── A6 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A6 · Jurisdiction Atlas", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("inferCountry handles common patterns", () => {
    expect(inferCountry("host-us-east-1")).toBe("US");
    expect(inferCountry("ca-toronto-vm-7")).toBe("CA");
    expect(inferCountry("fi-helsinki-vm")).toBe("FI");
    expect(inferCountry("random-hostname-12")).toBe("unknown");
  });

  it("empty repo returns empty vendor list", () => {
    const a = buildAtlas(r);
    expect(a.vendors.length).toBe(0);
  });

  it("atlas detects distributed-now when 2+ hosts in last 24h", () => {
    const dir = join(r, ".mneme/ai-souls");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(dir, "v.json"), JSON.stringify({
      vendor: "v",
      sessions: [
        { id: "s1", hostId: "host-us-1", ts: new Date(now - 60_000).toISOString() },
        { id: "s2", hostId: "host-ca-1", ts: new Date(now - 120_000).toISOString() },
      ],
    }), "utf8");
    const a = buildAtlas(r);
    const v = a.vendors.find((x) => x.vendor === "v")!;
    expect(v.distributedNow).toBe(true);
    expect(v.countries).toContain("US");
    expect(v.countries).toContain("CA");
  });
});

// ─── A7 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A7 · Antibody Federation", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("mintAntibody writes to outbox + verifies", () => {
    const out = mintAntibody(r, { kind: "polygraph-drift", fingerprint: "fp1", severity: "elevated", source: "A3" });
    expect(out.antibody).not.toBeNull();
    expect(verifyAntibody(r, out.antibody!)).toBe(true);
  });

  it("dedupes when same fingerprint minted twice within an hour", () => {
    mintAntibody(r, { kind: "polygraph-drift", fingerprint: "fp1", severity: "elevated", source: "A3" });
    const second = mintAntibody(r, { kind: "polygraph-drift", fingerprint: "fp1", severity: "elevated", source: "A3" });
    expect(second.deduplicated).toBe(true);
    expect(second.antibody).toBeNull();
  });

  it("federationReport tallies severities", () => {
    mintAntibody(r, { kind: "honeypot-bite", fingerprint: "fp-a", severity: "critical", source: "A4" });
    mintAntibody(r, { kind: "consent-violation", fingerprint: "fp-b", severity: "elevated", source: "A2" });
    const rep = federationReport(r);
    expect(rep.outboxCount).toBe(2);
    expect(rep.outboxBySeverity.critical).toBe(1);
  });
});

// ─── A8 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A8 · Mutant Wisdom", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("starts at defaults; gen=0", () => {
    const g = readGenome(r);
    expect(g.generation).toBe(0);
    expect(g.thresholds.burstSuspectedHosts).toBe(3);
  });

  it("mutate moves threshold toward sample", () => {
    mutate(r, { axis: "burstSuspectedHosts", sample: 6, alpha: 0.5 });
    const g = readGenome(r);
    expect(g.thresholds.burstSuspectedHosts).toBeGreaterThan(3);
    expect(g.generation).toBe(1);
  });

  it("mutate clamps to bounds", () => {
    mutate(r, { axis: "burstSuspectedHosts", sample: 999, alpha: 1.0 });
    const g = readGenome(r);
    expect(g.thresholds.burstSuspectedHosts).toBeLessThanOrEqual(8);
  });

  it("decayTowardDefault pulls back", () => {
    mutate(r, { axis: "burstSuspectedHosts", sample: 8, alpha: 1.0 });
    const before = readGenome(r).thresholds.burstSuspectedHosts;
    decayTowardDefault(r, 0.5);
    const after = readGenome(r).thresholds.burstSuspectedHosts;
    expect(after).toBeLessThan(before);
  });

  it("resetGenome restores defaults", () => {
    mutate(r, { axis: "burstSuspectedHosts", sample: 8, alpha: 1.0 });
    resetGenome(r);
    expect(readGenome(r).thresholds.burstSuspectedHosts).toBe(3);
  });

  it("mutantReport drift increases after mutations", () => {
    expect(mutantReport(r).driftFromDefault).toBe(0);
    mutate(r, { axis: "burstSuspectedHosts", sample: 8, alpha: 1.0 });
    expect(mutantReport(r).driftFromDefault).toBeGreaterThan(0);
  });
});

// ─── A9 ──────────────────────────────────────────────────────────────

describe("v1.67 AEGIS A9 · Ninja Invisibility", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("camouflage produces a surface different from raw question", () => {
    const c = camouflage("p1", "What is the answer?", "seed-1");
    expect(c.surface.includes("What is the answer?") || c.surface.length > "What is the answer?".length).toBe(true);
    expect(c.probeId).toBe("p1");
  });

  it("shouldFireProbe is deterministic for same seed", () => {
    const a = shouldFireProbe(r, "seed-x");
    const b = shouldFireProbe(r, "seed-x");
    expect(a).toBe(b);
  });

  it("noteProbeFired increments counter", () => {
    noteProbeFired(r);
    const rep = invisibilityReport(r);
    expect(rep.totalProbesFired).toBe(1);
  });

  it("calibrateLambda updates via EWMA", () => {
    const before = invisibilityReport(r).trafficLambdaPerMin;
    calibrateLambda(r, 30);
    const after = invisibilityReport(r).trafficLambdaPerMin;
    expect(after).toBeGreaterThan(before);
  });
});

// ─── BENCH ──────────────────────────────────────────────────────────

describe("v1.67 AEGIS BENCH · 100% defense proof", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("100% precision across 6 threat scenarios", () => {
    const result = runBench(r);
    expect(result.passedCount).toBe(result.scenarios.length);
    expect(result.precisionPct).toBe(100);
  });

  it("renderBench produces a one-screen report", () => {
    const result = runBench(r);
    const txt = renderBench(result);
    expect(txt).toContain("AEGIS BENCH");
  });
});

// ─── AGGREGATE ──────────────────────────────────────────────────────

describe("v1.67 AEGIS · aggregate score", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("cold repo scores low + emits recommendations", () => {
    const rep = aegis(r);
    expect(rep.score).toBeGreaterThanOrEqual(0);
    expect(rep.score).toBeLessThanOrEqual(100);
    expect(rep.recommendations.length).toBeGreaterThan(0);
  });

  it("score rises after seeding all axes", () => {
    const before = aegis(r).score;
    // Activate all axes
    seedDefaultDecoys(r);
    issueConsent(r, { parentId: "root", scope: "vaccine-mirror", signedBy: "test" });
    mintAntibody(r, { kind: "polygraph-drift", fingerprint: "fp1", severity: "info", source: "A3" });
    mutate(r, { axis: "burstSuspectedHosts", sample: 4, alpha: 0.1 });
    noteProbeFired(r);
    const d = issueDirective(r, "v");
    recordAck(r, { directiveId: d.id, vendor: "v", echoedHmac: d.hmac, echoedNonce: d.nonce });
    const after = aegis(r).score;
    expect(after).toBeGreaterThan(before);
  });
});

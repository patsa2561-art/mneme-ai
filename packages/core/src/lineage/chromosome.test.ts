/**
 * Chromosome — verify hash + signature determinism + tamper detection.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChromosomeId,
  canonicalJson,
  computeChromosomeHash,
  loadChromosome,
  machineFingerprint,
  persistChromosome,
  verifyChromosome,
  listChromosomes,
} from "./chromosome.js";
import { loadOrCreateIdentity } from "./identity.js";
import type { Chromosome } from "./types.js";

function emptyChromosome(): Omit<Chromosome, "contentHash" | "signature" | "signedBy"> {
  return {
    schemaVersion: 1,
    id: "2026-05-09T140000-claude-abcdef01",
    createdAt: "2026-05-09T14:00:00.000Z",
    vendor: "claude-opus-4-7",
    machineId: "abcdef0123456789",
    parents: [],
    vectorClock: { abcdef0123456789: 1 },
    topic: "test session",
    atomKarmaDeltas: {},
    molecules: [],
    courtVerdicts: [],
    confessOutcomes: { verified: 0, partiallyVerified: 0, hallucination: 0, unverifiable: 0, avgSelfConfidence: 0 },
    voiceFingerprint: { avgSentenceLen: 0, topPhrases: [], topTopics: [] },
    constitutionCandidates: [],
    lethalRecessives: [],
    session: {
      startedAt: "2026-05-09T14:00:00.000Z",
      endedAt: "2026-05-09T14:00:00.000Z",
      totalCalls: 0,
      endReason: "manual",
    },
  };
}

describe("canonicalJson", () => {
  it("sorts keys deterministically at every depth", () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles primitives + null", () => {
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(null)).toBe("null");
  });
});

describe("buildChromosomeId", () => {
  it("removes colons + dots from timestamp (filesystem-safe)", () => {
    const id = buildChromosomeId("2026-05-09T14:00:00.000Z", "claude-opus-4-7", "abcdef0123456789");
    expect(id).not.toContain(":");
    expect(id).not.toContain(".");
    expect(id).toMatch(/^2026-05-09T140000\d{0,3}Z-claude-opus-4-7-abcdef01$/);
  });

  it("sanitizes vendor field", () => {
    const id = buildChromosomeId("2026-05-09T14:00:00Z", "claude/opus@4-7", "deadbeef00000000");
    expect(id).toMatch(/claude_opus_4-7/);
  });

  it("truncates short hash to 8 chars", () => {
    const id = buildChromosomeId("2026-05-09T14:00:00Z", "x", "0123456789abcdef0123");
    expect(id.endsWith("01234567")).toBe(true);
  });
});

describe("computeChromosomeHash", () => {
  it("is deterministic across calls", () => {
    const c = { ...emptyChromosome(), signedBy: "fake-pem" };
    expect(computeChromosomeHash(c)).toBe(computeChromosomeHash(c));
  });

  it("is order-independent for object keys", () => {
    const c1 = { ...emptyChromosome(), signedBy: "fake" };
    const c2 = { ...emptyChromosome(), signedBy: "fake" };
    // Permute key order on a nested field — hash should be identical.
    c2.atomKarmaDeltas = { b: { karma: 1, invocations: 1, verified: 0, hallucinations: 0 }, a: { karma: 1, invocations: 1, verified: 0, hallucinations: 0 } };
    c1.atomKarmaDeltas = { a: { karma: 1, invocations: 1, verified: 0, hallucinations: 0 }, b: { karma: 1, invocations: 1, verified: 0, hallucinations: 0 } };
    expect(computeChromosomeHash(c1)).toBe(computeChromosomeHash(c2));
  });

  it("changes when ANY field changes", () => {
    const c = { ...emptyChromosome(), signedBy: "fake" };
    const baseline = computeChromosomeHash(c);
    expect(computeChromosomeHash({ ...c, topic: "different" })).not.toBe(baseline);
    expect(computeChromosomeHash({ ...c, vendor: "different" })).not.toBe(baseline);
    expect(computeChromosomeHash({ ...c, lethalRecessives: ["x"] })).not.toBe(baseline);
  });
});

describe("machineFingerprint", () => {
  it("is stable across calls with same inputs", () => {
    expect(machineFingerprint("/test/path")).toBe(machineFingerprint("/test/path"));
  });

  it("differs across paths", () => {
    expect(machineFingerprint("/a")).not.toBe(machineFingerprint("/b"));
  });

  it("returns 16 hex chars", () => {
    expect(machineFingerprint("/x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("persistChromosome + loadChromosome (round trip)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-lineage-"));
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("persists, reloads, and verifies", () => {
    const final = persistChromosome(repo, emptyChromosome());
    expect(final.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(final.signature).toMatch(/^[0-9a-f]+$/);
    expect(final.signedBy).toContain("BEGIN PUBLIC KEY");
    const reloaded = loadChromosome(repo, final.id);
    expect(reloaded.contentHash).toBe(final.contentHash);
    expect(reloaded.signature).toBe(final.signature);
  });

  it("verification passes for an untampered chromosome", () => {
    const final = persistChromosome(repo, emptyChromosome());
    expect(verifyChromosome(final).valid).toBe(true);
  });

  it("verification fails when the topic field is tampered post-sign", () => {
    const final = persistChromosome(repo, emptyChromosome());
    const tampered: Chromosome = { ...final, topic: "evil" };
    const v = verifyChromosome(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/contentHash mismatch|signature/);
  });

  it("verification fails when the signature is corrupted", () => {
    const final = persistChromosome(repo, emptyChromosome());
    // XOR the last byte with 0xff so the corruption is GUARANTEED different
    // from the original (slicing + "00" had a 1/256 collision risk if the
    // final byte was already 0x00 — caused a flaky CI failure).
    const last2 = final.signature.slice(-2);
    const flipped = (parseInt(last2, 16) ^ 0xff).toString(16).padStart(2, "0");
    const tampered: Chromosome = { ...final, signature: final.signature.slice(0, -2) + flipped };
    expect(tampered.signature).not.toBe(final.signature);
    expect(verifyChromosome(tampered).valid).toBe(false);
  });

  it("listChromosomes returns the persisted IDs newest-first", () => {
    const c1 = persistChromosome(repo, { ...emptyChromosome(), id: "2026-05-09T100000Z-claude-aaaaaaaa" });
    const c2 = persistChromosome(repo, { ...emptyChromosome(), id: "2026-05-09T120000Z-claude-bbbbbbbb" });
    const ids = listChromosomes(repo);
    expect(ids).toEqual([c2.id, c1.id]);
  });

  it("loadOrCreateIdentity is idempotent (same fingerprint across calls)", () => {
    const a = loadOrCreateIdentity(repo);
    const b = loadOrCreateIdentity(repo);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.publicPem).toBe(b.publicPem);
  });
});

describe("Cross-machine signature verification", () => {
  let repoA: string;
  let repoB: string;
  beforeEach(() => {
    repoA = mkdtempSync(join(tmpdir(), "mneme-lineage-A-"));
    repoB = mkdtempSync(join(tmpdir(), "mneme-lineage-B-"));
  });
  afterEach(() => {
    try { rmSync(repoA, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(repoB, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("a chromosome signed on machine A still verifies when loaded on machine B (signedBy travels with it)", () => {
    const signed = persistChromosome(repoA, emptyChromosome());
    // Read raw bytes + write into repoB's chromosome dir to simulate spore transfer.
    const path = join(repoB, ".mneme/lineage/chromosomes", `${signed.id}.chromosome.json`);
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(join(repoB, ".mneme/lineage/chromosomes"), { recursive: true });
    writeFileSync(path, JSON.stringify(signed, null, 2), "utf8");
    // Load on repoB — repoB has its own identity, but the chromosome carries A's pubkey.
    const reloaded = loadChromosome(repoB, signed.id);
    expect(verifyChromosome(reloaded).valid).toBe(true);
  });
});

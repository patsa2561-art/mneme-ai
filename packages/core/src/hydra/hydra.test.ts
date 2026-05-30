import { describe, it, expect } from "vitest";
import {
  forgeCodebook, gauntlet, collisions, buildCodebook,
  compress, expand, proveLossless, chooseMarkers, sha256Hex,
  mineCandidates,
  hydraForge, verifyCodebook, portableArtifact, bindAxioms,
} from "./index.js";

const CORPUS = [
  "HMAC-chained ledger is tamper-evident. The HMAC-chained ledger signs each row.",
  "Ed25519-signed receipt verifies offline. Another Ed25519-signed receipt chains.",
  "HMAC-chained ledger plus Ed25519-signed receipt equals tamper-evident provenance.",
].join("\n").repeat(4);

describe("v2.96 HYDRA · L3+L4 lossless engine", () => {
  it("round-trips byte-identical (lossless proof is true)", () => {
    const { codebook } = forgeCodebook(CORPUS, { minHits: 2 });
    const p = proveLossless(CORPUS, codebook);
    expect(p.lossless).toBe(true);
    expect(p.originalHash).toBe(p.roundTripHash);
    expect(expand(compress(CORPUS, codebook), codebook)).toBe(CORPUS);
  });

  it("markers are PUA chars absent from the corpus", () => {
    const [o, c] = chooseMarkers(CORPUS, []);
    expect(CORPUS.includes(o)).toBe(false);
    expect(CORPUS.includes(c)).toBe(false);
    expect(o.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
  });

  it("does NOT munge a corpus that already contains a candidate marker — falls back", () => {
    const tricky = String.fromCharCode(0xe000) + " " + CORPUS;     // corpus carries the first marker
    const { codebook } = forgeCodebook(tricky, { minHits: 2 });
    expect(proveLossless(tricky, codebook).lossless).toBe(true);   // still lossless via fallback marker
    expect(codebook.open).not.toBe(String.fromCharCode(0xe000));
  });
});

describe("v2.96 HYDRA · L7 collision-free (can't hold two meanings)", () => {
  it("a forged codebook has zero collisions", () => {
    const { codebook } = forgeCodebook(CORPUS, { minHits: 2 });
    expect(collisions(codebook).collisions).toBe(0);
  });

  it("detects an injected duplicate symbol / phrase", () => {
    const { codebook } = forgeCodebook(CORPUS, { minHits: 2 });
    const dup = { v: 1 as const, open: codebook.open, close: codebook.close, corpusHash: codebook.corpusHash,
      entries: [...codebook.entries, codebook.entries[0]!] };
    expect(collisions(dup).collisions).toBeGreaterThan(0);
  });
});

describe("v2.96 HYDRA · L9 self-refining forge converges + L6 portable", () => {
  it("converges with a perfect gauntlet (score 100)", () => {
    const r = forgeCodebook(CORPUS, { minHits: 2 });
    expect(r.converged).toBe(true);
    expect(r.gauntlet.score).toBe(100);
    expect(r.gauntlet.lossless).toBe(true);
    expect(r.gauntlet.collisions).toBe(0);
    expect(r.gauntlet.portable).toBe(true);
  });

  it("is deterministic — same corpus → identical codebook hash", () => {
    const a = forgeCodebook(CORPUS, { minHits: 2 });
    const b = forgeCodebook(CORPUS, { minHits: 2 });
    expect(sha256Hex(JSON.stringify(a.codebook.entries))).toBe(sha256Hex(JSON.stringify(b.codebook.entries)));
  });

  it("reports an HONEST net ratio (never claims single-shot magic)", () => {
    const r = forgeCodebook(CORPUS, { minHits: 2 });
    expect(r.gauntlet.netRatio).toBeGreaterThan(0);
    expect(typeof r.gauntlet.codebookBytes).toBe("number");
  });
});

describe("v2.96 HYDRA · L5 signed + L8 energy (offline-verifiable)", () => {
  it("signs the codebook and verifies offline; catches tampering", () => {
    const f = hydraForge(process.cwd(), CORPUS, 1700000000000, { minHits: 2 });
    expect(verifyCodebook(f.receipt, f.forge.codebook).bound).toBe(true);
    const tampered = JSON.parse(JSON.stringify(f.forge.codebook));
    tampered.entries[0].phrase += "X";
    expect(verifyCodebook(f.receipt, tampered).bound).toBe(false);  // swap-after-sign caught
  });

  it("mints an energy certificate and binds axioms (L7/L8)", () => {
    const f = hydraForge(process.cwd(), CORPUS, 1700000000000, { minHits: 2 });
    expect(f.energy.bytesSaved).toBeGreaterThanOrEqual(0);
    expect(f.axioms.length).toBe(f.forge.codebook.entries.length);
    expect(f.axioms[0]?.claim).toContain("expands to");
  });

  it("L6 portable artifact carries a self-describing grammar", () => {
    const f = hydraForge(process.cwd(), CORPUS, 1700000000000, { minHits: 2 });
    expect(f.portable.kind).toBe("hydra/portable-codebook");
    expect(f.portable.grammar.rule).toContain("replace");
    expect(f.portable.codebookHash).toHaveLength(64);
  });
});

describe("v2.96 HYDRA · L1/L2 mining is MDL-positive", () => {
  it("only mines phrases that pay back more than they cost", () => {
    const cands = mineCandidates(CORPUS, { minHits: 2 });
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c.gain).toBeGreaterThan(0);
  });
});

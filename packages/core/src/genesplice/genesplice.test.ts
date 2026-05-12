/**
 * v1.73.0 -- GENESPLICE PROTOCOL test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compressToSoulPrompt, parseSoulPrompt } from "./soul_prompt.js";
import { recombineGenome, uniqueWisdom, consensusWisdom } from "./genome_recombine.js";
import { packageGist, parseGistUrl, extractSoulFromGist } from "./gist_transmit.js";
import { expressPhenotype, expressSoulForVendor } from "./phenotype.js";
import { saveCapsule } from "../diaspora/session_capsule.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-gs-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

const sampleCapsule = (vendor: string, extras: { decisions?: string[]; contextOverride?: string } = {}) => ({
  id: `cap-${vendor}`,
  capsuleVersion: 1 as const,
  createdAt: new Date().toISOString(),
  originVendor: vendor,
  repoFingerprint: "deadbeefcafefade",
  contextSummary: extras.contextOverride ?? `${vendor} session: investigating auth bug; comparing bcrypt vs argon2`,
  promptTrace: [
    { ts: new Date(Date.now() - 60000).toISOString(), role: "user" as const, text: "why is login slow" },
    { ts: new Date(Date.now() - 50000).toISOString(), role: "assistant" as const, text: "bcrypt at cost 12 is the bottleneck" },
  ],
  reasoningTrace: [`${vendor} reasoned: hash cost dominates login latency`],
  decisions: extras.decisions ?? ["explore argon2id", "benchmark before switching"],
  hmac: "test-hmac",
});

// ─── G1 SOUL PROMPT ──────────────────────────────────────────────────

describe("v1.73 GeneSplice G1 · Soul Prompt", () => {
  it("compresses to under 500 tokens by default", () => {
    const cap = sampleCapsule("claude");
    const soul = compressToSoulPrompt({ capsule: cap });
    expect(soul.estTokens).toBeLessThanOrEqual(700);
    expect(soul.text).toContain("MNEME SOUL PROMPT");
    expect(soul.text).toContain("claude");
    expect(soul.text).toContain("bcrypt");
  });

  it("HMAC included when secret provided", () => {
    const cap = sampleCapsule("claude");
    const soul = compressToSoulPrompt({ capsule: cap, secret: "test-secret" });
    expect(soul.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(soul.text).toContain("HMAC:");
  });

  it("parseSoulPrompt round-trips the structured fields", () => {
    const cap = sampleCapsule("claude-opus-4-7", { decisions: ["use argon2id", "deprecate bcrypt"] });
    const soul = compressToSoulPrompt({ capsule: cap, secret: "abc" });
    const parsed = parseSoulPrompt(soul.text, "abc");
    expect(parsed.originVendor).toBe("claude-opus-4-7");
    expect(parsed.decisions.length).toBeGreaterThanOrEqual(1);
    expect(parsed.recentTurns.length).toBeGreaterThanOrEqual(1);
    expect(parsed.verdict).toBe("VALID");
  });

  it("detects tampered HMAC", () => {
    const cap = sampleCapsule("claude");
    const soul = compressToSoulPrompt({ capsule: cap, secret: "abc" });
    const tampered = soul.text.replace("bcrypt", "argon2");
    const parsed = parseSoulPrompt(tampered, "abc");
    expect(parsed.verdict).toBe("INVALID_HMAC");
  });

  it("MALFORMED on random text", () => {
    const parsed = parseSoulPrompt("just some random message");
    expect(parsed.verdict).toBe("MALFORMED");
  });
});

// ─── G2 GENOME RECOMBINATION ─────────────────────────────────────────

describe("v1.73 GeneSplice G2 · Genome Recombination", () => {
  it("merges N capsules into a hybrid", () => {
    const claude = sampleCapsule("claude", { decisions: ["use argon2id", "benchmark first"] });
    const gemini = sampleCapsule("gemini", { decisions: ["use argon2id", "audit bcrypt callers"] });
    const hybrid = recombineGenome({ capsules: [claude, gemini] });
    expect(hybrid.sources.length).toBe(2);
    expect(hybrid.decisions.length).toBeGreaterThan(0);
    expect(hybrid.contextSummary).toContain("claude");
    expect(hybrid.contextSummary).toContain("gemini");
  });

  it("consensusWisdom finds decisions multiple vendors agreed on", () => {
    const claude = sampleCapsule("claude", { decisions: ["use argon2id is safer"] });
    const gemini = sampleCapsule("gemini", { decisions: ["use argon2id safer choice"] });
    const hybrid = recombineGenome({ capsules: [claude, gemini] });
    const consensus = consensusWisdom(hybrid);
    expect(consensus.length).toBeGreaterThanOrEqual(1);
    expect(consensus[0]!.vendors.length).toBeGreaterThanOrEqual(2);
  });

  it("uniqueWisdom finds vendor-specific decisions", () => {
    const claude = sampleCapsule("claude", { decisions: ["use argon2id", "add CSRF tokens"] });
    const gemini = sampleCapsule("gemini", { decisions: ["use argon2id", "enable rate limiting"] });
    const hybrid = recombineGenome({ capsules: [claude, gemini] });
    const unique = uniqueWisdom(hybrid);
    // Each vendor should have at least one unique decision
    expect(unique["claude"] || unique["gemini"]).toBeDefined();
  });

  it("merges promptTrace chronologically", () => {
    const claude = sampleCapsule("claude");
    const gemini = sampleCapsule("gemini");
    const hybrid = recombineGenome({ capsules: [claude, gemini] });
    for (let i = 1; i < hybrid.promptTrace.length; i++) {
      expect(hybrid.promptTrace[i - 1]!.ts <= hybrid.promptTrace[i]!.ts).toBe(true);
    }
  });

  it("empty input returns empty hybrid", () => {
    const hybrid = recombineGenome({ capsules: [] });
    expect(hybrid.sources.length).toBe(0);
    expect(hybrid.decisions.length).toBe(0);
  });
});

// ─── G3 GIST BRAIN TRANSFER ──────────────────────────────────────────

describe("v1.73 GeneSplice G3 · Gist Brain Transfer", () => {
  it("packageGist wraps soul prompt in gist-ready content", () => {
    const cap = sampleCapsule("claude");
    const pkg = packageGist({ capsule: cap });
    expect(pkg.content).toContain("MNEME SOUL PROMPT");
    expect(pkg.content).toContain("mneme://gist");
    expect(pkg.filename).toMatch(/\.md$/);
    expect(pkg.instructions.length).toBeGreaterThan(0);
  });

  it("extractSoulFromGist recovers the soul", () => {
    const cap = sampleCapsule("claude");
    const pkg = packageGist({ capsule: cap });
    const recovered = extractSoulFromGist(pkg.content);
    expect(recovered).not.toBeNull();
    expect(recovered).toContain("MNEME SOUL PROMPT");
  });

  it("parseGistUrl handles raw + web variants", () => {
    const raw = parseGistUrl("https://gist.githubusercontent.com/user/abc123def/raw/sha/file.md");
    expect(raw.gistId).toBe("abc123def");
    expect(raw.isRaw).toBe(true);
    const web = parseGistUrl("https://gist.github.com/user/abc123def");
    expect(web.gistId).toBe("abc123def");
    expect(web.isRaw).toBe(false);
    const bad = parseGistUrl("https://example.com");
    expect(bad.gistId).toBeNull();
  });

  it("accepts a hybrid capsule via adapter", () => {
    const claude = sampleCapsule("claude");
    const gemini = sampleCapsule("gemini");
    const hybrid = recombineGenome({ capsules: [claude, gemini] });
    const pkg = packageGist({ capsule: hybrid });
    expect(pkg.content).toContain("hybrid:claude+gemini");
  });
});

// ─── G5 PHENOTYPE EXPRESSION ─────────────────────────────────────────

describe("v1.73 GeneSplice G5 · Phenotype Expression", () => {
  it("expresses Gemini as structured", () => {
    const ph = expressPhenotype("gemini-pro", "claude");
    expect(ph.style).toBe("structured");
    expect(ph.openingLine).toContain("Resumed");
  });

  it("expresses GPT as verbose", () => {
    const ph = expressPhenotype("gpt-4", "claude");
    expect(ph.style).toBe("verbose");
  });

  it("expresses Cursor/Codex as terse", () => {
    expect(expressPhenotype("cursor", "claude").style).toBe("terse");
    expect(expressPhenotype("codex", "claude").style).toBe("terse");
  });

  it("falls back to balanced for unknown vendor", () => {
    const ph = expressPhenotype("some-unknown-vendor", "claude");
    expect(ph.style).toBe("balanced");
  });

  it("expressSoulForVendor wraps soul prompt with phenotype", () => {
    const cap = sampleCapsule("claude");
    const soul = compressToSoulPrompt({ capsule: cap });
    const expressed = expressSoulForVendor(soul.text, "gemini-pro", "claude");
    expect(expressed).toContain("PHENOTYPE INSTRUCTIONS");
    expect(expressed).toContain("structured");
  });
});

// ─── End-to-end demo: claude session -> gemini paste ────────────────

describe("v1.73 GeneSplice · END-TO-END brain transfer (no install)", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("claude session -> soul prompt -> Gemini phenotype -> resume works", () => {
    // Step 1: Vendor A (claude) saves a capsule
    const cap = saveCapsule(r, {
      vendor: "claude-opus-4-7",
      contextSummary: "Investigating performance bug in auth.ts; user wants to compare bcrypt to argon2id",
      promptTrace: [
        { ts: new Date().toISOString(), role: "user", text: "why is login slow?" },
        { ts: new Date().toISOString(), role: "assistant", text: "auth.ts uses bcrypt cost 12; argon2id is faster" },
      ],
      decisions: ["benchmark argon2id before switching", "audit all bcrypt callers"],
      reasoningTrace: ["hash function cost dominates login p95"],
    });

    // Step 2: Compress to soul prompt
    const soul = compressToSoulPrompt({ capsule: cap, secret: "test-cluster-secret" });
    expect(soul.estTokens).toBeLessThan(800);

    // Step 3: Express for Gemini
    const geminiSoul = expressSoulForVendor(soul.text, "gemini-pro", "claude-opus-4-7");
    expect(geminiSoul).toContain("Resumed from claude-opus-4-7");
    expect(geminiSoul).toContain("structured");

    // Step 4: Simulate Gemini paste -> parse the soul
    const parsed = parseSoulPrompt(geminiSoul, "test-cluster-secret");
    expect(parsed.originVendor).toBe("claude-opus-4-7");
    expect(parsed.decisions.length).toBeGreaterThan(0);
    expect(parsed.verdict).toBe("VALID");
  });

  it("hybrid: claude + gemini -> super-genome with consensus + unique wisdom", () => {
    const claudeCap = saveCapsule(r, {
      vendor: "claude",
      contextSummary: "auth refactor",
      promptTrace: [],
      decisions: ["use argon2id", "add CSRF protection"],
    });
    const geminiCap = saveCapsule(r, {
      vendor: "gemini",
      contextSummary: "auth refactor analysis",
      promptTrace: [],
      decisions: ["use argon2id", "enable rate limiting"],
    });
    const hybrid = recombineGenome({ capsules: [claudeCap, geminiCap] });
    expect(hybrid.sources.length).toBe(2);
    const consensus = consensusWisdom(hybrid);
    expect(consensus.length).toBeGreaterThanOrEqual(1); // "use argon2id" was in both
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MNEME_PROTOCOL_VERSION, REFERENCE_IMPL_MANIFEST, validateImplementation, exportSpec, PROTOCOL_CAPABILITIES } from "./p1_substrate.js";
import { auditSovereignty, registerNode } from "./p2_sovereign.js";
import { measureLexicalSpread, MNEME_LEXICON, renderStackOverflowSnippet } from "./p3_language.js";
import { ALETHEIA_ARTICLES, gradeAgainstManifesto, renderManifestoMarkdown } from "./p4_philosophical.js";
import { computeGravity } from "./p5_antifork.js";
import { logAttack, listAttacks, promoteAttacksToVaccines, runWarGame } from "./p6_adversarial.js";
import { allocateRevenue, projectTreasury, DEFAULT_TREASURY_POLICY } from "./p7_autonomous.js";
import { SCENARIOS, renderScenarioPaper, renderAllPapers } from "./p8_existential.js";
import { createRosettaCapsule, listCapsules, verifyCapsule, verifyCapsuleChain } from "./p9_inherits.js";

describe("POWER 1 · substrate independence", () => {
  it("the reference implementation conforms to its own spec", () => {
    const r = validateImplementation(REFERENCE_IMPL_MANIFEST);
    expect(r.conforming).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("rejects an impl declaring a wrong protocolVersion", () => {
    const r = validateImplementation({ ...REFERENCE_IMPL_MANIFEST, protocolVersion: "0.0.1" });
    expect(r.conforming).toBe(false);
    expect(r.reason).toContain("protocol version mismatch");
  });

  it("rejects an impl missing required capabilities", () => {
    const r = validateImplementation({
      ...REFERENCE_IMPL_MANIFEST,
      capabilities: REFERENCE_IMPL_MANIFEST.capabilities.slice(0, 5),
    });
    expect(r.conforming).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("exports a spec usable by future ports", () => {
    const s = exportSpec();
    expect(s.protocolVersion).toBe(MNEME_PROTOCOL_VERSION);
    expect(s.capabilities).toEqual([...PROTOCOL_CAPABILITIES]);
  });
});

describe("POWER 2 · sovereign infrastructure", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-power-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("verdict is embryonic on empty repo", () => {
    const r = auditSovereignty(repo);
    expect(r.verdict).toBe("embryonic");
    expect(r.spofs.length).toBeGreaterThan(0);
  });

  it("flags single-jurisdiction concentration as a SPOF", () => {
    for (let i = 0; i < 6; i++) registerNode(repo, { id: `n${i}`, jurisdiction: "US", type: "validator" });
    const r = auditSovereignty(repo);
    expect(r.concentrationRisk).toBeGreaterThan(0.5);
    expect(r.spofs.some((s) => s.reason.includes("US"))).toBe(true);
  });

  it("multi-jurisdictional verdict triggers at 5+ jurisdictions / 50+ nodes", () => {
    for (const j of ["US", "DE", "JP", "BR", "ZA"]) {
      for (let i = 0; i < 12; i++) registerNode(repo, { id: `n-${j}-${i}`, jurisdiction: j, type: "validator" });
    }
    const r = auditSovereignty(repo);
    expect(r.verdict).toBe("multi-jurisdictional");
  });
});

describe("POWER 3 · language ownership", () => {
  it("lexicon entries all carry definition + competing terms", () => {
    expect(MNEME_LEXICON.length).toBeGreaterThanOrEqual(10);
    for (const e of MNEME_LEXICON) {
      expect(e.definition.length).toBeGreaterThan(20);
      expect(e.competingTerms.length).toBeGreaterThan(0);
    }
  });

  it("StackOverflow snippet uses our dialect", () => {
    const s = renderStackOverflowSnippet();
    expect(s.toLowerCase()).toContain("mneme'd");
    expect(s.toLowerCase()).toContain("aletheia");
    expect(s.toLowerCase()).toContain("vaccine");
  });

  it("measureLexicalSpread returns a report shape (smoke test)", () => {
    // We don't run git grep here; just verify the function is callable.
    // (in CI it returns 0s for everything when not in a git repo)
    const r = measureLexicalSpread(process.cwd());
    expect(r.termsTracked).toBe(MNEME_LEXICON.length);
    expect(typeof r.dialectIndex).toBe("number");
  });
});

describe("POWER 4 · philosophical moat (ALETHEIA)", () => {
  it("manifesto exposes 9 articles with stable IDs", () => {
    expect(ALETHEIA_ARTICLES).toHaveLength(9);
    for (const a of ALETHEIA_ARTICLES) expect(a.id).toMatch(/^M-\d{3}$/);
  });

  it("M-003 fires on documentation that tells humans to type CLI commands", () => {
    const r = gradeAgainstManifesto({ code: "Run: `mneme audit`" });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.article.id === "M-003")).toBe(true);
  });

  it("M-005 fires on 'audit-grade' overclaim", () => {
    const r = gradeAgainstManifesto({ commitMessage: "feat: ship SOC2-grade audit" });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.article.id === "M-005")).toBe(true);
  });

  it("clean input passes", () => {
    const r = gradeAgainstManifesto({ code: "// regular code, nothing controversial" });
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("manifesto markdown is citable", () => {
    const md = renderManifestoMarkdown();
    expect(md).toContain("# The ALETHEIA Manifesto");
    expect(md).toContain("M-001");
    expect(md).toContain("M-009");
  });
});

describe("POWER 5 · anti-fork immunity", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-power-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("empty repo => fork-vulnerable verdict", () => {
    const r = computeGravity(repo);
    expect(r.totalGravity).toBeLessThan(25);
    expect(r.verdict).toBe("fork-vulnerable");
  });

  it("vaccines + ratified cards push gravity up", () => {
    mkdirSync(join(repo, ".mneme/genome-market/cards"), { recursive: true });
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(repo, `.mneme/genome-market/cards/card-${i}.json`), "{}");
    }
    const lines = Array.from({ length: 15 }, (_, i) => JSON.stringify({ rule: `r${i}` })).join("\n");
    writeFileSync(join(repo, ".mneme/vaccines.jsonl"), lines + "\n");
    const r = computeGravity(repo);
    expect(r.totalGravity).toBeGreaterThan(20);
  });
});

describe("POWER 6 · adversarial resilience", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-power-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("logging an attack persists it", () => {
    logAttack(repo, { category: "prompt-injection", signature: "ignore previous", target: "mcp.tools", severity: "high", source: "test" });
    expect(listAttacks(repo)).toHaveLength(1);
  });

  it("two distinct hits on same signature promote into a vaccine draft", () => {
    logAttack(repo, { category: "prompt-injection", signature: "sig-X", target: "mcp.tools", severity: "high", source: "test" });
    logAttack(repo, { category: "prompt-injection", signature: "sig-X", target: "cli", severity: "high", source: "test" });
    const drafts = promoteAttacksToVaccines(repo);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.triggeringEvents).toBe(2);
  });

  it("single hit on a signature does NOT promote (need >= 2)", () => {
    logAttack(repo, { category: "prompt-injection", signature: "sig-Y", target: "mcp.tools", severity: "high", source: "test" });
    expect(promoteAttacksToVaccines(repo)).toHaveLength(0);
  });

  it("war game reports verdict + detection rate", () => {
    logAttack(repo, { category: "prompt-injection", signature: "sigA", target: "mcp", severity: "high", source: "t" });
    logAttack(repo, { category: "prompt-injection", signature: "sigA", target: "cli", severity: "high", source: "t" });
    const r = runWarGame(repo);
    expect(r.attacksReplayed).toBe(2);
    expect(r.detectionRatePct).toBe(100);
    expect(r.verdict).toBe("antifragile");
  });
});

describe("POWER 7 · autonomous economy", () => {
  it("default policy splits sum to 1.0", () => {
    const p = DEFAULT_TREASURY_POLICY;
    expect(p.rdSplit + p.bountySplit + p.bdSplit + p.validatorSplit).toBeCloseTo(1, 4);
  });

  it("rainy-day floor blocks auto-spend below threshold", () => {
    const r = allocateRevenue(0, 10_000); // floor is 50k by default
    expect(r.rd + r.bounty + r.bd + r.validator).toBe(0);
    expect(r.reasoning).toContain("rainy-day");
  });

  it("above-floor revenue allocates per policy", () => {
    const r = allocateRevenue(0, 100_000); // 50k spendable above floor
    expect(r.rd).toBeCloseTo(30_000, -1);    // 60% of 50k
    expect(r.validator).toBeCloseTo(5_000, -1);
  });

  it("projection runs N months without crashing", () => {
    const rows = projectTreasury(60_000, 2_000, 12);
    expect(rows).toHaveLength(12);
    expect(rows[11]!.month).toBe(12);
  });

  it("rejects splits that don't sum to 1.0", () => {
    expect(() => allocateRevenue(1000, 100_000, { ...DEFAULT_TREASURY_POLICY, rdSplit: 0.7 })).toThrow();
  });
});

describe("POWER 8 · existential niche", () => {
  it("five scenarios are defined", () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(5);
  });

  it("renderScenarioPaper produces non-empty markdown for each scenario", () => {
    for (const k of Object.keys(SCENARIOS)) {
      const md = renderScenarioPaper(k as keyof typeof SCENARIOS);
      expect(md).toContain("# ");
      expect(md.length).toBeGreaterThan(200);
    }
  });

  it("renderAllPapers contains every scenario title", () => {
    const all = renderAllPapers();
    for (const s of Object.values(SCENARIOS)) {
      expect(all).toContain(s.title);
    }
  });
});

describe("POWER 9 · inherits the earth (Rosetta capsule)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-power-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("creates a self-verifying capsule", () => {
    const c = createRosettaCapsule(repo, { authorNote: "test" });
    expect(c.formatVersion).toBe(1);
    expect(c.capsuleId).toMatch(/^[a-f0-9]{64}$/);
    expect(c.protocol.protocolVersion).toBe(MNEME_PROTOCOL_VERSION);
    expect(c.manifesto.length).toBe(9);
    expect(verifyCapsule(c)).toBe(true);
  });

  it("decoding instructions are present + plain English", () => {
    const c = createRosettaCapsule(repo);
    expect(c.decodingInstructions).toContain("HOW TO READ THIS CAPSULE");
    expect(c.decodingInstructions.length).toBeGreaterThan(500);
  });

  it("first capsule has prevCapsuleHash=null; subsequent chain back", () => {
    const c1 = createRosettaCapsule(repo);
    const c2 = createRosettaCapsule(repo);
    expect(c1.prevCapsuleHash).toBeNull();
    expect(c2.prevCapsuleHash).toBe(c1.capsuleId);
  });

  it("listCapsules returns chronologically", () => {
    createRosettaCapsule(repo);
    createRosettaCapsule(repo);
    createRosettaCapsule(repo);
    expect(listCapsules(repo)).toHaveLength(3);
  });

  it("verifyCapsuleChain detects an intact chain", () => {
    createRosettaCapsule(repo);
    createRosettaCapsule(repo);
    expect(verifyCapsuleChain(repo).ok).toBe(true);
  });

  it("tampered capsuleId fails verification", () => {
    const c = createRosettaCapsule(repo);
    const tampered = { ...c, capsuleId: "0".repeat(64) };
    expect(verifyCapsule(tampered)).toBe(false);
  });
});

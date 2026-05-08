/**
 * Genome module tests — covers G1 (annotator + phylogeny),
 * G2 (circuits), G3 (operons), G4 (CRISPR), G5 (synthesizer).
 */

import { describe, it, expect } from "vitest";
import { annotateTool, annotateCatalog, SUPPORTED_DOMAINS } from "./annotator.js";
import {
  buildPhylogeny,
  findAncestors,
  findCousins,
  treeDistance,
  findClosestRelative,
  speciationEvents,
  renderAsciiTree,
} from "./phylogeny.js";
import {
  toggle,
  andGate,
  orGate,
  notGate,
  oscillator,
  runCircuit,
} from "./circuits.js";
import {
  resolveOperonForTool,
  setRegulatorLevel,
  cascade,
  compareLevels,
  stripeBuiltinOperon,
} from "./operons.js";
import { crisprEdit, crisprEditChain } from "./crispr.js";
import {
  synthesize,
  recipeHash,
  emptyRegistry,
  registerSpecies,
  lookupByHash,
  lookupByName,
  type SynthesisRecipe,
} from "./synthesizer.js";
import type { Pack, ToolDefinition } from "../dynamic/pack-schema.js";

// ─── G1 · Annotator ──────────────────────────────────────────────────

describe("G1 · annotator — domain inference", () => {
  it("classifies search tools", () => {
    const a = annotateTool({ name: "mneme.memory.search_commits", description: "Find commits" });
    expect(a.domain).toBe("search");
    expect(a.mutability).toBe("read-only");
  });

  it("classifies mutate tools", () => {
    const a = annotateTool({ name: "mneme.audit.rotate", description: "Rotate keys" });
    expect(a.domain).toBe("mutate");
    expect(a.mutability).toBe("side-effecting");
  });

  it("classifies verify tools", () => {
    const a = annotateTool({ name: "mneme.dna.search", description: "Ghost-Sniper Verifier" });
    expect(a.domain).toBe("verify");
  });

  it("classifies compose tools", () => {
    const a = annotateTool({ name: "mneme.lab.compose", description: "Compose molecules" });
    expect(a.domain).toBe("compose");
  });

  it("classifies regulate tools (constitution)", () => {
    const a = annotateTool({ name: "mneme.constitution.get", description: "Get constitution rules" });
    expect(a.domain).toBe("regulate");
    expect(a.mutability).toBe("stateful");
  });

  it("classifies augment tools", () => {
    const a = annotateTool({ name: "mneme.tribal.augment", description: "Augment with tribal knowledge" });
    expect(a.domain).toBe("augment");
  });

  it("classifies observe / metric tools", () => {
    const a = annotateTool({ name: "mneme.metrics.hkd", description: "HKD hidden knowledge density" });
    expect(a.domain).toBe("observe");
  });

  it("classifies synthesize tools", () => {
    const a = annotateTool({ name: "mneme.synth.generate", description: "Synthesize a new tool" });
    expect(a.domain).toBe("synthesize");
    expect(a.mutability).toBe("side-effecting");
  });

  it("extracts genus + species from name", () => {
    const a = annotateTool({ name: "mneme.stripe.find_pricing_logic" });
    expect(a.genus).toBe("mneme.stripe");
    expect(a.species).toBe("find_pricing_logic");
  });

  it("annotateCatalog buckets by domain + genus deterministically", () => {
    const r = annotateCatalog([
      { name: "mneme.memory.search_commits" },
      { name: "mneme.memory.search_chunks" },
      { name: "mneme.audit.rotate" },
    ]);
    expect(r.byDomain.search?.length).toBe(2);
    expect(r.byDomain.mutate?.length).toBe(1);
    expect(r.byGenus["mneme.memory"]?.length).toBe(2);
    expect(r.domainCounts.search).toBe(2);
  });

  it("SUPPORTED_DOMAINS lists all 8 expected", () => {
    expect(SUPPORTED_DOMAINS).toContain("search");
    expect(SUPPORTED_DOMAINS).toContain("synthesize");
    expect(SUPPORTED_DOMAINS.length).toBe(8);
  });
});

// ─── G1 · Phylogeny ──────────────────────────────────────────────────

describe("G1 · phylogeny — tree building + queries", () => {
  const tools = annotateCatalog([
    { name: "mneme.search.code", parent: undefined },
    { name: "mneme.search.commits", parent: "mneme.search.code" },
    { name: "mneme.search.regrets", parent: "mneme.search.code" },
    { name: "mneme.search.regret_pattern", parent: "mneme.search.regrets" },
    { name: "mneme.dna.search", parent: undefined },
  ]).tools;

  it("orphans without parent attach to ROOT", () => {
    const t = buildPhylogeny(tools);
    const root = t.byName.get("ROOT")!;
    expect(root.children.some((c) => c.name === "mneme.search.code")).toBe(true);
    expect(root.children.some((c) => c.name === "mneme.dna.search")).toBe(true);
  });

  it("findAncestors walks up the chain", () => {
    const t = buildPhylogeny(tools);
    const a = findAncestors(t, "mneme.search.regret_pattern");
    expect(a).toEqual(["mneme.search.regrets", "mneme.search.code", "ROOT"]);
  });

  it("findCousins returns siblings in k-level scope", () => {
    const t = buildPhylogeny(tools);
    const c = findCousins(t, "mneme.search.commits", 1);
    expect(c).toContain("mneme.search.regrets");
    expect(c).toContain("mneme.search.regret_pattern"); // descendant of sibling
    expect(c).not.toContain("mneme.search.commits");
  });

  it("treeDistance is 0 for self, ∞ for unrelated", () => {
    const t = buildPhylogeny(tools);
    expect(treeDistance(t, "mneme.search.code", "mneme.search.code")).toBe(0);
    expect(treeDistance(t, "mneme.search.code", "non-existent")).toBe(Infinity);
  });

  it("treeDistance computes via LCA correctly", () => {
    const t = buildPhylogeny(tools);
    // commits ↔ regrets: parent commits→code, parent regrets→code, LCA=code, dist=2
    expect(treeDistance(t, "mneme.search.commits", "mneme.search.regrets")).toBe(2);
    // commits ↔ regret_pattern: LCA=code, dist = 1+2 = 3
    expect(treeDistance(t, "mneme.search.commits", "mneme.search.regret_pattern")).toBe(3);
  });

  it("findClosestRelative picks nearest by tree distance", () => {
    const t = buildPhylogeny(tools);
    const r = findClosestRelative(t, "mneme.search.commits", [
      "mneme.search.regrets",
      "mneme.dna.search",
    ]);
    expect(r?.name).toBe("mneme.search.regrets");
  });

  it("speciationEvents finds branching ancestors", () => {
    const t = buildPhylogeny(tools);
    const events = speciationEvents(t);
    expect(events.some((e) => e.ancestor === "mneme.search.code")).toBe(true);
  });

  it("renderAsciiTree produces a string tree", () => {
    const t = buildPhylogeny(tools);
    const ascii = renderAsciiTree(t);
    expect(ascii).toContain("ROOT");
    expect(ascii).toContain("mneme.search.code");
  });

  it("cycle detection: self-parent → orphaned to ROOT (no infinite loop)", () => {
    const cyclic = annotateCatalog([{ name: "loop.tool", parent: "loop.tool" }]).tools;
    const t = buildPhylogeny(cyclic);
    expect(t.byName.has("loop.tool")).toBe(true);
  });
});

// ─── G2 · Circuits ───────────────────────────────────────────────────

describe("G2 · circuits — toggle / AND / OR / NOT / oscillator", () => {
  it("toggle: read returns current state", () => {
    const r = toggle({ id: "x", op: "read", defaultState: true }, { signals: {} });
    expect(r.fired).toBe(true);
    expect(r.payload).toBe(true);
  });

  it("toggle: set explicitly", () => {
    const r = toggle({ id: "x", op: "set", value: true }, { signals: {} });
    expect(r.toggleState?.x).toBe(true);
  });

  it("toggle: flip inverts", () => {
    const r = toggle({ id: "x", op: "flip" }, { signals: {}, toggleState: { x: true } });
    expect(r.toggleState?.x).toBe(false);
    expect(r.fired).toBe(false);
  });

  it("AND with all-true → fires", () => {
    const r = andGate(["a", "b"], { signals: { a: true, b: true } });
    expect(r.fired).toBe(true);
  });

  it("AND with one-false → blocks", () => {
    const r = andGate(["a", "b"], { signals: { a: true, b: false } });
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/AND blocked/);
  });

  it("AND vacuous (empty inputs) → true", () => {
    const r = andGate([], { signals: {} });
    expect(r.fired).toBe(true);
  });

  it("OR fires on any true", () => {
    const r = orGate(["a", "b"], { signals: { a: false, b: true } });
    expect(r.fired).toBe(true);
  });

  it("OR vacuous → false", () => {
    expect(orGate([], { signals: {} }).fired).toBe(false);
  });

  it("NOT inverts", () => {
    expect(notGate("a", { signals: { a: true } }).fired).toBe(false);
    expect(notGate("a", { signals: { a: false } }).fired).toBe(true);
  });

  it("oscillator rotates strategies deterministically", () => {
    const cfg = { strategies: ["x", "y", "z"] };
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 0 }).payload).toBe("x");
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 1 }).payload).toBe("y");
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 2 }).payload).toBe("z");
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 3 }).payload).toBe("x"); // wraps
  });

  it("oscillator with period > 1 holds strategy across ticks", () => {
    const cfg = { strategies: ["a", "b"], period: 2 };
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 0 }).payload).toBe("a");
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 1 }).payload).toBe("a");
    expect(oscillator(cfg, { signals: {}, oscillatorTick: 2 }).payload).toBe("b");
  });

  it("runCircuit halts at first failing gate", () => {
    const network = {
      steps: [
        { kind: "and" as const, signals: ["a", "b"] },
        { kind: "not" as const, signal: "c" },
      ],
    };
    const r = runCircuit(network, { signals: { a: true, b: false, c: false } });
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/AND blocked/);
  });

  it("runCircuit chains successfully when all gates pass", () => {
    const network = {
      steps: [
        { kind: "and" as const, signals: ["a"] },
        { kind: "or" as const, signals: ["b"] },
      ],
    };
    const r = runCircuit(network, { signals: { a: true, b: true } });
    expect(r.fired).toBe(true);
  });
});

// ─── G3 · Operons ────────────────────────────────────────────────────

describe("G3 · operons — co-regulated tool clusters", () => {
  const op = stripeBuiltinOperon();
  const registry = { operons: [op] };

  it("resolveOperonForTool finds the governing operon", () => {
    const r = resolveOperonForTool("mneme.stripe.find_pricing_logic", registry, { "pci-compliance-level": "high" });
    expect(r.operon?.id).toBe("stripe-pci");
    expect(r.level).toBe("high");
    expect(r.modifier?.requireConstitutionGate).toBe(true);
    expect(r.modifier?.requireStrictSniper).toBe(true);
  });

  it("resolveOperonForTool returns nulls for unregulated tools", () => {
    const r = resolveOperonForTool("mneme.memory.search", registry, {});
    expect(r.operon).toBeNull();
  });

  it("setRegulatorLevel returns a new state map", () => {
    const next = setRegulatorLevel({}, "pci-compliance-level", "high");
    expect(next["pci-compliance-level"]).toBe("high");
  });

  it("cascade lists every affected tool with new modifier", () => {
    const c = cascade(registry, "pci-compliance-level", "low", "max");
    expect(c.affected.length).toBe(3);
    for (const a of c.affected) {
      expect(a.newModifier.minConfidence).toBe(0.85);
      expect(a.newModifier.requireConstitutionGate).toBe(true);
      expect(a.newModifier.requireStrictSniper).toBe(true);
    }
  });

  it("compareLevels orders correctly", () => {
    expect(compareLevels("low", "high")).toBe(-1);
    expect(compareLevels("max", "max")).toBe(0);
    expect(compareLevels("high", "off")).toBe(1);
  });

  it("higher level → tighter behavior modifier", () => {
    expect(op.perLevel.off.minConfidence).toBeLessThan(op.perLevel.high.minConfidence);
    expect(op.perLevel.off.requireStrictSniper).toBe(false);
    expect(op.perLevel.max.requireStrictSniper).toBe(true);
  });
});

// ─── G4 · CRISPR ─────────────────────────────────────────────────────

const SAMPLE_PACK: Pack = {
  schemaVersion: 1,
  id: "test-pack",
  displayName: "Test Pack",
  description: "A pack for testing CRISPR edits in this test suite.",
  version: "1.0.0",
  mnemeMinVersion: "1.13.0",
  maintainer: { name: "Test" },
  license: "MIT",
  detection: { packageDeps: ["foo"], pythonDeps: [], importPatterns: [], filePatterns: [], minConfidence: 0.5 },
  tools: [
    {
      id: "find_x",
      description: "Find X in this codebase. Returns code locations.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      query: { kind: "code-search", patterns: ["x"], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
      enrichWith: [],
      augmentation: { includeCanonicalPath: true, includeDeprecatedPaths: true, includeExpertAuthors: true, includeRecentIncidents: true, includeApplicableRules: true },
    },
    {
      id: "find_y",
      description: "Find Y in this codebase. Returns code locations.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      query: { kind: "code-search", patterns: ["y"], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
      enrichWith: [],
      augmentation: { includeCanonicalPath: true, includeDeprecatedPaths: true, includeExpertAuthors: true, includeRecentIncidents: true, includeApplicableRules: true },
    },
  ],
};

const NEW_TOOL: ToolDefinition = {
  id: "find_z",
  description: "Find Z in this codebase. Returns code locations.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  query: { kind: "code-search", patterns: ["z"], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
  enrichWith: [],
  augmentation: { includeCanonicalPath: true, includeDeprecatedPaths: true, includeExpertAuthors: true, includeRecentIncidents: true, includeApplicableRules: true },
};

describe("G4 · CRISPR — pack surgery", () => {
  it("delete by tool-id removes the matching tool", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "find_x" }, op: "delete" });
    expect(r.ok).toBe(true);
    expect(r.newPack?.tools.length).toBe(1);
    expect(r.newPack?.tools[0]!.id).toBe("find_y");
  });

  it("delete by pattern removing only some tools succeeds", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-pattern", selector: "^find_x$" }, op: "delete" });
    expect(r.ok).toBe(true);
    expect(r.newPack?.tools.length).toBe(1);
    expect(r.newPack?.tools[0]!.id).toBe("find_y");
  });

  it("delete-all-tools-by-pattern fails schema (need >= 1 tool)", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-pattern", selector: "^find_" }, op: "delete" });
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toBe("schema-validation");
  });

  it("replace-tool swaps the existing tool", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "find_x" }, op: "replace-tool", newTool: NEW_TOOL });
    expect(r.ok).toBe(true);
    expect(r.newPack?.tools.find((t) => t.id === "find_z")).toBeDefined();
    expect(r.newPack?.tools.find((t) => t.id === "find_x")).toBeUndefined();
  });

  it("add-tool appends new tool", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "" }, op: "add-tool", newTool: NEW_TOOL });
    expect(r.ok).toBe(true);
    expect(r.newPack?.tools.length).toBe(3);
  });

  it("add-tool with duplicate id fails", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "" }, op: "add-tool", newTool: SAMPLE_PACK.tools[0]! });
    expect(r.ok).toBe(false);
    expect(r.error?.details).toMatch(/already exists/);
  });

  it("patch-detection updates detection block", () => {
    const r = crisprEdit(SAMPLE_PACK, {
      target: { kind: "tool-by-id", selector: "" },
      op: "patch-detection",
      detectionPatch: { minConfidence: 0.9 },
    });
    expect(r.ok).toBe(true);
    expect(r.newPack?.detection.minConfidence).toBe(0.9);
  });

  it("invalid edit (tool-id not found in replace) fails closed", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "missing" }, op: "replace-tool", newTool: NEW_TOOL });
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toBe("apply-error");
  });

  it("hashes before/after are deterministic + different", () => {
    const r = crisprEdit(SAMPLE_PACK, { target: { kind: "tool-by-id", selector: "find_x" }, op: "delete" });
    expect(r.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.afterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.beforeHash).not.toBe(r.afterHash);
  });

  it("crisprEditChain stops at first failure", () => {
    const results = crisprEditChain(SAMPLE_PACK, [
      { target: { kind: "tool-by-id", selector: "find_x" }, op: "delete" },
      { target: { kind: "tool-by-id", selector: "find_x" }, op: "replace-tool", newTool: NEW_TOOL }, // fails — already deleted
      { target: { kind: "tool-by-id", selector: "" }, op: "add-tool", newTool: NEW_TOOL },
    ]);
    expect(results.length).toBe(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
  });
});

// ─── G5 · Synthesizer ────────────────────────────────────────────────

describe("G5 · synthesizer — de novo tool synthesis", () => {
  const valid: SynthesisRecipe = {
    intent: "Find PCI-scope creep — places that handle cardholder data outside services/billing/v2/",
    searchPatterns: ["customer\\.email", "billing_details"],
    fileExtensions: ["ts", "tsx", "py"],
    verifiers: ["ast", "semantic", "confidence"],
    augmenters: ["canonical-paths", "expert-authors", "incidents", "rules"],
    authoredBy: "alice",
  };

  it("synthesizes a valid tool from a valid recipe", () => {
    const r = synthesize(valid);
    expect(r.ok).toBe(true);
    expect(r.tool?.name).toMatch(/^mneme\.synth\.s_[a-f0-9]{16}$/);
    expect(r.tool?.dnaHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("recipe hash is deterministic", () => {
    const a = recipeHash(valid);
    const b = recipeHash(valid);
    expect(a).toBe(b);
  });

  it("identical recipes → identical tool names", () => {
    const a = synthesize(valid);
    const b = synthesize(valid);
    expect(a.tool?.name).toBe(b.tool?.name);
    expect(a.tool?.dnaHash).toBe(b.tool?.dnaHash);
  });

  it("different recipes → different tool names", () => {
    const a = synthesize(valid);
    const b = synthesize({ ...valid, intent: "Different intent that crosses the 10-char floor" });
    expect(a.tool?.name).not.toBe(b.tool?.name);
  });

  it("rejects recipe with too-short intent", () => {
    const r = synthesize({ ...valid, intent: "tiny" });
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toMatch(/intent/);
  });

  it("rejects recipe with no search patterns", () => {
    const r = synthesize({ ...valid, searchPatterns: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects recipe with no verifiers (hallucinations would leak)", () => {
    const r = synthesize({ ...valid, verifiers: [] });
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toMatch(/verifier/);
  });

  it("rejects recipe with invalid regex pattern", () => {
    const r = synthesize({ ...valid, searchPatterns: ["[unclosed"] });
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toMatch(/invalid regex/);
  });

  it("rejects recipe with too many patterns (defensive)", () => {
    const r = synthesize({ ...valid, searchPatterns: Array(100).fill("x") });
    expect(r.ok).toBe(false);
  });

  it("rejects recipe with no authoredBy", () => {
    const r = synthesize({ ...valid, authoredBy: "" });
    expect(r.ok).toBe(false);
  });

  it("synthesized tool definition validates against pack schema", () => {
    const r = synthesize(valid);
    expect(r.ok).toBe(true);
    expect(r.tool?.toolDef.id).toMatch(/^s_[a-f0-9]{16}$/);
  });

  it("registry deduplicates by hash", () => {
    const t1 = synthesize(valid).tool!;
    let reg = emptyRegistry();
    const r1 = registerSpecies(reg, t1);
    reg = r1.registry;
    expect(r1.isNewSpecies).toBe(true);

    const t2 = synthesize(valid).tool!; // same recipe
    const r2 = registerSpecies(reg, t2);
    expect(r2.isNewSpecies).toBe(false); // dedupe
  });

  it("registry lookup by hash + by name", () => {
    const t = synthesize(valid).tool!;
    const reg = registerSpecies(emptyRegistry(), t).registry;
    expect(lookupByHash(reg, t.dnaHash)?.name).toBe(t.name);
    expect(lookupByName(reg, t.name)?.dnaHash).toBe(t.dnaHash);
    expect(lookupByHash(reg, "nope")).toBeNull();
    expect(lookupByName(reg, "nope")).toBeNull();
  });
});

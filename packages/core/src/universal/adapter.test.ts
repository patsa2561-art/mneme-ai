import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportOpenAI, exportAnthropic, exportGemini, exportFor,
  expandMolecule, recordAdapterCall,
  BASELINE_TOOLS, BUILTIN_MOLECULES,
  type UniversalTool,
} from "./adapter.js";

describe("universal/adapter (function-calling for OpenAI/Anthropic/Gemini)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-uni-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("BASELINE_TOOLS catalog sanity", () => {
    it("ships at least 6 tools across memory/security/people/analysis/consensus", () => {
      expect(BASELINE_TOOLS.length).toBeGreaterThanOrEqual(6);
      const tags = new Set(BASELINE_TOOLS.flatMap((t) => t.tags ?? []));
      expect(tags.has("memory")).toBe(true);
      expect(tags.has("security")).toBe(true);
      expect(tags.has("compliance")).toBe(true);
    });
    it("every tool has stable id + description + parameters JSON-schema", () => {
      for (const t of BASELINE_TOOLS) {
        expect(t.id.startsWith("mneme.")).toBe(true);
        expect(t.description.length).toBeGreaterThan(20);
        expect(t.parameters.type).toBe("object");
      }
    });
  });

  describe("vendor projections produce schema-correct output", () => {
    it("OpenAI shape: { type: 'function', function: { name, description, parameters } }", () => {
      const out = exportOpenAI(BASELINE_TOOLS);
      expect(out.length).toBe(BASELINE_TOOLS.length);
      for (const item of out) {
        expect(item.type).toBe("function");
        expect(item.function.name).toMatch(/^[a-zA-Z0-9_]+$/);  // vendor-safe
        expect(item.function.description.length).toBeGreaterThan(0);
        expect(item.function.parameters.type).toBe("object");
      }
    });

    it("Anthropic shape: { name, description, input_schema }", () => {
      const out = exportAnthropic(BASELINE_TOOLS);
      expect(out.length).toBe(BASELINE_TOOLS.length);
      for (const item of out) {
        expect(item.name).toMatch(/^[a-zA-Z0-9_]+$/);
        expect(item.description.length).toBeGreaterThan(0);
        expect(item.input_schema.type).toBe("object");
      }
    });

    it("Gemini shape: { functionDeclarations: [{ name, description, parameters }] }", () => {
      const out = exportGemini(BASELINE_TOOLS);
      expect(out.functionDeclarations.length).toBe(BASELINE_TOOLS.length);
      for (const item of out.functionDeclarations) {
        expect(item.name).toMatch(/^[a-zA-Z0-9_]+$/);
        expect(item.parameters.type).toBe("object");
      }
    });

    it("vendor-safe naming: dots in IDs become underscores", () => {
      const out = exportOpenAI(BASELINE_TOOLS);
      const memoryAsk = out.find((o) => o.function.name === "mneme_memory_ask");
      expect(memoryAsk).toBeDefined();
    });

    it("description truncates at 1024 chars", () => {
      const longTool: UniversalTool = {
        id: "mneme.long",
        description: "x".repeat(2000),
        parameters: { type: "object", properties: {} },
      };
      const out = exportOpenAI([longTool]);
      expect(out[0]!.function.description.length).toBe(1024);
    });
  });

  describe("exportFor switch", () => {
    it("dispatches to the right vendor projection", () => {
      const oa = exportFor("openai", BASELINE_TOOLS) as Array<{ type: string }>;
      expect(oa[0]!.type).toBe("function");
      const an = exportFor("anthropic", BASELINE_TOOLS) as Array<{ name: string }>;
      expect(an[0]!.name).toBeTruthy();
      const gm = exportFor("gemini", BASELINE_TOOLS) as { functionDeclarations: unknown[] };
      expect(gm.functionDeclarations.length).toBeGreaterThan(0);
    });
  });

  describe("BUILTIN_MOLECULES + expandMolecule", () => {
    it("ships at least 4 named molecules", () => {
      expect(BUILTIN_MOLECULES.length).toBeGreaterThanOrEqual(4);
      const ids = BUILTIN_MOLECULES.map((m) => m.id);
      expect(ids).toContain("mneme.audit-before-merge");
      expect(ids).toContain("mneme.compliance-grade");
    });

    it("expandMolecule returns null when a sub-tool is missing from catalog", () => {
      const incompleteTools = BASELINE_TOOLS.filter((t) => t.id !== "mneme.antivirus.scan");
      const auditMolecule = BUILTIN_MOLECULES.find((m) => m.id === "mneme.audit-before-merge")!;
      // audit-before-merge depends on antivirus.scan -- removing it should make expand fail.
      expect(expandMolecule(auditMolecule, incompleteTools)).toBeNull();
    });

    it("a molecule expands to its tool sequence + strategy", () => {
      // Build a synthetic full catalog containing every tool every molecule needs.
      const fullCatalog: UniversalTool[] = [
        ...BASELINE_TOOLS,
        { id: "mneme.forensics.scan", description: "x", parameters: { type: "object", properties: {} } },
        { id: "mneme.grade.answer", description: "x", parameters: { type: "object", properties: {} } },
        { id: "mneme.time-machine", description: "x", parameters: { type: "object", properties: {} } },
        { id: "mneme.bus_factor", description: "x", parameters: { type: "object", properties: {} } },
        { id: "mneme.audit.certify", description: "x", parameters: { type: "object", properties: {} } },
        { id: "mneme.advocate", description: "x", parameters: { type: "object", properties: {} } },
      ];
      const audit = BUILTIN_MOLECULES.find((m) => m.id === "mneme.audit-before-merge")!;
      const r = expandMolecule(audit, fullCatalog);
      expect(r).not.toBeNull();
      expect(r!.tools.length).toBe(audit.sequence.length);
      expect(r!.strategy).toBe("fan-out-grade");
    });
  });

  describe("recordAdapterCall (always-studying loop)", () => {
    it("appends to .mneme/universal/calls.jsonl", () => {
      recordAdapterCall(repo, {
        ts: "2026-05-12T10:00:00Z",
        vendor: "openai",
        tool: "mneme.memory.ask",
      });
      expect(existsSync(join(repo, ".mneme/universal/calls.jsonl"))).toBe(true);
    });
  });

  describe("WILD invariants -- vendor-neutral fidelity", () => {
    it("OpenAI + Anthropic + Gemini all emit the SAME tool count for the same input", () => {
      const oa = exportOpenAI(BASELINE_TOOLS);
      const an = exportAnthropic(BASELINE_TOOLS);
      const gm = exportGemini(BASELINE_TOOLS);
      expect(oa.length).toBe(an.length);
      expect(an.length).toBe(gm.functionDeclarations.length);
    });

    it("vendor-safe naming yields IDENTICAL function names across vendors (same tool, same name)", () => {
      const oa = exportOpenAI(BASELINE_TOOLS);
      const an = exportAnthropic(BASELINE_TOOLS);
      const gm = exportGemini(BASELINE_TOOLS);
      for (let i = 0; i < BASELINE_TOOLS.length; i++) {
        expect(oa[i]!.function.name).toBe(an[i]!.name);
        expect(an[i]!.name).toBe(gm.functionDeclarations[i]!.name);
      }
    });
  });
});

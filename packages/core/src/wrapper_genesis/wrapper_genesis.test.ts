import { describe, it, expect } from "vitest";
import {
  scanCoreExports, scanMcpToolNames, findOrphans, scanForOrphans,
  verifyReport, formatReport, formatOrphan,
} from "./index.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeCoreFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-genesis-core-"));
  // Module A — has both functions
  mkdirSync(join(dir, "module_a"), { recursive: true });
  writeFileSync(join(dir, "module_a", "index.ts"),
    `export function doThing(input: { x: string }): { ok: boolean } { return { ok: true }; }
export async function asyncDoThing(input: { y: number }): Promise<void> {}
export class ThingClass { go(): void {} }
function _internal(): void {}
export const formatLine = (x: string): string => x;
export const PROTOCOL_VERSION = 1;
`, "utf8");
  // Module B — exports nothing (no orphans either)
  mkdirSync(join(dir, "module_b"), { recursive: true });
  writeFileSync(join(dir, "module_b", "index.ts"), `// empty module\n`, "utf8");
  // Module C — single function, no wrapper
  mkdirSync(join(dir, "module_c"), { recursive: true });
  writeFileSync(join(dir, "module_c", "index.ts"),
    `export function newFeature(): boolean { return true; }\n`, "utf8");
  return dir;
}

function makeMcpFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-genesis-mcp-"));
  writeFileSync(join(dir, "_v1.ts"),
    `export const tool1 = { name: "mneme.module_a.do_thing", category: "lab", handler: async () => ({}) };
export const tool2 = { name: "mneme.module_a.async_do_thing", category: "lab", handler: async () => ({}) };
// module_c has NO wrapper here
`, "utf8");
  return dir;
}

describe("v2.19.8 · AUTO-GENESIS WRAPPER FACTORY", () => {
  it("scanCoreExports finds function + async function + class + const exports", () => {
    const dir = makeCoreFixture();
    const exports = scanCoreExports(dir);
    const symbols = exports.map((e) => `${e.module}.${e.symbol}`);
    expect(symbols).toContain("module_a.doThing");
    expect(symbols).toContain("module_a.asyncDoThing");
    expect(symbols).toContain("module_a.ThingClass");
    // _internal is private convention; format* is a display helper; PROTOCOL_VERSION is UPPER_SNAKE
    // — these should NOT necessarily be excluded by SCAN (filter happens at findOrphans)
    expect(exports.find((e) => e.symbol === "_internal")).toBeUndefined();
  });

  it("scanMcpToolNames extracts mneme.X.Y patterns from MCP tool files", () => {
    const dir = makeMcpFixture();
    const tools = scanMcpToolNames(dir);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["mneme.module_a.async_do_thing", "mneme.module_a.do_thing"]);
    expect(tools[0]!.family).toBe("module_a");
  });

  it("findOrphans flags FUNCTION symbols with no matching MCP wrapper (classes excluded by design)", () => {
    const coreDir = makeCoreFixture();
    const mcpDir = makeMcpFixture();
    const coreExports = scanCoreExports(coreDir);
    const mcpTools = scanMcpToolNames(mcpDir);
    const orphans = findOrphans({ coreExports, mcpTools });
    // module_c.newFeature must be flagged (whole family missing)
    expect(orphans.find((o) => o.module === "module_c" && o.symbol === "newFeature")).toBeDefined();
    // Classes are reached via singleton/new pattern, not 1:1 MCP wrappers — should NOT be flagged.
    expect(orphans.find((o) => o.symbol === "ThingClass")).toBeUndefined();
  });

  it("findOrphans skips internal-prefix symbols (formatXLine, verifyX, etc.)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-genesis-internal-"));
    mkdirSync(join(dir, "x"), { recursive: true });
    writeFileSync(join(dir, "x", "index.ts"),
      `export function formatXLine(): string { return ""; }
export function verifyX(): boolean { return true; }
export function realFeature(): void {}
`, "utf8");
    const coreExports = scanCoreExports(dir);
    const orphans = findOrphans({ coreExports, mcpTools: [] });
    // formatXLine + verifyX are internal — filtered out
    expect(orphans.find((o) => o.symbol === "formatXLine")).toBeUndefined();
    expect(orphans.find((o) => o.symbol === "verifyX")).toBeUndefined();
    // realFeature must be flagged
    expect(orphans.find((o) => o.symbol === "realFeature")).toBeDefined();
  });

  it("scanForOrphans produces a signed report", () => {
    const coreDir = makeCoreFixture();
    const mcpDir = makeMcpFixture();
    const r = scanForOrphans({ coreSrcDir: coreDir, mcpToolsDir: mcpDir });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(r.reportId).toMatch(/^gen-[0-9a-f]{14}$/);
    expect(r.totalCoreExports).toBeGreaterThan(0);
    expect(r.totalMcpTools).toBe(2);
    expect(r.orphans.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
    expect(verifyReport(r)).toBe(true);
  });

  it("verifyReport detects tampering", () => {
    const r = scanForOrphans({ coreSrcDir: makeCoreFixture(), mcpToolsDir: makeMcpFixture() });
    const tampered = { ...r, ok: true, orphans: [] };
    expect(verifyReport(tampered)).toBe(false);
  });

  it("ok=true when no orphans found", () => {
    const coreDir = mkdtempSync(join(tmpdir(), "mneme-genesis-clean-"));
    mkdirSync(join(coreDir, "x"), { recursive: true });
    writeFileSync(join(coreDir, "x", "index.ts"),
      `export function feature(): void {}\n`, "utf8");
    const mcpDir = mkdtempSync(join(tmpdir(), "mneme-genesis-clean-mcp-"));
    writeFileSync(join(mcpDir, "_v.ts"),
      `export const t = { name: "mneme.x.feature", handler: async () => ({}) };\n`, "utf8");
    const r = scanForOrphans({ coreSrcDir: coreDir, mcpToolsDir: mcpDir });
    expect(r.ok).toBe(true);
    expect(r.orphans.length).toBe(0);
  });

  it("family aliases map dir names to MCP families (vendor_ghost → ghost, etc.)", () => {
    const coreDir = mkdtempSync(join(tmpdir(), "mneme-genesis-alias-"));
    mkdirSync(join(coreDir, "vendor_ghost"), { recursive: true });
    writeFileSync(join(coreDir, "vendor_ghost", "index.ts"),
      `export function distillProfile(): void {}\nexport function askGhost(): void {}\n`, "utf8");
    const mcpDir = mkdtempSync(join(tmpdir(), "mneme-genesis-alias-mcp-"));
    writeFileSync(join(mcpDir, "_v.ts"),
      `export const t1 = { name: "mneme.ghost.distill", handler: async () => ({}) };
export const t2 = { name: "mneme.ghost.ask", handler: async () => ({}) };
`, "utf8");
    const r = scanForOrphans({ coreSrcDir: coreDir, mcpToolsDir: mcpDir });
    // distillProfile ≈ ghost.distill; askGhost ≈ ghost.ask — both should match
    expect(r.orphans.length).toBe(0);
  });

  it("real-world scan: scanner detects orphans (proves it works on the actual repo)", () => {
    const r = scanForOrphans({
      coreSrcDir: join(process.cwd(), "packages/core/src"),
      mcpToolsDir: join(process.cwd(), "packages/mcp/src/tools"),
    });
    // Scanner must SCAN something real (proves it's not a no-op).
    expect(r.totalCoreExports).toBeGreaterThan(50);
    expect(r.totalMcpTools).toBeGreaterThan(50);
    // It's expected to find legacy orphans (pre-v2.18 modules without wrappers).
    // Strict enforcement is on NEW modules only — covered by the next test.
  });

  it("STRICT enforcement: every ENFORCE_FULL_COVERAGE (v2.18+) module has zero orphans", async () => {
    const { ENFORCE_FULL_COVERAGE } = await import("./index.js");
    const r = scanForOrphans({
      coreSrcDir: join(process.cwd(), "packages/core/src"),
      mcpToolsDir: join(process.cwd(), "packages/mcp/src/tools"),
    });
    const enforcedOrphans = r.orphans.filter((o) => ENFORCE_FULL_COVERAGE.has(o.module));
    if (enforcedOrphans.length > 0) {
      console.error("V2.18+ MODULES WITH MISSING MCP WRAPPERS:");
      for (const o of enforcedOrphans) console.error(formatOrphan(o));
    }
    // Hard gate: v2.18+ modules MUST have full coverage.
    expect(enforcedOrphans.length).toBe(0);
  });

  it("formatReport summarises ok + dirty modules + orphans", () => {
    const r = scanForOrphans({ coreSrcDir: makeCoreFixture(), mcpToolsDir: makeMcpFixture() });
    const text = formatReport(r);
    expect(text).toContain("AUTO-GENESIS");
    expect(text).toContain("core exports scanned:");
    if (r.orphans.length > 0) expect(text).toContain("Orphans");
  });
});

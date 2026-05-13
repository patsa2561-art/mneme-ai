import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentCatchAudit, anyDensityAudit, runAudits, formatAuditPulseLine } from "./code_audit.js";

function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "mneme-audit-test-"));
  const dir = join(root, "packages", "core", "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "good.ts"), [
    "export function ok(): number { try { return 1; } catch (e) { console.error(e); throw e; } }",
  ].join("\n"));
  writeFileSync(join(dir, "bad.ts"), [
    "export function silent(): void { try {} catch {} }",
    "export function silent2(): void { try {} catch (e) { /* */ } }",
    "export function silent3(): void { try {} catch (_e) {} }",
  ].join("\n"));
  writeFileSync(join(dir, "any.ts"), [
    "export const a: any = 1;",
    "export function f(x: any, y: any): any { return x as any; }",
    "export const safe: number = 1;",
  ].join("\n"));
  return root;
}

describe("v2.7 METRON code audit · silent catch", () => {
  it("counts catch {} and catch (e) {} as silent", () => {
    const root = fakeRepo();
    const r = silentCatchAudit(root);
    expect(r.totalSilentCatches).toBeGreaterThanOrEqual(3);
    expect(r.worstFiles[0]?.file).toMatch(/bad\.ts$/);
  });

  it("does NOT count catch blocks with throw / log / side effect", () => {
    const root = fakeRepo();
    const r = silentCatchAudit(root);
    // good.ts has a non-silent catch — should not appear in worstFiles
    expect(r.worstFiles.some((f) => /good\.ts$/.test(f.file))).toBe(false);
  });

  it("sampleHits records file + line + excerpt", () => {
    const root = fakeRepo();
    const r = silentCatchAudit(root);
    expect(r.sampleHits.length).toBeGreaterThan(0);
    expect(r.sampleHits[0]!.file).toMatch(/bad\.ts$/);
    expect(r.sampleHits[0]!.excerpt).toMatch(/catch/);
  });
});

describe("v2.7 METRON code audit · :any density", () => {
  it("counts :any annotations", () => {
    const root = fakeRepo();
    const r = anyDensityAudit(root);
    // any.ts has 4: `a: any`, `x: any`, `y: any`, `): any`. The `as any` is not :any pattern.
    expect(r.totalAnyAnnotations).toBeGreaterThanOrEqual(4);
    expect(r.worstFiles[0]?.file).toMatch(/any\.ts$/);
  });

  it("does NOT count :number / :string / :boolean", () => {
    const root = fakeRepo();
    const r = anyDensityAudit(root);
    expect(r.totalAnyAnnotations).toBeLessThan(10);
  });

  it("density = total / fileCount", () => {
    const root = fakeRepo();
    const r = anyDensityAudit(root);
    expect(r.density).toBe(r.totalAnyAnnotations / r.filesScanned);
  });
});

describe("v2.7 METRON code audit · pulse", () => {
  it("runAudits returns both results", () => {
    const root = fakeRepo();
    const r = runAudits(root);
    expect(r.silentCatch.totalSilentCatches).toBeGreaterThan(0);
    expect(r.anyDensity.totalAnyAnnotations).toBeGreaterThan(0);
  });

  it("formatAuditPulseLine produces a compact summary", () => {
    const root = fakeRepo();
    const r = runAudits(root);
    const line = formatAuditPulseLine(r);
    expect(line).toContain("AUDIT");
    expect(line).toContain("silent-catches=");
    expect(line).toContain(":any=");
  });
});

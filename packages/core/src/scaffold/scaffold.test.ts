import { describe, it, expect } from "vitest";
import { scaffold, scaffoldGauntlet } from "./index.js";

describe("v2.126 SCAFFOLD — ts-model", () => {
  it("renders an interface + CRUD repo with every field, balanced braces", () => {
    const r = scaffold({ kind: "ts-model", model: "User", fields: { id: "string", email: "string", age: "number" }, crud: true });
    expect(r.ok).toBe(true);
    const code = r.files[0]!.content;
    expect(code).toContain("export interface User {");
    expect(code).toContain("email: string;");
    expect(code).toContain("age: number;");
    expect(code).toContain("class UserRepo");
    expect(code).toContain("create(");
    // balanced
    const open = (code.match(/{/g) || []).length, close = (code.match(/}/g) || []).length;
    expect(open).toBe(close);
  });
  it("saves OUTPUT tokens (spec ≪ generated code)", () => {
    const r = scaffold({ kind: "ts-model", model: "Order", fields: { id: "string", total: "number" } });
    expect(r.measure.expansionRatio).toBeGreaterThan(3);
    expect(r.measure.outputReductionPct).toBeGreaterThan(50);
  });
  it("sanitizes hostile identifiers", () => {
    const r = scaffold({ kind: "ts-model", model: "User; rm -rf /", fields: { "x\n}": "string" } });
    expect(r.files[0]!.content).not.toContain("rm -rf");
  });
});

describe("v2.126 SCAFFOLD — test-skeleton + config", () => {
  it("test-skeleton has describe + each case, balanced", () => {
    const r = scaffold({ kind: "test-skeleton", target: "Repo", cases: ["creates", "deletes"] });
    expect(r.ok).toBe(true);
    expect(r.files[0]!.content).toContain('describe("Repo"');
    expect(r.files[0]!.content).toContain("creates");
    expect(r.files[0]!.content).toContain("deletes");
  });
  it("config json round-trips", () => {
    const r = scaffold({ kind: "config", format: "json", entries: { port: 8080, name: "svc" } });
    expect(JSON.parse(r.files[0]!.content).port).toBe(8080);
  });
  it("config env emits KEY=value lines", () => {
    const r = scaffold({ kind: "config", format: "env", entries: { apiKey: "x", port: 3000 } });
    expect(r.files[0]!.content).toMatch(/APIKEY=x/);
    expect(r.files[0]!.path).toBe(".env.example");
  });
});

describe("v2.126 SCAFFOLD — honesty + totality", () => {
  it("REFUSES an unknown kind (never guesses arbitrary logic)", () => {
    const r = scaffold({ kind: "smart-stock-deduction-system" } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown scaffold kind/i);
    expect(r.files).toEqual([]);
  });
  it("note honestly scopes it to boilerplate, not arbitrary logic", () => {
    const r = scaffold({ kind: "ts-model", model: "X", fields: { id: "string" } });
    expect(r.note).toMatch(/BOILERPLATE only/);
    expect(r.note).toMatch(/NOT a generator of arbitrary/i);
  });
  it("is TOTAL — never throws on garbage", () => {
    expect(() => scaffold(null as never)).not.toThrow();
    expect(() => scaffold({} as never)).not.toThrow();
    expect(scaffold(null as never).ok).toBe(false);
  });
  it("scaffoldGauntlet() = 100", () => {
    const g = scaffoldGauntlet();
    expect(g.score).toBe(100);
    expect(g.tsModelValid).toBe(true);
    expect(g.testSkeletonValid).toBe(true);
    expect(g.configRoundTrips).toBe(true);
    expect(g.expansionReal).toBe(true);
    expect(g.refusesUnknown).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});

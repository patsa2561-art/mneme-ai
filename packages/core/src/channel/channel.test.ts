import { describe, it, expect } from "vitest";
import { openChannel, applyOp, quickCheck, diffSummary, commitChannel, channelSavings, channelGauntlet } from "./index.js";

const SRC = `export function add(a, b) {\n  return a + b;\n}\nexport const NAME = "x";\n`;

describe("v2.128 CHANNEL — apply ops to a local working copy", () => {
  it("replaceRegion edits the exact lines + reports a compact delta", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    const r = applyOp(st, { kind: "replaceRegion", path: "m.ts", startLine: 2, endLine: 2, text: "  return a * b;" });
    st = r.state;
    expect(r.result.ok).toBe(true);
    expect(st.files["m.ts"]!.working).toContain("a * b");
    expect(r.result.brief).toMatch(/structure OK/);
    expect(r.result.opId).toBe(1);
  });
  it("replaceText + insertAfter + appendFile work", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    st = applyOp(st, { kind: "replaceText", path: "m.ts", find: '"x"', replace: '"y"' }).state;
    st = applyOp(st, { kind: "insertAfter", path: "m.ts", line: 0, text: "// header" }).state;
    st = applyOp(st, { kind: "appendFile", path: "m.ts", text: "// footer\n" }).state;
    const w = st.files["m.ts"]!.working;
    expect(w).toContain('"y"'); expect(w.startsWith("// header")).toBe(true); expect(w).toContain("// footer");
  });
  it("a bad op (find not present / invalid region) leaves working unchanged", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    const before = st.files["m.ts"]!.working;
    const r = applyOp(st, { kind: "replaceText", path: "m.ts", find: "zzz_absent", replace: "q" });
    expect(r.result.ok).toBe(false);
    expect(r.state.files["m.ts"]!.working).toBe(before);
  });
  it("an op on an unknown file is reported, not thrown", () => {
    const st = openChannel([{ path: "m.ts", content: SRC }]);
    const r = applyOp(st, { kind: "appendFile", path: "ghost.ts", text: "x" });
    expect(r.result.ok).toBe(false);
    expect(r.result.brief).toMatch(/no file/);
  });
});

describe("v2.128 CHANNEL — quick structural check", () => {
  it("flags an unbalanced edit", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    const r = applyOp(st, { kind: "replaceRegion", path: "m.ts", startLine: 3, endLine: 3, text: "// brace gone" });
    expect(r.result.structureOk).toBe(false);
    expect(r.result.structureIssue).toBeTruthy();
  });
  it("ignores braces inside strings/comments", () => {
    expect(quickCheck(`const s = "}{ unbalanced in string {";`).ok).toBe(true);
  });
  it("python uses #/triple-quote masking", () => {
    expect(quickCheck(`def f():\n    x = "} {"  # } comment\n    return x\n`, true).ok).toBe(true);
  });
});

describe("v2.128 CHANNEL — commit + diff + savings", () => {
  it("commit yields the byte-exact edited content", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    st = applyOp(st, { kind: "replaceText", path: "m.ts", find: "add", replace: "sum" }).state;
    const c = commitChannel(st);
    expect(c.files[0]!.content).toBe(st.files["m.ts"]!.working);
    expect(c.files[0]!.changed).toBe(true);
  });
  it("diff summary localizes the change", () => {
    let st = openChannel([{ path: "m.ts", content: SRC }]);
    st = applyOp(st, { kind: "replaceRegion", path: "m.ts", startLine: 2, endLine: 2, text: "  return a - b;" }).state;
    const d = diffSummary(st, "m.ts");
    expect(d.changed).toBe(true);
    expect(d.hunks[0]!.startLine).toBe(2);
  });
  it("a multi-op loop saves tokens vs the naive re-stream baseline", () => {
    const big = ("code line;\n".repeat(300)) + "const Q = 1;\n";
    let st = openChannel([{ path: "b.ts", content: big }]);
    for (let i = 0; i < 4; i++) st = applyOp(st, { kind: "replaceText", path: "b.ts", find: "Q = " + (i === 0 ? "1" : i), replace: "Q = " + (i + 1) }).state;
    const s = channelSavings(st);
    expect(s.reductionPct).toBeGreaterThan(50);
    expect(s.note).toMatch(/chars\/4|not re-streamed/i);
  });
});

describe("v2.128 CHANNEL — totality + gauntlet", () => {
  it("is TOTAL on garbage", () => {
    expect(() => openChannel(null as never)).not.toThrow();
    expect(() => applyOp(null as never, null as never)).not.toThrow();
    expect(() => commitChannel(null as never)).not.toThrow();
  });
  it("channelGauntlet() = 100", () => {
    const g = channelGauntlet();
    expect(g.score).toBe(100);
    expect(g.appliesRegion).toBe(true);
    expect(g.workingExact).toBe(true);
    expect(g.catchesBrokenStructure).toBe(true);
    expect(g.rejectsBadOp).toBe(true);
    expect(g.commitByteExact).toBe(true);
    expect(g.diffCompact).toBe(true);
    expect(g.savingsReal).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  emptyRegistry,
  initMain,
  branchFrom,
  diffBranches,
  mergeBranch,
  verifyRegistry,
  listBranches,
  formatBranchLine,
  type BrainRegistry,
} from "./index.js";

const SECRET = "brain-test-secret-77821";

function seed(): BrainRegistry {
  let r = emptyRegistry();
  r = initMain({
    registry: r,
    axioms: [{ id: "A1", body: "the sun rises in the east" }, { id: "A2", body: "water boils at 100C" }],
    claims: [{ id: "C1", body: "today's commit hash is abc" }],
    nowMs: 1_000_000,
    secret: SECRET,
  });
  return r;
}

describe("v2.19.12 BRAIN BRANCHES · initMain + branchFrom", () => {
  it("initMain seeds a 'main' branch with parentId=null and a deterministic snapshot hash", () => {
    const r = seed();
    expect(r.branches).toHaveLength(1);
    const main = r.branches[0]!;
    expect(main.name).toBe("main");
    expect(main.parentId).toBeNull();
    expect(main.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("initMain is idempotent unless force=true", () => {
    let r = seed();
    r = initMain({ registry: r, axioms: [], claims: [], nowMs: 2_000_000, secret: SECRET });
    expect(r.branches).toHaveLength(1);
    expect(r.branches[0]!.axioms).toHaveLength(2);
    r = initMain({ registry: r, axioms: [], claims: [], force: true, nowMs: 2_000_000, secret: SECRET });
    expect(r.branches[0]!.axioms).toHaveLength(0);
  });

  it("branchFrom creates a child carrying parent's state, with parentId set", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "experimental-v3", nowMs: 1_001_000, secret: SECRET });
    expect(r.branches).toHaveLength(2);
    const child = r.branches.find((b) => b.name === "experimental-v3")!;
    expect(child.parentId).toBe(r.branches.find((b) => b.name === "main")!.id);
    expect(child.axioms).toHaveLength(2);
    expect(child.claims).toHaveLength(1);
  });

  it("branchFrom refuses duplicate branch name", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    expect(() =>
      branchFrom({ registry: r, newName: "exp", nowMs: 1_002_000, secret: SECRET }),
    ).toThrow(/already exists/);
  });

  it("branchFrom refuses unknown parent", () => {
    const r = seed();
    expect(() =>
      branchFrom({ registry: r, newName: "x", fromName: "ghost", secret: SECRET }),
    ).toThrow(/not found/);
  });
});

describe("v2.19.12 BRAIN BRANCHES · diffBranches", () => {
  it("returns symmetric onlyA / onlyB / common sets", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    // Add a new axiom on exp by replacing it
    const exp = r.branches.find((b) => b.name === "exp")!;
    const newExp = { ...exp, axioms: [...exp.axioms, { id: "A3", body: "gravity = 9.8" }] };
    r = { ...r, branches: r.branches.map((b) => (b.id === exp.id ? newExp : b)) };
    const d = diffBranches({ registry: r, a: "exp", b: "main" });
    expect(d.axiomsOnlyInA.map((a) => a.id)).toEqual(["A3"]);
    expect(d.axiomsOnlyInB).toHaveLength(0);
    expect(d.axiomsCommon.map((a) => a.id).sort()).toEqual(["A1", "A2"]);
    expect(d.conflicts).toHaveLength(0);
  });

  it("flags conflicts when same id has different body", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const exp = r.branches.find((b) => b.name === "exp")!;
    const newExp = { ...exp, axioms: exp.axioms.map((a) => (a.id === "A2" ? { ...a, body: "water boils at 99C" } : a)) };
    r = { ...r, branches: r.branches.map((b) => (b.id === exp.id ? newExp : b)) };
    const d = diffBranches({ registry: r, a: "exp", b: "main" });
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]!.id).toBe("A2");
    expect(d.conflicts[0]!.kind).toBe("axiom");
  });

  it("throws on unknown branch", () => {
    const r = seed();
    expect(() => diffBranches({ registry: r, a: "main", b: "ghost" })).toThrow();
  });
});

describe("v2.19.12 BRAIN BRANCHES · mergeBranch", () => {
  it("strategy=all applies every non-conflicting axiom + claim from source to target", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const exp = r.branches.find((b) => b.name === "exp")!;
    const newExp = { ...exp, axioms: [...exp.axioms, { id: "A3", body: "x" }, { id: "A4", body: "y" }] };
    r = { ...r, branches: r.branches.map((b) => (b.id === exp.id ? newExp : b)) };
    const m = mergeBranch({ registry: r, from: "exp", into: "main", strategy: "all", nowMs: 1_002_000, secret: SECRET });
    expect(m.appliedAxioms).toBe(2);
    expect(m.appliedClaims).toBe(0);
    const newMain = m.registry.branches.find((b) => b.name === "main")!;
    expect(newMain.axioms.map((a) => a.id).sort()).toEqual(["A1", "A2", "A3", "A4"]);
  });

  it("strategy=selective applies only the explicitly-selected ids", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const exp = r.branches.find((b) => b.name === "exp")!;
    const newExp = { ...exp, axioms: [...exp.axioms, { id: "A3", body: "x" }, { id: "A4", body: "y" }] };
    r = { ...r, branches: r.branches.map((b) => (b.id === exp.id ? newExp : b)) };
    const m = mergeBranch({
      registry: r, from: "exp", into: "main",
      strategy: "selective",
      selectAxiomIds: ["A3"],
      nowMs: 1_002_000, secret: SECRET,
    });
    expect(m.appliedAxioms).toBe(1);
    const newMain = m.registry.branches.find((b) => b.name === "main")!;
    expect(newMain.axioms.map((a) => a.id).sort()).toEqual(["A1", "A2", "A3"]);
  });

  it("reports skippedConflicts when ids overlap with different bodies (no auto-resolve)", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const exp = r.branches.find((b) => b.name === "exp")!;
    const newExp = { ...exp, axioms: exp.axioms.map((a) => (a.id === "A2" ? { ...a, body: "water boils at 99C" } : a)) };
    r = { ...r, branches: r.branches.map((b) => (b.id === exp.id ? newExp : b)) };
    const m = mergeBranch({ registry: r, from: "exp", into: "main", strategy: "all", nowMs: 1_002_000, secret: SECRET });
    expect(m.skippedConflicts).toHaveLength(1);
    expect(m.skippedConflicts[0]!.id).toBe("A2");
  });
});

describe("v2.19.12 BRAIN BRANCHES · verifyRegistry + listBranches + formatters", () => {
  it("verifyRegistry passes on freshly-built registry", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const v = verifyRegistry(r, SECRET);
    expect(v.ok).toBe(true);
  });

  it("verifyRegistry detects tampered axiom body (snapshot hash will mismatch)", () => {
    const r = seed();
    const tampered: BrainRegistry = {
      ...r,
      branches: r.branches.map((b) => ({ ...b, axioms: [{ id: "EVIL", body: "forged" }] })),
    };
    const v = verifyRegistry(tampered, SECRET);
    expect(v.ok).toBe(false);
  });

  it("listBranches returns one summary per branch with counts + snapshot hash prefix", () => {
    let r = seed();
    r = branchFrom({ registry: r, newName: "exp", nowMs: 1_001_000, secret: SECRET });
    const ls = listBranches(r);
    expect(ls).toHaveLength(2);
    expect(ls.find((x) => x.name === "main")!.axiomCount).toBe(2);
    expect(ls.find((x) => x.name === "exp")!.parentId).toBe(ls.find((x) => x.name === "main")!.id);
  });

  it("formatter line includes the branch name and 🌳 emoji", () => {
    const line = formatBranchLine({ name: "exp", axiomCount: 5, claimCount: 3, snapshotHash: "abcdef1234567890" });
    expect(line).toContain("🌳");
    expect(line).toContain("exp");
    expect(line).toContain("axioms=5");
  });
});

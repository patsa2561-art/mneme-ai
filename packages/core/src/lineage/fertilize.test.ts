/**
 * Fertilize + Tree DAG — verify boot-context inheritance + tree integrity.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetForTests, recordAtom, recordConfess, startSession } from "./working_memory.js";
import { crystallize } from "./crystallize.js";
import { addToTree, ancestors, findCommonAncestor, rebuildTreeFromDisk, readTree } from "./tree.js";
import { fertilize } from "./fertilize.js";
import { listChromosomes } from "./chromosome.js";
import { unlinkSync } from "node:fs";
import { treePath } from "./paths.js";

function mkRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-fert-"));
}

beforeEach(() => _resetForTests());

describe("Tree DAG", () => {
  let repo: string;
  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("starts empty", () => {
    const t = readTree(repo);
    expect(t.head).toBeNull();
    expect(Object.keys(t.nodes)).toHaveLength(0);
  });

  it("addToTree links parents → children", () => {
    startSession({ sessionId: "s1", vendor: "claude", machineId: "m1" });
    recordAtom(repo, "mneme.x", {});
    const c1 = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c1.chromosome);

    _resetForTests();
    startSession({ sessionId: "s2", vendor: "claude", machineId: "m1" });
    recordAtom(repo, "mneme.y", {});
    const c2 = crystallize(repo, { endReason: "manual", parents: [c1.chromosome.id] })!;
    addToTree(repo, c2.chromosome);

    const t = readTree(repo);
    expect(t.head).toBe(c2.chromosome.id);
    expect(t.nodes[c1.chromosome.id]?.children).toContain(c2.chromosome.id);
    expect(t.nodes[c2.chromosome.id]?.parents).toContain(c1.chromosome.id);
  });

  it("addToTree is idempotent", () => {
    startSession({ sessionId: "s", vendor: "x", machineId: "m" });
    const c = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c.chromosome);
    addToTree(repo, c.chromosome);
    expect(Object.keys(readTree(repo).nodes)).toHaveLength(1);
  });

  it("ancestors() walks parents BFS, newest-first", () => {
    // Build chain: c1 → c2 → c3
    startSession({ sessionId: "s1", vendor: "x", machineId: "m" });
    const c1 = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c1.chromosome);

    _resetForTests();
    startSession({ sessionId: "s2", vendor: "x", machineId: "m" });
    const c2 = crystallize(repo, { endReason: "manual", parents: [c1.chromosome.id] })!;
    addToTree(repo, c2.chromosome);

    _resetForTests();
    startSession({ sessionId: "s3", vendor: "x", machineId: "m" });
    const c3 = crystallize(repo, { endReason: "manual", parents: [c2.chromosome.id] })!;
    addToTree(repo, c3.chromosome);

    const tree = readTree(repo);
    const anc = ancestors(tree, c3.chromosome.id, 5);
    expect(anc).toContain(c1.chromosome.id);
    expect(anc).toContain(c2.chromosome.id);
  });

  it("findCommonAncestor finds shared root", () => {
    startSession({ sessionId: "s1", vendor: "x", machineId: "m" });
    const root = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, root.chromosome);
    _resetForTests();
    startSession({ sessionId: "sA", vendor: "x", machineId: "m" });
    const branchA = crystallize(repo, { endReason: "manual", parents: [root.chromosome.id], topic: "branchA" })!;
    addToTree(repo, branchA.chromosome);
    _resetForTests();
    startSession({ sessionId: "sB", vendor: "x", machineId: "m" });
    const branchB = crystallize(repo, { endReason: "manual", parents: [root.chromosome.id], topic: "branchB" })!;
    addToTree(repo, branchB.chromosome);

    const tree = readTree(repo);
    expect(findCommonAncestor(tree, branchA.chromosome.id, branchB.chromosome.id)).toBe(root.chromosome.id);
  });

  it("rebuildTreeFromDisk recovers from a deleted tree.json", () => {
    startSession({ sessionId: "s", vendor: "x", machineId: "m" });
    const c = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c.chromosome);
    // Delete the tree file.
    unlinkSync(treePath(repo));
    expect(readTree(repo).nodes[c.chromosome.id]).toBeUndefined(); // missing
    rebuildTreeFromDisk(repo);
    const restored = readTree(repo);
    expect(restored.nodes[c.chromosome.id]).toBeDefined();
    expect(restored.head).toBe(c.chromosome.id);
  });
});

describe("Fertilize", () => {
  let repo: string;
  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns null when lineage is empty", () => {
    expect(fertilize(repo)).toBeNull();
  });

  it("returns inheritance bundle from a single ancestor", () => {
    startSession({ sessionId: "s1", vendor: "claude", machineId: "m" });
    recordAtom(repo, "mneme.memory.ask", {});
    const c1 = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c1.chromosome);

    const bundle = fertilize(repo)!;
    expect(bundle.sourceIds).toContain(c1.chromosome.id);
    expect(bundle.vendors).toEqual(["claude"]);
    expect(bundle.inheritedAtomCount).toBeGreaterThan(0);
  });

  it("merges top-N ancestors via Mendel", () => {
    // 3 sessions across vendors.
    for (const [vendor, atom] of [["claude", "mneme.memory.ask"], ["cursor", "mneme.audit.certify"], ["codex", "mneme.insights.story"]] as const) {
      _resetForTests();
      startSession({ sessionId: `s-${vendor}`, vendor, machineId: "m" });
      recordAtom(repo, atom, {});
      const c = crystallize(repo, { endReason: "manual" })!;
      addToTree(repo, c.chromosome);
    }

    const bundle = fertilize(repo, { topN: 3 })!;
    expect(bundle.sourceIds).toHaveLength(3);
    expect(bundle.vendors).toContain("claude");
    expect(bundle.vendors).toContain("cursor");
    expect(bundle.vendors).toContain("codex");
    expect(bundle.inheritedAtomCount).toBeGreaterThanOrEqual(3);
    expect(bundle.narrative).toContain("3 prior sessions");
  });

  it("respects an explicit parentIds list", () => {
    for (let i = 0; i < 3; i++) {
      _resetForTests();
      startSession({ sessionId: `s${i}`, vendor: "claude", machineId: "m" });
      recordAtom(repo, "mneme.x", {});
      const c = crystallize(repo, { endReason: "manual" })!;
      addToTree(repo, c.chromosome);
    }
    const ids = listChromosomes(repo);
    const bundle = fertilize(repo, { parentIds: [ids[0]!] })!;
    expect(bundle.sourceIds).toEqual([ids[0]]);
  });

  it("excludes lethal recessives from inherited atoms", () => {
    _resetForTests();
    startSession({ sessionId: "s1", vendor: "claude", machineId: "m" });
    // Force a lethal by recording a hallucination confess.
    recordAtom(repo, "mneme.bad", {});
    recordConfess({ vendor: "claude", verdict: "hallucination", selfConfidence: 0.9, hadHallucination: true }, "mneme.bad");
    const c1 = crystallize(repo, { endReason: "manual" })!;
    addToTree(repo, c1.chromosome);

    _resetForTests();
    startSession({ sessionId: "s2", vendor: "claude", machineId: "m" });
    recordAtom(repo, "mneme.bad", {});
    recordConfess({ vendor: "claude", verdict: "hallucination", selfConfidence: 0.9, hadHallucination: true }, "mneme.bad");
    const c2 = crystallize(repo, { endReason: "manual", parents: [c1.chromosome.id] })!;
    addToTree(repo, c2.chromosome);

    const bundle = fertilize(repo, { topN: 2 })!;
    expect(bundle.lethalRecessives).toContain("mneme.bad");
    expect(bundle.topMolecules.find((m) => m.atoms.includes("mneme.bad"))).toBeUndefined();
  });

  it("performance — fertilize 5 ancestors completes < 300ms", () => {
    for (let i = 0; i < 5; i++) {
      _resetForTests();
      startSession({ sessionId: `s${i}`, vendor: "claude", machineId: "m" });
      for (let j = 0; j < 50; j++) recordAtom(repo, `mneme.tool_${j}`, {});
      const c = crystallize(repo, { endReason: "manual" })!;
      addToTree(repo, c.chromosome);
    }
    const start = Date.now();
    const bundle = fertilize(repo, { topN: 5 })!;
    const ms = Date.now() - start;
    expect(bundle).not.toBeNull();
    expect(ms).toBeLessThan(300);
  });
});

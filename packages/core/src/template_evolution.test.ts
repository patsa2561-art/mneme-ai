import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { proposeMutations, readMutations, applyMutation, evaluateMutation, inFlightMutations } from "./template_evolution.js";
import { logCompliance } from "./ai_compliance.js";
import { pickTemplate } from "./vendor_pulse_templates.js";

describe("template_evolution · proposer", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-tev-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("proposeMutations returns [] when compliance is healthy (no log)", () => {
    expect(proposeMutations(repo, "claude-opus-4-7")).toEqual([]);
  });

  it("proposeMutations returns 3 candidates when compliance < 60%", () => {
    // 3 executed + 7 failed = 30% inline compliance (well under 60%)
    for (let i = 0; i < 3; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "executed" });
    for (let i = 0; i < 7; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "failed" });
    const ms = proposeMutations(repo, "claude-opus-4-7");
    expect(ms).toHaveLength(3);
    expect(ms.map((m) => m.kind).sort()).toEqual(["duplicate-toggle", "flip-action-position", "tighten-maxchars"]);
    expect(ms.every((m) => m.status === "proposed")).toBe(true);
    expect(ms.every((m) => m.id.startsWith("m-"))).toBe(true);
    expect(ms[0]!.baselineCompliance).toBeCloseTo(0.3, 2);
  });

  it("readMutations returns the persisted proposals", () => {
    for (let i = 0; i < 1; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "executed" });
    for (let i = 0; i < 5; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "failed" });
    const proposed = proposeMutations(repo, "v");
    expect(readMutations(repo)).toHaveLength(proposed.length);
  });
});

describe("template_evolution · apply + A/B evaluate", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-tev-"));
    // seed: low-compliance baseline so proposer kicks in
    for (let i = 0; i < 2; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "executed" });
    for (let i = 0; i < 8; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "failed" });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("applyMutation overwrites the registry template + records the application event", () => {
    const proposals = proposeMutations(repo, "claude-opus-4-7");
    const tightenId = proposals.find((p) => p.kind === "tighten-maxchars")!.id;
    const before = pickTemplate(repo, "claude-opus-4-7");
    const applied = applyMutation(repo, tightenId);
    expect(applied).not.toBeNull();
    expect(applied!.status).toBe("applied");
    const after = pickTemplate(repo, "claude-opus-4-7");
    expect(after.maxChars).toBeLessThan(before.maxChars);
  });

  it("applyMutation on unknown id returns null", () => {
    expect(applyMutation(repo, "totally-unknown-id")).toBeNull();
  });

  it("inFlightMutations returns only currently-applied (not promoted/reverted) mutations", () => {
    const proposals = proposeMutations(repo, "v");
    applyMutation(repo, proposals[0]!.id);
    expect(inFlightMutations(repo, "v")).toHaveLength(1);
    // add enough post-apply entries to clear the still-running gate, then evaluate
    for (let i = 0; i < 30; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "executed" });
    evaluateMutation(repo, proposals[0]!.id, { window: 30, bumpRequired: -1 });   // force promote regardless of delta
    expect(inFlightMutations(repo, "v")).toHaveLength(0);
  });

  it("evaluateMutation returns 'still-running' when too few entries since apply", () => {
    const proposals = proposeMutations(repo, "v");
    const id = proposals[0]!.id;
    applyMutation(repo, id);
    // window of 50 needs >= 25 entries; we have 10 — still-running expected
    const result = evaluateMutation(repo, id, { window: 50 });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("still-running");
  });

  it("evaluateMutation promotes when delta exceeds threshold (synthesized improvement)", () => {
    const proposals = proposeMutations(repo, "v");
    const id = proposals[0]!.id;
    applyMutation(repo, id);
    // simulate post-application improvement: add many executed entries
    for (let i = 0; i < 30; i++) logCompliance(repo, { ts: "t", mandate: "m", args: {}, executor: "pulse-pre-executor", outcome: "executed" });
    const result = evaluateMutation(repo, id, { window: 30, bumpRequired: 0.10 });
    expect(result!.decision).toBe("promote");
    expect(result!.delta).toBeGreaterThan(0.10);
  });
});

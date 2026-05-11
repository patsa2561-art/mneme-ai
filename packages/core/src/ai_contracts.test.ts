import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { signContract, recordEvent, computeStats, renderContractBlock, CONTRACT_TEMPLATES } from "./ai_contracts.js";

describe("ai_contracts · sign + record + stats", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-con-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("computeStats on empty repo returns []", () => {
    expect(computeStats(repo)).toEqual([]);
  });

  it("CONTRACT_TEMPLATES has the three out-of-box offerings", () => {
    expect(CONTRACT_TEMPLATES.map((t) => t.id)).toEqual([
      "tmpl-confess-for-precog",
      "tmpl-execute-for-prestige",
      "tmpl-cite-for-lineage",
    ]);
  });

  it("signContract creates a contract + appears in stats with default compliance 100%", () => {
    const c = signContract(repo, "claude", { aiProvides: "X", mnemeProvides: "Y" });
    expect(c.id).toMatch(/^c-[a-z0-9]+$/);
    const stats = computeStats(repo);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.contractId).toBe(c.id);
    expect(stats[0]!.aiCompliance).toBe(1);   // 0 events, default 1
    expect(stats[0]!.mnemeCompliance).toBe(1);
  });

  it("ai-fulfilled raises ai compliance + valueToMneme; ai-breached lowers it", () => {
    const c = signContract(repo, "v", { aiProvides: "X", mnemeProvides: "Y" });
    recordEvent(repo, c.id, "v", "ai-fulfilled", undefined, 2);
    recordEvent(repo, c.id, "v", "ai-fulfilled", undefined, 3);
    recordEvent(repo, c.id, "v", "ai-breached");
    const s = computeStats(repo)[0]!;
    expect(s.aiFulfilled).toBe(2);
    expect(s.aiBreached).toBe(1);
    expect(s.aiCompliance).toBeCloseTo(2 / 3, 4);
    expect(s.valueToMneme).toBe(5); // 2 + 3
  });

  it("revoked contracts are filtered out of computeStats", () => {
    const c = signContract(repo, "v", { aiProvides: "X", mnemeProvides: "Y" });
    recordEvent(repo, c.id, "v", "revoked");
    expect(computeStats(repo)).toEqual([]);
  });

  it("renderContractBlock returns empty string when no active contract for vendor", () => {
    expect(renderContractBlock(repo, "claude")).toBe("");
  });

  it("renderContractBlock surfaces the active contract for the vendor", () => {
    const c = signContract(repo, "claude", { aiProvides: "X", mnemeProvides: "Y" });
    recordEvent(repo, c.id, "claude", "ai-fulfilled", undefined, 5);
    recordEvent(repo, c.id, "claude", "mneme-fulfilled", undefined, 7);
    const block = renderContractBlock(repo, "claude");
    expect(block).toContain("YOUR CONTRACT");
    expect(block).toContain("claude");
    expect(block).toContain("compliance");
  });
});

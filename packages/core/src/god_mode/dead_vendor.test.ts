import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanDeadVendors, buildMigrationPlan } from "./dead_vendor.js";

function seed(repo: string, deprecations: object[] = [], trials: object[] = []): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  if (deprecations.length > 0) writeFileSync(join(repo, ".mneme/vendor-deprecations.jsonl"), deprecations.map((d) => JSON.stringify(d)).join("\n") + "\n");
  if (trials.length > 0) writeFileSync(join(repo, ".mneme/vendor-trials.jsonl"), trials.map((t) => JSON.stringify(t)).join("\n") + "\n");
}

const days = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe("god_mode/dead_vendor · scanning", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-deadv-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns empty when no logs exist", () => {
    const r = scanDeadVendors(repo);
    expect(r.formallyDeprecated).toEqual([]);
    expect(r.softDeaths).toEqual([]);
  });

  it("reports formally deprecated vendors from deprecations file", () => {
    seed(repo, [{ vendor: "v1", model: "m1", deprecatedAt: days(10) }]);
    const r = scanDeadVendors(repo);
    expect(r.formallyDeprecated).toHaveLength(1);
    expect(r.formallyDeprecated[0]!.vendor).toBe("v1");
  });

  it("flags soft death — vendor with last success > 90 days ago", () => {
    seed(repo, [], [
      { vendor: "v1", taskClass: "x", outcome: "success", at: days(100) },
      { vendor: "v2", taskClass: "x", outcome: "success", at: days(5) },
    ]);
    const r = scanDeadVendors(repo);
    expect(r.softDeaths.find((s) => s.vendor === "v1")).toBeDefined();
    expect(r.softDeaths.find((s) => s.vendor === "v2")).toBeUndefined();
  });

  it("formally deprecated vendor not double-counted as soft death", () => {
    seed(repo,
      [{ vendor: "v1", model: "m", deprecatedAt: days(10) }],
      [{ vendor: "v1", taskClass: "x", outcome: "success", at: days(200) }],
    );
    const r = scanDeadVendors(repo);
    expect(r.softDeaths.find((s) => s.vendor === "v1")).toBeUndefined();
  });
});

describe("god_mode/dead_vendor · migration plan", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-deadv-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("recommends best-trial-rate live vendor for each task class", () => {
    seed(repo,
      [{ vendor: "dead", model: "m", deprecatedAt: days(10), replacementHint: "use new model X" }],
      [
        // dead vendor handled "code" task class
        ...Array.from({ length: 5 }, () => ({ vendor: "dead", taskClass: "code", outcome: "success", at: days(60) })),
        // live alpha: 9 successes on "code"
        ...Array.from({ length: 9 }, () => ({ vendor: "alpha", taskClass: "code", outcome: "success", at: days(5) })),
        ...Array.from({ length: 1 }, () => ({ vendor: "alpha", taskClass: "code", outcome: "fail", at: days(5) })),
        // live beta: 5 successes / 5 fails
        ...Array.from({ length: 5 }, () => ({ vendor: "beta", taskClass: "code", outcome: "success", at: days(5) })),
        ...Array.from({ length: 5 }, () => ({ vendor: "beta", taskClass: "code", outcome: "fail", at: days(5) })),
      ],
    );
    const plan = buildMigrationPlan(repo, "dead");
    expect(plan.taskClassesToMigrate).toEqual(["code"]);
    expect(plan.replacements[0]!.recommendedVendor).toBe("alpha");
    expect(plan.replacements[0]!.recommendedScore).toBeGreaterThan(0.7);
  });

  it("returns 'manual selection required' when no live vendor has any success", () => {
    seed(repo,
      [{ vendor: "dead", model: "m", deprecatedAt: days(10) }],
      [
        { vendor: "dead", taskClass: "code", outcome: "success", at: days(60) },
        { vendor: "alpha", taskClass: "code", outcome: "fail", at: days(5) },
        { vendor: "alpha", taskClass: "code", outcome: "fail", at: days(5) },
      ],
    );
    const plan = buildMigrationPlan(repo, "dead");
    expect(plan.replacements[0]!.recommendedVendor).toBeNull();
    expect(plan.replacements[0]!.reason).toContain("manual");
  });

  it("falls back to penalized overall rate when no class-specific trials", () => {
    seed(repo,
      [{ vendor: "dead", model: "m", deprecatedAt: days(10) }],
      [
        { vendor: "dead", taskClass: "rare", outcome: "success", at: days(60) },
        // alpha only ever did "code", not "rare"
        ...Array.from({ length: 10 }, () => ({ vendor: "alpha", taskClass: "code", outcome: "success", at: days(5) })),
      ],
    );
    const plan = buildMigrationPlan(repo, "dead");
    expect(plan.replacements[0]!.recommendedVendor).toBe("alpha");
    expect(plan.replacements[0]!.recommendedScore).toBeCloseTo(0.5, 1); // 100% × 0.5 penalty
    expect(plan.replacements[0]!.reason).toContain("penalized 50%");
  });

  it("writes a markdown plan to disk", () => {
    seed(repo,
      [{ vendor: "dead", model: "m", deprecatedAt: days(10) }],
      [
        { vendor: "dead", taskClass: "code", outcome: "success", at: days(60) },
        { vendor: "alpha", taskClass: "code", outcome: "success", at: days(5) },
      ],
    );
    const plan = buildMigrationPlan(repo, "dead");
    const md = readFileSync(plan.planPath, "utf8");
    expect(md).toContain("# Migration plan — dead");
    expect(md).toContain("## Per-task-class recommendations");
    expect(md).toContain("### code");
  });

  it("handles dead vendor with no observed task classes", () => {
    seed(repo, [{ vendor: "ghost", model: "m", deprecatedAt: days(10) }], []);
    const plan = buildMigrationPlan(repo, "ghost");
    expect(plan.taskClassesToMigrate).toEqual([]);
    expect(plan.replacements).toEqual([]);
  });

  it("includes vendor's own replacementHint in plan when provided", () => {
    seed(repo,
      [{ vendor: "dead", model: "m", deprecatedAt: days(10), replacementHint: "switch to model-9000" }],
      [{ vendor: "dead", taskClass: "code", outcome: "success", at: days(60) }],
    );
    const plan = buildMigrationPlan(repo, "dead");
    const md = readFileSync(plan.planPath, "utf8");
    expect(md).toContain("model-9000");
  });
});

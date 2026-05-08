import { describe, expect, it } from "vitest";
import { buildSarif } from "./sarif.js";
import { huntVulnerabilities } from "./vulnhunt.js";
import { buildStackProfile } from "./stack-priors.js";
import type { Commit } from "../types.js";

const fakeCommit = (subject: string, hash = "abc1234"): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject,
  body: "",
  authorName: "Alice",
  authorEmail: "alice@x",
  authorDate: "2026-01-01T00:00:00Z",
  committerDate: "2026-01-01T00:00:00Z",
  parents: [],
  files: [],
  prNumber: undefined,
});

describe("forensics/sarif — buildSarif", () => {
  it("produces SARIF v2.1.0 envelope", () => {
    const report = huntVulnerabilities([], { stack: buildStackProfile(["pg"]) });
    const sarif = buildSarif(report) as { version: string; runs: unknown[] };
    expect(sarif.version).toBe("2.1.0");
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(sarif.runs).toHaveLength(1);
  });

  it("includes a tool driver block with the rule registry", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n+    await pool.query(\`SELECT * FROM t WHERE id = \${id}\`);\n`;
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: q"), diff }], { stack: buildStackProfile(["pg"]) });
    const sarif = buildSarif(report) as { runs: Array<{ tool: { driver: { name: string; rules: unknown[] } } }> };
    expect(sarif.runs[0]!.tool.driver.name).toBe("mneme-ai");
    expect(sarif.runs[0]!.tool.driver.rules.length).toBeGreaterThan(0);
  });

  it("each result has a stable partialFingerprints id", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n+    await pool.query(\`SELECT * FROM t WHERE id = \${id}\`);\n`;
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: q"), diff }], { stack: buildStackProfile(["pg"]) });
    const sarif = buildSarif(report) as { runs: Array<{ results: Array<{ partialFingerprints: { primaryLocationLineHash: string } }> }> };
    const fp = sarif.runs[0]!.results[0]!.partialFingerprints.primaryLocationLineHash;
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it("maps severity to SARIF level", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n+    await pool.query(\`SELECT * FROM t WHERE id = \${id}\`);\n`;
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: q"), diff }], { stack: buildStackProfile(["pg"]) });
    const sarif = buildSarif(report) as { runs: Array<{ results: Array<{ level: string }> }> };
    expect(["error", "warning", "note"]).toContain(sarif.runs[0]!.results[0]!.level);
  });

  it("includes posterior + prior + evidence on each result", () => {
    const diff = `diff --git a/src/x.ts b/src/x.ts\n+    await pool.query(\`SELECT * FROM t WHERE id = \${id}\`);\n`;
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: q"), diff }], { stack: buildStackProfile(["pg"]) });
    const sarif = buildSarif(report) as { runs: Array<{ results: Array<{ properties: Record<string, unknown> }> }> };
    const props = sarif.runs[0]!.results[0]!.properties;
    expect(props.posterior).toBeGreaterThan(0);
    expect(props.prior).toBeGreaterThan(0);
    expect(props.evidenceScore).toBeGreaterThan(0);
  });
});

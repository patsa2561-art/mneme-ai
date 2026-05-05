import { describe, it, expect } from "vitest";
import { extractDecisions, renderDecisionsAsMarkdown } from "./decisions.js";
import type { Commit } from "../types.js";

const commit = (subject: string, body = ""): Commit => ({
  hash: "abcdef1234567890abcdef1234567890abcdef12",
  shortHash: "abcdef1",
  authorName: "alice",
  authorEmail: "alice@example.com",
  authorDate: "2024-08-12T00:00:00Z",
  committerDate: "2024-08-12T00:00:00Z",
  subject,
  body,
  parents: [],
  files: [],
});

describe("extractDecisions — high-precision patterns", () => {
  it('catches "decided to X"', () => {
    const out = extractDecisions(commit("refactor: decided to use Postgres for write-heavy paths"));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("decided-to");
    expect(out[0]!.summary).toContain("Postgres");
  });

  it('catches "switched from X to Y" with rationale', () => {
    const out = extractDecisions(
      commit(
        "auth: switched from passport to custom middleware",
        "switched from passport to custom JWT because legal flagged session token storage",
      ),
    );
    expect(out.length).toBeGreaterThan(0);
    const switched = out.find((d) => d.kind === "switched");
    expect(switched).toBeDefined();
    expect(switched!.summary).toContain("from passport to custom");
    expect(switched!.rationale).toContain("legal");
  });

  it('catches "replaced X with Y"', () => {
    const out = extractDecisions(commit("replaced lodash with native methods"));
    expect(out.find((d) => d.kind === "replaced")).toBeDefined();
  });

  it('catches "chose X over Y"', () => {
    const out = extractDecisions(commit("chose pnpm over npm for monorepo workspaces"));
    const d = out.find((d) => d.kind === "chose-over");
    expect(d).toBeDefined();
    expect(d!.summary).toContain("pnpm over npm");
  });

  it('catches "use X instead of Y"', () => {
    const out = extractDecisions(commit("perf: use Map instead of plain object for hot path"));
    expect(out.find((d) => d.kind === "instead-of")).toBeDefined();
  });

  it('catches "deprecated X"', () => {
    const out = extractDecisions(commit("deprecate the legacy /api/v1/auth endpoint"));
    expect(out.find((d) => d.kind === "deprecated")).toBeDefined();
  });

  it('catches "migrated from X to Y"', () => {
    const out = extractDecisions(commit("infra: migrated from Redis to Valkey for license"));
    expect(out.find((d) => d.kind === "migrated")).toBeDefined();
  });

  it('catches "adopted X"', () => {
    const out = extractDecisions(commit("ci: adopted GitHub Actions over Jenkins"));
    expect(out.find((d) => d.kind === "adopted")).toBeDefined();
  });
});

describe("extractDecisions — false positives stay low", () => {
  it("does not fire on simple progress commits", () => {
    expect(extractDecisions(commit("fix: typo in README"))).toEqual([]);
    expect(extractDecisions(commit("wip: more tests"))).toEqual([]);
    expect(extractDecisions(commit("update package-lock.json"))).toEqual([]);
  });

  it("does not fire when 'decided' appears without 'to'", () => {
    expect(extractDecisions(commit("the team decided unanimously"))).toEqual([]);
  });

  it("does not fire on too-short text after the trigger", () => {
    // "decided to X" — needs >= 8 chars after, so a 5-char tail is rejected.
    expect(extractDecisions(commit("we decided to wait"))).toEqual([]);
  });
});

describe("extractDecisions — rationale capture", () => {
  it('captures "because ..." rationale', () => {
    const out = extractDecisions(
      commit("auth: switched from passport to custom JWT because compliance flagged session token storage"),
    );
    expect(out[0]!.rationale).toContain("compliance");
  });

  it('captures "so that ..." rationale', () => {
    const out = extractDecisions(
      commit("infra: switched from Redis to Valkey so that we keep BSD license compatibility"),
    );
    expect(out[0]!.rationale).toContain("BSD");
  });

  it("rationale is undefined when no marker present", () => {
    const out = extractDecisions(commit("decided to drop synchronous fs.readFileSync calls"));
    expect(out[0]!.rationale).toBeUndefined();
  });
});

describe("extractDecisions — multi-decision and dedupe", () => {
  it("returns multiple decisions when a commit records several", () => {
    const out = extractDecisions(
      commit(
        "perf: replaced lodash with native methods",
        "Also adopted Bun for tests because it is fast.",
      ),
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    const kinds = out.map((d) => d.kind);
    expect(kinds).toContain("replaced");
    expect(kinds).toContain("adopted");
  });

  it("dedupes the same summary if the same line is matched by multiple patterns", () => {
    // A potentially tricky case: "decided to switch from A to B" — both
    // 'decided-to' and 'switched' could fire. Both are useful but on
    // different summary text, so we keep both.
    const out = extractDecisions(commit("decided to switch from passport to custom JWT"));
    const summaries = out.map((d) => d.summary);
    expect(new Set(summaries).size).toBe(summaries.length); // no exact duplicates
  });
});

describe("renderDecisionsAsMarkdown", () => {
  it("renders a markdown table with Date, Author, Decision, Rationale, Source", () => {
    const out = renderDecisionsAsMarkdown([
      {
        commitHash: "abc1234",
        shortHash: "abc1234",
        date: "2024-08-12",
        author: "alice",
        summary: "switched from passport to custom JWT",
        rationale: "compliance",
        kind: "switched",
        confidence: 0.9,
      },
    ]);
    expect(out).toContain("| Date | Author | Decision | Rationale | Source |");
    expect(out).toContain("alice");
    expect(out).toContain("switched from passport to custom JWT");
    expect(out).toContain("compliance");
    expect(out).toContain("`abc1234`");
  });

  it("renders a friendly fallback when there are no decisions", () => {
    const out = renderDecisionsAsMarkdown([]);
    expect(out.toLowerCase()).toContain("no decisions extracted");
  });

  it("escapes pipe characters to keep the table valid", () => {
    const out = renderDecisionsAsMarkdown([
      {
        commitHash: "x",
        shortHash: "xxxxxxx",
        date: "2024-01-01",
        author: "bob",
        summary: "decided to use a|b matching",
        kind: "decided-to",
        confidence: 0.95,
      },
    ]);
    expect(out).toContain("a\\|b");
  });
});

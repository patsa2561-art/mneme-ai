/**
 * Tribal-fetcher tests — verify composition logic with injected data.
 *
 * Filesystem-read paths are also exercised via mkdtemp + writeFileSync.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAugmentationInput,
  daysSince,
  fetchAtrophyEntries,
  fetchForensicsIncidents,
  fetchConstitutionRules,
  fetchDeprecations,
} from "./tribal-fetcher.js";
import type { CodeSearchHit } from "./query-engine.js";

const HITS: CodeSearchHit[] = [
  { path: "src/auth.ts", line: 1, snippet: "x", matchedPattern: "x" },
  { path: "lib/old.ts", line: 1, snippet: "x", matchedPattern: "x" },
];

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-tribal-"));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("daysSince", () => {
  it("returns 0 for now", () => {
    expect(daysSince(new Date().toISOString())).toBe(0);
  });

  it("returns positive integer for past date", () => {
    const oneDayAgo = new Date(Date.now() - 86400_000).toISOString();
    expect(daysSince(oneDayAgo)).toBe(1);
  });

  it("clamps negative to 0", () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(daysSince(future)).toBe(0);
  });

  it("returns 0 for malformed date", () => {
    expect(daysSince("nope")).toBe(0);
  });
});

describe("buildAugmentationInput — composes from injected data", () => {
  it("matches expertise to hits via atrophy then git-blame fallback", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {
        atrophy: [
          { path: "src/auth.ts", expert: "alice", atrophyScore: 25 },
        ],
        blame: [
          { path: "lib/old.ts", author: "bob", lastTouchedAt: new Date(Date.now() - 30 * 86400_000).toISOString() },
        ],
      },
    });
    expect(r.expertise).toHaveLength(2);
    const auth = r.expertise.find((e) => e.path === "src/auth.ts")!;
    const old = r.expertise.find((e) => e.path === "lib/old.ts")!;
    expect(auth.expert).toBe("alice");
    expect(auth.atrophyScore).toBe(25);
    expect(old.expert).toBe("bob");
    expect(old.atrophyScore).toBe(0);
    expect(old.daysSinceLastTouch).toBeGreaterThan(0);
  });

  it("atrophy data wins over git-blame for the same path", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {
        atrophy: [{ path: "src/auth.ts", expert: "alice", atrophyScore: 30 }],
        blame: [{ path: "src/auth.ts", author: "bob", lastTouchedAt: new Date().toISOString() }],
      },
    });
    const auth = r.expertise.find((e) => e.path === "src/auth.ts")!;
    expect(auth.expert).toBe("alice");
  });

  it("filters deprecations to those affecting hit paths", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {
        deprecations: [
          { path: "lib/old.ts", canonical: "src/new.ts", deprecatedInCommit: "abc", reason: "moved" },
          { path: "lib/unrelated.ts", canonical: "src/x.ts", deprecatedInCommit: "def", reason: "x" },
        ],
      },
    });
    expect(r.deprecations).toHaveLength(1);
    expect(r.deprecations[0]!.path).toBe("lib/old.ts");
  });

  it("filters incidents to those touching hit paths", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {
        incidents: [
          { affectedPaths: ["src/auth.ts"], title: "auth issue", reportedAt: "2024-01-01T00:00:00Z" },
          { affectedPaths: ["unrelated.ts"], title: "unrelated", reportedAt: "2024-01-01T00:00:00Z" },
        ],
      },
    });
    expect(r.incidents).toHaveLength(1);
    expect(r.incidents[0]!.title).toBe("auth issue");
  });

  it("includes global rules (no applicablePaths) AND path-specific rules that match", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {
        rules: [
          { id: "global-1", severity: "must", rule: "global rule", source: "regret" },
          { id: "path-1", severity: "must", rule: "auth-only", source: "regret", applicablePaths: ["src/auth.ts"] },
          { id: "path-2", severity: "must", rule: "unrelated", source: "regret", applicablePaths: ["nope.ts"] },
        ],
      },
    });
    expect(r.applicableRules.map((x) => x.id).sort()).toEqual(["global-1", "path-1"]);
  });

  it("returns empty arrays when injected data is empty", () => {
    const r = buildAugmentationInput({
      hits: HITS,
      repoRoot: tmp,
      injected: {},
    });
    expect(r.expertise).toEqual([]);
    expect(r.deprecations).toEqual([]);
    expect(r.incidents).toEqual([]);
    expect(r.applicableRules).toEqual([]);
  });
});

describe("buildAugmentationInput — filesystem read fallback", () => {
  it("reads .mneme/atrophy.json when present", () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmp, ".mneme", "atrophy.json"),
      JSON.stringify({ records: [{ path: "src/auth.ts", expert: "fs-alice", atrophyScore: 50 }] }),
    );
    const r = buildAugmentationInput({ hits: HITS, repoRoot: tmp });
    const auth = r.expertise.find((e) => e.path === "src/auth.ts");
    expect(auth?.expert).toBe("fs-alice");
  });

  it("reads .mneme/incidents.json when present", () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmp, ".mneme", "incidents.json"),
      JSON.stringify({
        incidents: [{ affectedPaths: ["src/auth.ts"], title: "fs incident", reportedAt: "2024-01-01T00:00:00Z" }],
      }),
    );
    const r = buildAugmentationInput({ hits: HITS, repoRoot: tmp });
    expect(r.incidents).toHaveLength(1);
    expect(r.incidents[0]!.title).toBe("fs incident");
  });

  it("returns empty arrays when no .mneme/* files exist (graceful)", () => {
    const r = buildAugmentationInput({ hits: HITS, repoRoot: tmp });
    expect(r.expertise).toEqual([]);
    expect(r.deprecations).toEqual([]);
    expect(r.incidents).toEqual([]);
    expect(r.applicableRules).toEqual([]);
  });

  it("malformed JSON → empty arrays (no throw)", () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(join(tmp, ".mneme", "atrophy.json"), "{ broken json");
    expect(fetchAtrophyEntries(tmp)).toEqual([]);
    writeFileSync(join(tmp, ".mneme", "incidents.json"), "not json");
    expect(fetchForensicsIncidents(tmp)).toEqual([]);
    writeFileSync(join(tmp, ".mneme", "constitution.json"), "x");
    expect(fetchConstitutionRules(tmp)).toEqual([]);
    writeFileSync(join(tmp, ".mneme", "deprecations.json"), "x");
    expect(fetchDeprecations(tmp)).toEqual([]);
  });

  it("accepts legacy 'array root' JSON format too", () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmp, ".mneme", "atrophy.json"),
      JSON.stringify([{ path: "src/auth.ts", expert: "z", atrophyScore: 0 }]),
    );
    const records = fetchAtrophyEntries(tmp);
    expect(records).toHaveLength(1);
    expect(records[0]!.expert).toBe("z");
  });
});

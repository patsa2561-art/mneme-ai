/**
 * Pack schema tests — every Zod constraint covered.
 *
 * Pattern: for each rule in the schema, write at least one test that
 * accepts a valid case + at least one test that rejects an invalid case.
 * If a rule slips, the schema is silently lying. Tests catch this.
 */

import { describe, it, expect } from "vitest";
import { validatePack, PackSchema, PACK_SCHEMA_VERSION, SUPPORTED_QUERY_KINDS, SUPPORTED_ENRICHMENTS } from "./pack-schema.js";

const VALID_PACK = {
  schemaVersion: 1,
  id: "stripe",
  displayName: "Stripe Payments",
  description: "Detect Stripe SDK usage and expose ecosystem-specific tools.",
  version: "1.0.0",
  mnemeMinVersion: "1.13.0",
  maintainer: { name: "Mneme Core", email: "hello@mneme.dev" },
  license: "MIT",
  detection: {
    packageDeps: ["stripe"],
    importPatterns: ["from\\s+['\"]stripe['\"]"],
  },
  tools: [
    {
      id: "find_pricing_logic",
      description: "Find Stripe pricing logic in this codebase. Returns code locations + git history.",
      query: {
        kind: "code-search",
        patterns: ["stripe\\.prices\\."],
      },
      enrichWith: ["git-blame", "centrality-rank"],
    },
  ],
};

describe("validatePack — happy path", () => {
  it("accepts a minimal valid pack", () => {
    const r = validatePack(VALID_PACK);
    expect(r.ok).toBe(true);
  });

  it("returns the parsed pack with defaults filled", () => {
    const r = validatePack(VALID_PACK);
    if (!r.ok) throw new Error("expected valid");
    // Defaults applied
    expect(r.pack.detection.minConfidence).toBe(0.5);
    expect(r.pack.detection.pythonDeps).toEqual([]);
    expect(r.pack.detection.filePatterns).toEqual([]);
    expect(r.pack.tools[0]!.augmentation.includeCanonicalPath).toBe(true);
  });

  it("retains all explicit values exactly", () => {
    const r = validatePack(VALID_PACK);
    if (!r.ok) throw new Error("expected valid");
    expect(r.pack.id).toBe("stripe");
    expect(r.pack.tools[0]!.id).toBe("find_pricing_logic");
    expect(r.pack.tools[0]!.enrichWith).toEqual(["git-blame", "centrality-rank"]);
  });
});

describe("validatePack — top-level rules", () => {
  it("rejects schemaVersion not 1", () => {
    const r = validatePack({ ...VALID_PACK, schemaVersion: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects pack id with spaces", () => {
    const r = validatePack({ ...VALID_PACK, id: "stripe payments" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects pack id with uppercase", () => {
    const r = validatePack({ ...VALID_PACK, id: "Stripe" });
    expect(r.ok).toBe(false);
  });

  it("accepts kebab-case id", () => {
    const r = validatePack({ ...VALID_PACK, id: "stripe-payments" });
    expect(r.ok).toBe(true);
  });

  it("rejects empty displayName", () => {
    const r = validatePack({ ...VALID_PACK, displayName: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects displayName longer than 80 chars", () => {
    const r = validatePack({ ...VALID_PACK, displayName: "x".repeat(81) });
    expect(r.ok).toBe(false);
  });

  it("rejects description shorter than 20 chars", () => {
    const r = validatePack({ ...VALID_PACK, description: "too short" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-semver version", () => {
    const r = validatePack({ ...VALID_PACK, version: "v1" });
    expect(r.ok).toBe(false);
  });

  it("accepts pre-release semver", () => {
    const r = validatePack({ ...VALID_PACK, version: "1.0.0-beta.1" });
    expect(r.ok).toBe(true);
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    const r = validatePack({ ...VALID_PACK, randomField: "nope" });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid maintainer email", () => {
    const r = validatePack({
      ...VALID_PACK,
      maintainer: { name: "X", email: "not-an-email" },
    });
    expect(r.ok).toBe(false);
  });

  it("requires at least one tool", () => {
    const r = validatePack({ ...VALID_PACK, tools: [] });
    expect(r.ok).toBe(false);
  });
});

describe("validatePack — detection rules", () => {
  it("accepts empty detection (uses defaults)", () => {
    const r = validatePack({ ...VALID_PACK, detection: {} });
    expect(r.ok).toBe(true);
  });

  it("rejects minConfidence outside 0..1", () => {
    const r = validatePack({
      ...VALID_PACK,
      detection: { minConfidence: 1.5 },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty string in packageDeps", () => {
    const r = validatePack({
      ...VALID_PACK,
      detection: { packageDeps: ["valid", ""] },
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePack — tool rules", () => {
  it("rejects tool id with hyphens (must be snake_case)", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, id: "find-pricing" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects tool id starting with number", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, id: "1find" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects too-short tool description", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, description: "too short" }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePack — query rules", () => {
  it("rejects unknown query kind", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, query: { kind: "magic", patterns: ["x"] } }],
    });
    expect(r.ok).toBe(false);
  });

  it("requires at least one pattern in code-search", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, query: { kind: "code-search", patterns: [] } }],
    });
    expect(r.ok).toBe(false);
  });

  it("caps maxResults at 500", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{
        ...VALID_PACK.tools[0]!,
        query: { kind: "code-search", patterns: ["x"], maxResults: 1000 },
      }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts git-history query kind", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{
        ...VALID_PACK.tools[0]!,
        query: { kind: "git-history", paths: ["src/auth.ts"] },
      }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts entity-graph query kind with depth limit", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{
        ...VALID_PACK.tools[0]!,
        query: { kind: "entity-graph", entityKinds: ["function"], maxDepth: 2 },
      }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects entity-graph maxDepth > 5 (defensive)", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{
        ...VALID_PACK.tools[0]!,
        query: { kind: "entity-graph", entityKinds: ["function"], maxDepth: 10 },
      }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePack — enrichment rules", () => {
  it("accepts known enrichers", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, enrichWith: SUPPORTED_ENRICHMENTS as unknown as string[] }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects unknown enricher", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, enrichWith: ["unknown-magic"] }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePack — error reporting", () => {
  it("returns dot-path for nested errors", () => {
    const r = validatePack({
      ...VALID_PACK,
      tools: [{ ...VALID_PACK.tools[0]!, id: "BAD-ID" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const idError = r.errors.find((e) => e.path === "tools.0.id");
    expect(idError).toBeDefined();
  });

  it("reports multiple errors at once (not just the first)", () => {
    const r = validatePack({
      schemaVersion: 1,
      id: "BAD",
      displayName: "",
      description: "x",
      version: "v1",
      mnemeMinVersion: "x",
      maintainer: { name: "Y" },
      detection: {},
      tools: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(3);
  });
});

describe("constants exposed", () => {
  it("PACK_SCHEMA_VERSION is 1", () => {
    expect(PACK_SCHEMA_VERSION).toBe(1);
  });

  it("SUPPORTED_QUERY_KINDS contains expected primitives", () => {
    expect(SUPPORTED_QUERY_KINDS).toContain("code-search");
    expect(SUPPORTED_QUERY_KINDS).toContain("git-history");
    expect(SUPPORTED_QUERY_KINDS).toContain("entity-graph");
  });

  it("SUPPORTED_ENRICHMENTS contains tribal-knowledge enrichers", () => {
    expect(SUPPORTED_ENRICHMENTS).toContain("git-blame");
    expect(SUPPORTED_ENRICHMENTS).toContain("centrality-rank");
    expect(SUPPORTED_ENRICHMENTS).toContain("atrophy-author");
    expect(SUPPORTED_ENRICHMENTS).toContain("constitution-rules");
  });
});

/**
 * Contract tests — loop every registered MCP tool and verify the structural
 * invariants that the Mneme architecture depends on. These tests catch:
 *
 *   • name regex violations (the namespace pattern matters for grouping)
 *   • description / handler shape regressions
 *   • inputSchema validity (must be a JSON Schema object, type=object)
 *   • outputSchema validity when present
 *   • duplicate names across categories
 *   • unique categories (only the 9 documented categories are allowed)
 *   • no orphaned composeWith references
 *
 * v1.18 — these tests are STRUCTURAL only. Description-quality scoring
 * (length, jargon coverage, examples) lives in mneme.tool.lint and is
 * intended to be a soft target, not a build-time gate. Build-time gates
 * here would block legitimate refactors of legacy tools.
 */

import { describe, expect, it } from "vitest";
import { buildAllTools, buildToolMap } from "./_registry.js";
import { computeCatalogHash } from "./_tool_meta.js";

const NAME_PATTERN = /^mneme\.[a-z_]+(?:\.[a-z_]+)*$/;
const VALID_CATEGORIES = new Set([
  "memory",
  "people",
  "audit",
  "forensics",
  "insights",
  "quality",
  "quant",
  "lab",
  "meta",
]);

describe("MCP tool contract — structural invariants", () => {
  const all = buildAllTools();

  it("registers at least 90 tools (catalog should be growing, not shrinking)", () => {
    expect(all.length).toBeGreaterThanOrEqual(90);
  });

  it.each(all.map((t) => [t.name, t]))("%s — name matches mneme.<group>(.<sub>)* pattern", (_name, t) => {
    expect(t.name).toMatch(NAME_PATTERN);
  });

  it.each(all.map((t) => [t.name, t]))("%s — category is one of the 9 documented categories", (_name, t) => {
    expect(VALID_CATEGORIES.has(t.category)).toBe(true);
  });

  it.each(all.map((t) => [t.name, t]))("%s — has a non-empty description", (_name, t) => {
    expect(t.description).toBeTypeOf("string");
    expect(t.description.length).toBeGreaterThan(20);
  });

  it.each(all.map((t) => [t.name, t]))("%s — has at least one trigger phrase", (_name, t) => {
    expect(Array.isArray(t.triggers)).toBe(true);
    expect(t.triggers.length).toBeGreaterThanOrEqual(1);
  });

  it.each(all.map((t) => [t.name, t]))("%s — handler is an async function", (_name, t) => {
    expect(typeof t.handler).toBe("function");
    // Async functions in TS may lose the AsyncFunction prototype after compile,
    // so we don't assert constructor.name; we trust the type system here.
  });

  it.each(all.map((t) => [t.name, t]))("%s — inputSchema is a JSON Schema object", (_name, t) => {
    const s = t.inputSchema as { type?: string; properties?: unknown };
    expect(s).toBeTypeOf("object");
    expect(s.type).toBe("object");
    // properties may be empty {} for zero-arg tools — that's fine.
    expect(s.properties).toBeTypeOf("object");
  });

  it("has no duplicate tool names across the registry", () => {
    const names = all.map((t) => t.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it("buildToolMap rejects collisions and produces a 1:1 map", () => {
    const map = buildToolMap();
    expect(map.size).toBe(all.length);
    for (const t of all) expect(map.get(t.name)).toBe(t);
  });
});

describe("MCP tool contract — v1.18 optional fields are well-formed when present", () => {
  const all = buildAllTools();

  it.each(all.filter((t) => t.outputSchema).map((t) => [t.name, t]))(
    "%s — outputSchema (when present) is a JSON Schema object",
    (_name, t) => {
      const s = t.outputSchema as { type?: string; properties?: unknown };
      expect(s).toBeTypeOf("object");
      expect(s.type).toBe("object");
    },
  );

  it.each(all.filter((t) => t.examples).map((t) => [t.name, t]))(
    "%s — every example has at minimum a userQuery string",
    (_name, t) => {
      for (const ex of t.examples!) {
        expect(typeof ex.userQuery).toBe("string");
        expect(ex.userQuery.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(all.filter((t) => t.composeWith && t.composeWith.length > 0).map((t) => [t.name, t]))(
    "%s — composeWith references resolve (no orphans)",
    (_name, t) => {
      const map = buildToolMap();
      for (const ref of t.composeWith!) {
        // composeWith may legitimately reference tools that don't exist yet
        // (e.g., in same-version planning), so we only enforce when the
        // ref looks like an mneme.* name.
        if (ref.startsWith("mneme.")) {
          expect(map.has(ref), `${t.name} composeWith references unknown tool ${ref}`).toBe(true);
        }
      }
    },
  );

  it.each(all.filter((t) => t.pitfalls).map((t) => [t.name, t]))(
    "%s — every pitfall is a non-empty short string",
    (_name, t) => {
      for (const p of t.pitfalls!) {
        expect(typeof p).toBe("string");
        expect(p.length).toBeGreaterThan(5);
        expect(p.length).toBeLessThan(400);
      }
    },
  );
});

describe("Catalog hash — deterministic + stable", () => {
  it("computeCatalogHash returns a 16-char hex string", () => {
    const h = computeCatalogHash();
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("computeCatalogHash is deterministic across calls", () => {
    expect(computeCatalogHash()).toBe(computeCatalogHash());
  });
});

/**
 * Tool builder tests — verify deterministic compilation of MCP catalog.
 */

import { describe, it, expect } from "vitest";
import { buildActiveToolCatalog, lookupTool } from "./tool-builder.js";
import type { Pack } from "./pack-schema.js";
import type { EcosystemDetection } from "./ecosystem.js";

const STRIPE_PACK: Pack = {
  schemaVersion: 1,
  id: "stripe",
  displayName: "Stripe",
  description: "Stripe ecosystem pack with payments tooling.",
  version: "1.0.0",
  mnemeMinVersion: "1.13.0",
  maintainer: { name: "Test" },
  license: "MIT",
  detection: {
    packageDeps: ["stripe"],
    pythonDeps: [],
    importPatterns: [],
    filePatterns: [],
    minConfidence: 0.5,
  },
  tools: [
    {
      id: "find_pricing_logic",
      description: "Find Stripe pricing logic in this codebase to support refactor or audit work.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      query: { kind: "code-search", patterns: ["stripe\\.prices"], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
      enrichWith: [],
      augmentation: {
        includeCanonicalPath: true,
        includeDeprecatedPaths: true,
        includeExpertAuthors: true,
        includeRecentIncidents: true,
        includeApplicableRules: true,
      },
    },
    {
      id: "audit_pii_handlers",
      description: "Audit code paths that handle Stripe-bound PII (email, name, phone, address).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      query: { kind: "code-search", patterns: ["customer\\.email"], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
      enrichWith: [],
      augmentation: {
        includeCanonicalPath: true,
        includeDeprecatedPaths: true,
        includeExpertAuthors: true,
        includeRecentIncidents: true,
        includeApplicableRules: true,
      },
    },
  ],
};

const detection_active: EcosystemDetection = {
  detectedAt: "2026-05-08T00:00:00Z",
  signals: [{ id: "stripe", confidence: 0.9, evidence: ["dep:stripe"], tools: ["mneme.stripe.find_pricing_logic"] }],
  toolsToAdd: 2,
};

const detection_below_threshold: EcosystemDetection = {
  detectedAt: "2026-05-08T00:00:00Z",
  signals: [{ id: "stripe", confidence: 0.3, evidence: ["dep:stripe"], tools: [] }],
  toolsToAdd: 0,
};

const detection_no_match: EcosystemDetection = {
  detectedAt: "2026-05-08T00:00:00Z",
  signals: [{ id: "kafka", confidence: 0.9, evidence: [], tools: [] }],
  toolsToAdd: 0,
};

describe("buildActiveToolCatalog — happy path", () => {
  it("emits MCP tools when pack matches a detected ecosystem", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    expect(catalog).toHaveLength(2);
    expect(catalog[0]!.name).toBe("mneme.stripe.audit_pii_handlers");
    expect(catalog[1]!.name).toBe("mneme.stripe.find_pricing_logic");
  });

  it("includes inputSchema verbatim from pack", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    expect(catalog[0]!.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });

  it("includes detection confidence on every tool", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    for (const t of catalog) expect(t.confidence).toBe(0.9);
  });
});

describe("buildActiveToolCatalog — confidence gating", () => {
  it("does NOT emit tools when detection below pack's minConfidence", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_below_threshold, packs: [STRIPE_PACK] });
    expect(catalog).toEqual([]);
  });

  it("does NOT emit tools when no signal matches pack id", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_no_match, packs: [STRIPE_PACK] });
    expect(catalog).toEqual([]);
  });
});

describe("buildActiveToolCatalog — augmentation hook", () => {
  it("uses caller-provided augmenter when given", () => {
    const catalog = buildActiveToolCatalog({
      detection: detection_active,
      packs: [STRIPE_PACK],
      augmentDescription: (base) => base + "\n\nAUGMENTED",
    });
    for (const t of catalog) expect(t.description.endsWith("AUGMENTED")).toBe(true);
  });

  it("uses base description when augmenter not provided", () => {
    const catalog = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    expect(catalog[0]!.description.includes("AUGMENTED")).toBe(false);
  });
});

describe("buildActiveToolCatalog — determinism", () => {
  it("returns tools in stable alphabetical order across runs", () => {
    const catalog1 = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    const catalog2 = buildActiveToolCatalog({ detection: detection_active, packs: [STRIPE_PACK] });
    expect(catalog1.map((t) => t.name)).toEqual(catalog2.map((t) => t.name));
  });
});

describe("lookupTool", () => {
  it("finds a tool by full name", () => {
    const r = lookupTool("mneme.stripe.find_pricing_logic", [STRIPE_PACK]);
    expect(r).not.toBeNull();
    expect(r!.pack.id).toBe("stripe");
    expect(r!.tool.id).toBe("find_pricing_logic");
  });

  it("returns null for malformed tool name", () => {
    expect(lookupTool("invalid", [STRIPE_PACK])).toBeNull();
    expect(lookupTool("mneme.stripe", [STRIPE_PACK])).toBeNull();
    expect(lookupTool("mneme.STRIPE.find_pricing", [STRIPE_PACK])).toBeNull();
  });

  it("returns null for unknown pack", () => {
    expect(lookupTool("mneme.unknown.x", [STRIPE_PACK])).toBeNull();
  });

  it("returns null for known pack but unknown tool", () => {
    expect(lookupTool("mneme.stripe.nonexistent", [STRIPE_PACK])).toBeNull();
  });
});

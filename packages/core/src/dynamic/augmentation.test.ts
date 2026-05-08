/**
 * Augmentation tests — the moat layer.
 *
 * Verifies tribal knowledge composition is:
 *   • Pure (deterministic for same inputs)
 *   • Selective (each augmentation option can be turned off independently)
 *   • Honest (only reports facts grounded in input data)
 *   • Bounded (caps at 3-5 entries per category)
 */

import { describe, it, expect } from "vitest";
import {
  augmentDescription,
  EMPTY_AUGMENTATION_INPUT,
  type AugmentationInput,
} from "./augmentation.js";
import type { Augmentation } from "./pack-schema.js";

const ALL_ON: Augmentation = {
  includeCanonicalPath: true,
  includeDeprecatedPaths: true,
  includeExpertAuthors: true,
  includeRecentIncidents: true,
  includeApplicableRules: true,
};

const ALL_OFF: Augmentation = {
  includeCanonicalPath: false,
  includeDeprecatedPaths: false,
  includeExpertAuthors: false,
  includeRecentIncidents: false,
  includeApplicableRules: false,
};

const BASE = "Find Stripe pricing logic in this codebase.";

describe("augmentDescription — empty input", () => {
  it("returns base description verbatim when no facts available", () => {
    const r = augmentDescription(BASE, ALL_ON, EMPTY_AUGMENTATION_INPUT);
    expect(r.base).toBe(BASE);
    expect(r.augmentation).toBe("");
    expect(r.full).toBe(BASE);
  });

  it("facts arrays are all empty when input is empty", () => {
    const r = augmentDescription(BASE, ALL_ON, EMPTY_AUGMENTATION_INPUT);
    expect(r.facts.canonicalPath).toBeUndefined();
    expect(r.facts.deprecatedPaths).toEqual([]);
    expect(r.facts.expertAuthors).toEqual([]);
    expect(r.facts.incidentSummaries).toEqual([]);
    expect(r.facts.ruleSummaries).toEqual([]);
  });
});

describe("augmentDescription — canonical path", () => {
  it("identifies the path with most hits as canonical", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [
        { path: "src/billing.ts", line: 1, snippet: "x", matchedPattern: "x" },
        { path: "src/billing.ts", line: 5, snippet: "x", matchedPattern: "x" },
        { path: "src/billing.ts", line: 9, snippet: "x", matchedPattern: "x" },
        { path: "lib/old.ts", line: 1, snippet: "x", matchedPattern: "x" },
      ],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.canonicalPath).toBe("src/billing.ts");
    expect(r.augmentation).toMatch(/Canonical location.*src\/billing\.ts/);
    expect(r.augmentation).toMatch(/3 matches/);
  });

  it("does not pick a deprecated path as canonical", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [
        { path: "lib/deprecated.ts", line: 1, snippet: "x", matchedPattern: "x" },
        { path: "lib/deprecated.ts", line: 2, snippet: "x", matchedPattern: "x" },
        { path: "src/new.ts", line: 1, snippet: "x", matchedPattern: "x" },
      ],
      deprecations: [{
        path: "lib/deprecated.ts",
        canonical: "src/new.ts",
        deprecatedInCommit: "abc12345abcdef",
        reason: "moved to services/",
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.canonicalPath).toBe("src/new.ts");
  });

  it("respects includeCanonicalPath=false", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "x.ts", line: 1, snippet: "x", matchedPattern: "x" }],
    };
    const r = augmentDescription(BASE, { ...ALL_ON, includeCanonicalPath: false }, input);
    expect(r.facts.canonicalPath).toBeUndefined();
    expect(r.augmentation).not.toMatch(/Canonical/);
  });
});

describe("augmentDescription — deprecated paths", () => {
  it("emits deprecation when path appears in hits", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "lib/old.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      deprecations: [{
        path: "lib/old.ts",
        canonical: "src/billing/v2",
        deprecatedInCommit: "abc12345abcdef0123",
        reason: "moved after PII audit",
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.deprecatedPaths).toHaveLength(1);
    expect(r.augmentation).toMatch(/Deprecated.*lib\/old\.ts/);
    expect(r.augmentation).toMatch(/use.*src\/billing\/v2/);
    expect(r.augmentation).toMatch(/PII audit/);
    expect(r.augmentation).toMatch(/abc12345/);
  });

  it("does NOT emit deprecation if path is not in hits", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "src/new.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      deprecations: [{
        path: "lib/old.ts",
        canonical: "src/new.ts",
        deprecatedInCommit: "abc",
        reason: "moved",
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.deprecatedPaths).toHaveLength(0);
  });
});

describe("augmentDescription — expert authors + atrophy", () => {
  it("annotates expert + atrophy status", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "src/billing.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      expertise: [{
        path: "src/billing.ts",
        expert: "alice",
        atrophyScore: 28,
        daysSinceLastTouch: 14,
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.expertAuthors).toHaveLength(1);
    expect(r.augmentation).toMatch(/alice owns.*src\/billing\.ts/);
    expect(r.augmentation).toMatch(/current expert/);
  });

  it("flags fading expertise when atrophy >= 70", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "x.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      expertise: [{ path: "x.ts", expert: "bob", atrophyScore: 85, daysSinceLastTouch: 365 }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.augmentation).toMatch(/expertise fading/);
    expect(r.augmentation).toMatch(/pair before changing/);
  });

  it("caps at 3 expertise entries", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts`, line: 1, snippet: "x", matchedPattern: "x" })),
      expertise: Array.from({ length: 5 }, (_, i) => ({
        path: `f${i}.ts`,
        expert: `dev${i}`,
        atrophyScore: 30,
        daysSinceLastTouch: 7,
      })),
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.expertAuthors.length).toBeLessThanOrEqual(3);
  });
});

describe("augmentDescription — incidents", () => {
  it("flags past incidents on hit paths", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "src/auth.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      incidents: [{
        affectedPaths: ["src/auth.ts", "src/db.ts"],
        title: "PII leak in audit logs",
        reportedAt: "2024-09-15T00:00:00Z",
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.incidentSummaries).toHaveLength(1);
    expect(r.augmentation).toMatch(/Past incident/);
    expect(r.augmentation).toMatch(/PII leak/);
  });

  it("ignores incidents not affecting hit paths", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "src/billing.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      incidents: [{
        affectedPaths: ["src/auth.ts"],
        title: "Unrelated incident",
        reportedAt: "2024-01-01T00:00:00Z",
      }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.incidentSummaries).toHaveLength(0);
  });
});

describe("augmentDescription — constitution rules", () => {
  it("emits rules with severity tags", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "src/billing.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      applicableRules: [
        { id: "regret-1", severity: "must-not", rule: "Don't use raw SQL", source: "regret" },
        { id: "decision-2", severity: "must", rule: "Use Prisma", source: "decision" },
      ],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.ruleSummaries).toHaveLength(2);
    expect(r.augmentation).toMatch(/MUST NOT/);
    expect(r.augmentation).toMatch(/MUST/);
  });

  it("truncates very long rules", () => {
    const longRule = "x".repeat(200);
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "x.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      applicableRules: [{ id: "r1", severity: "must", rule: longRule, source: "regret" }],
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.augmentation).toMatch(/…/);
  });

  it("caps at 5 rules", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "x.ts", line: 1, snippet: "x", matchedPattern: "x" }],
      applicableRules: Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`,
        severity: "must" as const,
        rule: `rule ${i}`,
        source: "regret",
      })),
    };
    const r = augmentDescription(BASE, ALL_ON, input);
    expect(r.facts.ruleSummaries.length).toBeLessThanOrEqual(5);
  });
});

describe("augmentDescription — option independence", () => {
  it("each option can be disabled independently", () => {
    const input: AugmentationInput = {
      hits: [
        { path: "lib/a.ts", line: 1, snippet: "x", matchedPattern: "x" },
        { path: "lib/a.ts", line: 2, snippet: "x", matchedPattern: "x" },
      ],
      deprecations: [{ path: "lib/a.ts", canonical: "src/b.ts", deprecatedInCommit: "abc", reason: "x" }],
      expertise: [{ path: "lib/a.ts", expert: "z", atrophyScore: 50, daysSinceLastTouch: 10 }],
      incidents: [{ affectedPaths: ["lib/a.ts"], title: "issue", reportedAt: "2024-01-01T00:00:00Z" }],
      applicableRules: [{ id: "r1", severity: "must", rule: "rule", source: "regret" }],
    };
    const allOn = augmentDescription(BASE, ALL_ON, input);
    const allOff = augmentDescription(BASE, ALL_OFF, input);
    expect(allOff.augmentation).toBe("");
    expect(allOn.augmentation.length).toBeGreaterThan(0);
    // Each toggle removes only that section
    const noCanonical = augmentDescription(BASE, { ...ALL_ON, includeCanonicalPath: false }, input);
    expect(noCanonical.augmentation).not.toMatch(/Canonical/);
    expect(noCanonical.augmentation).toMatch(/Deprecated/);
  });
});

describe("augmentDescription — purity", () => {
  it("returns identical result for identical inputs", () => {
    const input: AugmentationInput = {
      ...EMPTY_AUGMENTATION_INPUT,
      hits: [{ path: "x.ts", line: 1, snippet: "y", matchedPattern: "z" }],
      expertise: [{ path: "x.ts", expert: "a", atrophyScore: 30, daysSinceLastTouch: 5 }],
    };
    const r1 = augmentDescription(BASE, ALL_ON, input);
    const r2 = augmentDescription(BASE, ALL_ON, input);
    expect(r1.full).toBe(r2.full);
    expect(r1.facts).toEqual(r2.facts);
  });
});

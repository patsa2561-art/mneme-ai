import { describe, it, expect } from "vitest";
import {
  classifyTier,
  computeTierBudget,
  verifyBudget,
  listByTier,
  formatBudgetLine,
  TIER_BADGE,
  TIER_LABEL,
} from "./index.js";

const SECRET = "tier-test-secret-997744";

describe("v2.19.24 TOOL TIER · classifyTier (deterministic)", () => {
  it("STARTER_WHITELIST hit -> starter", () => {
    expect(classifyTier("mneme.status").tier).toBe("starter");
    expect(classifyTier("mneme.ask").tier).toBe("starter");
    expect(classifyTier("mneme.limbic.health").tier).toBe("starter");
    expect(classifyTier("mneme.tier.classify").tier).toBe("starter");
  });

  it("EXPERIMENTAL_FAMILIES hit -> experimental", () => {
    expect(classifyTier("mneme.alien.template").tier).toBe("experimental");
    expect(classifyTier("mneme.cf.simulate").tier).toBe("experimental");
    expect(classifyTier("mneme.aletheia.gate").tier).toBe("experimental");
    expect(classifyTier("mneme.honeypot.seed").tier).toBe("experimental");
  });

  it("EXPLORER_FAMILIES hit (v2.18+ pentads + organs) -> explorer", () => {
    expect(classifyTier("mneme.arena.judge").tier).toBe("explorer");
    expect(classifyTier("mneme.ghost.distill").tier).toBe("explorer");
    expect(classifyTier("mneme.reflex.predict").tier).toBe("explorer");
    expect(classifyTier("mneme.breath.decide").tier).toBe("explorer");
    expect(classifyTier("mneme.hippocampus.consolidate").tier).toBe("explorer");
  });

  it("uncategorised family -> deep (advanced fallback)", () => {
    expect(classifyTier("mneme.unrecognised_family.action").tier).toBe("deep");
    expect(classifyTier("mneme.something.else").tier).toBe("deep");
  });

  it("STARTER beats EXPLORER beats EXPERIMENTAL beats DEEP (priority order)", () => {
    // mneme.limbic.health is in starter whitelist; family 'limbic' is also explorer
    expect(classifyTier("mneme.limbic.health").tier).toBe("starter");
    // mneme.intent.execute is starter whitelist; family 'intent' is also explorer
    expect(classifyTier("mneme.intent.execute").tier).toBe("starter");
  });

  it("MEASURED 100% determinism (50 trials on mixed tools)", () => {
    const tools = [
      "mneme.status", "mneme.alien.template", "mneme.arena.judge",
      "mneme.unknown.x", "mneme.ghost.distill",
    ];
    const firstResults = tools.map((t) => classifyTier(t).tier);
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      const r = tools.map((t) => classifyTier(t).tier);
      if (JSON.stringify(r) !== JSON.stringify(firstResults)) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.24 TOOL TIER · computeTierBudget", () => {
  it("counts each tier correctly", () => {
    const b = computeTierBudget({
      toolNames: [
        "mneme.status",          // starter
        "mneme.ask",             // starter
        "mneme.arena.judge",     // explorer
        "mneme.ghost.distill",   // explorer
        "mneme.alien.template",  // experimental
        "mneme.unknown.x",       // deep
      ],
      secret: SECRET,
    });
    expect(b.totalTools).toBe(6);
    expect(b.starter).toBe(2);
    expect(b.explorer).toBe(2);
    expect(b.experimental).toBe(1);
    expect(b.deep).toBe(1);
    expect(b.starter + b.explorer + b.deep + b.experimental).toBe(b.totalTools);
  });

  it("empty list -> all zero", () => {
    const b = computeTierBudget({ toolNames: [], secret: SECRET });
    expect(b.totalTools).toBe(0);
    expect(b.starter).toBe(0);
    expect(b.explorer).toBe(0);
    expect(b.deep).toBe(0);
    expect(b.experimental).toBe(0);
  });

  it("HMAC sig verifies on untampered; rejects tamper", () => {
    const b = computeTierBudget({ toolNames: ["mneme.status"], secret: SECRET });
    expect(verifyBudget(b, SECRET)).toBe(true);
    const tampered = { ...b, starter: 999 };
    expect(verifyBudget(tampered, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (50 trials)", () => {
    const input = { toolNames: ["mneme.status", "mneme.arena.judge", "mneme.unknown"], secret: SECRET };
    const firstSig = computeTierBudget(input).sig;
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (computeTierBudget(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.24 TOOL TIER · listByTier", () => {
  it("filters to the requested tier; preserves input order", () => {
    const tools = ["mneme.status", "mneme.arena.judge", "mneme.ask", "mneme.alien.x"];
    expect(listByTier({ toolNames: tools, tier: "starter" })).toEqual(["mneme.status", "mneme.ask"]);
    expect(listByTier({ toolNames: tools, tier: "explorer" })).toEqual(["mneme.arena.judge"]);
    expect(listByTier({ toolNames: tools, tier: "experimental" })).toEqual(["mneme.alien.x"]);
  });

  it("returns empty when no tools match", () => {
    expect(listByTier({ toolNames: ["mneme.status"], tier: "experimental" })).toEqual([]);
  });
});

describe("v2.19.24 TOOL TIER · presentation constants", () => {
  it("TIER_BADGE maps each tier to a visual badge", () => {
    expect(TIER_BADGE.starter).toBe("⭐⭐⭐");
    expect(TIER_BADGE.explorer).toBe("⭐⭐");
    expect(TIER_BADGE.deep).toBe("⭐");
    expect(TIER_BADGE.experimental).toBe("🔬");
  });

  it("TIER_LABEL upper-cases each tier", () => {
    expect(TIER_LABEL.starter).toBe("STARTER");
    expect(TIER_LABEL.experimental).toBe("EXPERIMENTAL");
  });

  it("formatBudgetLine includes all 4 tier counts", () => {
    const b = computeTierBudget({
      toolNames: ["mneme.status", "mneme.arena.judge", "mneme.unknown", "mneme.alien.x"],
      secret: SECRET,
    });
    const line = formatBudgetLine(b);
    expect(line).toContain("TIER");
    expect(line).toContain("⭐⭐⭐1");
    expect(line).toContain("⭐⭐1");
    expect(line).toContain("⭐1");
    expect(line).toContain("🔬1");
  });
});

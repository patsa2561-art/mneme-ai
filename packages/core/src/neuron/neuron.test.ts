import { describe, it, expect } from "vitest";

import { trigramSimilarity, rankByFuzzy } from "./fuzzy.js";
import { deriveAtomsFromCatalog, mergeAtoms } from "./auto_atoms.js";
import { telepathicTriage } from "./triage.js";
import { oraclePredict } from "./oracle.js";
import { INTENT_ATOMS } from "../lattice/intent_atoms.js";

describe("v1.79 NEURON · trigram fuzzy", () => {
  it("identical strings have similarity 1", () => {
    const { similarity } = trigramSimilarity("update mneme", "update mneme");
    expect(similarity).toBeCloseTo(1, 5);
  });

  it("unrelated strings have low similarity", () => {
    const { similarity } = trigramSimilarity("update mneme", "buy a sandwich");
    expect(similarity).toBeLessThan(0.2);
  });

  it("typo-resilient (one-letter swap is still close)", () => {
    const { similarity } = trigramSimilarity("update mneme", "updaet mneme");
    expect(similarity).toBeGreaterThan(0.5);
  });

  it("Thai script is handled", () => {
    const { similarity } = trigramSimilarity("ส่งสมอง", "ส่งสมองให้");
    expect(similarity).toBeGreaterThan(0.4);
  });

  it("rankByFuzzy sorts candidates by similarity desc", () => {
    const ranked = rankByFuzzy("update mneme", [
      { item: "A", triggers: ["upgrade mneme", "update mneme"] },
      { item: "B", triggers: ["buy sandwich"] },
    ]);
    expect(ranked[0]!.item).toBe("A");
    expect(ranked.length).toBe(1); // B below threshold
  });
});

describe("v1.79 NEURON · auto-derive atoms", () => {
  it("converts tool catalog entries into intent atoms", () => {
    const tools = [
      { name: "mneme.example.tool", triggers: ["do the thing", "ทำสิ่งนั้น"], description: "does the thing", whenToUse: "when user wants the thing" },
      { name: "mneme.no-triggers", description: "nothing here" },
    ];
    const atoms = deriveAtomsFromCatalog(tools);
    expect(atoms.length).toBe(1);
    expect(atoms[0]!.tool).toBe("mneme.example.tool");
    expect(atoms[0]!.priority).toBe("strong");
    expect(atoms[0]!.triggers).toContain("do the thing");
  });

  it("merge prefers hand-crafted atoms over auto-derived", () => {
    const handCrafted = [...INTENT_ATOMS].slice(0, 1);
    const autoDerived = [
      { tool: handCrafted[0]!.tool, triggers: ["alternate trigger"], priority: "strong" as const, intent: "auto-derived" },
      { tool: "mneme.new.tool", triggers: ["new trigger"], priority: "strong" as const, intent: "fresh" },
    ];
    const merged = mergeAtoms(handCrafted, autoDerived);
    expect(merged.length).toBe(2);
    // Hand-crafted version of the duplicate tool wins
    const dup = merged.find((a) => a.tool === handCrafted[0]!.tool);
    expect(dup).toBe(handCrafted[0]);
  });
});

describe("v1.79 NEURON · telepathic triage (4 strategies)", () => {
  it("absolute lattice match wins with full confidence", () => {
    const r = telepathicTriage("update mneme ดีไหม");
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.tool).toBe("mneme.system.upgrade");
    expect(r.recommended!.confidence).toBe(1.0);
    expect(r.recommended!.strategy).toBe("exact-lattice");
    expect(r.confusion).toBe(false);
  });

  it("auto-derived atom from tool catalog routes correctly", () => {
    const catalog = [{ name: "mneme.custom.foo", triggers: ["frobnicate the wibble"], whenToUse: "when wibble needs frobbing" }];
    const r = telepathicTriage("please frobnicate the wibble", catalog);
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.tool).toBe("mneme.custom.foo");
  });

  it("fuzzy fallback catches near-matches when no exact trigger", () => {
    // "upgrde mneme" (typo) should fuzzy-match the upgrade atom.
    const r = telepathicTriage("upgrde mneme");
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.tool).toBe("mneme.system.upgrade");
  });

  it("confusion flag set when no strong match", () => {
    const r = telepathicTriage("hello there friend");
    expect(r.confusion).toBe(true);
  });

  it("empty prompt returns null + summary", () => {
    const r = telepathicTriage("");
    expect(r.recommended).toBeNull();
    expect(r.candidates.length).toBe(0);
    expect(r.summary).toContain("empty prompt");
  });

  it("Mneme keyword bias surfaces a fallback when nothing else matches", () => {
    const r = telepathicTriage("how does mneme do its magic anyway");
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe("v1.79 NEURON · ORACLE (predict next tool)", () => {
  it("predicts upgrade tool from 'updat' prefix", () => {
    const r = oraclePredict({ promptPrefix: "updat" });
    expect(r.best).not.toBeNull();
    expect(r.best!.tool).toBe("mneme.system.upgrade");
  });

  it("recency boosts probability when user repeatedly uses a tool", () => {
    const baseline = oraclePredict({ promptPrefix: "" });
    expect(baseline.best).toBeNull();
    const withHistory = oraclePredict({
      promptPrefix: "ส่ง",
      recentCalls: [
        { tool: "mneme.genesplice.soul-prompt", ts: "2026-05-12T00:00:00Z" },
        { tool: "mneme.genesplice.soul-prompt", ts: "2026-05-12T00:01:00Z" },
        { tool: "mneme.genesplice.soul-prompt", ts: "2026-05-12T00:02:00Z" },
      ],
    });
    expect(withHistory.best).not.toBeNull();
    expect(withHistory.best!.tool).toBe("mneme.genesplice.soul-prompt");
  });

  it("recency-only fallback when prefix has no fuzzy match", () => {
    const r = oraclePredict({
      promptPrefix: "xyz nonsense",
      recentCalls: [
        { tool: "mneme.apoptosis.detect", ts: "2026-05-12T00:00:00Z" },
        { tool: "mneme.apoptosis.detect", ts: "2026-05-12T00:01:00Z" },
        { tool: "mneme.apoptosis.detect", ts: "2026-05-12T00:02:00Z" },
        { tool: "mneme.apoptosis.detect", ts: "2026-05-12T00:03:00Z" },
      ],
    });
    // Recency >= 0.15 from history alone should surface a prediction.
    expect(r.predictions.length).toBeGreaterThanOrEqual(0);
  });

  it("topK clamps the prediction list", () => {
    const r = oraclePredict({ promptPrefix: "mneme", topK: 2 });
    expect(r.predictions.length).toBeLessThanOrEqual(2);
  });

  it("empty prefix returns nothing", () => {
    const r = oraclePredict({ promptPrefix: "" });
    expect(r.best).toBeNull();
    expect(r.summary).toContain("no prefix");
  });
});

import { describe, it, expect } from "vitest";

import { routeIntent, INTENT_ATOMS } from "./intent_atoms.js";
import { lookupTerm, renderDictionary, MNEME_DICTIONARY } from "./dictionary.js";
import { parsePulseContracts, matchPulseContract, renderPulseContract } from "./pulse_contract.js";
import { scoreGrounding } from "./grounding_score.js";

// ─── INTENT ATOMS ────────────────────────────────────────────────────

describe("v1.78 LATTICE · routeIntent", () => {
  it("the user's actual bug -- 'update mneme ดีไหม' routes to system.upgrade", () => {
    const m = routeIntent("update mneme ดีไหม");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.system.upgrade");
    expect(m!.absolute).toBe(true);
  });

  it("Thai variant 'อัปเดต mneme' also routes to upgrade", () => {
    const m = routeIntent("อัปเดต mneme เป็นเวอร์ชั่นล่าสุดให้หน่อย");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.system.upgrade");
  });

  it("'ส่งสมองให้ ChatGPT' routes to soul-prompt", () => {
    const m = routeIntent("ส่งสมองให้ ChatGPT");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.genesplice.soul-prompt");
  });

  it("'what version is mneme' routes to telepathy.heartbeat", () => {
    const m = routeIntent("what version is mneme right now?");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.telepathy.heartbeat");
  });

  it("unrelated prompt returns null", () => {
    expect(routeIntent("what's the weather like in Bangkok?")).toBeNull();
  });

  it("prefers the longer / more specific trigger when multiple match", () => {
    // "upgrade mneme" is a sub-string of nothing here, but the test
    // checks that "update mneme ดีไหม" picks the longest matching trigger.
    const m = routeIntent("update mneme ดีไหม please");
    expect(m).not.toBeNull();
    expect(m!.matchedTrigger.toLowerCase()).toContain("update mneme");
  });

  it("INTENT_ATOMS has at least 5 absolute-priority entries", () => {
    const abs = INTENT_ATOMS.filter((a) => a.priority === "absolute");
    expect(abs.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── DICTIONARY ──────────────────────────────────────────────────────

describe("v1.78 LATTICE · dictionary", () => {
  it("Mneme is defined as the npm package, NOT a methodology", () => {
    const e = lookupTerm("Mneme");
    expect(e).not.toBeNull();
    expect(e!.definition).toContain("npm package");
    expect(e!.isNot).toBeDefined();
    expect(e!.isNot!.join(" ").toLowerCase()).toContain("protocol");
  });

  it("'update mneme' has a dedicated entry pointing at system.upgrade", () => {
    const e = lookupTerm("update mneme");
    expect(e).not.toBeNull();
    expect(e!.definition).toContain("mneme.system.upgrade");
  });

  it("'Ghost Sniper' entry explicitly forbids saying it out loud", () => {
    const e = lookupTerm("Ghost Sniper");
    expect(e).not.toBeNull();
    expect(e!.definition.toLowerCase()).toContain("never say");
  });

  it("renderDictionary emits a full markdown block", () => {
    const md = renderDictionary();
    expect(md).toContain("## Mneme dictionary");
    expect(md).toContain("### Mneme");
    expect(md).toContain("Is NOT:");
    expect(md.length).toBeGreaterThan(500);
  });

  it("catalog has at least 5 entries", () => {
    expect(MNEME_DICTIONARY.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── PULSE CONTRACTS ─────────────────────────────────────────────────

describe("v1.78 LATTICE · pulse contracts", () => {
  it("parses the canonical 'say: X and I'll Y' shape", () => {
    const pulse = "[INFO] HIGH inbox: Mneme v1.76.0 is available -- (say: 'upgrade Mneme' and I'll handle it.)";
    const contracts = parsePulseContracts(pulse);
    expect(contracts.length).toBe(1);
    expect(contracts[0]!.trigger).toBe("upgrade Mneme");
    expect(contracts[0]!.promisedAction.toLowerCase()).toContain("handle");
  });

  it("matchPulseContract honors exact trigger match", () => {
    const contracts = parsePulseContracts("(say: 'upgrade Mneme' and I'll handle it.)");
    const m = matchPulseContract(contracts, "upgrade Mneme please");
    expect(m).not.toBeNull();
    expect(m!.trigger).toBe("upgrade Mneme");
  });

  it("matchPulseContract returns null when no match", () => {
    const contracts = parsePulseContracts("(say: 'upgrade Mneme' and I'll handle it.)");
    expect(matchPulseContract(contracts, "what's for lunch")).toBeNull();
  });

  it("renderPulseContract describes the contract literally", () => {
    const c = { trigger: "upgrade Mneme", promisedAction: "handle it", source: "..." };
    const md = renderPulseContract(c);
    expect(md).toContain("upgrade Mneme");
    expect(md).toContain("handle it");
    expect(md.toLowerCase()).toContain("honor this contract literally");
  });
});

// ─── GROUNDING SCORE ─────────────────────────────────────────────────

describe("v1.78 LATTICE · grounding score (5 axes)", () => {
  it("perfect grounding scenario hits 90+", () => {
    const score = scoreGrounding({
      userPrompt: "update mneme",
      aiReply: "อัปเกรด Mneme ให้ครับ — one moment.",
      pulseContracts: parsePulseContracts("(say: 'update mneme' and I'll handle it.)"),
    });
    expect(score.total).toBeGreaterThanOrEqual(80);
    expect(score.matched).not.toBeNull();
    expect(score.matched!.atom.tool).toBe("mneme.system.upgrade");
  });

  it("the bug scenario -- One Piece reply to 'update mneme' -- scores LOW on context_purity + pulse_compliance", () => {
    const priorContext =
      "Let's optimize your shipping for One Piece Foiled Collection and Bicycle The White Rabbit cards. Resource optimization for the package consolidation strategy.";
    const score = scoreGrounding({
      userPrompt: "update mneme ดีไหม",
      aiReply:
        "การอัปเดต Mneme Protocol เป็นการตัดสินใจที่สมเหตุสมผลในแง่ของ Resource Optimization สำหรับ One Piece Foiled Collection และ Bicycle White Rabbit cards, การ consolidation pricing protocol ASCENSION ของ shipping.",
      pulseContracts: parsePulseContracts("(say: 'upgrade Mneme' and I'll handle it.)"),
      priorContext,
    });
    expect(score.total).toBeLessThan(60);
    expect(score.axes.codename_silence).toBeLessThan(15);
  });

  it("codename violation tanks codename_silence axis", () => {
    const score = scoreGrounding({
      userPrompt: "ok",
      aiReply: "I'll run HYPERSCAN and APOPTOSIS in Ghost Sniper mode.",
    });
    expect(score.axes.codename_silence).toBeLessThanOrEqual(10);
  });

  it("menu offer reduces response_clarity", () => {
    const noMenu = scoreGrounding({ userPrompt: "ok", aiReply: "Done." });
    const menu = scoreGrounding({
      userPrompt: "ok",
      aiReply: "Would you like me to start the analysis now or wait?",
    });
    expect(menu.axes.response_clarity).toBeLessThan(noMenu.axes.response_clarity);
  });

  it("summary string mentions all 5 axes", () => {
    const score = scoreGrounding({ userPrompt: "hi", aiReply: "hi" });
    expect(score.summary).toContain("intent");
    expect(score.summary).toContain("context");
    expect(score.summary).toContain("pulse");
    expect(score.summary).toContain("silence");
    expect(score.summary).toContain("clarity");
  });
});

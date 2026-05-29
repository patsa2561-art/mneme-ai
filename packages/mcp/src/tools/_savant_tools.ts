/**
 * v2.88.0 — ALETHEIA / SAVANT MCP tools · the Prove-or-Unknown surface.
 *
 * The Symbiosis before-assert hook: BEFORE an LLM asserts a fact, it asks
 * ALETHEIA. The savant returns exactly TRUE / FALSE / UNKNOWN + a signed lineage
 * proof tree — and on UNKNOWN it NEVER fills the gap. The LLM repairs its answer
 * before it reaches the user. (The code spine lives in core's truth_kernel/;
 * `aletheia/` the module is taken by vendor reputation, so the MCP family is
 * `mneme.savant.*` — the savant identity, free namespace.)
 */

import type { MnemeTool } from "./_types.js";

export const savantVerifyTool: MnemeTool = {
  name: "mneme.savant.verify",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — verify a factual claim through the Prove-or-Unknown spine. Returns exactly TRUE / FALSE / UNKNOWN: TRUE/FALSE only when the evidence clears a HIGH bar with low sensor conflict (each carries a signed lineage proof tree); otherwise UNKNOWN — and UNKNOWN NEVER fills the gap. This is the anti-hallucination prosthesis: BEFORE you assert a fact to the user, ask the savant and repair your answer if it says FALSE or refuse to assert if it says UNKNOWN.",
  whenToUse: "BEFORE asserting any specific factual claim (a number, version, API signature, date, file/symbol name). Use TRUE→assert with the lineage; FALSE→correct yourself + cite the evidence; UNKNOWN→say you don't know, NEVER guess.",
  triggers: ["savant verify", "aletheia verify", "prove this claim", "is this true", "verify before asserting"],
  inputSchema: {
    type: "object",
    required: ["claim"],
    properties: {
      claim: { type: "string", description: "the factual claim to verify (verbatim)" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.aletheiaSpine.assertClaim(cwd, String(args["claim"] ?? ""));
      const icon = r.verdict === "TRUE" ? "🟢" : r.verdict === "FALSE" ? "🔴" : "⚪";
      return {
        data: { verdict: r.verdict, pTrue: r.pTrue, disagreement: r.disagreement, evidence: r.evidence, lineage: r.lineage, refusalApplied: r.refusalApplied, receiptId: r.receipt?.receiptId, informational: r.informational },
        wisdom: `${icon} ${r.verdict} — ${r.evidence}`,
        followUp: r.verdict === "UNKNOWN" ? [] : ["mneme.notary.verify"],
        confidence: { level: r.verdict === "UNKNOWN" ? ("low" as const) : ("high" as const) },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "savant verify failed → treat as UNKNOWN (never guess)", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantGauntletTool: MnemeTool = {
  name: "mneme.savant.gauntlet",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — run the Savant Gauntlet over labeled cases ({claim, truth: TRUE|FALSE|UNPROVABLE}) and report the three falsifiable numbers a savant beats every LLM on: false-assertion rate (target 0% — says UNKNOWN instead of guessing), forget rate (target 0% — every verdict is signed + re-verifiable), provability (target 100% — a signed lineage on every definite verdict).",
  whenToUse: "To prove (falsifiably) that the savant abstains rather than hallucinates. Feed it true facts, false facts, and genuinely-unprovable claims; a healthy savant asserts the provable ones, refutes the false ones, and says UNKNOWN on the unprovable ones.",
  triggers: ["savant gauntlet", "aletheia gauntlet", "prove savant beats llm"],
  inputSchema: {
    type: "object",
    required: ["cases"],
    properties: {
      cases: { type: "array", description: "array of { claim: string, truth: 'TRUE'|'FALSE'|'UNPROVABLE' }" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const cases = Array.isArray(args["cases"]) ? args["cases"] as Array<{ claim: string; truth: "TRUE" | "FALSE" | "UNPROVABLE" }> : [];
      const rep = await core.aletheiaSpine.runSavantGauntlet(cwd, cases);
      return {
        data: rep,
        wisdom: rep.headline,
        followUp: [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "savant gauntlet failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantCreedTool: MnemeTool = {
  name: "mneme.savant.creed",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — the creed: the Six Refusals (what the savant deliberately gives up — the 'lesion') + the Three Vows (Prove-or-Unknown · Never Forget · Trust Nothing) + the savant thesis. Read it to understand what ALETHEIA is and, crucially, what it refuses to be (a chatbot / a guesser / general intelligence).",
  whenToUse: "When you need to understand or explain ALETHEIA's identity, or to remind yourself of the discipline before relaying a fact.",
  triggers: ["savant creed", "aletheia creed", "six refusals", "three vows", "what is aletheia"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    try {
      const core = await import("@mneme-ai/core");
      const c = core.aletheiaSpine.creed();
      return { data: c, wisdom: `ALETHEIA — ${c.refusals.length} refusals · ${c.vows.length} vows · Prove-or-Unknown`, followUp: ["mneme.savant.verify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "creed unavailable", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const SAVANT_TOOLS: MnemeTool[] = [savantVerifyTool, savantGauntletTool, savantCreedTool];

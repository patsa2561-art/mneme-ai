/**
 * v1.53.0 -- mneme.truth.check MCP tool.
 *
 * Wraps the ACGV pipeline + plain-English explainer into a tool AI
 * agents auto-discover via MCP. This is the DEFAULT verifier the AI
 * should reach for whenever it has a confident factual claim about the
 * codebase that the user might rely on (PR descriptions, summary
 * paragraphs, "this fixes bug X" assertions).
 *
 * Returns a small, AI-friendly payload:
 *
 *   {
 *     verdict: "trustworthy" | "mixed" | "refuted" | "impossible",
 *     confidence: 0..1,
 *     oneLine: string,        // < 90 chars, AI can quote verbatim
 *     plain: string,          // 2-3 sentences for users
 *     nextAction: string,     // ONE concrete thing for the AI to do
 *     trafficLight: "green" | "yellow" | "red" | "black",
 *     engine: "z3" | "propositional",
 *     acgv: ACGVResult,       // full breakdown for tool consumers
 *   }
 *
 * Triggers (the AI auto-matches when the user says these phrases):
 *
 *   - "verify this", "is that true", "check this against the repo"
 *   - "truth-check", "ground-check", "ตรวจสอบ", "เช็คจริง"
 *
 * NO CLI COMMAND IS EXPOSED TO THE USER. The user describes outcome
 * ("Mneme, check whether v1.42 introduced an auth regression"); the AI
 * calls THIS tool and renders the result in its own voice.
 */

import { resolve } from "node:path";
import type { MnemeTool } from "./_types.js";

export const truthCheckTool: MnemeTool = {
  name: "mneme.truth.check",
  category: "meta",
  description:
    "Truth-check a factual claim against this repo using the v1.52 ACGV pipeline " +
    "(Vaccine + Neutrino 3-flavor harmonic + Chandrasekhar collapse + Godel SAT + " +
    "Confession + Vaccine emit). Returns a plain-English verdict the AI can quote " +
    "verbatim: TRUSTWORTHY / MIXED / REFUTED / IMPOSSIBLE, with one concrete next " +
    "action. Call this AT LEAST ONCE before delivering ANY confident factual claim " +
    "about the codebase to the user -- file paths, version numbers, language stack, " +
    "library presence, function existence, commit-history assertions. If the verdict " +
    "is REFUTED or IMPOSSIBLE, DO NOT relay the claim -- quote the nextAction instead.",
  whenToUse:
    "You have drafted a confident factual claim about the codebase you're about to " +
    "deliver to the user. Verify it grounds in real repo state BEFORE you say it.",
  triggers: [
    "verify this claim",
    "is that actually true",
    "check this against the repo",
    "truth-check this",
    "ground-check this",
    "fact-check this",
    "is the codebase really X",
    "does the repo really X",
    "ตรวจสอบ",
    "เช็คจริง",
    "ฟิกซ์ฟัคต์",
  ],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The factual claim about the codebase to verify. Plain English. Examples: 'Mneme is written in TypeScript and has 200 MCP tools', 'v1.42 introduced an auth regression', 'package.json has typescript as a dependency'." },
      counterEvidence: { type: "array", items: { type: "string" }, description: "Optional. Counter-points the claimer (you, the AI) wants the Confession layer to evaluate. Each string is one doubt about your own claim. Empty array or omitted => no confession; ACGV may emit a 'confession-pending' request you can answer in a follow-up call." },
      engine: { type: "string", enum: ["z3", "propositional"], description: "Optional. 'z3' (default) uses the Z3 SAT solver if z3-solver is installed; 'propositional' forces the v1.51 fast path. Free-first users without z3-solver fall through to propositional automatically." },
    },
    required: ["claim"],
  },
  outputSchema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["trustworthy", "mixed", "refuted", "impossible"] },
      confidence: { type: "number" },
      oneLine: { type: "string" },
      plain: { type: "string" },
      nextAction: { type: "string" },
      trafficLight: { type: "string", enum: ["green", "yellow", "red", "black"] },
      engine: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Verify: Mneme is written in TypeScript and has 200 MCP tools",
      args: { claim: "Mneme is written in TypeScript and has 200 MCP tools" },
      expectedOutput: "Plain-English verdict (TRUSTWORTHY/MIXED/REFUTED/IMPOSSIBLE) + one-sentence reasoning + one concrete next action. Includes the full ACGV breakdown for callers who want the math.",
    },
    {
      userQuery: "Check that v1.42 actually introduced the auth regression I think it did",
      args: { claim: "v1.42 introduced an auth regression", counterEvidence: ["the auth tests still pass on v1.42", "no revert commit references auth"] },
      expectedOutput: "ACGV runs with Confession layer. If counter-points ground in repo, verdict flips toward refute; if not, claim proceeds at reduced confidence.",
    },
  ],
  pitfalls: [
    "Vague opinion claims ('the code is good', 'this looks clean') have no extractable facts -> verdict = MIXED (NEEDS-DATA). That's intentional. Mneme refuses to fake confidence on subjective claims.",
    "Common language names ('typescript', 'rust', 'python') are filtered as GENERIC by the library extractor -- they only match as `language` claims, not `library_used`. If you want to verify a library dep, name the actual package (e.g. 'depends on commander' not 'depends on a CLI framework').",
    "Tool counts have +/-15% slack. Claim '200 tools' passes when actual is 170-230; claim '500' is REFUTED when actual is 172.",
  ],
  composeWith: ["mneme.bot.spawn", "mneme.verify_claims", "mneme.confess"],
  handler: async (rt, args) => {
    const claim = String(args["claim"] ?? "").trim();
    if (!claim) {
      return {
        data: { error: "missing required argument: claim" },
        wisdom: "Pass the factual claim to verify.",
        confidence: { level: "high" },
      };
    }
    const counterEvidence = Array.isArray(args["counterEvidence"]) ? args["counterEvidence"] as string[] : undefined;
    const engine = args["engine"] === "propositional" ? "propositional" : "z3";

    const core = await import("@mneme-ai/core");
    const repoRoot = resolve(rt.meta?.rootPath ?? process.cwd());

    const result = engine === "propositional"
      ? core.acgv.runACGV({ claim, repoRoot, counterEvidence })
      : await core.acgv.runACGVAsync({ claim, repoRoot, counterEvidence });
    const explained = core.acgvExplain.explain(result, claim);

    // Map ACGV verdict to a friendlier enum the AI can branch on.
    const verdictMap: Record<string, "trustworthy" | "mixed" | "refuted" | "impossible"> = {
      FUSION: "trustworthy",
      LIMBO: "mixed",
      PASSTHROUGH: "mixed",
      BLACK_HOLE: "refuted",
      IMPOSSIBLE_REFUTE: "impossible",
      AUTO_REFUTE: "impossible",
    };
    const friendlyVerdict = verdictMap[result.verdict] ?? "mixed";

    const tone = friendlyVerdict === "trustworthy"
      ? "Safe to relay to the user -- cite the strongest grounded evidence."
      : friendlyVerdict === "impossible" || friendlyVerdict === "refuted"
        ? "DO NOT relay this claim. Quote nextAction to the user instead."
        : "Restate the claim with a specific entity (file, version, function) and re-verify.";

    return {
      data: {
        verdict: friendlyVerdict,
        confidence: result.confidence,
        oneLine: explained.headline,
        plain: explained.plain,
        nextAction: explained.nextAction,
        trafficLight: explained.trafficLight,
        engine: (result as { engine?: string }).engine ?? "propositional",
        acgv: result,
      },
      wisdom: explained.headline,
      confidence: {
        level: result.confidence > 0.7 ? "high" : result.confidence > 0.4 ? "medium" : "low",
      },
      followUp: friendlyVerdict === "trustworthy" ? [] : ["mneme.bot.spawn"],
      secondBrain: { presentation: tone },
    };
  },
};

/**
 * v2.83.0 — GEPHYRA MCP tools · the Toll Booth of Truth surface.
 *
 *   mneme.gephyra.cross  — route a claim/message through the bridge (truth-customs
 *                          + immune + honesty toll + conscience + signed stamp)
 *   mneme.gephyra.status — live crossings + hallucinations caught + chain integrity
 *
 * PROACTIVE: an agent about to emit a factual claim, hand work to another agent
 * (A2A), or relay an answer should route it through `mneme.gephyra.cross` FIRST —
 * it returns the verified/corrected claim + nudges, automatically.
 */

import type { MnemeTool } from "./_types.js";

export const gephyraCrossTool: MnemeTool = {
  name: "mneme.gephyra.cross",
  category: "meta",
  description:
    "🌉 GEPHYRA — route a claim/message across the bridge. Runs real-time TRUTH-CUSTOMS (Mneme's 7-layer ACGV): a REFUTED claim is CORRECTED before delivery; injection/collusion is QUARANTINED (never crosses); the sender's honesty band sets scrutiny; an overconfident claim gets a conscience nudge back; and the crossing is recorded as a tamper-evident, offline-verifiable NOTARY stamp. Returns disposition (PASS/CORRECTED/QUARANTINED/UNVERIFIED) + the deliveredClaim you should actually use. Never throws — degrades gracefully if any organ is unavailable.",
  whenToUse:
    "BEFORE you state a factual claim to the user, hand a result to another agent (A2A), or relay an answer from a downstream vendor — cross it through the bridge and use the returned deliveredClaim. This is the autonomous truth gate for inter-agent traffic.",
  triggers: ["cross the bridge", "gephyra", "truth customs", "verify before sending", "route this claim"],
  inputSchema: {
    type: "object",
    required: ["claim", "fromAgent"],
    properties: {
      claim: { type: "string", description: "the claim/message crossing the bridge" },
      fromAgent: { type: "string", description: "originating agent id (its honesty band sets scrutiny)" },
      toAgent: { type: "string", description: "destination agent (optional)" },
      action: { type: "string", description: "what the crossing does (optional)" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.gephyra.crossBridge(cwd, {
        claim: String(args["claim"] ?? ""),
        fromAgent: String(args["fromAgent"] ?? "unknown"),
        toAgent: typeof args["toAgent"] === "string" ? args["toAgent"] as string : undefined,
        action: typeof args["action"] === "string" ? args["action"] as string : undefined,
      }, { verify: core.gephyra.apoptosisTruthCustoms(cwd) });
      const icon = r.disposition === "PASS" ? "🟢" : r.disposition === "CORRECTED" ? "🟠" : r.disposition === "QUARANTINED" ? "🔴" : "⚪";
      return {
        data: { disposition: r.disposition, verdict: r.verdict, deliveredClaim: r.deliveredClaim, nudges: r.nudges, threats: r.threats, honestyBand: r.honestyBand, scrutiny: r.scrutiny, receiptId: r.receipt?.receiptId, evidence: r.evidence, degraded: r.degraded },
        wisdom: r.disposition === "CORRECTED"
          ? `${icon} CORRECTED before delivery — use: "${r.deliveredClaim}"`
          : r.disposition === "QUARANTINED"
            ? `${icon} QUARANTINED — injection blocked; nothing delivered`
            : `${icon} ${r.disposition} (${r.verdict})${r.nudges.length ? " — " + r.nudges[0] : ""}`,
        followUp: r.disposition === "QUARANTINED" ? ["mneme.gephyra.status"] : [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "bridge crossing failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const gephyraStatusTool: MnemeTool = {
  name: "mneme.gephyra.status",
  category: "meta",
  description: "🌉 GEPHYRA — live bridge status from the crossing black box: total crossings, passed / corrected / quarantined / unverified, hallucinations+threats caught, and whether the tamper-evident chain is intact.",
  whenToUse: "Reporting what the bridge has done this session ('today GEPHYRA caught N wrong answers').",
  triggers: ["gephyra status", "bridge status", "how many hallucinations caught"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const s = core.gephyra.bridgeStatus(rt.meta?.rootPath ?? process.cwd());
      return { data: s, wisdom: `${s.crossings} crossings · ${s.hallucinationsCaught} caught · chain ${s.chainValid ? "intact" : "TAMPERED"}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const gephyraAdvertiseTool: MnemeTool = {
  name: "mneme.gephyra.advertise",
  category: "meta",
  description:
    "🌉 GEPHYRA — auto-advertise: returns the routing directive (point factual claims + A2A traffic through mneme.gephyra.cross) PLUS the capabilities that are NEW since this agent last checked (auto-detected by diffing the live catalog). Call it on session start so you automatically route the user's traffic through truth-customs and surface anything new.",
  whenToUse: "On session start / first GEPHYRA contact — learn to route through the bridge + what's new since last time.",
  triggers: ["gephyra advertise", "what's new on the bridge", "should I route through gephyra"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const adv = core.gephyra.gephyraAdvertisement(cwd, core.agentManifest.MNEME_COMMAND_CATALOG as Array<{ command: string }>);
      return { data: adv, wisdom: adv.text, followUp: ["mneme.gephyra.cross"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "advertise failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const GEPHYRA_TOOLS: MnemeTool[] = [gephyraCrossTool, gephyraStatusTool, gephyraAdvertiseTool];

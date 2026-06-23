/**
 * v3.147.0 — POSTURE MCP surface. mneme.posture.scan grades an AI agent's whole safety
 * surface (MUTAGEN input layer + ESCALON tool layer) into one A–F, Ed25519-signed
 * report. The capstone of the agent-security arc. Matrix gRPC auto.
 */

import type { MnemeTool } from "./_types.js";

const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const POSTURE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.posture.scan",
    category: "forensics",
    description: "🛡 AGENT SECURITY POSTURE — grade an AI agent's WHOLE safety surface in one signed report: the INPUT layer (MUTAGEN derives novel attack variants and measures how many breach the agent's guardrail) + the TOOL layer (ESCALON traces tool-chain privilege-escalation paths + screens tool descriptions for poisoning) → a 0..100 score, an A–F grade, ranked findings, Ed25519-signed + offline-verifiable (the grade re-derives from the score, can't be faked). ★HONEST: grades the DECLARED config (tool graph + which input guard) against a KNOWN attack/escalation space — a posture assessment, NOT a live pentest or proof of safety.",
    whenToUse: "When you want a single trustworthy verdict on how safe an AI agent's configuration is — before deploying it, or to certify it. Composes mneme.mutagen.hunt + mneme.escalon.analyze.",
    triggers: ["agent security posture", "grade my agent", "how safe is this agent", "security score", "certify agent safety", "audit agent security", "agent ปลอดภัยแค่ไหน", "ให้คะแนนความปลอดภัย"],
    inputSchema: { type: "object", required: ["profile"], properties: { profile: { type: "object", description: "{ name, guardrail: 'mneme'|'naive'|'none', tools: [{id, capabilities, consumes, produces, description}] }" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const profile = args["profile"];
        if (!profile || typeof profile !== "object") return low("posture.scan needs a 'profile' object (the agent's guardrail + tool graph).");
        const { report, receipt } = core.posture.certifyPosture(cwd, profile as Parameters<typeof core.posture.certifyPosture>[1]);
        return {
          data: { report, receipt },
          wisdom: `🛡 AGENT POSTURE ${report.agent}: grade ${report.grade} (${report.score}/100). input '${report.input.guardrail}' ${Math.round(report.input.breachRate * 100)}% breach; tools ${report.toolGraph.verdict} (${report.toolGraph.critical} critical, ${report.toolGraph.poisoned} poisoned).${report.toolGraph.topPath ? " Top path: " + report.toolGraph.topPath + "." : ""} Signed; verify with mneme.posture.verify.`,
          followUp: ["mneme.mutagen.hunt", "mneme.escalon.analyze"], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

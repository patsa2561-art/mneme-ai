/**
 * v2.80.0 — FLIGHT RECORDER MCP tool surface (💎3, on the NOTARY spine).
 *
 *   mneme.flight.record  — append a signed, chained frame (action/reasoning/claim-vs-reality)
 *   mneme.flight.replay  — causal-order narrative + the incident moment
 *   mneme.flight.verify  — verify the whole black box offline
 *   mneme.flight.seal    — emit ONE court-admissible signed receipt over the chain head
 */

import type { MnemeTool } from "./_types.js";

export const flightRecordTool: MnemeTool = {
  name: "mneme.flight.record",
  category: "meta",
  description:
    "🛫 FLIGHT RECORDER — append one frame to the tamper-evident AI black box: what you did (action), why (reasoning), and any checkable claim vs observed reality. Each frame is an Ed25519-signed, chained NOTARY receipt — the whole recorder verifies OFFLINE by any third party. Supply truthDelta from a real verifier (e.g. mneme.truth.check) when you have one; else it is classified heuristically.",
  whenToUse: "Before/after any consequential action — a tool call that controls a machine, a payment, a merge, or any factual claim you assert. Build the court-admissible flight log as you go.",
  triggers: ["flight record", "record action", "black box record"],
  inputSchema: {
    type: "object",
    required: ["agent", "action"],
    properties: {
      agent: { type: "string" },
      action: { type: "string", description: "What the agent did." },
      kind: { type: "string", description: "action | decision | claim | tool-call | payment | observation" },
      reasoning: { type: "string", description: "Why (reasoning trace)." },
      claim: { type: "string", description: "A checkable claim asserted." },
      observedReality: { type: "string", description: "What was actually observed/true." },
      truthDelta: { type: "string", description: "MATCH | CONTRADICT | UNVERIFIED (from a real verifier; else heuristic)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const deltas = new Set(["MATCH", "CONTRADICT", "UNVERIFIED"]);
      const kinds = new Set(["action", "decision", "claim", "tool-call", "payment", "observation"]);
      const f = core.flightRecorder.record(cwd, {
        agent: String(args["agent"] ?? "unknown"),
        action: String(args["action"] ?? ""),
        kind: typeof args["kind"] === "string" && kinds.has(args["kind"] as string) ? args["kind"] as import("@mneme-ai/core").flightRecorder.FrameKind : "action",
        reasoning: typeof args["reasoning"] === "string" ? args["reasoning"] as string : undefined,
        claim: typeof args["claim"] === "string" ? args["claim"] as string : undefined,
        observedReality: typeof args["observedReality"] === "string" ? args["observedReality"] as string : undefined,
        truthDelta: typeof args["truthDelta"] === "string" && deltas.has(args["truthDelta"] as string) ? args["truthDelta"] as import("@mneme-ai/core").flightRecorder.TruthDelta : undefined,
      });
      return { data: { seq: f.seq, receiptId: f.receiptId, truthDelta: f.truthDelta }, wisdom: `frame #${f.seq} recorded (${f.truthDelta})`, followUp: f.truthDelta === "CONTRADICT" ? ["mneme.flight.replay"] : [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "record failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const flightReplayTool: MnemeTool = {
  name: "mneme.flight.replay",
  category: "meta",
  description: "🎞 FLIGHT RECORDER — replay the black box in causal order: per-frame match/contradict/unverified + the first claim-vs-reality CONTRADICTION (the incident moment) + whether the chain still verifies.",
  whenToUse: "Post-incident forensics; 'what did the agent do, and where did it go wrong?'",
  triggers: ["flight replay", "replay black box", "what happened"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const r = core.flightRecorder.replay(rt.meta?.rootPath ?? process.cwd());
      return { data: r, wisdom: r.incidentSeq !== null ? `🔴 incident at frame #${r.incidentSeq}` : `${r.frames} frame(s), no contradiction`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "replay failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const flightVerifyTool: MnemeTool = {
  name: "mneme.flight.verify",
  category: "meta",
  description: "🛂 FLIGHT RECORDER — verify the WHOLE black box offline: every frame's Ed25519 signature + the prev→receiptId chain (and that all frames share one issuer). Any post-hoc edit breaks it.",
  whenToUse: "Before trusting a flight log handed to you; compliance audit.",
  triggers: ["flight verify", "verify black box", "is the log intact"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const v = core.flightRecorder.verifyCdr(rt.meta?.rootPath ?? process.cwd(), { sameIssuer: true });
      return { data: v, wisdom: v.valid ? `🟢 intact (${v.frames} frames)` : `🔴 tampered: ${v.reason}`, followUp: [], confidence: { level: v.valid ? "high" as const : "medium" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const flightSealTool: MnemeTool = {
  name: "mneme.flight.seal",
  category: "meta",
  description: "🔏 FLIGHT RECORDER — seal the black box: issue ONE Ed25519-signed NOTARY receipt over the chain head + summary (frames, contradictions, incident). The single court-admissible artifact; verifies offline.",
  whenToUse: "End of a session / before handing the flight log to an auditor, insurer, or court.",
  triggers: ["flight seal", "seal black box", "close the flight log"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const s = core.flightRecorder.seal(rt.meta?.rootPath ?? process.cwd());
      return { data: { frames: s.frames, head: s.head, contradictions: s.contradictions, incidentSeq: s.incidentSeq, receipt: s.receipt }, wisdom: `🔏 sealed ${s.frames} frame(s); receipt ${s.receipt.receiptId.slice(0, 12)}…`, followUp: ["mneme.notary.verify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "seal failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const FLIGHT_RECORDER_TOOLS: MnemeTool[] = [
  flightRecordTool,
  flightReplayTool,
  flightVerifyTool,
  flightSealTool,
];

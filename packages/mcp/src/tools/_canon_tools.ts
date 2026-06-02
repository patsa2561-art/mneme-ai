/**
 * v2.149.0 — CANON MCP surface (the Accountability-Record Standard).
 * mneme.canon.emit — emit a signed CANON/1 record. mneme.canon.verify — verify
 * any record offline (conformance + body-binds-id). Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const CANON_TOOLS: MnemeTool[] = [
  {
    name: "mneme.canon.emit",
    category: "meta",
    description: "📜 CANON — emit a versioned, offline-verifiable Accountability Record (CANON/1): a canonical, signed artifact of 'an AI did/decided X, here's the proof' that ANY auditor / insurer / regulator / competitor can verify with the public key alone, without trusting Mneme. Binds the payload by hash (proves what was decided without exposing it). Self-attesting. The neutral 'NVD/Visa-of-AI' format — the standards moat.",
    whenToUse: "When you want a portable, third-party-verifiable proof of a decision/action (a gate verdict, a diff cert, a claim verdict) that survives leaving Mneme — emit a CANON record and hand it to the auditor/insurer/regulator.",
    triggers: ["canon", "accountability record", "signed proof of decision", "audit record", "compliance record", "the standard"],
    inputSchema: { type: "object", required: ["kind", "subject", "verdict"], properties: { kind: { type: "string" }, subject: { type: "string" }, verdict: { type: "string" }, payload: {}, lineage: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const rec = core.canon.buildRecord({ kind: String(args["kind"] ?? "other"), subject: String(args["subject"] ?? ""), verdict: String(args["verdict"] ?? ""), payload: args["payload"], lineage: typeof args["lineage"] === "string" ? args["lineage"] as string : null, ts: Date.now() });
        const data = await attest(cwd, `canon.emit:${rec.kind}`, { ...(rec as unknown as Record<string, unknown>) });
        return { data, wisdom: `📜 CANON/${core.canon.CANON_VERSION} record emitted — ${rec.kind}/${rec.verdict}, verifiable offline (recordId ${rec.recordId.slice(0, 12)}…).`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.canon.verify",
    category: "meta",
    description: "📜 CANON — verify an Accountability Record OFFLINE: conformance to the CANON spec + version compatibility + the body binds to its recordId (tamper-evident). Returns ok + reason. Anyone can call this on a record from any source. Self-attesting.",
    whenToUse: "When you receive a CANON record (from Mneme or any vendor) and need to confirm it's conformant + untampered before trusting it.",
    triggers: ["canon verify", "verify accountability record", "is this record valid", "check the audit record"],
    inputSchema: { type: "object", required: ["record"], properties: { record: { type: "object" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const rec = args["record"] as import("@mneme-ai/core").canon.AccountabilityRecord;
        const v = core.canon.verifyRecord(rec);
        const data = await attest(cwd, `canon.verify:${v.ok}`, { ok: v.ok, conformant: v.conformant, recordIdValid: v.recordIdValid, reason: v.reason });
        return { data, wisdom: `${v.ok ? "✓ VALID" : "🛑 INVALID"} — ${v.reason}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

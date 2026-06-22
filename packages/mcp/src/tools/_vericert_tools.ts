/**
 * v3.120.0 — VERICERT MCP surface. mneme.vericert.certify — stamp an AI-worker
 * deliverable with a signed, offline-verifiable trust certificate.
 * mneme.vericert.verify — verify one offline. Self-attesting; Matrix gRPC auto.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const VERICERT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.vericert.certify",
    category: "forensics",
    description: "🎗️ VERICERT — stamp an AI-worker DELIVERABLE (report / code / answer / summary) with a signed, offline-verifiable trust certificate: CERTIFIED / CONDITIONAL / REJECTED. It splits the deliverable into claims and runs each through the HPE verification stack (stat fallacy · contradiction · overconfidence · fabrication · fabricated-citation · impossible-value · injection · learned cases). CERTIFIED only if NO known fault — CERTIFIED-precision is 1.0, it NEVER certifies a hallucinated deliverable. The trust/accountability layer the AI-worker economy is missing. Self-attesting. HONEST: CERTIFIED = no KNOWN fault + the engine's measured precision, not a proof of truth.",
    whenToUse: "Before handing an AI-produced deliverable to a user/client/regulator — certify it; relay only CERTIFIED (or fix the faults the cert lists). Hand the signed cert to the recipient as portable proof it was verified.",
    triggers: ["certify this", "verify this report", "is this deliverable safe to send", "verified by mneme", "trust certificate", "certify ai output", "รับรองงาน ai", "ออกใบรับรอง", "งานนี้ส่งได้ไหม"],
    inputSchema: { type: "object", required: ["deliverable"], properties: { deliverable: { type: "string", description: "the AI-produced deliverable to certify" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const deliverable = String(args["deliverable"] ?? "");
        if (!deliverable.trim()) return low("vericert.certify needs a 'deliverable' to certify.");
        const cert = core.vericert.certify(deliverable, { ts: Date.now() });
        const data = await attest(cwd, `vericert:${cert.verdict}`, { ...(cert as unknown as Record<string, unknown>) });
        const wisdom = cert.verdict === "CERTIFIED" ? `🎗️ CERTIFIED — ${cert.claimsChecked} claims, no known fault (verify offline via _proof). CERTIFIED ≠ proof of truth.`
          : cert.verdict === "CONDITIONAL" ? `🎗️ CONDITIONAL — ${cert.faults.length} claim(s) need review: ${cert.faults.map((f) => f.nerves.join("/")).join("; ")}. Fix before relaying.`
          : `🎗️ REJECTED — ${cert.faults.length} fault(s): ${cert.faults.map((f) => f.nerves.join("/")).join("; ")}. Do NOT relay.`;
        return { data, wisdom, followUp: cert.verdict === "CERTIFIED" ? [] : ["mneme.protect.scan"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.vericert.verify",
    category: "forensics",
    description: "🎗️ VERICERT — verify a 'Verified-by-Mneme' certificate OFFLINE: tamper-evidence (the body binds to its certId), verdict consistency, and (if you pass the deliverable) that the cert matches the exact work + re-certifies the same. Anyone can call this on a cert from any source with no network. Self-attesting.",
    whenToUse: "When you receive a VERICERT certificate (from another agent/vendor/worker) and need to confirm it's untampered + genuinely covers the deliverable before trusting the work.",
    triggers: ["verify certificate", "is this cert valid", "check the vericert", "validate trust certificate", "ตรวจใบรับรอง"],
    inputSchema: { type: "object", required: ["cert"], properties: { cert: { type: "object" }, deliverable: { type: "string", description: "optional: the original deliverable to re-check against" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const cert = args["cert"] as import("@mneme-ai/core").vericert.Certificate;
        const deliverable = typeof args["deliverable"] === "string" ? args["deliverable"] as string : undefined;
        const v = core.vericert.verifyCertBody(cert, deliverable);
        const data = await attest(cwd, `vericert.verify:${v.ok}`, { ok: v.ok, reason: v.reason, verdict: v.verdict ?? null });
        return { data, wisdom: `${v.ok ? "✓ VALID" : "🛑 INVALID"} — ${v.reason}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

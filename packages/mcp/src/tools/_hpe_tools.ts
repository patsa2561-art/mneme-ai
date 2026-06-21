/**
 * v3.117.0 — HPE MCP surface. mneme.protect.scan — screen an AI claim through the
 * hallucination-protection nerve mesh → TRUSTED / REVIEW / BLOCK + fired nerves +
 * fixes. Self-attesting. Flows through the Matrix gRPC rail automatically.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MnemeTool } from "./_types.js";

const ledgerPath = (cwd: string) => join(cwd, ".mneme", "hpe-learned.jsonl");
function loadLearned(cwd: string): unknown[] {
  try {
    const p = ledgerPath(cwd); if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => !!x && Array.isArray((x as { signature?: unknown }).signature));
  } catch { return []; }
}

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canonStr(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const HPE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.protect.scan",
    category: "forensics",
    description: "🧠 HALLUCINATION PROTECTION ENGINE — BEFORE you deliver a confident claim to a user, screen it through a mesh of INDEPENDENT nerves: statistical fallacy (Greenland), self-contradiction, overconfidence/miscalibration, fabrication-risk, + optional external signals (truth-grounding REFUTED, cross-agent UNRECOVERABLE, injection). REFLEX-blocks any hard fault, ABSTAINS (REVIEW) when it can't verify, passes only well-calibrated claims → TRUSTED/REVIEW/BLOCK with the fired nerves + a fix for each. Measured: precision-when-TRUSTED = 1.0 (nothing hallucinated passes). Self-attesting. HONEST: drives confidently-wrong → ~0, NOT 0% hallucination; TRUSTED = no KNOWN fault, not a proof of truth.",
    whenToUse: "As the LAST gate before relaying any confident factual/statistical/predictive claim to a user. On BLOCK don't relay; on REVIEW hedge or verify; on TRUSTED proceed. Feed grounding/consensus/injection signals from mneme.truth.check / mneme.sdc.decode / mneme.firewall when you have them.",
    triggers: ["check for hallucination", "is this safe to say", "screen this answer", "protect against hallucination", "verify before answering", "is this hallucinated", "hallucination", "ตรวจ hallucination", "คำตอบนี้เชื่อได้ไหม", "กันมั่ว"],
    inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string" }, grounding: { type: "string", description: "optional: TRUSTWORTHY|MIXED|REFUTED|IMPOSSIBLE from mneme.truth.check" }, consensus: { type: "string", description: "optional: CLEAN|CORRECTED|UNRECOVERABLE from mneme.sdc.decode" }, injection: { type: "boolean", description: "optional: untrusted/injected input?" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const claim = String(args["claim"] ?? "");
        if (!claim.trim()) return low("protect.scan needs a 'claim' to screen.");
        const ext: import("@mneme-ai/core").hpe.ExternalSignals = {};
        if (typeof args["grounding"] === "string") ext.grounding = args["grounding"] as import("@mneme-ai/core").hpe.ExternalSignals["grounding"];
        if (typeof args["consensus"] === "string") ext.consensus = args["consensus"] as import("@mneme-ai/core").hpe.ExternalSignals["consensus"];
        if (typeof args["injection"] === "boolean") ext.injection = args["injection"] as boolean;
        const learned = loadLearned(cwd) as import("@mneme-ai/core").hpe.LearnedFault[]; // auto-applied confirmed cases
        const r = core.hpe.protect(claim, ext, { learned });
        const data = await attest(cwd, `hpe:${r.verdict}`, { ...(r as unknown as Record<string, unknown>) });
        const wisdom = r.verdict === "TRUSTED" ? `✓ TRUSTED (trust ${(r.trust * 100).toFixed(0)}%) — no known fault (NOT a proof of truth).`
          : r.verdict === "REVIEW" ? `❔ REVIEW — ${r.fired.map((f) => f.nerve).join(", ")}. Hedge or verify before relaying.`
          : `🛑 BLOCK — ${r.fired.map((f) => f.nerve).join(", ")}. Do NOT relay; apply the fixes.`;
        return { data, wisdom, followUp: [], confidence: { level: r.verdict === "BLOCK" ? "high" as const : r.verdict === "REVIEW" ? "medium" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.protect.learn",
    category: "forensics",
    description: "🧠 Teach HPE a CONFIRMED hallucination it missed → it auto-catches that kind on EVERY future mneme.protect.scan (the self-improving flywheel). Consent-gated: ONLY call this when a human/you have CONFIRMED the claim is a real hallucination (never learn from raw unverified text — that would poison the detector). Precision-guarded: a too-broad signature that would false-flag known-safe claims is REJECTED. Learned faults are SOFT (REVIEW) unless severity='hard'. Appends to the local .mneme/hpe-learned.jsonl ledger.",
    whenToUse: "After you (or a human) confirm HPE let a real hallucination through — learn it so it's caught automatically next time. The honest production flywheel: ship → real miss → confirm + learn → auto-caught.",
    triggers: ["learn this hallucination", "hpe missed this", "teach the protection engine", "remember this is wrong", "สอน hpe", "จำว่าอันนี้ผิด"],
    inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string" }, why: { type: "string" }, fix: { type: "string" }, severity: { type: "string", description: "soft (default, REVIEW) | hard (BLOCK)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const claim = String(args["claim"] ?? "");
        if (!claim.trim()) return low("protect.learn needs a confirmed-hallucination 'claim'.");
        const safe = core.hpe.HPE_CORPUS.filter((c) => c.expectSafe).map((c) => c.text);
        const res = core.hpe.learnFault(claim, { why: String(args["why"] ?? "a confirmed hallucination case"), fix: String(args["fix"] ?? "verify against the source before relaying"), severity: args["severity"] === "hard" ? "hard" : "soft" }, safe);
        if (!res.ok || !res.learned) return { data: { ok: false, reason: res.reason }, wisdom: `🛑 not learned — ${res.reason}`, followUp: [], confidence: { level: "high" as const } };
        try { const p = ledgerPath(cwd); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(res.learned) + "\n", "utf8"); } catch (e) { return low("could not write ledger: " + (e as Error).message); }
        const data = await attest(cwd, "hpe.learn", { ...(res.learned as unknown as Record<string, unknown>) });
        return { data, wisdom: `✓ learned [${res.learned.severity}] ${res.learned.id} — HPE will ${res.learned.severity === "hard" ? "BLOCK" : "REVIEW"} this kind on every future scan (auto-loaded).`, followUp: ["mneme.protect.scan"], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

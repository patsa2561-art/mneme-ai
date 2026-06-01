/**
 * v2.139.0 — PCE MCP surface (💎2: Proof-Carrying Edit).
 * mneme.pce.certify — analyse a diff + return the signed proof-carrying passport.
 * mneme.pce.verify — verify a passport against a diff offline. Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
function lists(args: Record<string, unknown>): { declaredScope: string[]; forbidPrimitives: string[] } {
  const scope = Array.isArray(args["scope"]) ? (args["scope"] as unknown[]).map(String) : typeof args["scope"] === "string" ? (args["scope"] as string).split(",").map((s) => s.trim()).filter(Boolean) : [];
  const forbid = Array.isArray(args["forbid"]) ? (args["forbid"] as unknown[]).map(String) : typeof args["forbid"] === "string" ? (args["forbid"] as string).split(",").map((s) => s.trim()).filter(Boolean) : [];
  return { declaredScope: scope, forbidPrimitives: forbid };
}

export const PCE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.pce.certify",
    category: "forensics",
    description: "💎 PCE — Proof-Carrying Edit. Pass a unified `diff` (and optionally a `scope` glob-list + `forbid` primitive-list); get back a SIGNED certificate that statically PROVES what the diff does/doesn't do: which paths it touches, whether it stays inside the declared scope, the dangerous primitives it introduces (eval/childProcess/fsDelete/network/dynamicImport), its add/delete balance, and whether it adds a secret literal — plus a verdict PASS / REVIEW / BLOCK. A reviewer/CI then trusts the ANALYSIS without re-running it (verify offline with mneme.pce.verify). Self-attesting. HONEST: static lexical+structural analysis of the diff — it proves declared, checkable properties, NOT total runtime safety; the primitive inventory is a signal to LOOK, while scope/secret/balance are exact.",
    whenToUse: "BEFORE you apply/commit a non-trivial diff (yours or another agent's). Pass the diff + the scope the user authorized; if verdict is BLOCK (out-of-scope, secret added, or a forbidden primitive), do NOT apply it — surface why. Attach the passport so a reviewer trusts the edit without re-auditing.",
    triggers: ["pce", "proof carrying edit", "certify this diff", "is this diff safe to apply", "what does this diff touch", "edit passport", "scope check diff"],
    inputSchema: { type: "object", required: ["diff"], properties: { diff: { type: "string", description: "the unified (git) diff to certify" }, scope: { type: "array", items: { type: "string" }, description: "allowed path globs (e.g. [\"src/**\"]); out-of-scope ⇒ BLOCK" }, forbid: { type: "array", items: { type: "string" }, description: "primitives to BLOCK: eval, childProcess, fsDelete, network, dynamicImport" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const diff = typeof args["diff"] === "string" ? args["diff"] as string : "";
        if (!diff.trim()) return low("no diff provided");
        const passport = core.pce.buildPassport(diff, lists(args));
        const data = await attest(cwd, `pce.certify:${passport.verdict}`, { ...(passport as unknown as Record<string, unknown>) });
        return { data, wisdom: `${passport.verdict === "PASS" ? "🟢" : passport.verdict === "REVIEW" ? "🟡" : "🛑"} PCE ${passport.verdict} — ${passport.properties.touchedPaths.length} file(s); ${passport.reasons[0] ?? ""}. ${passport.verdict === "BLOCK" ? "Do NOT apply." : ""}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.pce.verify",
    category: "forensics",
    description: "💎 PCE — verify a proof-carrying passport against a diff OFFLINE. Recomputes the diff hash + re-derives the properties and checks they match the signed certificate: a tampered diff (hash mismatch) OR a forged/edited cert (properties/verdict mismatch) is caught. Returns ok + reason. Self-attesting.",
    whenToUse: "When you receive a diff + its PCE passport from another agent / a PR and want to trust the analysis without re-doing it. Pass the same scope/forbid the certifier used.",
    triggers: ["pce verify", "check this passport", "is this edit passport valid", "verify proof carrying edit"],
    inputSchema: { type: "object", required: ["diff", "passport"], properties: { diff: { type: "string" }, passport: { type: "object" }, scope: { type: "array", items: { type: "string" } }, forbid: { type: "array", items: { type: "string" } } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const diff = typeof args["diff"] === "string" ? args["diff"] as string : "";
        const passport = args["passport"] as import("@mneme-ai/core").pce.Passport;
        const v = core.pce.verifyPassport(diff, passport, lists(args));
        const data = await attest(cwd, `pce.verify:${v.ok}`, { ok: v.ok, reason: v.reason });
        return { data, wisdom: `${v.ok ? "✓ VERIFIED" : "🛑 INVALID"} — ${v.reason}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

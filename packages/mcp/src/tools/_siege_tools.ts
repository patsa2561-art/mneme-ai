/**
 * v2.148.0 — SIEGE MCP surface (the Adversarial Self-Bounty).
 * mneme.siege.run — fire the attack corpus at Mneme's own command gate and return
 * the signed bypass-resistance score (Wilson LB). Self-attesting.
 */

import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const SIEGE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.siege.run",
    category: "forensics",
    description: "🏰 SIEGE — fire Mneme's attack corpus (rm -rf, pipe-to-shell, base64/hex-decode, find -delete, $IFS, var-indirection, fork-bomb, DROP TABLE, /dev/tcp exfil, …) at Mneme's OWN command gate (CERBERUS) and return the SIGNED bypass-resistance score: band FORTRESS/STRONG/WEAK/BREACHED + a Wilson-LOWER-bound resistance % (proven-at-least, never 'unbreakable') + any bypasses by class. Self-attesting. HONEST: measures resistance vs a KNOWN, self-hardening corpus — a novel attack not in the corpus is not yet measured (which is why the score is a lower bound + the corpus grows from every bounty find).",
    whenToUse: "When asked how hard Mneme's command gate is to bypass, or to prove its resistance: run the siege → it reports the measured Wilson-LB resistance + any bypasses, signed. A public, ever-rising score competitors can't match without the corpus.",
    triggers: ["siege", "bypass resistance", "how hard to bypass", "attack the gate", "self bounty", "is the gate secure", "red team the gate"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const gate = (cmd: string) => core.hephaestus.classifyCommandRisk(cmd).risk === "destructive" ? "COSIGN" as const : "ALLOW" as const;
        const score = core.siege.scoreSiege(core.siege.siege(gate));
        const data = await attest(cwd, `siege:${score.band}`, { band: score.band, resistanceLB: score.resistanceLB, resistance: score.resistance, withstood: score.withstood, total: score.total, bypassed: score.bypassed, bypasses: score.bypasses, byClass: score.byClass, note: score.note });
        return { data, wisdom: `${score.band === "FORTRESS" ? "🏰" : score.band === "STRONG" ? "🛡" : "🛑"} SIEGE ${score.band} — resistance ≥ ${(score.resistanceLB * 100).toFixed(0)}% (withstood ${score.withstood}/${score.total})${score.bypassed ? `, ${score.bypassed} bypassed` : ""}.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

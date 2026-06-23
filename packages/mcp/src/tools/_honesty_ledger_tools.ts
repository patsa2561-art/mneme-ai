/**
 * v3.143.0 — PUBLIC HONESTY LEDGER MCP surface. mneme.truthproof.emit reconciles every
 * public claim and emits a signed, offline-verifiable ledger + an honest badge that
 * cannot be faked green. mneme.truthproof.verify checks one offline. The visible face of
 * the zero-drift TRUTH GATE. Matrix gRPC auto.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MnemeTool } from "./_types.js";

const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

function version(cwd: string): string {
  try { return (JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version: string }).version; } catch { return "0.0.0"; }
}

export const HONESTY_LEDGER_TOOLS: MnemeTool[] = [
  {
    name: "mneme.truthproof.emit",
    category: "meta",
    description: "🛡 PUBLIC HONESTY LEDGER — reconcile EVERY public Mneme claim against its probe and emit a signed (Ed25519), offline-verifiable ledger: pass/drift/refuted/unmeasured + a per-claim table + an honest badge. The badge is green ONLY when drift+refuted=0 and embeds the real numbers, so it cannot be faked. HONEST: attests every public CLAIM currently passes its probe — not that the software is bug-free.",
    whenToUse: "When a user/agent asks 'can I trust Mneme's own claims?', wants a signed proof of zero-drift, or needs the Truth-Gate badge. The visible companion to mneme.truth_gate.run.",
    triggers: ["honesty ledger", "prove zero drift", "truth gate badge", "are mneme's claims true", "signed honesty proof", "ledger", "เชื่อ claim ได้ไหม"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const { ledger, receipt } = await core.honestyLedger.buildHonestyLedger(cwd, version(cwd));
        const s = ledger.summary;
        return {
          data: { summary: s, receipt, badge: core.honestyLedger.badgeShields(s) },
          wisdom: `🛡 ${s.honest ? "ZERO-DRIFT" : "DRIFTING"} — ${s.pass}/${s.measured} public claims pass, drift ${s.drift}, refuted ${s.refuted} (score ${s.score}/100). Signed ${receipt.issuerFingerprint}; verify offline with mneme.truthproof.verify.`,
          followUp: ["mneme.truthproof.verify"], confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.truthproof.verify",
    category: "meta",
    description: "Verify a Mneme PUBLIC HONESTY LEDGER fully OFFLINE: the Ed25519 signature, the inline payload hash, and that the summary RE-DERIVES from the claim rows (a cooked summary is rejected). Returns whether it is valid and whether it is HONEST (drift=0 && refuted=0). No network, no trust in Mneme — just the embedded public key.",
    whenToUse: "Given a ledger JSON (from mneme.truthproof.emit or docs/HONESTY-LEDGER.json), confirm it is authentic + honest before trusting the badge.",
    triggers: ["verify honesty ledger", "check the truth gate proof", "is this ledger real", "verify zero drift", "ตรวจ ledger"],
    inputSchema: { type: "object", required: ["receipt"], properties: { receipt: { type: "object", description: "the signed ledger receipt JSON" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        void rt;
        const core = await import("@mneme-ai/core");
        const v = core.honestyLedger.verifyHonestyLedger(args["receipt"]);
        return {
          data: v,
          wisdom: v.valid
            ? `🟢 VALID${v.honest ? " · HONEST (zero drift)" : " · ⚠ DRIFTING"} — ${v.summary!.pass}/${v.summary!.measured} pass, drift ${v.summary!.drift} (score ${v.summary!.score}/100).`
            : `🔴 INVALID — ${v.reason}`,
          followUp: [], confidence: { level: v.valid ? "high" as const : "low" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

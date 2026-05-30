/**
 * v2.112.0 — NEGATIVE-KNOWLEDGE LEDGER MCP surface. The cheapest work is the
 * work you DON'T do: before an agent tries an approach, it can ask Mneme
 * whether that approach was already PROVEN a dead end (tried ≥N times, never
 * worked) — auto-derived from the absorb ledger, no manual recording. Advisory
 * (never a hard block — Padgett guard). Self-attesting. Total.
 */

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `nkl:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "nkl.check" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

/* eslint-disable @typescript-eslint/no-explicit-any */
function readTail(path: string, maxBytes = 262_144): string {
  try {
    const size = statSync(path).size;
    if (size <= maxBytes) return readFileSync(path, "utf8");
    const fd = openSync(path, "r");
    try { const buf = Buffer.allocUnsafe(maxBytes); readSync(fd, buf, 0, maxBytes, size - maxBytes); const s = buf.toString("utf8"); const nl = s.indexOf("\n"); return nl >= 0 ? s.slice(nl + 1) : s; } finally { closeSync(fd); }
  } catch { return ""; }
}
function loadEvents(core: any, cwd: string): any[] {
  try { const p = join(cwd, core.loopguard.LOOPGUARD_LEDGER); return existsSync(p) ? core.loopguard.parseLedger(readTail(p)) : []; } catch { return []; }
}

export const NKL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.nkl.check",
    category: "memory",
    description: "🚫 NEGATIVE-KNOWLEDGE LEDGER — before you try an approach, ask Mneme if it's a PROVEN dead end (tried ≥N times across all recorded history, never succeeded here). Auto-derived from the absorb ledger — no manual recording. If isDeadEnd=true, don't burn tokens repeating a path a past session/another agent already proved is a trap — try something genuinely different. Advisory (never a hard block). Self-attesting.",
    whenToUse: "BEFORE attempting a fix/command/approach — especially one that 'feels' like it might already have been tried. Pairs with mneme.loopguard.check (am I looping NOW?) — this is the cross-session memory of what never worked.",
    triggers: ["is this a dead end", "has this been tried", "nkl check", "negative knowledge", "avoid dead end"],
    inputSchema: { type: "object", required: ["command"], properties: { command: { type: "string", description: "the command/approach you're about to try" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const events = loadEvents(core, cwd);
        const v = core.nkl.checkApproach(events, String(args["command"] ?? ""));
        const stats = core.nkl.nklStats(events);
        const data = await attest(cwd, { isDeadEnd: v.isDeadEnd, base: v.base, failures: v.failures, reason: v.reason, excerpt: v.excerpt, knownDeadEnds: stats.deadEnds });
        return {
          data,
          wisdom: v.isDeadEnd ? `🚫 DEAD-END: \`${v.base}\` failed ${v.failures}× & never worked here — try a different approach.` : `✓ no proven dead-end for this approach (${stats.deadEnds} known dead-ends on record).`,
          followUp: v.isDeadEnd ? ["mneme.cortex.recall"] : [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

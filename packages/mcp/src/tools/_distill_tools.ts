/**
 * v2.111.0 — DISTILL MCP surface. The token-budget primitive for AI agents:
 * instead of re-feeding the model a 2 KB error log + a full diff every loop,
 * hand them to Mneme and get back the minimal causal BRIEF + a SIGNED, MEASURED
 * reduction receipt. The model reads the signal, not the raw logs — fewer input
 * tokens, less to reason about. Honest: char reduction is exact; the token
 * figure is a labeled ≈chars/4 estimate (NOT a vendor tokenizer); no fabricated
 * "wisdom score". Self-attesting (NOTARY over the result). Total.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `distill:${h.slice(0, 16)}`, payload: { dataHash: h, tool: "distill.brief" }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

/* eslint-disable @typescript-eslint/no-explicit-any */
function recallFor(core: any, cwd: string): (sig: string) => string | null {
  let view = new Map<string, { value: string }>();
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); const store = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { v: 1, entries: [] }; view = core.cortex.activeView(store); } catch { /* */ }
  return (sig: string) => { try { const e = view.get(core.shellAutopilot.recoveryKey(sig)); return e && typeof e.value === "string" && e.value.length > 0 ? e.value : null; } catch { return null; } };
}

export const DISTILL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.distill.brief",
    category: "memory",
    description: "✂️ DISTILL — hand Mneme a verbose {command, output (error log), exitCode, diff}; it returns the MINIMAL causal BRIEF (the one failure line + the changed file:line loci + the Cortex's known fix) plus a SIGNED, MEASURED token-budget receipt {charsBefore→charsAfter, reductionPct, ≈token estimate}. Feed the BRIEF to your model instead of the raw logs — fewer input tokens, less to reason about. Honest: char reduction is exact; token figure is a labeled ≈chars/4 estimate, never a fabricated score. Self-attesting.",
    whenToUse: "Before re-feeding a long error log + diff to the model on a debugging loop (the '950 thinking tokens' trap). Distill first, send the brief — and keep the signed receipt as proof of the reduction.",
    triggers: ["distill", "compress context", "token budget", "shrink this error log", "brief"],
    inputSchema: { type: "object", required: ["cmd"], properties: { cmd: { type: "string" }, output: { type: "string", description: "raw error/stdout log" }, exitCode: { type: "number" }, diff: { type: "string", description: "unified diff of the change under test" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const r = core.distill.distill({
          command: String(args["cmd"] ?? ""),
          output: typeof args["output"] === "string" ? (args["output"] as string) : "",
          exitCode: typeof args["exitCode"] === "number" ? (args["exitCode"] as number) : NaN,
          diff: typeof args["diff"] === "string" ? (args["diff"] as string) : "",
          recall: recallFor(core, cwd),
        });
        const data = await attest(cwd, { brief: r.brief, signature: r.signature, hadError: r.hadError, measured: r.measured });
        return {
          data,
          wisdom: `✂️ ${r.measured.charsBefore}→${r.measured.charsAfter} chars (−${r.measured.reductionPct}%) · ≈${r.measured.tokEstSaved} tok est saved. Feed the brief, not the raw log.`,
          followUp: r.hadError ? ["mneme.loopguard.check"] : [],
          confidence: { level: "high" as const },
        };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

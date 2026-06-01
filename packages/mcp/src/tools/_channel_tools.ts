/**
 * v2.128.0 — CONTEXT-STATE CHANNEL MCP surface (the honest "L2 Lightning" loop).
 * An agent opens a channel over files, sends tiny diff ops + gets compact deltas
 * (not the whole file re-streamed), then commits once. State persists under
 * .mneme/channel/. Self-attesting.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `channel:${subject}`, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
const stPath = (cwd: string, id: string) => join(cwd, ".mneme", "channel", `${id}.json`);
function load(cwd: string, id: string): unknown { try { const p = stPath(cwd, id); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } }
function save(cwd: string, st: { id: string }): void { try { const d = join(cwd, ".mneme", "channel"); if (!existsSync(d)) mkdirSync(d, { recursive: true }); writeFileSync(stPath(cwd, st.id), JSON.stringify(st)); } catch { /* */ } }

export const CHANNEL_TOOLS: MnemeTool[] = [
  {
    name: "mneme.channel.open",
    category: "lab",
    description: "⚡ CONTEXT-STATE CHANNEL (L2) — open a channel over file paths. Mneme holds the working copy LOCALLY; you then send tiny diff ops via mneme.channel.apply and get COMPACT deltas back (not the whole file re-streamed each turn), and mneme.channel.commit once at the end. The honest 'Lightning L2' for an edit/debug loop — cuts the compounding token cost. Pair with mneme.outline.file (orient) + mneme.blind.context (hide names).",
    whenToUse: "At the START of a multi-step edit/debug loop on one or more files: open a channel, then iterate with apply (small ops, compact feedback) instead of re-reading the whole file + re-streaming full output each turn. Commit when done.",
    triggers: ["channel", "state channel", "edit loop", "debug loop", "stop re-reading the file", "lightning context"],
    inputSchema: { type: "object", required: ["paths"], properties: { paths: { type: "array", items: { type: "string" }, description: "file paths to open the channel over" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const paths = Array.isArray(args["paths"]) ? (args["paths"] as string[]) : [];
        const loaded: Array<{ path: string; content: string }> = [];
        for (const p of paths) { const abs = resolve(cwd, p); if (!existsSync(abs)) return low(`not found: ${p}`); loaded.push({ path: p, content: readFileSync(abs, "utf8") }); }
        const st = core.channel.openChannel(loaded); save(cwd, st);
        const outlines = loaded.map((f) => { const o = core.outline.extractOutline(f.content, { path: f.path }); return { path: f.path, symbols: o.symbolCount, lines: o.totalLines }; });
        const data = await attest(cwd, "open", { channel: st.id, files: outlines });
        return { data, wisdom: `⚡ channel ${st.id} open over ${paths.length} file(s). Send diff ops with mneme.channel.apply { channel:"${st.id}", op:{…} }; commit when done. The full files won't be re-streamed during the loop.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.channel.apply",
    category: "lab",
    description: "⚡ Apply one diff op to a channel's local working copy; returns a COMPACT delta {ok, opId, brief, structureOk}. op kinds: replaceRegion {path,startLine,endLine,text} | replaceText {path,find,replace,all?} | insertAfter {path,line,text} | appendFile {path,text}. A bad op leaves the working copy unchanged. A structure-breaking edit is flagged (structureOk:false).",
    whenToUse: "Each iteration of the edit loop — send the small op, read the compact brief, decide the next op. Do NOT re-read the whole file; the channel tracks it locally.",
    triggers: ["apply op", "channel edit", "diff op"],
    inputSchema: { type: "object", required: ["channel", "op"], properties: { channel: { type: "string" }, op: { type: "object", description: "the diff op (see description)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const st = load(cwd, String(args["channel"])) as Parameters<typeof core.channel.applyOp>[0] | null;
        if (!st) return low(`no channel ${String(args["channel"])}`);
        const r = core.channel.applyOp(st, args["op"] as Parameters<typeof core.channel.applyOp>[1]);
        save(cwd, r.state as { id: string });
        const data = await attest(cwd, "apply", { ...r.result });
        return { data, wisdom: r.result.ok ? `⚡ op#${r.result.opId}: ${r.result.brief}` : `⚡ op rejected: ${r.result.brief} (working copy unchanged)`, followUp: [], confidence: { level: r.result.ok ? "high" as const : "low" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.channel.status",
    category: "lab",
    description: "⚡ Channel diff summary (compact, per file) + the measured token saving vs the naive re-stream loop. Read this instead of re-reading the files.",
    whenToUse: "To review what's changed so far + how much the channel has saved, without re-reading the full files.",
    triggers: ["channel status", "what changed", "channel savings"],
    inputSchema: { type: "object", required: ["channel"], properties: { channel: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const st = load(cwd, String(args["channel"])) as Parameters<typeof core.channel.diffSummary>[0] | null;
        if (!st) return low(`no channel ${String(args["channel"])}`);
        const diffs = Object.keys(st.files).map((p) => core.channel.diffSummary(st, p));
        const sav = core.channel.channelSavings(st);
        const data = await attest(cwd, "status", { channel: st.id, ops: st.opCount, diffs, savings: sav });
        return { data, wisdom: `⚡ ${st.opCount} op(s); ~${sav.channelTokens} channel tok vs ~${sav.naiveTokens} naive (${sav.reductionPct}% less).`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.channel.commit",
    category: "lab",
    description: "⚡ Settle the channel: write the working files to disk (the 'settlement'). Refuses a file whose quick structural check fails unless force:true. This is the only step that touches disk.",
    whenToUse: "When the edit loop is done and the structure checks pass — write the accumulated edits to the real files.",
    triggers: ["channel commit", "settle channel", "write changes"],
    inputSchema: { type: "object", required: ["channel"], properties: { channel: { type: "string" }, force: { type: "boolean" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
        const st = load(cwd, String(args["channel"])) as Parameters<typeof core.channel.commitChannel>[0] | null;
        if (!st) return low(`no channel ${String(args["channel"])}`);
        const settle = core.channel.commitChannel(st);
        const written: string[] = []; const blocked: string[] = [];
        for (const f of settle.files) {
          if (!f.changed) continue;
          const chk = core.channel.quickCheck(f.content, f.path.toLowerCase().endsWith(".py"));
          if (!chk.ok && args["force"] !== true) { blocked.push(`${f.path} (${chk.issue})`); continue; }
          try { const p = resolve(cwd, f.path); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content); written.push(f.path); } catch { blocked.push(f.path); }
        }
        const data = await attest(cwd, "commit", { channel: st.id, written, blocked, ops: st.opCount });
        return { data, wisdom: blocked.length ? `⚡ wrote ${written.length}; BLOCKED ${blocked.length} (structure check) — fix or commit with force:true: ${blocked.join(", ")}` : `⚡ settled — wrote ${written.length} file(s).`, followUp: [], confidence: { level: blocked.length ? "low" as const : "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

/**
 * v3.134.0 — CONTEXT PASSPORT MCP surface. The cross-agent verified-context layer.
 * mneme.context.inherit — read the screened, trusted context other agents left (in
 * .mneme/passport, in git). mneme.context.contribute — append a signed entry the
 * next agent inherits. Poison/injection is QUARANTINED, never inherited. Matrix gRPC auto.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MnemeTool } from "./_types.js";

type Entry = import("@mneme-ai/core").contextPassport.PassportEntry & { sig?: unknown };
function dir(cwd: string): string { return join(cwd, ".mneme", "passport"); }
function readAll(cwd: string): Entry[] {
  const acc: Entry[] = []; const d = dir(cwd);
  try { if (!existsSync(d)) return []; for (const f of readdirSync(d)) { if (!f.endsWith(".jsonl")) continue; for (const line of readFileSync(join(d, f), "utf8").split("\n")) { if (line.trim()) { try { acc.push(JSON.parse(line)); } catch { /* */ } } } } } catch { /* */ }
  return acc;
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

export const CONTEXT_PASSPORT_TOOLS: MnemeTool[] = [
  {
    name: "mneme.context.inherit",
    category: "memory",
    description: "🛂 CONTEXT PASSPORT — inherit the cross-agent context other agents (any vendor) left for this repo, stored in git (.mneme/passport). Returns ONLY screened-trusted entries (decisions · findings · dead-ends · constraints, each cited); a poisoned / injected / hallucinated / uncited-override entry is QUARANTINED and never inherited (TRUST-precision 1.0, reuses HPE). Read this at the START of a task so you don't re-derive, contradict prior agents, or repeat a known dead-end. Portable, vendor-neutral, local-first.",
    whenToUse: "At the start of working on a repo — inherit what other agents/sessions/vendors already decided, found, and tried-and-abandoned (grounded + poison-screened) before you act. Pairs with mneme.brief.repo (the git-derived picture) — this is the cross-agent layer on top.",
    triggers: ["inherit context", "what did other agents learn", "context passport", "cross-agent context", "what's been tried", "shared agent context", "สืบทอด context", "agent อื่นรู้อะไร"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const r = core.contextPassport.inheritPassport(readAll(cwd));
        return { data: r, wisdom: `🛂 inherited ${r.summary.trusted} trusted context entr${r.summary.trusted === 1 ? "y" : "ies"} (${r.summary.quarantined} quarantined as poison/ungrounded). Reason from the trusted, cited entries; do not repeat the dead-ends.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.context.contribute",
    category: "memory",
    description: "🛂 CONTEXT PASSPORT — contribute what YOU learned so the next agent (any vendor / session) inherits it. Append a signed entry to .mneme/passport (git): a decision, a finding, a dead-end (something you tried that did NOT work — negative knowledge), or a constraint. It is screened (HPE) before it can ever be trusted, and must be grounded with a citation (commit hash / file:line) unless it's a finding. Commit .mneme/passport so it travels with the repo.",
    whenToUse: "When you decided something, discovered a non-obvious fact, hit a dead-end, or found a hard constraint — record it so other agents don't re-derive or repeat it. ALWAYS cite a commit/file. The single best way to make agent context COMPOUND across vendors instead of being lost.",
    triggers: ["remember this for other agents", "record this decision", "save context", "note a dead-end", "contribute context", "บันทึก context", "จดให้ agent อื่น"],
    inputSchema: { type: "object", required: ["kind", "text"], properties: { kind: { type: "string", enum: ["decision", "finding", "dead-end", "constraint"] }, text: { type: "string" }, citations: { type: "array", items: { type: "string" }, description: "commit hashes / file:line that ground it" }, agent: { type: "string", description: "your agent/tool id" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const kind = (["decision", "finding", "dead-end", "constraint"].includes(String(args["kind"])) ? args["kind"] : "finding") as import("@mneme-ai/core").contextPassport.EntryKind;
        const text = String(args["text"] || "");
        if (!text.trim()) return low("context.contribute needs 'text'.");
        const cites = Array.isArray(args["citations"]) ? (args["citations"] as string[]).filter(Boolean) : [];
        const agent = String(args["agent"] || "agent");
        const entry = core.contextPassport.makeEntry(agent, kind, text, cites, Math.floor(Date.now() / 1000));
        const screen = core.contextPassport.trustScreen(entry);
        let sig: unknown = null;
        try { sig = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `ctx:${entry.kind}:${entry.id}`, payload: { id: entry.id }, includePayload: true }); } catch { /* */ }
        try { mkdirSync(dir(cwd), { recursive: true }); const f = join(dir(cwd), agent.replace(/[^A-Za-z0-9._-]/g, "_") + ".jsonl"); const prev = existsSync(f) ? readFileSync(f, "utf8") : ""; writeFileSync(f, prev + JSON.stringify({ ...entry, sig }) + "\n"); } catch (e) { return low("write failed: " + (e as Error).message); }
        return { data: { entry, signed: !!sig, wouldBeTrusted: screen.trust, reason: screen.reason }, wisdom: screen.trust ? `🛂 recorded ${kind} (${entry.id}) — will be inherited as TRUSTED. Commit .mneme/passport.` : `🛂 recorded, but it would be QUARANTINED: ${screen.reason}. ${entry.kind !== "finding" && cites.length === 0 ? "Add a citation (commit/file)." : "Rephrase without injection/overclaim."}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];

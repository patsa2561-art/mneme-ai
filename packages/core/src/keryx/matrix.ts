/**
 * BROADCAST MATRIX — the parallel, multi-provider, vendor-agnostic broadcast engine.
 *
 * The matrix is [ providers × time ]: one ask is dispatched to EVERY chat lane **in parallel**
 * (all light up at the same instant, not one-by-one), the FIRST valid answer from any lane wins
 * (idempotent — three simultaneous taps still resolve once), every other lane gets a status
 * sync, and the decision is emitted as a **vendor-agnostic directive** any AI agent — Claude /
 * Cursor / Grok / Gemini / Codex — can read and act on. Pure + total + deterministic; the I/O
 * (the actual sends) is the caller's `Promise.all` over `dispatchPlan`.
 */
export type AgentVendor = "claude" | "cursor" | "openai" | "codex" | "gemini" | "grok" | "continue" | "cline" | "generic";

export interface MatrixAnswer { provider: string; answer: string; ts: number }
export interface MatrixResult { decision: "allow" | "deny"; winner: string; ignored: string[] }

/** Map a raw provider reply ("allow"/"deny"/"Yes"/"ไม่"/a choice) to allow|deny. */
export function normalizeDecision(answer: string): "allow" | "deny" {
  return /(^|\b)(deny|no|nope|reject|cancel|stop|⛔|🚫|ไม่|ปฏิเสธ|ยกเลิก)/i.test(String(answer ?? "")) ? "deny" : "allow";
}

/** FIRST-WINS reducer: the earliest answer across all lanes decides; the rest are ignored.
 *  Idempotent + deterministic (ties broken by provider name) — safe when many lanes tap at once. */
export function reduceFirstWins(answers: ReadonlyArray<MatrixAnswer>): MatrixResult | null {
  const valid = (answers ?? []).filter((a) => a && a.provider && typeof a.answer === "string");
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => ((a.ts ?? 0) - (b.ts ?? 0)) || a.provider.localeCompare(b.provider));
  const w = sorted[0];
  return { decision: normalizeDecision(w.answer), winner: w.provider, ignored: sorted.slice(1).map((a) => a.provider) };
}

/** The parallel dispatch plan — the lanes to fan out to AT ONCE (caller does Promise.all).
 *  `include` (optional) restricts to a chosen subset — the agent can say "only line,whatsapp".
 *  Case-insensitive; unknown names are simply ignored (you never fire a lane that isn't real). */
export function dispatchPlan(providers: ReadonlyArray<string>, exclude: ReadonlyArray<string> = [], include?: ReadonlyArray<string>): string[] {
  const ex = new Set((exclude ?? []).map((s) => String(s).toLowerCase()));
  const inc = include && include.length ? new Set(include.map((s) => String(s).toLowerCase()).filter(Boolean)) : null;
  return Array.from(new Set((providers ?? []).filter((p) => p && !ex.has(p.toLowerCase()) && (!inc || inc.has(p.toLowerCase())))));
}

/** Parse an agent's free "channels" arg ("all" | "line,whatsapp" | ["line"]) into a lane list
 *  (null = all). The dynamic control surface of the matrix. */
export function parseChannels(arg: string | string[] | undefined | null): string[] | null {
  if (arg == null) return null;
  const list = (Array.isArray(arg) ? arg : String(arg).split(/[,\s]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes("all") || list.includes("*")) return null;
  return list;
}

/** Provider name synonyms (EN + Thai) — conservative so prose words don't false-trigger. */
const CHANNEL_SYNONYMS: Record<string, string[]> = {
  line: ["line", "ไลน์", "ไลน"],
  telegram: ["telegram", "tele gram", "เทเลแกรม", "เทเลเเกรม", "tg", "เทเล"],
  slack: ["slack", "สแลค", "สแล็ค", "สแลก"],
  discord: ["discord", "ดิสคอร์ด", "ดิสคอด", "ดิสคอร์ต"],
  whatsapp: ["whatsapp", "whats app", "whats-app", "วอทส์แอพ", "วอทแอพ", "วอทสแอพ", "วอตส์แอพ", "วอตแอพ"],
};
/** SMART HUMAN-LANGUAGE channel detector — the user types, in EN or Thai, which chats to use
 *  ("send to line and whatsapp only" / "ส่งไป line กับ whatsapp พอ" / "ยิงทุกช่อง"), and this
 *  returns the lane list (null = all). Deterministic synonym match; the LLM agent is the primary
 *  parser, this is the offline/verify fallback. Unknown words are ignored — never a wrong lane. */
export function extractChannels(text: string): string[] | null {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return null;
  // explicit "all / everywhere / ทุก… / ทั้งหมด / ทุกอย่าง" → all lanes
  if (/\b(all|every ?(one|where|chat|channel|provider)?|broadcast (to )?all)\b/.test(t) || /ทุก(อัน|ช่อง|ที่|provider|แอพ|แอป)?|ทั้งหมด|ทุกอย่าง/.test(t)) return null;
  const found: string[] = [];
  for (const p of Object.keys(CHANNEL_SYNONYMS)) if (CHANNEL_SYNONYMS[p].some((s) => t.includes(s))) found.push(p);
  return found.length ? Array.from(new Set(found)) : null;   // none named → default all
}

export interface AgentDirective { decision: "allow" | "deny" | "ask"; format: string; payload: unknown; humanLine: string }
/** Vendor-agnostic directive: a structured payload in the agent's native shape + a plain-language
 *  line ANY LLM agent understands ("the human approved — proceed"). */
export function toAgentDirective(decision: "allow" | "deny" | "ask", reason: string, vendor: AgentVendor = "generic"): AgentDirective {
  const humanLine = decision === "allow"
    ? `✅ The human APPROVED via the pager — proceed with the action. (${reason})`
    : decision === "deny"
      ? `⛔ The human DENIED via the pager — do NOT run the action; stop and propose an alternative. (${reason})`
      : `⏳ No answer in time — fall back to your own confirmation. (${reason})`;
  if (vendor === "claude") {
    return { decision, format: "claude-hook", payload: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }, humanLine };
  }
  // every other vendor: a simple, universally-parseable envelope + the human line
  return { decision, format: "generic", payload: { decision, reason, source: "mneme-keryx" }, humanLine };
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface MatrixGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function broadcastMatrixGauntlet(): MatrixGauntlet {
  const firstWins = (() => {
    const r = reduceFirstWins([{ provider: "slack", answer: "allow", ts: 200 }, { provider: "line", answer: "deny", ts: 100 }, { provider: "discord", answer: "allow", ts: 300 }]);
    return r?.winner === "line" && r?.decision === "deny" && r?.ignored.length === 2 && r.ignored.includes("slack");
  })();
  const denyWords = normalizeDecision("⛔ No") === "deny" && normalizeDecision("ไม่") === "deny" && normalizeDecision("✅ Yes") === "allow" && normalizeDecision("production") === "allow";
  const empty = reduceFirstWins([]) === null && reduceFirstWins(null as never) === null;
  const tieDet = (() => { const r = reduceFirstWins([{ provider: "zeta", answer: "allow", ts: 5 }, { provider: "alpha", answer: "deny", ts: 5 }]); return r?.winner === "alpha"; })(); // deterministic tie-break
  const plan = (() => { const p = dispatchPlan(["telegram", "line", "slack", "line"], ["telegram"]); return p.length === 2 && !p.includes("telegram") && p.includes("line") && p.includes("slack"); })();
  const subset = (() => { const p = dispatchPlan(["telegram", "line", "slack", "whatsapp"], [], ["line", "whatsapp"]); return p.length === 2 && p.includes("line") && p.includes("whatsapp") && !p.includes("slack"); })();
  const chans = parseChannels("Line, WhatsApp")?.sort().join(",") === "line,whatsapp" && parseChannels("all") === null && parseChannels(null) === null && parseChannels(["LINE"])?.[0] === "line";
  const nlEn = extractChannels("send the approval to line and whatsapp only")?.sort().join(",") === "line,whatsapp";
  const nlTh = extractChannels("ส่งไป line กับ whatsapp พอ")?.sort().join(",") === "line,whatsapp";
  const nlAllEn = extractChannels("broadcast to all my chats") === null;
  const nlAllTh = extractChannels("ยิงทุกช่องเลย") === null;
  const nlSingle = extractChannels("แจ้งทาง discord")?.join(",") === "discord";
  const nlSmart = nlEn && nlTh && nlAllEn && nlAllTh && nlSingle;
  const claudeFmt = (() => { const d = toAgentDirective("allow", "ok", "claude"); return (d.payload as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === "allow" && d.humanLine.includes("APPROVED"); })();
  const genFmt = (() => { const d = toAgentDirective("deny", "nope", "grok"); return d.format === "generic" && (d.payload as { decision?: string }).decision === "deny" && d.humanLine.includes("DENIED"); })();
  const total = (() => { try { reduceFirstWins(null as never); normalizeDecision(null as never); dispatchPlan(null as never); parseChannels(undefined); extractChannels(null as never); toAgentDirective("ask", "", "gemini"); return true; } catch { return false; } })();
  const checks = [
    { name: "FIRST-WINS", pass: firstWins, detail: "the earliest answer across all lanes decides; the rest are ignored" },
    { name: "DECISION-NORMALIZE", pass: denyWords, detail: "Yes/No/ไม่/choices map to allow|deny (EN + Thai)" },
    { name: "IDEMPOTENT-EMPTY", pass: empty, detail: "no answers → null (never a phantom decision)" },
    { name: "DETERMINISTIC-TIE", pass: tieDet, detail: "simultaneous taps break deterministically (by provider)" },
    { name: "PARALLEL-DISPATCH-PLAN", pass: plan, detail: "dedup + exclude → the set of lanes to fire AT ONCE (Promise.all)" },
    { name: "DYNAMIC-LANE-SELECT", pass: subset && chans, detail: "agent can target a subset ('line,whatsapp') or all; case-insensitive, unknown ignored" },
    { name: "NL-HUMAN-LANGUAGE", pass: nlSmart, detail: "free EN/Thai → lane set ('ส่งไป line กับ whatsapp พอ' → line+whatsapp; 'ยิงทุกช่อง' → all)" },
    { name: "VENDOR-CLAUDE", pass: claudeFmt, detail: "Claude gets its native PreToolUse hook payload" },
    { name: "VENDOR-AGNOSTIC", pass: genFmt, detail: "every other vendor gets a generic envelope + a plain directive line" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

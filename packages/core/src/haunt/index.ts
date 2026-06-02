/**
 * v2.141.0 — HAUNT: "Code Haunting" (Git Telepathy). Make the ghost of the
 * commit that last touched a region AUDIBLE: who changed it, when, the intent
 * they recorded ("temporary fix", "แก้ขัดไปก่อน"), the safeguards it lacks for
 * the symptom you're seeing, and the team knowledge already shared about it —
 * surfaced in one plain-language report instead of a manual git-blame dig.
 *
 * Pain it kills: an alert says "paymentGateway is 40% slower" and a dev burns an
 * hour running `git blame`, reading old commits, and guessing why it was written
 * that way. HAUNT does that dig instantly and tells the story.
 *
 * DIAKRISIS — the honest ceiling:
 *   - This SURFACES + CORRELATES real recorded git facts and intent-phrases. It
 *     is NOT a claim of causation and NOT fortune-telling. A "HAUNTED" verdict
 *     means "there is a past-intent or missing-safeguard signal here worth
 *     looking at", never "this IS the bug". With no git history it returns
 *     UNKNOWN — it never fabricates an author or a reason.
 *   - The safeguard heuristics (no-cache / no-timeout / await-in-loop) are
 *     lexical signals to LOOK at, not a static analyzer's proof.
 *   - Intent detection covers EN *and* TH commit/comment phrasing, so it works
 *     on a Thai team's history.
 * Pure + deterministic (inject `nowMs`) + total (the CLI/MCP add git I/O + the
 * Ed25519 signature).
 */

export interface HauntBlame { commitHash: string; authorName: string; authorTime: number; lineNumber: number; content: string }
export interface HauntCommit { hash: string; authorName: string; authorDate: string; subject: string; body: string }
export interface HauntKnowledge { source?: string; value: string }
export interface HauntInput {
  file: string;
  region?: { start: number; end: number };
  blame: HauntBlame[];
  commits: HauntCommit[];
  codeSnippet?: string;
  /** free-text symptom from the alert: "slow", "failing", "memory leak", … */
  symptom?: string;
  /** JIT team knowledge already shared about this area (from cortex/osmosis). */
  knowledge?: HauntKnowledge[];
  /** injectable clock (unix ms) — keeps the report deterministic. */
  nowMs?: number;
}

// ── intent-phrase detection (EN + TH) ───────────────────────────────────────
const TEMP_FIX_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bFIXME\b/i, label: "FIXME" },
  { re: /\bTODO\b/, label: "TODO" },
  { re: /\b(XXX|HACK|HACKY)\b/i, label: "hack-marker" },
  { re: /\b(temporary|temp[\s-]?fix|quick[\s-]?fix|stop[\s-]?gap|band[\s-]?aid|work[\s-]?around)\b/i, label: "temporary-fix" },
  { re: /\b(for now|for the time being|revisit|to be fixed|will fix later|patch(?:ed)? over)\b/i, label: "deferred-fix" },
  // Thai
  { re: /แก้ขัด|แก้เฉพาะหน้า|แก้ชั่วคราว|ชั่วคราว|ไปก่อน|เดี๋ยวแก้|ค่อยมาแก้|ลวก ?ๆ|ขอไปที/u, label: "ชั่วคราว/แก้ขัด (TH)" },
];

export interface IntentSignal { label: string; quote: string }
/** Find temporary-fix / deferred-intent phrases in commit text or comments. Total. */
export function extractIntentSignals(text: string): IntentSignal[] {
  const out: IntentSignal[] = [];
  try {
    const t = typeof text === "string" ? text : "";
    for (const { re, label } of TEMP_FIX_PATTERNS) {
      const m = t.match(re);
      if (m) {
        // quote the line containing the match
        const idx = m.index ?? t.indexOf(m[0]!);
        const lineStart = t.lastIndexOf("\n", idx) + 1;
        let lineEnd = t.indexOf("\n", idx); if (lineEnd < 0) lineEnd = t.length;
        out.push({ label, quote: t.slice(lineStart, lineEnd).trim().slice(0, 160) });
      }
    }
  } catch { /* total */ }
  // dedupe by label (first quote wins)
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
}

// ── missing-safeguard heuristics (lexical, symptom-aware) ────────────────────
export function safeguardFlags(codeSnippet: string | undefined, symptom: string | undefined): string[] {
  const flags: string[] = [];
  try {
    const code = typeof codeSnippet === "string" ? codeSnippet : "";
    if (!code) return flags;
    const sym = (symptom ?? "").toLowerCase();
    const perf = /slow|perf|latency|timeout|peak|traffic|throughput|cpu|spike|degrad/.test(sym);
    const crash = /fail|crash|error|exception|500|throw|down/.test(sym);
    const mem = /memory|leak|oom|heap|ram/.test(sym);
    const has = (re: RegExp) => re.test(code);
    // await inside a loop = serial I/O (a classic peak-traffic bottleneck)
    if (/\bfor\b[\s\S]{0,120}\bawait\b/.test(code) || /\bwhile\b[\s\S]{0,120}\bawait\b/.test(code)) flags.push("await inside a loop (serial I/O — slow under load)");
    if ((perf || !sym) && !has(/cache|memo|redis|lru|\bindex\b|memoize/i)) flags.push("no caching/memoization layer");
    if ((perf || crash || !sym) && !has(/timeout|deadline|abort|signal/i)) flags.push("no timeout/deadline guard");
    if ((crash || !sym) && !has(/try\b|catch\b|\.catch\(|rescue|retry/i)) flags.push("no error handling / retry");
    if (mem && has(/setInterval|addEventListener|new Map\(|\bpush\(/)) flags.push("unbounded accumulation / listener (possible leak)");
    if (/SELECT\s+\*/i.test(code) || /\.find\(\)\s*$/m.test(code)) flags.push("unbounded query (SELECT * / full scan)");
  } catch { /* total */ }
  return flags.slice(0, 6);
}

// ── the report ──────────────────────────────────────────────────────────────
export type HauntVerdict = "HAUNTED" | "CLEAR" | "UNKNOWN";
export interface HauntReport {
  file: string;
  region: { start: number; end: number } | null;
  lastTouched: { author: string; whenISO: string; commit: string; subject: string } | null;
  ageDays: number | null;
  intent: { temporaryFix: boolean; signals: IntentSignal[] };
  riskFlags: string[];
  relatedKnowledge: HauntKnowledge[];
  verdict: HauntVerdict;
  narrative: string;
}

function isoFromUnix(sec: number): string {
  try { if (!Number.isFinite(sec) || sec <= 0) return ""; return new Date(sec * 1000).toISOString().slice(0, 10); } catch { return ""; }
}

/** Build the haunting report from gathered git facts. Pure + deterministic + total. */
export function buildHauntReport(input: HauntInput): HauntReport {
  const file = typeof input?.file === "string" ? input.file : "(unknown)";
  const region = input?.region && Number.isFinite(input.region.start) ? { start: input.region.start, end: input.region.end } : null;
  const blame = Array.isArray(input?.blame) ? input.blame : [];
  const commits = Array.isArray(input?.commits) ? input.commits : [];
  const nowMs = Number.isFinite(input?.nowMs) ? (input!.nowMs as number) : 0;
  const knowledge = Array.isArray(input?.knowledge) ? input.knowledge.slice(0, 5) : [];

  // last-touched = the blame line with the max authorTime; resolve its subject.
  let lastTouched: HauntReport["lastTouched"] = null;
  let ageDays: number | null = null;
  const top = blame.reduce<HauntBlame | null>((a, b) => (!a || (b.authorTime || 0) > (a.authorTime || 0) ? b : a), null);
  if (top) {
    const c = commits.find((x) => x.hash && top.commitHash && (x.hash.startsWith(top.commitHash) || top.commitHash.startsWith(x.hash)));
    lastTouched = { author: top.authorName || (c?.authorName ?? ""), whenISO: isoFromUnix(top.authorTime), commit: top.commitHash.slice(0, 8), subject: c?.subject ?? "" };
    if (nowMs > 0 && top.authorTime > 0) ageDays = Math.max(0, Math.round((nowMs / 1000 - top.authorTime) / 86400));
  }

  // intent: scan the recent commits touching this file (newest first), prefer the
  // one resolving to last-touched, else any recent commit.
  const intentText = commits.slice(0, 8).map((c) => `${c.subject}\n${c.body}`).join("\n");
  const signals = extractIntentSignals(intentText);
  const temporaryFix = signals.some((s) => /temporary|deferred|hack|FIXME|ชั่วคราว/i.test(s.label));

  const riskFlags = safeguardFlags(input?.codeSnippet, input?.symptom);

  let verdict: HauntVerdict;
  if (blame.length === 0 && commits.length === 0) verdict = "UNKNOWN";
  else if (temporaryFix || (input?.symptom ? riskFlags.length > 0 : false)) verdict = "HAUNTED";
  else verdict = "CLEAR";

  const narrative = buildNarrative({ file, region, lastTouched, ageDays, temporaryFix, signals, riskFlags, knowledge, verdict, symptom: input?.symptom });
  return { file, region, lastTouched, ageDays, intent: { temporaryFix, signals }, riskFlags, relatedKnowledge: knowledge, verdict, narrative };
}

function buildNarrative(a: {
  file: string; region: HauntReport["region"]; lastTouched: HauntReport["lastTouched"]; ageDays: number | null;
  temporaryFix: boolean; signals: IntentSignal[]; riskFlags: string[]; knowledge: HauntKnowledge[]; verdict: HauntVerdict; symptom?: string;
}): string {
  const loc = a.region ? `${a.file}:${a.region.start}-${a.region.end}` : a.file;
  if (a.verdict === "UNKNOWN") return `No git history found for ${loc} — UNKNOWN. I won't guess at an author or a reason.`;
  const parts: string[] = [];
  if (a.lastTouched) {
    const age = a.ageDays !== null ? `${a.ageDays} day${a.ageDays === 1 ? "" : "s"} ago` : "at an unknown time";
    parts.push(`${loc} was last changed ${age} by ${a.lastTouched.author || "an unknown author"}${a.lastTouched.subject ? ` — "${a.lastTouched.subject}"` : ""} (${a.lastTouched.commit}).`);
  }
  if (a.temporaryFix) {
    const q = a.signals[0]?.quote;
    parts.push(`⚠ The author left a temporary-fix intent${q ? `: "${q}"` : ""} — this was meant to be revisited.`);
  }
  if (a.riskFlags.length) parts.push(`It also lacks: ${a.riskFlags.join("; ")}${a.symptom ? ` — a likely contributor to "${a.symptom}".` : "."}`);
  if (a.knowledge.length) parts.push(`💡 The team already shared knowledge about this area: ${a.knowledge.map((k) => (k.source ? `${k.source}: ` : "") + k.value).join(" · ").slice(0, 240)}`);
  if (a.verdict === "CLEAR") parts.push(`No temporary-fix or missing-safeguard signal found here — looks clean.`);
  else parts.push(`Worth a look before you trust this region. (Surfaced from real git history — a candidate, not a proven cause.)`);
  return parts.join(" ");
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface HauntGauntlet {
  extractsTemporaryFixEN: boolean;
  extractsTemporaryFixTH: boolean;
  flagsMissingCacheOnPerf: boolean;
  lastTouchedResolved: boolean;
  ageComputed: boolean;
  unknownOnEmptyHistory: boolean;
  clearOnCleanRecent: boolean;
  surfacesKnowledge: boolean;
  noCausationOverclaim: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function hauntGauntlet(): HauntGauntlet {
  const NOW = 1_700_000_000_000; // fixed clock
  const day = 86400;
  const touchedAt = Math.floor(NOW / 1000) - 90 * day; // 90 days ago

  const hauntedEN: HauntInput = {
    file: "src/payment.ts", region: { start: 40, end: 92 }, nowMs: NOW, symptom: "slow under traffic peak",
    blame: [{ commitHash: "abc1234def", authorName: "Alice", authorTime: touchedAt, lineNumber: 41, content: "doPay()" }],
    commits: [{ hash: "abc1234def567", authorName: "Alice", authorDate: "2023-08", subject: "quick fix for flash sale", body: "temporary fix, will revisit after the sale" }],
    codeSnippet: "async function doPay(){ for (const o of orders){ await charge(o); } return ok; }",
    knowledge: [{ source: "Bob", value: "use the batched charge API to avoid per-order latency" }],
  };
  const rEN = buildHauntReport(hauntedEN);
  const extractsTemporaryFixEN = rEN.intent.temporaryFix === true && rEN.verdict === "HAUNTED";
  const flagsMissingCacheOnPerf = rEN.riskFlags.some((f) => /caching|await inside a loop/.test(f));
  const lastTouchedResolved = rEN.lastTouched?.author === "Alice" && rEN.lastTouched?.subject === "quick fix for flash sale" && rEN.lastTouched?.commit === "abc1234d";
  const ageComputed = rEN.ageDays === 90;
  const surfacesKnowledge = rEN.relatedKnowledge.length === 1 && /batched charge/.test(rEN.narrative);
  const noCausationOverclaim = /candidate, not a proven cause/i.test(rEN.narrative) && !/\bthis is the (bug|cause)\b/i.test(rEN.narrative);

  const hauntedTH: HauntInput = {
    file: "src/auth.ts", nowMs: NOW,
    blame: [{ commitHash: "fff999", authorName: "เอ", authorTime: touchedAt, lineNumber: 5, content: "x" }],
    commits: [{ hash: "fff999000", authorName: "เอ", authorDate: "2023", subject: "แก้ขัดไปก่อน", body: "เดี๋ยวค่อยมาแก้ทีหลัง" }],
  };
  const rTH = buildHauntReport(hauntedTH);
  const extractsTemporaryFixTH = rTH.intent.temporaryFix === true && rTH.intent.signals.some((s) => /TH/.test(s.label));

  const empty = buildHauntReport({ file: "x.ts", blame: [], commits: [], nowMs: NOW });
  const unknownOnEmptyHistory = empty.verdict === "UNKNOWN" && empty.lastTouched === null && /UNKNOWN/.test(empty.narrative) && !/last changed/.test(empty.narrative);

  const clean: HauntInput = {
    file: "src/clean.ts", nowMs: NOW,
    blame: [{ commitHash: "ccc111", authorName: "Cara", authorTime: Math.floor(NOW / 1000) - 2 * day, lineNumber: 1, content: "ok" }],
    commits: [{ hash: "ccc111222", authorName: "Cara", authorDate: "2023", subject: "add caching + timeout", body: "with retry and try/catch" }],
    codeSnippet: "const cache = new LRU(); try { await withTimeout(fn); } catch(e){ retry(); }",
  };
  const clearOnCleanRecent = buildHauntReport(clean).verdict === "CLEAR";

  const deterministic = JSON.stringify(buildHauntReport(hauntedEN)) === JSON.stringify(buildHauntReport(hauntedEN));

  let total = true;
  try {
    buildHauntReport(null as unknown as HauntInput);
    buildHauntReport({ file: 1 as unknown as string, blame: null as unknown as HauntBlame[], commits: undefined as unknown as HauntCommit[] });
    extractIntentSignals(undefined as unknown as string);
    safeguardFlags(123 as unknown as string, null as unknown as string);
  } catch { total = false; }

  const all = extractsTemporaryFixEN && extractsTemporaryFixTH && flagsMissingCacheOnPerf && lastTouchedResolved
    && ageComputed && unknownOnEmptyHistory && clearOnCleanRecent && surfacesKnowledge && noCausationOverclaim
    && deterministic && total;
  return { extractsTemporaryFixEN, extractsTemporaryFixTH, flagsMissingCacheOnPerf, lastTouchedResolved, ageComputed, unknownOnEmptyHistory, clearOnCleanRecent, surfacesKnowledge, noCausationOverclaim, deterministic, total, score: all ? 100 : 0 };
}

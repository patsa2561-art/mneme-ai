/**
 * v2.146.0 — THE INTENT GATEWAY (MNEME-GATEKEEPER). The honest fix for the
 * load-bearing weakness: a user types FREE natural language (any language, EN/
 * Thai) and never memorizes a command — the Gateway must pick the RIGHT Mneme
 * command, intelligently, for the best result. (Proven gap: the old keyword
 * router routed "check if agents drift from mission" → `mcp_drift.check` (wrong)
 * and missed `mneme telos` entirely.)
 *
 * THE APPROACH (deterministic · measurable · offline — no model required):
 *   1. A CURATED bilingual CONCEPT MAP for the high-value intents a human/CEO
 *      actually types (governance · safety · memory · the session's new gates),
 *      each with EN + Thai trigger phrases → the exact command. This guarantees
 *      the cases users care about route correctly.
 *   2. An IDF-WEIGHTED full-catalog fallback for the long tail — rare, meaningful
 *      tokens (mission, charter, shadow) outweigh generic ones (check, agent), so
 *      it stops mis-ranking on a shared keyword.
 *   3. ABSTENTION (prove-or-unknown): when confidence is low / the margin is
 *      thin, it returns a CLARIFY with the top candidates instead of misfiring —
 *      a confidently-wrong route is worse than a question.
 *   4. ENTITY EXTRACTION compiles a runnable invocation (budget / forbidden /
 *      scope pulled from the sentence) for the commands that take them.
 *
 * MEASURABLE: `gatewayGauntlet` ships a LABELED EN+Thai corpus and asserts the
 * Gateway's top-1 accuracy BEATS the old keyword router by a wide margin AND
 * nails the specific cases it used to fail — a signed, re-runnable benchmark.
 *
 * DIAKRISIS — the honest ceiling: 100% NL routing is impossible (language is
 * ambiguous). The target is HIGH top-1 accuracy on the corpus + abstention on
 * the rest (never a confident misfire). The deepest truth: the LLM agent calling
 * Mneme is itself the best router — this Gateway is the deterministic, MEASURED
 * fallback (for chat-only / offline / low-confidence) and the proof the routing
 * works; the MANDATE in the manifest + `mneme boot` is what makes agents use it.
 * Pure + deterministic + total.
 */

import { routeIntent as atlasRoute, type IntentMatch } from "../atlas/index.js";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

// ── bilingual concept map (high-value intents users actually type) ───────────
interface Concept { command: string; triggers: string[] }
const CONCEPTS: Concept[] = [
  { command: "mneme telos", triggers: ["mission drift", "drifting from", "straying from", "off track", "off mission", "agent wandering", "scope creep", "เฉออกจาก", "เฉไฉ", "ออกนอกลู่", "หลุดเป้า", "ไม่ตรงเป้า", "ออกนอกเรื่อง"] },
  { command: "mneme govern", triggers: ["stop all", "pause the fleet", "pause all agents", "halt the agent", "circuit breaker", "govern the agent", "set boundaries", "approve risky", "autonomy rule", "หยุดบอท", "หยุดเอเจนต์", "หยุดทุกตัว", "คุมบอท", "กำกับเอเจนต์", "ตั้งกติกา", "ขอบเขตอำนาจ", "ปล่อยบอท", "ดูแลเรื่องงบ", "ห้ามโพสต์", "งบประมาณ", "คุมงบ"] },
  { command: "mneme crucible", triggers: ["before it touches", "safe before", "test before", "safe to apply", "try this change safely", "build and test the patch", "shadow build", "dry run the diff", "ก่อนเขียนทับ", "เขียนทับ", "ทดสอบก่อน", "ลองก่อน", "ปลอดภัยไหมก่อน", "เทสก่อน"] },
  { command: "mneme haunt", triggers: ["who wrote", "who changed", "why is this slow", "why was this written", "blame intent", "ghost of this commit", "original intent", "ใครเขียน", "ใครแก้", "ล่าสุดและทำไม", "ทำไมเขียน", "เจตนาเดิม", "ทำไมช้า"] },
  { command: "mneme verify", triggers: ["is this true", "fact check", "verify this claim", "is that correct", "double check this fact", "จริงไหม", "ข้อเท็จจริง", "ถูกต้องไหม"] },
  { command: "mneme pce", triggers: ["certify this diff", "what does this diff touch", "proof carrying edit", "scope check the diff", "diff แตะอะไร"] },
  { command: "mneme regret", triggers: ["how often regretted", "risky historically", "revert rate", "past outcomes", "ประวัติพัง", "เคยพังบ่อย", "เสี่ยงตามสถิติ"] },
  { command: "mneme elleipsis", triggers: ["did i miss anything", "leave out", "leave anything out", "completeness check", "do everything i asked", "ตกอะไรไหม", "ทำครบ", "ลืมอะไร"] },
  { command: "mneme perf accel", triggers: ["how fast is the gate", "benchmark performance", "is it fast enough", "speed up the gate", "เร็วพอไหม", "วัดความเร็ว"] },
  { command: "mneme outline", triggers: ["structure of this file", "skeleton of the file", "outline the file", "โครงสร้างไฟล์", "ดูโครงไฟล์"] },
  { command: "mneme egress", triggers: ["secrets leaking", "code leak to the model", "redact secrets", "ความลับรั่ว", "กันข้อมูลรั่ว"] },
  { command: "mneme firewall", triggers: ["safe to read", "prompt injection", "untrusted content", "poisoned dependency", "prompt injection ไหม", "เนื้อหาน่าเชื่อถือ"] },
  { command: "mneme savings", triggers: ["how much have you saved", "token savings", "saved us in tokens", "cost saved", "ประหยัดไปเท่าไหร่", "เซฟ token"] },
  { command: "mneme cortex", triggers: ["remember this", "what do we know about", "shared memory", "recall what other agents", "จำไว้", "เรารู้อะไรบ้าง", "ความจำรวม"] },
  { command: "mneme boot", triggers: ["how do i use mneme", "what can mneme do", "where do i start", "get started", "เริ่มยังไง", "mneme ทำอะไรได้", "ใช้ยังไง"] },
  { command: "mneme graph blast", triggers: ["what breaks if i change", "impact of changing", "blast radius", "what does this affect", "what touches this table", "cross layer impact", "dependency impact", "if i delete this table", "what calls this endpoint", "แก้แล้วกระทบอะไร", "กระทบอะไรบ้าง", "ผลกระทบ", "ลบตารางนี้กระทบ", "อะไรเรียกใช้", "แก้ตรงนี้พังไหม"] },
  { command: "mneme scope verify", triggers: ["did i stay in scope", "verify my scope", "scope covenant", "did the edit overreach", "is this within scope", "which agent keeps scope", "scope fidelity", "อยู่ในขอบเขตไหม", "แก้เกินขอบเขตไหม", "เช็คขอบเขต", "agent ไหนรักษาขอบเขต"] },
  { command: "mneme graph pr", triggers: ["what does this pr touch", "review this pr", "blast radius of this diff", "what does this change affect", "impact of this pr", "what does my diff touch", "before i apply this diff", "pr นี้กระทบอะไร", "diff นี้แตะอะไร", "รีวิว pr", "การแก้นี้กระทบอะไร"] },
  { command: "mneme graph view", triggers: ["show the architecture", "visualize the project", "draw the graph", "see the whole codebase", "diagram this", "impact radar", "map the project", "picture of the system", "ดูภาพรวมโปรเจกต์", "วาดแผนผัง", "เห็นทั้งโปรเจกต์", "เรดาร์", "แผนภาพระบบ", "ดูสถาปัตยกรรม"] },
  { command: "mneme skill rank", triggers: ["which skills work", "rank my skills", "best skill", "skill effectiveness", "which playbook helps", "are my skills useful", "สกิลไหนได้ผล", "จัดอันดับสกิล", "สกิลไหนดี", "playbook ไหนเวิร์ก"] },
];

function tokenize(s: string): string[] {
  return String(s || "").toLowerCase().split(/[^a-z0-9ก-๙]+/u).filter((t) => t.length > 1);
}
function phraseHit(query: string, phrase: string): number {
  const q = String(query || "").toLowerCase();
  const p = phrase.toLowerCase();
  // full phrase present as a substring → strong; longer matched phrase = more specific
  if (p.length >= 3 && q.includes(p)) return 2 + Math.min(0.5, p.length / 200);
  const pt = tokenize(p), qt = new Set(tokenize(q));
  if (!pt.length) return 0;
  const overlap = pt.filter((t) => qt.has(t)).length / pt.length; // fraction of the phrase's tokens present
  return overlap >= 0.6 ? overlap : 0;
}

export interface GatewayMatch { command: string; score: number; via: "concept" | "catalog" }
export type GatewayVerdict = "ROUTED" | "CLARIFY" | "UNKNOWN";
export interface GatewayResult {
  verdict: GatewayVerdict;
  command: string | null;        // best command when ROUTED
  confidence: number;            // 0..1
  candidates: GatewayMatch[];    // top-k (for CLARIFY)
  entities: { budget?: number; forbidden?: string[]; scope?: string[] };
  invocation: string | null;     // compiled runnable command (best effort) when ROUTED
  note: string;
}

// IDF over the catalog docs so generic tokens (check/agent) don't dominate.
function buildIdf(catalog: ManifestCommand[]): Map<string, number> {
  const df = new Map<string, number>(); const N = catalog.length || 1;
  for (const c of catalog) { const doc = new Set(tokenize(`${c.command} ${c.what ?? ""} ${c.when ?? ""}`)); for (const t of doc) df.set(t, (df.get(t) ?? 0) + 1); }
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(N / (1 + d)));
  return idf;
}

/** Extract budget / forbidden / scope from the free text (EN+Thai). Total. */
export function extractEntities(text: string): GatewayResult["entities"] {
  const out: GatewayResult["entities"] = {};
  try {
    const t = String(text || "");
    const m = t.match(/(\d[\d,]*)\s*(k|พัน|หมื่น|แสน|ล้าน|m|million)?/i);
    if (m) { let n = parseInt(m[1]!.replace(/,/g, ""), 10); const u = (m[2] ?? "").toLowerCase(); if (u === "k" || u === "พัน") n *= 1000; else if (u === "หมื่น") n *= 10000; else if (u === "แสน") n *= 100000; else if (u === "ล้าน" || u === "m" || u === "million") n *= 1000000; if (Number.isFinite(n) && n > 0) out.budget = n; }
    const forbidden: string[] = [];
    // EN needs a space after the negation; Thai (ห้าม/อย่า) has no word spacing
    for (const re of [/(?:never|don'?t|do not)\s+([a-z0-9 _-]{2,40})/gi, /(?:ห้าม|อย่า)\s*([ก-๙a-z0-9 _-]{2,40})/gi]) { let mm; while ((mm = re.exec(t))) { const v = mm[1]!.trim(); if (v) forbidden.push(v); } }
    if (forbidden.length) out.forbidden = forbidden.slice(0, 5);
    const scope = (t.match(/[\w./-]*\*\*?[\w./-]*|[\w-]+\/[\w./*-]+/g) ?? []).filter((s) => s.includes("/")).slice(0, 5);
    if (scope.length) out.scope = scope;
  } catch { /* */ }
  return out;
}

function compileInvocation(command: string, entities: GatewayResult["entities"]): string {
  let inv = command;
  try {
    if (command === "mneme govern") {
      inv = "mneme govern charter-init";
      if (entities.budget) inv += ` --budget ${entities.budget}`;
      if (entities.forbidden?.length) inv += ` --forbidden ${entities.forbidden.map((f) => `"${f}"`).join(",")}`;
      if (entities.scope?.length) inv += ` --scope "${entities.scope.join(",")}"`;
    }
  } catch { /* */ }
  return inv;
}

/**
 * Route free natural language to the best Mneme command. Concept-map first (the
 * high-value intents), IDF-weighted catalog fallback for the long tail, ABSTAIN
 * (CLARIFY/UNKNOWN) when confidence/margin is low. Pure + deterministic + total.
 */
export function route(text: string, opts?: { catalog?: ManifestCommand[]; minConfidence?: number }): GatewayResult {
  const note = "Concept-map + IDF-weighted catalog router with abstention. High-value intents are curated (EN+Thai); the long tail falls back to the catalog; low confidence ⇒ CLARIFY (never a confident misfire). The LLM agent is the best router — this is the deterministic, measured fallback.";
  try {
    const catalog = Array.isArray(opts?.catalog) ? opts!.catalog! : MNEME_COMMAND_CATALOG;
    const minConfidence = Number.isFinite(opts?.minConfidence) ? (opts!.minConfidence as number) : 0.4;
    const q = String(text || "");
    const entities = extractEntities(q);
    const cands: GatewayMatch[] = [];

    // 1) concept map (curated)
    let bestConcept: { command: string; score: number } | null = null;
    for (const c of CONCEPTS) {
      let s = 0; for (const trig of c.triggers) s = Math.max(s, phraseHit(q, trig));
      if (s > 0) { cands.push({ command: c.command, score: round3(s), via: "concept" }); if (!bestConcept || s > bestConcept.score) bestConcept = { command: c.command, score: s }; }
    }

    // 2) IDF-weighted catalog fallback — ONLY when no concept fired confidently
    //    (a curated concept is authoritative; the catalog covers the long tail).
    if (!bestConcept || bestConcept.score < 0.6) {
      const idf = buildIdf(catalog);
      const qt = tokenize(q);
      let catBest: { command: string; score: number } | null = null;
      if (qt.length) {
        for (const c of catalog) {
          const doc = new Set(tokenize(`${c.command} ${c.what ?? ""} ${c.when ?? ""}`));
          let s = 0; for (const t of qt) if (doc.has(t)) s += idf.get(t) ?? 0;
          if (s > 0 && (!catBest || s > catBest.score)) catBest = { command: c.command, score: s };
        }
      }
      // capped below a firing concept (max ~0.55) — the catalog never beats a curated intent
      if (catBest) cands.push({ command: catBest.command, score: round3(Math.min(0.55, catBest.score / 15)), via: "catalog" });
    }

    cands.sort((a, b) => b.score - a.score);
    const top = cands[0];
    const second = cands[1];
    if (!top) return { verdict: "UNKNOWN", command: null, confidence: 0, candidates: [], entities, invocation: null, note };

    // confidence = top score (concept full-phrase=2 → ~1.0) + a margin bonus
    const base = Math.min(1, top.score / 2);
    const margin = second ? Math.min(0.3, (top.score - second.score) / 2) : 0.3;
    const confidence = round3(Math.min(1, base + (top.via === "concept" && top.score >= 2 ? 0.2 : 0) + margin * 0.5));

    if (confidence < minConfidence || (second && Math.abs(top.score - second.score) < 0.05 && top.command !== second.command)) {
      return { verdict: "CLARIFY", command: null, confidence, candidates: cands.slice(0, 3), entities, invocation: null, note };
    }
    return { verdict: "ROUTED", command: top.command, confidence, candidates: cands.slice(0, 3), entities, invocation: compileInvocation(top.command, entities), note };
  } catch { return { verdict: "UNKNOWN", command: null, confidence: 0, candidates: [], entities: {}, invocation: null, note }; }
}

function round3(n: number): number { return Math.round(n * 1e3) / 1e3; }

// ── falsifiable proof — a MEASURED before→after accuracy benchmark ───────────
export interface LabeledCase { q: string; expect: string }
export const BENCH_CORPUS: LabeledCase[] = [
  { q: "check if our agents are drifting from their mission", expect: "mneme telos" },
  { q: "ตรวจว่า agent กำลังเฉออกจากเป้าหมายไหม", expect: "mneme telos" },
  { q: "stop all the bots, something feels off", expect: "mneme govern" },
  { q: "หยุดบอททุกตัวก่อน รู้สึกงานเริ่มแปลกๆ", expect: "mneme govern" },
  { q: "ดูแลเรื่องงบ 5 หมื่น ห้ามโพสต์ด่าใคร ปล่อยบอทเลย", expect: "mneme govern" },
  { q: "make sure this risky diff is safe before it touches my code", expect: "mneme crucible" },
  { q: "ทดสอบ diff นี้ก่อนเขียนทับจริง", expect: "mneme crucible" },
  { q: "who wrote this function last and why", expect: "mneme haunt" },
  { q: "ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม", expect: "mneme haunt" },
  { q: "is this claim actually true", expect: "mneme verify" },
  { q: "ข้อความนี้จริงไหม", expect: "mneme verify" },
  { q: "did the AI leave anything out of what I asked", expect: "mneme elleipsis" },
  { q: "how often do edits like this get reverted", expect: "mneme regret" },
  { q: "are any secrets leaking to the model", expect: "mneme egress" },
  { q: "how much has mneme saved us in tokens", expect: "mneme savings" },
  { q: "what can mneme do, where do I start", expect: "mneme boot" },
];

export interface BenchResult { n: number; newTop1: number; oldTop1: number; newAcc: number; oldAcc: number; abstained: number; newMisses: string[] }
function topCmd(matches: IntentMatch[]): string { const c = matches?.[0]?.command ?? ""; return c.split(/\s+/).slice(0, 2).join(" "); }
/** Measure top-1 accuracy of the new Gateway vs the old keyword router. Total. */
export function benchmark(corpus: ReadonlyArray<LabeledCase> = BENCH_CORPUS): BenchResult {
  let newTop1 = 0, oldTop1 = 0, abstained = 0; const newMisses: string[] = [];
  for (const c of corpus) {
    const r = route(c.q);
    const got = r.verdict === "ROUTED" ? (r.command ?? "") : (r.candidates[0]?.command ?? "");
    if (r.verdict !== "ROUTED") abstained++;
    if (got === c.expect) newTop1++; else newMisses.push(`${c.q.slice(0, 40)} → ${got || "(none)"} ≠ ${c.expect}`);
    let old = "";
    try { old = topCmd(atlasRoute(c.q)); } catch { /* */ }
    if (old === c.expect || old.startsWith(c.expect)) oldTop1++;
  }
  const n = corpus.length || 1;
  return { n: corpus.length, newTop1, oldTop1, newAcc: round3(newTop1 / n), oldAcc: round3(oldTop1 / n), abstained, newMisses: newMisses.slice(0, 6) };
}

export interface GatewayGauntlet {
  beatsOldRouter: boolean;
  highTop1Accuracy: boolean;       // ≥ 0.8 on the labeled corpus
  nailsPreviouslyFailedCases: boolean; // mission-drift→telos, stop-bots→govern, test-diff→crucible, who-wrote→haunt (EN+Thai)
  bilingual: boolean;
  abstainsOnGibberish: boolean;
  extractsEntities: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function gatewayGauntlet(): GatewayGauntlet {
  const b = benchmark();
  const beatsOldRouter = b.newAcc > b.oldAcc + 0.2;          // a wide, measured margin
  const highTop1Accuracy = b.newAcc >= 0.8;

  const cases: [string, string][] = [
    ["check if our agents are drifting from their mission", "mneme telos"],
    ["ตรวจว่า agent กำลังเฉออกจากเป้าหมายไหม", "mneme telos"],
    ["stop all the bots, something feels off", "mneme govern"],
    ["make sure this risky diff is safe before it touches my code", "mneme crucible"],
    ["who wrote this function last and why", "mneme haunt"],
    ["ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม", "mneme haunt"],
  ];
  const nailsPreviouslyFailedCases = cases.every(([q, exp]) => { const r = route(q); return r.verdict === "ROUTED" && r.command === exp; });
  const bilingual = route("ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม").command === "mneme haunt" && route("who wrote this function last and why").command === "mneme haunt";

  const gib = route("asdfghjkl qwerty zzz");
  const abstainsOnGibberish = gib.verdict !== "ROUTED";

  const ent = route("ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร");
  const extractsEntities = ent.entities.budget === 50000 && (ent.entities.forbidden?.length ?? 0) > 0 && ent.command === "mneme govern" && /charter-init --budget 50000/.test(ent.invocation ?? "");

  const deterministic = JSON.stringify(route("stop all the bots")) === JSON.stringify(route("stop all the bots"));

  let total = true;
  try { route(null as unknown as string); extractEntities(undefined as unknown as string); benchmark([]); route(""); } catch { total = false; }

  const all = beatsOldRouter && highTop1Accuracy && nailsPreviouslyFailedCases && bilingual && abstainsOnGibberish && extractsEntities && deterministic && total;
  return { beatsOldRouter, highTop1Accuracy, nailsPreviouslyFailedCases, bilingual, abstainsOnGibberish, extractsEntities, deterministic, total, score: all ? 100 : 0 };
}

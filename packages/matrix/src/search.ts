/**
 * THE WISDOM SEARCH INDEX — autonomous tool discovery by INTENT.
 *
 * An AI agent connecting over gRPC rarely knows the 1000+ tool names. It knows what
 * the user WANTS, in plain language. This index turns an intent → the right tool(s),
 * deterministically, with NO LLM:
 *
 *   • SUPER SEARCH (retrieval) — a BM25-lite ranker over each tool's name · category
 *     · description, so any phrasing finds the relevant tools.
 *   • WISDOM (the boost) — every tool ships hand-authored `triggers` ("when to use
 *     me" phrases). A trigger that matches the intent is CURATED knowledge, not a
 *     lexical coincidence, so it dominates the score. An optional pheromone map
 *     (proven real-world usage) multiplies on top — the more a tool has actually
 *     helped, the higher it ranks. Absent data ⇒ neutral (never fabricated).
 *
 * Pure + deterministic + total. Measured, not claimed: `searchGauntlet` feeds every
 * tool its OWN trigger phrases back and reports top-1 / top-3 accuracy.
 */

export interface ToolLike { name: string; category?: string; description?: string; triggers?: string[] }
export interface SearchHit { name: string; category: string; description: string; score: number; why: string }
export interface SearchIndex {
  tools: Array<{ name: string; category: string; description: string; triggers: string[]; tf: Map<string, number>; trigSet: string[] }>;
  idf: Map<string, number>;
}

const STOP = new Set("the a an of to in on for is are be do does how what when which i you it me my this that with your from can could should would will get set use using run".split(/\s+/));
const tokenize = (s: string): string[] =>
  String(s || "").toLowerCase().replace(/[._/-]+/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && w !== "mneme" && !STOP.has(w));

/** Build the index once from the tool registry. Deterministic. */
export function buildSearchIndex(tools: ToolLike[]): SearchIndex {
  const docs = tools.filter((t) => t && t.name).map((t) => {
    const name = String(t.name), category = String(t.category ?? ""), description = String(t.description ?? "");
    const triggers = (Array.isArray(t.triggers) ? t.triggers : []).map(String);
    // term-frequency document: name ×3 + category ×2 + triggers ×3 + description ×1
    const tf = new Map<string, number>();
    const add = (text: string, w: number) => { for (const tok of tokenize(text)) tf.set(tok, (tf.get(tok) ?? 0) + w); };
    add(name, 3); add(category, 2); add(description, 1);
    for (const tr of triggers) add(tr, 3);
    return { name, category, description, triggers, tf, trigSet: triggers.map((x) => x.toLowerCase().trim()).filter(Boolean) };
  });
  const N = Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const tok of d.tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [tok, n] of df) idf.set(tok, Math.log(1 + (N - n + 0.5) / (n + 0.5))); // BM25-style idf
  return { tools: docs, idf };
}

/**
 * Search the index by free-text intent. `wisdom` is an optional proven-usage map
 * (tool name → pheromone/usage count); present ⇒ a gentle multiplicative boost.
 */
export function searchTools(index: SearchIndex, intent: string, limit = 8, wisdom?: Map<string, number>): SearchHit[] {
  const q = String(intent || "");
  const qLower = q.toLowerCase().trim();
  const qTokens = tokenize(q);
  if (!qTokens.length && !qLower) return [];
  const qSet = new Set(qTokens);
  const maxPhe = wisdom && wisdom.size ? Math.max(1, ...wisdom.values()) : 1;

  const hits = index.tools.map((d) => {
    // BM25-lite: Σ idf(term) · tf, length-normalised
    const len = Math.max(1, [...d.tf.values()].reduce((s, x) => s + x, 0));
    let base = 0, overlap = 0;
    for (const tok of qSet) { const tf = d.tf.get(tok); if (tf) { base += (index.idf.get(tok) ?? 0) * (tf / (tf + 1.5 * (len / 30))); overlap++; } }
    // WISDOM boost — a curated trigger phrase that matches the intent is intent, not coincidence
    let why = overlap ? `matches ${overlap} term(s)` : "";
    let trigBoost = 0;
    for (const tr of d.trigSet) {
      if (!tr) continue;
      if (qLower === tr) { trigBoost = Math.max(trigBoost, 6); why = `exact trigger “${tr}”`; }
      else if (qLower.includes(tr) || tr.includes(qLower)) { trigBoost = Math.max(trigBoost, 3.5); why = `trigger “${tr}”`; }
      else { const trTok = new Set(tokenize(tr)); let inter = 0; for (const t of trTok) if (qSet.has(t)) inter++; if (trTok.size && inter / trTok.size >= 0.6) { trigBoost = Math.max(trigBoost, 2); if (!overlap) why = `trigger “${tr}”`; } }
    }
    // name substring (e.g. intent contains "outline" → mneme.outline.*)
    let nameBoost = 0; for (const tok of qSet) if (d.name.toLowerCase().includes(tok)) nameBoost += 0.8;
    let score = base + trigBoost + nameBoost;
    if (wisdom && score > 0) { const phe = wisdom.get(d.name) ?? 0; score *= 1 + 0.5 * (Math.log1p(phe) / Math.log1p(maxPhe)); }
    return { name: d.name, category: d.category, description: d.description, score, why: why || "weak match" };
  }).filter((h) => h.score > 0);

  hits.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return hits.slice(0, Math.max(1, limit)).map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
}

// ─── gauntlet — MEASURED, not claimed ─────────────────────────────────────────
export interface SearchGauntlet { score: number; checks: Array<{ name: string; pass: boolean; detail: string }>; metrics: { tools: number; trials: number; top1: number; top3: number } }

/**
 * Feed every tool its OWN trigger phrases back as a query and measure how often the
 * owning tool is ranked #1 / top-3. A real, reproducible retrieval-quality number.
 */
export function searchGauntlet(tools: ToolLike[]): SearchGauntlet {
  const index = buildSearchIndex(tools);
  let trials = 0, top1 = 0, top3 = 0;
  for (const t of index.tools) {
    for (const tr of t.triggers.slice(0, 3)) {
      if (!tr.trim()) continue;
      trials++;
      const hits = searchTools(index, tr, 3);
      if (hits[0]?.name === t.name) top1++;
      if (hits.some((h) => h.name === t.name)) top3++;
    }
  }
  const top1Pct = trials ? top1 / trials : 0, top3Pct = trials ? top3 / trials : 0;
  // determinism + a non-empty result on a plain intent + a sane accuracy floor
  const det = JSON.stringify(searchTools(index, "verify a claim is true", 5)) === JSON.stringify(searchTools(index, "verify a claim is true", 5));
  const nonEmpty = searchTools(index, "verify a claim", 5).length > 0;
  const checks = [
    { name: "TOP1-OWN-TRIGGER", pass: top1Pct >= 0.85, detail: `a tool is #1 for its own trigger ${(top1Pct * 100).toFixed(1)}% of the time (${top1}/${trials})` },
    { name: "TOP3-OWN-TRIGGER", pass: top3Pct >= 0.95, detail: `a tool is in top-3 for its own trigger ${(top3Pct * 100).toFixed(1)}% (${top3}/${trials})` },
    { name: "NON-EMPTY", pass: nonEmpty, detail: "a plain-language intent returns at least one tool" },
    { name: "DETERMINISTIC", pass: det, detail: "same intent → byte-identical ranking" },
  ];
  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), checks, metrics: { tools: index.tools.length, trials, top1, top3 } };
}

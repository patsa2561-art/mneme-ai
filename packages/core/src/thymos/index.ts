/**
 * THYMOS (θυμός — the Homeric seat of feeling + will) — the AFFECTIVE CORE.
 *
 * Jack's two diamonds, cut honestly into one heart:
 *   ① Biomorphic decay — memory that forgets like a mind: every trace carries an AFFECTIVE CHARGE
 *      (salience) read from real signals, and fades unless it matters, leaving only the core
 *      impression. Not a perfect-recall database — a living one that keeps what BONDS.
 *   ② Resonant magnetism — the same affective core is an ATTRACTOR: inbound content is ranked by
 *      resonance with what the user cares about, so the meaningful is pulled in and the noise repelled
 *      — relevance as a standing field, not a per-query search.
 *
 * ★HONEST (DIAKRISIS) — the line this never crosses: "feeling" here is a SIGNED, DETERMINISTIC,
 * MEASURABLE salience/bond score computed from observable signals (reuse, sentiment markers in the
 * text, consequence, shared history). It is NOT a claim of sentience, qualia, or real emotion. The
 * value is a memory that behaves like a mind — forgets the trivial, holds the meaningful, warms with
 * a relationship — and that you can MEASURE (salience 0..1, valence -1..1, bond 0..100, retention
 * curves, footprint saved). That honesty is the whole point: a heart you can audit.
 */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number(n) || 0));
const round = (n: number, d = 3): number => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
const DAY = 86_400_000;

// ── affect from text — how strongly, and which way, the human reacted (EN + Thai) ───────────────
const POS = ["love", "great", "excellent", "important", "amazing", "thank", "perfect", "brilliant", "awesome", "beautiful", "ชอบ", "รัก", "เยี่ยม", "สุดยอด", "ดีมาก", "สำคัญ", "ประทับใจ", "ขอบคุณ", "เจ๋ง", "ปลื้ม"];
const NEG = ["wrong", "bad", "hate", "broken", "bug", "terrible", "angry", "sad", "awful", "fail", "ผิด", "แย่", "เกลียด", "ไม่ชอบ", "เสียใจ", "โกรธ", "พัง", "บั๊ก", "ห่วย", "เซ็ง"];
const BOOST = ["very", "so", "most", "really", "extremely", "มาก", "สุด", "ที่สุด", "โคตร", "สุดๆ"];
export interface AffectRead { valence: number; intensity: number }
/** Read affective valence (-1..1) + intensity (0..1) from text — sentiment markers + boosters + "!". */
export function readAffect(text: string): AffectRead {
  const t = String(text ?? "").toLowerCase();
  const count = (words: string[]): number => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const pos = count(POS), neg = count(NEG), boost = count(BOOST), bangs = (t.match(/!|ที่สุด/g) ?? []).length;
  const hits = pos + neg;
  if (hits === 0 && boost === 0 && bangs === 0) return { valence: 0, intensity: 0 };
  const valence = hits === 0 ? 0 : clamp((pos - neg) / hits, -1, 1);
  const intensity = clamp((hits * 0.34) + (boost * 0.18) + (bangs * 0.12), 0, 1);
  return { valence: round(valence), intensity: round(intensity) };
}

// ── salience — the affective charge that decides what stays ──────────────────────────────────────
export interface AffectSignals { recalls?: number; valence?: number; consequence?: number }
/** Salience 0..1 from real signals: reuse (reinforcement) + |valence| (strong feeling either way is
 *  memorable) + consequence (tied to a decision/commit/fix). Both praise AND correction stick. */
export function salience(s: AffectSignals): number {
  const recalls = Math.max(0, Number(s?.recalls) || 0);
  const reuse = recalls / (recalls + 3);                 // saturating reinforcement
  const feel = clamp(Math.abs(Number(s?.valence) || 0), 0, 1);
  const cons = clamp(Number(s?.consequence) || 0, 0, 1);
  return round(clamp(0.12 + 0.34 * reuse + 0.27 * feel + 0.27 * cons, 0, 1));
}
/** A salient trace fades slowly; a trivial one within a day. half-life ranges ~0.5d … ~1.5y. */
export function halfLifeMs(sal: number): number { return (0.5 + clamp(sal, 0, 1) ** 2 * 547) * DAY; }

export interface MemoryNode { id: string; text: string; bornMs: number; lastTouchMs: number; recalls: number; valence: number; consequence: number; strength: number }
/** Imprint a new trace; its initial valence is read from the text unless given. */
export function imprint(id: string, text: string, opts: { nowMs: number; consequence?: number; valence?: number }): MemoryNode {
  const a = readAffect(text);
  return { id: String(id), text: String(text ?? ""), bornMs: opts.nowMs, lastTouchMs: opts.nowMs, recalls: 0, valence: opts.valence ?? a.valence, consequence: clamp(opts?.consequence ?? a.intensity * 0.5, 0, 1), strength: 1 };
}
/** The trace's surviving strength right now: exponential decay by a salience-driven half-life. */
export function strengthAt(node: MemoryNode, nowMs: number): number {
  const sal = salience(node);
  const elapsed = Math.max(0, nowMs - (Number(node?.lastTouchMs) || 0));
  return round(clamp((Number(node?.strength) || 0) * Math.pow(0.5, elapsed / halfLifeMs(sal)), 0, 1));
}
/** Reinforce a trace (it was recalled / mattered again) — restores strength + resets the decay clock. */
export function touch(node: MemoryNode, nowMs: number, addConsequence = 0): MemoryNode {
  return { ...node, recalls: (node.recalls || 0) + 1, lastTouchMs: nowMs, consequence: clamp(node.consequence + addConsequence, 0, 1), strength: 1 };
}
export function salienceOf(node: MemoryNode): number { return salience(node); }
/** Forget the trivial: below the strength floor AND low salience. High-salience traces never auto-forget. */
export function shouldForget(node: MemoryNode, nowMs: number, floor = 0.18): boolean {
  return strengthAt(node, nowMs) < floor && salience(node) < 0.5;
}
/** Sweep a store: keep what bonds, forget the noise. Returns the survivors + how many faded. */
export function consolidate(nodes: ReadonlyArray<MemoryNode>, nowMs: number, floor = 0.18): { kept: MemoryNode[]; forgotten: number } {
  const kept = (nodes ?? []).filter((n) => n && !shouldForget(n, nowMs, floor));
  return { kept, forgotten: (nodes?.length ?? 0) - kept.length };
}

// ── resonance — the affective core as an attractor over inbound content ──────────────────────────
function bag(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of String(text ?? "").toLowerCase().split(/[^a-z0-9฀-๿]+/).filter((x) => x.length > 1)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
/** Cosine resonance 0..1 between the core's "what I care about" text and an inbound item. */
export function resonance(core: string, item: string): number {
  const a = bag(core), b = bag(item); if (!a.size || !b.size) return 0;
  let dot = 0; for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  const mag = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  return round(clamp(dot / (mag(a) * mag(b) || 1), 0, 1));
}
export interface Attracted { item: string; resonance: number; pulled: boolean }
/** The core attracts: rank inbound by resonance; items above the threshold are pulled, the rest repelled. */
export function attract(core: string, items: ReadonlyArray<string>, threshold = 0.12): Attracted[] {
  return (items ?? []).map((item) => { const r = resonance(core, item); return { item, resonance: r, pulled: r >= threshold }; }).sort((x, y) => y.resonance - x.resonance);
}

// ── the measurable heart: a bond index you can audit ─────────────────────────────────────────────
/** Bond 0..100 — the relationship's measured warmth: shared history (count) × reinforcement ×
 *  mean salience × how much positive feeling is woven through it. Deterministic, signable. */
export function bondIndex(nodes: ReadonlyArray<MemoryNode>, nowMs: number): number {
  const live = (nodes ?? []).filter((n) => n && strengthAt(n, nowMs) >= 0.1);
  if (!live.length) return 0;
  const meanSal = live.reduce((s, n) => s + salience(n), 0) / live.length;
  const reinforced = live.reduce((s, n) => s + Math.min(1, (n.recalls || 0) / 5), 0) / live.length;
  const warmth = live.reduce((s, n) => s + Math.max(0, n.valence), 0) / live.length;
  const depth = Math.min(1, live.length / 40);            // a bond deepens with shared history
  return Math.round(clamp(100 * (0.4 * meanSal + 0.3 * reinforced + 0.15 * warmth + 0.15 * depth), 0, 100));
}

// ── gauntlet ─────────────────────────────────────────────────────────────────────────────────────
export interface ThymosGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function thymosGauntlet(): ThymosGauntlet {
  const T0 = 1_000_000_000_000;
  // affect reading (EN + Thai)
  const aPos = readAffect("this is สำคัญมาก and เยี่ยมที่สุด!"); const aNeg = readAffect("this is wrong and พัง"); const aNeu = readAffect("the file has 12 lines");
  const affectOK = aPos.valence > 0.5 && aPos.intensity > 0.5 && aNeg.valence < 0 && aNeu.intensity === 0;

  // salience: a meaningful trace (recalled, strong feeling, consequential) outscores a trivial one
  const salHi = salience({ recalls: 6, valence: 0.9, consequence: 0.8 }); const salLo = salience({ recalls: 0, valence: 0, consequence: 0 });
  const salienceOK = salHi > 0.75 && salLo < 0.2 && salHi > salLo;

  // DECAY: after 30 days, a high-salience trace survives, a trivial one fades below the floor
  const hi = imprint("a", "the deploy key lives in vault — สำคัญมาก", { nowMs: T0, consequence: 0.9, valence: 0.9 });
  const lo = imprint("b", "ran ls in the tmp dir", { nowMs: T0 });
  const later = T0 + 30 * DAY;
  const decayOK = strengthAt(hi, later) > 0.7 && strengthAt(lo, later) < 0.18 && shouldForget(lo, later) && !shouldForget(hi, later);

  // REINFORCE: touching restores strength + resets the clock
  const touched = touch(lo, later); const reinforceOK = touched.recalls === 1 && strengthAt(touched, later) === 1 && strengthAt(touched, later) > strengthAt(lo, later);

  // CONSOLIDATE: a noisy store keeps the meaningful, forgets the trivial (measurable footprint saving)
  const store = [hi, lo, imprint("c", "another throwaway", { nowMs: T0 }), imprint("d", "the architecture decision we agreed — รัก", { nowMs: T0, consequence: 0.8, valence: 0.8 })];
  const con = consolidate(store, later); const consolidateOK = con.kept.length === 2 && con.forgotten === 2 && con.kept.some((n) => n.id === "a") && con.kept.some((n) => n.id === "d");

  // RESONANCE: the core attracts the matching inbound, repels the mismatched
  const core = "build a powerful local-first trust and memory layer for AI agents";
  const at = attract(core, ["a new signed memory protocol for agents", "cheap flights to Tokyo this weekend", "trust + provenance for local AI tools"]);
  const resonanceOK = at[0].resonance > at[2].resonance && at[0].pulled && !at.find((x) => x.item.includes("Tokyo"))!.pulled;

  // BOND index: a reinforced, warm store scores higher than a cold one; measurable 0..100
  const warmStore = [touch(touch(hi, later), later), touch(imprint("e", "thank you, this is brilliant", { nowMs: T0, valence: 0.9, consequence: 0.6 }), later)];
  const coldStore = [imprint("f", "x", { nowMs: T0 })];
  const bondWarm = bondIndex(warmStore, later); const bondCold = bondIndex(coldStore, later);
  const bondOK = bondWarm > bondCold && bondWarm > 40 && bondCold >= 0 && bondCold <= 100;

  const total = (() => { try { readAffect(null as never); salience(null as never); strengthAt(null as never, 0); resonance(null as never, null as never); bondIndex(null as never, 0); consolidate(null as never, 0); return true; } catch { return false; } })();

  const checks = [
    { name: "AFFECT-READ-EN-TH", pass: affectOK, detail: "reads valence + intensity from EN+Thai sentiment markers; neutral text → 0 intensity" },
    { name: "SALIENCE-MEANINGFUL>TRIVIAL", pass: salienceOK, detail: "reuse + strong feeling + consequence raise salience; a throwaway scores low" },
    { name: "DECAY-KEEPS-WHAT-BONDS", pass: decayOK, detail: "after 30 days a salient trace survives; a trivial one fades below the floor + is forgettable" },
    { name: "REINFORCE-ON-TOUCH", pass: reinforceOK, detail: "recalling a trace restores its strength + resets the decay clock" },
    { name: "CONSOLIDATE-SAVES-FOOTPRINT", pass: consolidateOK, detail: "a sweep keeps the meaningful + forgets the noise (measurable footprint saving)" },
    { name: "RESONANCE-ATTRACTS", pass: resonanceOK, detail: "the core pulls inbound that matches its vision + repels what doesn't" },
    { name: "BOND-INDEX-MEASURABLE", pass: bondOK, detail: "a reinforced, warm relationship scores a higher auditable bond (0..100) than a cold one" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

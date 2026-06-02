/**
 * v2.147.0 — MYCELIUM: the Sovereign Data Flywheel (moat #1). The data flywheel
 * that COMPOUNDS WITHOUT CENTRALIZING — like the fungal "Wood-Wide-Web" where
 * trees share nutrients through an underground network with no central tree.
 *
 * The honest fix for Mneme's weakest moat (no data flywheel / no central data):
 * every node keeps its data LOCAL, and shares only SIGNED, CONTENT-FREE lesson
 * DIGESTS (hashes + DP-noised counts — never raw code/secrets). Peers merge them
 * (CRDT — commutative + idempotent, signature-verified, forged dropped), so the
 * whole network gets smarter together with NO honeypot to breach. It captures
 * BOTH what worked AND what failed (negative knowledge — moat #4, folded in):
 * the only AI memory that gets more valuable from failures.
 *
 * Why only Mneme can build this: a centralized competitor's business REQUIRES
 * hoarding data; Mneme's local-first, signed, prove-or-unknown architecture is
 * the one design that can run a PRIVACY-PRESERVING flywheel. That's the moat.
 *
 * DIAKRISIS — the honest ceiling: the PRIMARY privacy guarantee is structural +
 * provable — a shared lesson carries NO raw content, only one-way hashes +
 * counts (the gauntlet asserts no raw string/secret can appear in a bundle). DP
 * noise on counts is a SECONDARY guard (its scale is deterministic; the noise
 * sample is injected so tests stay deterministic — real randomness is added at
 * the CLI share boundary). The "compounding" is MEASURED as an inherited-lesson
 * hit-rate, not asserted. Pure + deterministic + total (CLI/MCP add Ed25519).
 */

import { createHash } from "node:crypto";
function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function h12(s: string): string { return sha256(s).slice(0, 16); }

export type LessonKind = "worked" | "failed";
export interface Lesson {
  id: string;            // = h12(topicHash + kind + signalHash) — the dedup key
  topicHash: string;     // hash of the problem topic (NEVER the raw topic)
  kind: LessonKind;      // positive or NEGATIVE knowledge (both shared)
  signalHash: string;    // hashed approach/signal fingerprint
  count: number;         // times observed (DP-noised when shared)
  source: string;        // anonymized instance id
  sig?: string;          // set at the CLI/MCP boundary (Ed25519); verified on merge
}

/** A raw local outcome (stays LOCAL — only its digest is ever shared). */
export interface LocalOutcome { topic: string; approach: string; kind: LessonKind; count?: number }

/** Turn local outcomes into content-free lesson digests. Pure + total. */
export function extractLessons(outcomes: ReadonlyArray<LocalOutcome>, source = "local"): Lesson[] {
  const out: Lesson[] = [];
  try {
    const list = Array.isArray(outcomes) ? outcomes : [];
    const seen = new Map<string, Lesson>();
    for (const o of list) {
      if (!o || typeof o.topic !== "string") continue;
      const kind: LessonKind = o.kind === "failed" ? "failed" : "worked";
      const topicHash = h12(o.topic.toLowerCase().trim());
      const signalHash = h12(String(o.approach ?? "").toLowerCase().trim());
      const id = h12(`${topicHash}:${kind}:${signalHash}`);
      const c = Number.isFinite(o.count) && (o.count as number) > 0 ? Math.floor(o.count as number) : 1;
      const prev = seen.get(id);
      if (prev) prev.count += c;
      else { const l: Lesson = { id, topicHash, kind, signalHash, count: c, source: h12(source) }; seen.set(id, l); out.push(l); }
    }
  } catch { /* total */ }
  return out;
}

// ── differential privacy on counts (scale deterministic; sample injected) ────
export function dpScale(epsilon: number): number { const e = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 1; return 1 / e; }
/** Apply Laplace noise to a count. `sample` is an injected unit-Laplace draw (so
 *  tests are deterministic); at runtime the CLI passes a real draw. Total. */
export function noiseCount(count: number, epsilon: number, sample = 0): number {
  try { const noised = Math.round((Number(count) || 0) + dpScale(epsilon) * sample); return Math.max(0, noised); } catch { return Math.max(0, Number(count) || 0); }
}

/** Build a shareable bundle: content-free, DP-noised. The CLI signs it. Pure + total. */
export function buildBundle(lessons: ReadonlyArray<Lesson>, opts?: { epsilon?: number; sample?: (i: number) => number }): { lessons: Lesson[]; epsilon: number } {
  const epsilon = Number.isFinite(opts?.epsilon) && (opts!.epsilon as number) > 0 ? (opts!.epsilon as number) : 1;
  const samp = typeof opts?.sample === "function" ? opts!.sample! : () => 0;
  const list = Array.isArray(lessons) ? lessons : [];
  return { lessons: list.map((l, i) => ({ id: l.id, topicHash: l.topicHash, kind: l.kind, signalHash: l.signalHash, count: noiseCount(l.count, epsilon, samp(i)), source: l.source, ...(l.sig ? { sig: l.sig } : {}) })), epsilon };
}

export interface MergeResult { merged: Lesson[]; added: number; updated: number; dropped: number }
/**
 * CRDT merge: union by lesson id, count = max (last-write-wins on the larger
 * observation), signature-verified (forged dropped via the injected verifier).
 * Commutative + idempotent ⇒ every node converges. Pure + total.
 */
export function mergeBundles(local: ReadonlyArray<Lesson>, incoming: ReadonlyArray<Lesson>, verify?: (l: Lesson) => boolean): MergeResult {
  try {
    const map = new Map<string, Lesson>();
    for (const l of Array.isArray(local) ? local : []) if (l?.id) map.set(l.id, { ...l });
    let added = 0, updated = 0, dropped = 0;
    for (const l of Array.isArray(incoming) ? incoming : []) {
      if (!l?.id) { dropped++; continue; }
      if (verify && !verify(l)) { dropped++; continue; }      // forged ⇒ dropped
      const prev = map.get(l.id);
      if (!prev) { map.set(l.id, { ...l }); added++; }
      else if ((l.count ?? 0) > (prev.count ?? 0)) { map.set(l.id, { ...prev, count: l.count }); updated++; }
    }
    const merged = [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); // deterministic order
    return { merged, added, updated, dropped };
  } catch { return { merged: [...(Array.isArray(local) ? local : [])], added: 0, updated: 0, dropped: 0 }; }
}

export interface FlywheelMetric { totalQueries: number; inherited: number; hitRate: number }
/** The compounding number: fraction of queries answered by an INHERITED lesson
 *  (one from a peer, not locally generated). Pure + total. */
export function flywheelMetric(queries: ReadonlyArray<string>, merged: ReadonlyArray<Lesson>, localIds: ReadonlySet<string>): FlywheelMetric {
  try {
    const byTopic = new Set((Array.isArray(merged) ? merged : []).map((l) => l.topicHash));
    const inheritedTopics = new Set((Array.isArray(merged) ? merged : []).filter((l) => !localIds.has(l.id)).map((l) => l.topicHash));
    let inherited = 0; const qs = Array.isArray(queries) ? queries : [];
    for (const q of qs) { const th = h12(String(q).toLowerCase().trim()); if (byTopic.has(th) && inheritedTopics.has(th)) inherited++; }
    const n = qs.length || 1;
    return { totalQueries: qs.length, inherited, hitRate: Math.round((inherited / n) * 1e4) / 1e4 };
  } catch { return { totalQueries: 0, inherited: 0, hitRate: 0 }; }
}

/** Does a shared bundle leak any raw content? (privacy invariant check). Total. */
export function bundleLeaksRaw(bundle: { lessons: Lesson[] }, rawNeedles: ReadonlyArray<string>): boolean {
  try {
    const blob = JSON.stringify(bundle).toLowerCase();
    return (Array.isArray(rawNeedles) ? rawNeedles : []).some((r) => r && blob.includes(String(r).toLowerCase()));
  } catch { return true; } // fail-closed: if we can't prove it's clean, treat as leaking
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface MyceliumGauntlet {
  extractsContentFreeLessons: boolean;
  privacyInvariantNoRawLeak: boolean;   // the load-bearing guarantee
  sharesNegativeKnowledge: boolean;     // failed lessons shared too (moat #4)
  mergeIsCommutative: boolean;
  mergeIsIdempotent: boolean;
  forgedBundleDropped: boolean;
  dpNoiseBounded: boolean;
  compoundingMeasured: boolean;         // inherited lessons raise the hit-rate
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function myceliumGauntlet(): MyceliumGauntlet {
  const rawSecret = "AKIAEXAMPLESECRETKEY";
  const localOutcomes: LocalOutcome[] = [
    { topic: "fix flaky auth test", approach: `retry with backoff token=${rawSecret}`, kind: "worked", count: 3 },
    { topic: "speed up payment", approach: "add redis cache", kind: "worked", count: 2 },
    { topic: "speed up payment", approach: "await inside loop", kind: "failed", count: 4 },  // negative knowledge
  ];
  const local = extractLessons(localOutcomes, "nodeA");
  const extractsContentFreeLessons = local.length === 3 && local.every((l) => /^[0-9a-f]{16}$/.test(l.topicHash) && /^[0-9a-f]{16}$/.test(l.signalHash));
  const sharesNegativeKnowledge = local.some((l) => l.kind === "failed" && l.count === 4);

  // privacy: the shared bundle must NOT contain the raw secret or raw topic text
  const bundle = buildBundle(local, { epsilon: 1, sample: () => 0 });
  const privacyInvariantNoRawLeak = !bundleLeaksRaw(bundle, [rawSecret, "redis cache", "flaky auth test", "await inside loop"]);

  // CRDT: commutative + idempotent
  const peer = extractLessons([{ topic: "rotate keys safely", approach: "use vault", kind: "worked", count: 5 }], "nodeB");
  const ab = mergeBundles(local, peer).merged;
  const ba = mergeBundles(peer, local).merged;
  const mergeIsCommutative = JSON.stringify(ab) === JSON.stringify(ba);
  const once = mergeBundles(local, peer).merged;
  const twice = mergeBundles(once, peer).merged;
  const mergeIsIdempotent = JSON.stringify(once) === JSON.stringify(twice);

  // forged dropped (verifier rejects lessons whose source isn't trusted)
  const forged: Lesson = { ...peer[0]!, id: h12("forged"), source: "evil" };
  const dropRes = mergeBundles(local, [peer[0]!, forged], (l) => l.source !== "evil");
  const forgedBundleDropped = dropRes.dropped === 1 && !dropRes.merged.some((l) => l.source === "evil");

  // DP noise bounded: with a unit Laplace sample, |noised - true| ≤ a few * scale
  const dpNoiseBounded = noiseCount(10, 1, 0) === 10 && Math.abs(noiseCount(10, 1, 2) - 10) <= 6 && noiseCount(10, 1, -100) >= 0;

  // compounding: nodeA inherits nodeB's lesson → a query on nodeB's topic now hits
  const localIds = new Set(local.map((l) => l.id));
  const m0 = flywheelMetric(["rotate keys safely"], local, localIds);            // before inherit: 0
  const m1 = flywheelMetric(["rotate keys safely"], mergeBundles(local, peer).merged, localIds); // after: 1
  const compoundingMeasured = m0.inherited === 0 && m1.inherited === 1 && m1.hitRate === 1;

  const deterministic = JSON.stringify(extractLessons(localOutcomes, "nodeA")) === JSON.stringify(extractLessons(localOutcomes, "nodeA"));

  let total = true;
  try {
    extractLessons(null as unknown as LocalOutcome[]);
    buildBundle(null as unknown as Lesson[]);
    mergeBundles(null as unknown as Lesson[], undefined as unknown as Lesson[]);
    flywheelMetric(null as unknown as string[], null as unknown as Lesson[], new Set());
    bundleLeaksRaw(null as unknown as { lessons: Lesson[] }, null as unknown as string[]);
    noiseCount(NaN, NaN, NaN);
  } catch { total = false; }

  const all = extractsContentFreeLessons && privacyInvariantNoRawLeak && sharesNegativeKnowledge && mergeIsCommutative && mergeIsIdempotent && forgedBundleDropped && dpNoiseBounded && compoundingMeasured && deterministic && total;
  return { extractsContentFreeLessons, privacyInvariantNoRawLeak, sharesNegativeKnowledge, mergeIsCommutative, mergeIsIdempotent, forgedBundleDropped, dpNoiseBounded, compoundingMeasured, deterministic, total, score: all ? 100 : 0 };
}

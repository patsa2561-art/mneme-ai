/**
 * Time-scrub transformations.
 *
 * Given the canonical NervousSystemData and a scrub timestamp `t`, produce a
 * "view at time t" — authors who hadn't joined yet vanish, telepathy edges
 * that haven't formed yet are gone, atrophy is recomputed at t (instead of now).
 *
 * The math is intentionally simple/cheap so dragging the scrubber stays at
 * 60fps even on a laptop trackpad.
 */

import type { NervousSystemData, PassportData, TelepathyPair } from "../types";

export interface TimeBounds {
  min: number;
  max: number;
}

/**
 * Compute the temporal range [earliest signal, latest signal] across the data.
 * We look at passport identity dates + telepathy lastSeen + meta.generatedAt
 * and fall back to a sensible default if none of those are present.
 */
export function computeTimeBounds(data: NervousSystemData | null): TimeBounds | null {
  if (!data) return null;
  const samples: number[] = [];
  for (const p of data.passports ?? []) {
    const from = parseTime(p.identity.fromDate);
    const to = parseTime(p.identity.toDate);
    if (from !== null) samples.push(from);
    if (to !== null) samples.push(to);
    const last = parseTime(p.expertise.lastActiveAt);
    if (last !== null) samples.push(last);
  }
  for (const t of data.telepathy?.pairs ?? []) {
    const ts = parseTime(t.lastSeenAt);
    if (ts !== null) samples.push(ts);
  }
  const generated = parseTime(data.meta.generatedAt);
  if (generated !== null) samples.push(generated);

  if (samples.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    // Widen a hair so the scrubber is never zero-width.
    const fallbackMax = max === -Infinity ? Date.now() : max;
    return { min: fallbackMax - 90 * 86_400_000, max: fallbackMax };
  }
  return { min, max };
}

function parseTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Produce a temporal slice of the data at moment `t`. The returned object
 * has the same shape; views render it directly.
 *
 * What we change at time t:
 *   - passports: drop any author whose `identity.fromDate > t`
 *   - expertise: re-decay every file using half-life from `meta.halfLifeDays`
 *     and the difference between `t` and the file's last touch
 *   - telepathy.pairs: drop pairs whose `lastSeenAt > t`
 *   - alphas + atrophy.criticalFiles: filtered to live authors only
 *   - hero metrics: not re-aggregated (not enough info in the JSON) — we
 *     instead substitute a "as of <date>" subtitle so the hero stays honest
 */
export function scrubData(
  data: NervousSystemData,
  t: number,
): NervousSystemData {
  const halfLifeDays = Math.max(1, data.meta.halfLifeDays || 60);
  const aliveEmails = new Set<string>();
  const passports: PassportData[] = [];
  for (const p of data.passports ?? []) {
    const joined = parseTime(p.identity.fromDate) ?? t;
    if (joined > t) continue;
    aliveEmails.add(p.identity.email.toLowerCase());
    passports.push(decayPassport(p, t, halfLifeDays));
  }

  const pairs: TelepathyPair[] = (data.telepathy?.pairs ?? []).filter((pair) => {
    const ts = parseTime(pair.lastSeenAt) ?? t;
    if (ts > t) return false;
    return (
      aliveEmails.has(pair.authorA.email.toLowerCase()) &&
      aliveEmails.has(pair.authorB.email.toLowerCase())
    );
  });

  const alphas = (data.alphas ?? []).filter((a) =>
    aliveEmails.has(a.email.toLowerCase()),
  );

  // Critical files: we don't re-decay because the JSON's `freshestKnowledge`
  // is "as-of-generation"; we just narrow to the authors who are present.
  const criticalFiles = data.atrophy.criticalFiles.filter((f) => {
    if (!f.topKnower) return true;
    return aliveEmails.has(f.topKnower.email.toLowerCase());
  });

  const distinctAuthorsInGrid = new Set<string>();
  for (const p of pairs) {
    distinctAuthorsInGrid.add(p.authorA.email.toLowerCase());
    distinctAuthorsInGrid.add(p.authorB.email.toLowerCase());
  }

  return {
    ...data,
    passports,
    alphas,
    telepathy: {
      ...data.telepathy,
      pairs,
      distinctAuthorsInGrid: distinctAuthorsInGrid.size,
    },
    atrophy: {
      ...data.atrophy,
      criticalFiles,
    },
  };
}

/**
 * Re-decay every expertise file in a passport given moment `t`.
 *
 * Knowledge model (mirrors core/atrophy semantics):
 *   knowledge(t) = familiarity(touches) × decay(daysSince)
 *   decay = exp(-days * ln(2) / halfLife)
 *   familiarity = 1 - exp(-touches/5)
 *
 * The original JSON gives us `lastTouchDaysAgo` relative to `meta.generatedAt`,
 * so we recover the absolute moment and re-decay against `t` (which may be
 * earlier — knowledge can never be "more decayed than the original" but it
 * can be fresher in the past, which is the point of the scrub).
 */
function decayPassport(p: PassportData, t: number, halfLifeDays: number): PassportData {
  const generatedMs = parseTime(p.meta.generatedAt) ?? t;
  const halfMs = halfLifeDays * 86_400_000;
  const ln2 = Math.LN2;
  const top = p.expertise.topFiles.map((f) => {
    const touchedMs = generatedMs - f.lastTouchDaysAgo * 86_400_000;
    const daysFromT = Math.max(0, (t - touchedMs) / 86_400_000);
    const decay = Math.exp((-daysFromT * ln2) / halfLifeDays);
    const fam = 1 - Math.exp(-f.touchCount / 5);
    const k = Math.max(0, Math.min(1, decay * fam));
    return {
      ...f,
      knowledge: round3(k),
      lastTouchDaysAgo: Math.max(0, Math.round(daysFromT)),
      band: bandFor(k),
    } as PassportData["expertise"]["topFiles"][number];
  });
  // Total knowledge mass = sum of file knowledge × (1 + log(touches))
  let mass = 0;
  for (const f of top) mass += f.knowledge * (1 + Math.log(1 + f.touchCount));
  const lastActiveAt = new Date(
    Math.min(t, parseTime(p.expertise.lastActiveAt) ?? t),
  ).toISOString();
  void halfMs; // exposed for tooling, used implicitly via halfLifeDays
  return {
    ...p,
    expertise: {
      ...p.expertise,
      topFiles: top,
      knowledgeMass: round3(mass),
      lastActiveAt,
      filesStillFresh: top.filter((f) => f.knowledge >= 0.5).length,
    },
  };
}

function bandFor(k: number): "fresh" | "warm" | "fading" | "ghosted" {
  if (k >= 0.7) return "fresh";
  if (k >= 0.4) return "warm";
  if (k >= 0.15) return "fading";
  return "ghosted";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Format a UNIX-ms moment as "MMM d, yyyy". Pure helper used by the scrubber. */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

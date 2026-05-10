/**
 * Mneme Antivirus -- the scan engine.
 *
 * Runs all vaccines in the active pharmacopoeia against a draft, returns
 * the list of confirmed infections (with evidence + cures) plus a summary.
 * Persists a per-scan record into stats.json so the realtime Lab dashboard
 * can render the activity feed.
 */

import { randomUUID, createHash } from "node:crypto";
import type { Vaccine, SuspectClaim, VaccineCache, AssayResult, ScanSummary } from "./types.js";
import { compilePatterns, listStrains } from "./strains.js";
import { SEED_VACCINES, buildCache } from "./vaccines.js";
import { recordScan } from "./stats.js";

export interface ScanResult {
  scanId: string;
  ranAt: string;
  draftLengthChars: number;
  /** All assay results (infected + clean), grouped by strain. */
  assays: AssayResult[];
  /** Subset of assays where infected=true. */
  infections: AssayResult[];
  /** 0..1 risk score = avg surface confidence × infection rate. */
  riskScore: number;
  /** Per-strain infection counts. */
  byStrain: Record<string, number>;
  /** Total ms for the whole scan. */
  totalMs: number;
  /** Vaccines that were actually invoked. */
  vaccinesUsed: string[];
}

export interface ScanOptions {
  /** Override the active vaccine set. Default: all SEED_VACCINES. */
  vaccines?: Vaccine[];
  /** Pre-built cache. If omitted, scan() builds one. */
  cache?: VaccineCache;
  /** When true, persist a stats record. Default true. */
  recordStats?: boolean;
}

/** Extract suspect claims from `draft` for every strain we know about. */
export function extractSuspects(draft: string): SuspectClaim[] {
  const out: SuspectClaim[] = [];
  for (const strain of listStrains()) {
    const patterns = compilePatterns(strain.id);
    // v1.27.8 (BUGFIX): the `seen` Set was scoped INSIDE the pattern
    // loop, so two patterns of the same strain that both matched the
    // same substring produced TWO suspect claims (and two infections
    // post-vaccine). User-reported: src/auth/legacy.ts surfaced twice.
    // Now `seen` lives at the strain scope, so we dedup across all
    // patterns of the same strain. Key = strain|normalisedMatch (case-
    // insensitive trim) -- different offsets of the same surface text
    // collapse into one suspect, regardless of which pattern matched.
    const seen = new Set<string>();
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(draft)) !== null) {
        const match = m[0];
        if (!match) {
          if (re.lastIndex === m.index) re.lastIndex++;
          continue;
        }
        const key = `${strain.id}|${match.trim().toLowerCase()}`;
        if (seen.has(key)) {
          if (re.lastIndex === m.index) re.lastIndex++;
          continue;
        }
        seen.add(key);
        out.push({
          strain: strain.id,
          match,
          offset: m.index,
          surfaceConfidence: 0.7,
        });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    }
  }
  return out;
}

/** Run all vaccines against a draft. Returns a ScanResult. */
export async function scan(
  repoRoot: string,
  draft: string,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const t0 = Date.now();
  const scanId = randomUUID();
  const vaccines = opts.vaccines ?? SEED_VACCINES;
  const cache = opts.cache ?? buildCache(repoRoot);
  // Side-channel for vaccines that need the full draft (logica_circularis).
  (globalThis as { __mnemeCurrentDraft?: string }).__mnemeCurrentDraft = draft;

  const suspects = extractSuspects(draft);

  // Group suspects by strain so we run the right vaccine on each.
  const byStrain = new Map<string, SuspectClaim[]>();
  for (const s of suspects) {
    const arr = byStrain.get(s.strain) ?? [];
    arr.push(s);
    byStrain.set(s.strain, arr);
  }

  const vaccineByStrain = new Map<string, Vaccine>();
  for (const v of vaccines) vaccineByStrain.set(v.strain, v);

  const assays: AssayResult[] = [];
  for (const [strain, claims] of byStrain) {
    const vac = vaccineByStrain.get(strain);
    if (!vac) continue;
    for (const claim of claims) {
      const aT0 = Date.now();
      try {
        const r = await vac.assay(claim, { repoRoot, cache });
        assays.push({ claim, infected: r.infected, evidence: r.evidence, cure: r.cure, assayMs: Date.now() - aT0 });
      } catch (e) {
        assays.push({
          claim,
          infected: false,
          evidence: `vaccine ${vac.id} threw: ${(e as Error).message}`,
          assayMs: Date.now() - aT0,
        });
      }
    }
  }

  const infections = assays.filter((a) => a.infected);
  const byStrainInfections: Record<string, number> = {};
  for (const a of infections) {
    byStrainInfections[a.claim.strain] = (byStrainInfections[a.claim.strain] ?? 0) + 1;
  }
  const riskScore = assays.length === 0
    ? 0
    : (infections.length / assays.length) * (assays.reduce((s, a) => s + a.claim.surfaceConfidence, 0) / assays.length);

  const summary: ScanSummary = {
    scanId,
    ranAt: new Date(t0).toISOString(),
    draftLengthChars: draft.length,
    claimsExamined: assays.length,
    infections: infections.length,
    totalMs: Date.now() - t0,
    vaccinesUsed: vaccines.map((v) => v.id),
  };
  if (opts.recordStats !== false) {
    try { recordScan(repoRoot, summary, byStrainInfections); } catch { /* best-effort */ }
  }

  return {
    scanId,
    ranAt: summary.ranAt,
    draftLengthChars: draft.length,
    assays,
    infections,
    riskScore,
    byStrain: byStrainInfections,
    totalMs: summary.totalMs,
    vaccinesUsed: summary.vaccinesUsed,
  };
}

/** Produce a deterministic short hash of a draft (for de-dup, idempotency). */
export function draftFingerprint(draft: string): string {
  return createHash("sha256").update(draft).digest("hex").slice(0, 16);
}

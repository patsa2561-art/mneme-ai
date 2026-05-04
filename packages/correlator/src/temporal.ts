import { createHash } from "node:crypto";
import type {
  Commit,
  Correlation,
  Incident,
  correlate as CorrelateNS,
} from "@mneme-ai/core";

/**
 * Temporal + structural correlation engine.
 *
 * For each (commit, incident) pair where the incident occurred within `windowMs`
 * after the commit, score by:
 *   1. temporal proximity (closer = stronger)
 *   2. file overlap (commit's files vs incident.affectedFiles ∪ stack frames)
 *
 * Semantic correlation (commit message vs stack trace embeddings) is layered on
 * top by future versions — it requires an embedder, which this engine does not.
 */
export class TemporalCorrelationEngine implements CorrelateNS.CorrelationEngine {
  readonly name = "temporal-structural-v1";

  constructor(
    private readonly defaults: {
      windowMs?: number;
      minWeight?: number;
      /** Fraction of weight assigned to file-overlap (rest goes to temporal). 0..1. */
      fileOverlapWeight?: number;
    } = {},
  ) {}

  async correlate(input: CorrelateNS.CorrelateInput): Promise<Correlation[]> {
    const windowMs =
      input.windowMs ??
      this.defaults.windowMs ??
      // 7 days
      7 * 24 * 60 * 60 * 1000;
    const minWeight = this.defaults.minWeight ?? 0.15;
    const overlapWeight = clamp01(this.defaults.fileOverlapWeight ?? 0.4);
    const temporalWeight = 1 - overlapWeight;

    const out: Correlation[] = [];
    const sortedCommits = [...input.commits].sort(byDate);

    for (const inc of input.incidents) {
      const incidentTime = parseTime(inc.occurredAt);
      if (!Number.isFinite(incidentTime)) continue;
      const windowStart = incidentTime - windowMs;
      const incidentFiles = new Set([
        ...(inc.affectedFiles ?? []),
        ...(inc.stackFrames?.map((f) => normalizePath(f.file)) ?? []),
      ]);

      for (const c of sortedCommits) {
        const ct = parseTime(c.authorDate);
        if (!Number.isFinite(ct)) continue;
        if (ct > incidentTime) break;
        if (ct < windowStart) continue;

        const temporal = 1 - (incidentTime - ct) / windowMs;
        const overlap = computeFileOverlap(c.files, incidentFiles);
        // Convex combination: weight ∈ [0, 1], no saturation, monotonic in both inputs.
        const weight = clamp01(temporal * temporalWeight + overlap * overlapWeight);
        if (weight < minWeight) continue;

        const reason = buildReason(temporal, overlap, c, inc);
        out.push({
          id: hashId([c.hash, inc.id]),
          fromKind: "commit",
          fromId: c.hash,
          toKind: "incident",
          toId: inc.id,
          weight: round3(weight),
          reason,
          evidence: [c.hash, inc.id],
        });
      }
    }

    return out;
  }
}

function buildReason(temporal: number, overlap: number, c: Commit, inc: Incident): string {
  const parts: string[] = [];
  parts.push(
    `Incident "${inc.title}" occurred ${humanDelta(c.authorDate, inc.occurredAt)} after commit ${c.shortHash || c.hash.slice(0, 7)}.`,
  );
  if (overlap > 0) {
    parts.push(`File overlap score: ${round2(overlap)}.`);
  } else {
    parts.push("No direct file overlap; correlation is purely temporal.");
  }
  parts.push(`Temporal score: ${round2(temporal)}.`);
  return parts.join(" ");
}

function computeFileOverlap(commitFiles: string[], incidentFiles: Set<string>): number {
  if (!commitFiles.length || !incidentFiles.size) return 0;
  const cset = new Set(commitFiles.map(normalizePath));
  let hits = 0;
  for (const f of cset) if (incidentFiles.has(f)) hits++;
  return hits / Math.min(cset.size, incidentFiles.size);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function parseTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function humanDelta(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function hashId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
function byDate(a: Commit, b: Commit): number {
  return Date.parse(a.authorDate) - Date.parse(b.authorDate);
}

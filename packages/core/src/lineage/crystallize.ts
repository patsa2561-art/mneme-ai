/**
 * Crystallize — turn the live working memory of an MCP session into a
 * persistent, signed Chromosome. Called automatically on:
 *   - process exit (SIGTERM / SIGINT / uncaught)
 *   - idle timeout (default 45 min of no MCP calls)
 *   - context-pressure checkpoint (manual or auto via heuristic)
 *   - explicit `mneme.lineage.crystallize` invocation
 *
 * Performance budget:
 *   - synchronous part (build chromosome, sign, write) must be < 2s
 *     even on a noisy session (10K atoms, 1K molecules)
 *   - PII scrub is the dominant cost; we limit to the human-language
 *     fields (topic, voice phrases, court claims)
 */

import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { machineFingerprint, persistChromosome, buildChromosomeId } from "./chromosome.js";
import { scrubDeep } from "./pii_scrub.js";
import { snapshotForChromosome as antivirusSnapshot } from "../antivirus/lineage_vaccines.js";
import {
  flushToDisk,
  getSnapshot,
  summarizeMolecules,
  topTopics,
} from "./working_memory.js";

/** Best-effort wrapper -- antivirus may not be initialized yet on a
 *  fresh install; never throw from crystallize because of it. */
function snapshotVaccinesForChromosome(repoRoot: string): ReturnType<typeof antivirusSnapshot> | undefined {
  try { return antivirusSnapshot(repoRoot); } catch { return undefined; }
}
import type { Chromosome, ConstitutionCandidate, VoiceFingerprint } from "./types.js";

export interface CrystallizeOptions {
  endReason: Chromosome["session"]["endReason"];
  /** Optional — if not passed, derived from the current session state. */
  topic?: string;
  /** Optional explicit parents (defaults to lineage.head). */
  parents?: string[];
  /** Whether to PII-scrub the output. Default true. */
  scrub?: boolean;
}

export interface CrystallizeResult {
  chromosome: Chromosome;
  /** Bytes written to disk. */
  bytes: number;
  /** Total CPU time (ms). */
  durationMs: number;
}

const NOOP_FINGERPRINT: VoiceFingerprint = { avgSentenceLen: 0, topPhrases: [], topTopics: [] };

/** Crystallize the active session. Returns null if no session is active. */
export function crystallize(repoRoot: string, opts: CrystallizeOptions): CrystallizeResult | null {
  const start = Date.now();
  const snap = getSnapshot();
  if (!snap) return null;

  // Force one final flush so the working JSONL mirrors the in-memory snapshot.
  flushToDisk(repoRoot);

  const molecules = summarizeMolecules(snap, 2);
  const topics = topTopics(snap, 3);
  const topic = opts.topic ?? topics[0] ?? "ad-hoc session";

  const confessAgg = aggregateConfess(snap);
  const fingerprint: VoiceFingerprint = {
    avgSentenceLen: 0, // populated by future LLM-aware probe; fine as 0 for v1.19
    topPhrases: [],
    topTopics: topics,
  };

  const constitutionCandidates = deriveConstitutionCandidates(snap);

  const createdAt = new Date().toISOString();
  // Short hash of session ID + topic for the chromosome ID.
  const shortHash = createHash("sha256")
    .update(snap.sessionId)
    .update("|")
    .update(topic)
    .update("|")
    .update(createdAt)
    .digest("hex")
    .slice(0, 8);
  const id = buildChromosomeId(createdAt, snap.vendor, shortHash);

  const machineId = snap.machineId || machineFingerprint(repoRoot) || hostname();

  const draft: Omit<Chromosome, "contentHash" | "signature" | "signedBy"> = {
    schemaVersion: 1,
    id,
    createdAt,
    vendor: snap.vendor,
    machineId,
    parents: opts.parents ?? [],
    vectorClock: { [machineId]: 1 },
    topic,
    atomKarmaDeltas: Object.fromEntries(snap.atoms),
    molecules,
    courtVerdicts: snap.courtVerdicts,
    confessOutcomes: confessAgg,
    voiceFingerprint: fingerprint,
    constitutionCandidates,
    lethalRecessives: [...snap.lethalRecessives],
    // v1.24.0 -- snapshot the active vaccine inventory so children
    // sessions inherit (Lamarckian).
    vaccineSignatures: snapshotVaccinesForChromosome(repoRoot),
    session: {
      startedAt: snap.startedAt,
      endedAt: createdAt,
      totalCalls: snap.totalCalls,
      endReason: opts.endReason,
    },
  };

  // PII scrub the human-language surface (NOT the structured atom map —
  // tool names are public and karma counts have no PII).
  const scrubbed: typeof draft = opts.scrub === false
    ? draft
    : {
        ...draft,
        topic: scrubDeep(draft.topic),
        courtVerdicts: scrubDeep(draft.courtVerdicts),
        constitutionCandidates: scrubDeep(draft.constitutionCandidates),
        voiceFingerprint: scrubDeep(draft.voiceFingerprint),
      };

  const chromosome = persistChromosome(repoRoot, scrubbed);
  const bytes = JSON.stringify(chromosome).length;
  const durationMs = Date.now() - start;
  return { chromosome, bytes, durationMs };
}

function aggregateConfess(snap: NonNullable<ReturnType<typeof getSnapshot>>): Chromosome["confessOutcomes"] {
  const out = { verified: 0, partiallyVerified: 0, hallucination: 0, unverifiable: 0, avgSelfConfidence: 0 };
  if (snap.confessRecords.length === 0) return out;
  let confSum = 0;
  for (const r of snap.confessRecords) {
    if (r.verdict === "verified") out.verified += 1;
    else if (r.verdict === "partially_verified") out.partiallyVerified += 1;
    else if (r.verdict === "hallucination") out.hallucination += 1;
    else out.unverifiable += 1;
    confSum += r.selfConfidence;
  }
  out.avgSelfConfidence = Math.round((confSum / snap.confessRecords.length) * 1000) / 1000;
  return out;
}

/** Heuristic constitution candidates from co-fire patterns:
 *  - Atoms that ALWAYS appear together in this session → "always pair X with Y"
 *  - Atoms with very high karma → "X is a load-bearing tool for this work" */
function deriveConstitutionCandidates(snap: NonNullable<ReturnType<typeof getSnapshot>>): ConstitutionCandidate[] {
  const out: ConstitutionCandidate[] = [];
  for (const [pair, fires] of snap.coFires) {
    const [a, b] = pair.split("|");
    if (!a || !b) continue;
    const aInv = snap.atoms.get(a)?.invocations ?? 0;
    const bInv = snap.atoms.get(b)?.invocations ?? 0;
    if (aInv === 0 || bInv === 0) continue;
    const overlap = fires / Math.min(aInv, bInv);
    if (overlap >= 0.8 && fires >= 3) {
      out.push({
        rule: `Always pair ${a} with ${b} (overlap ${Math.round(overlap * 100)}% over ${fires} co-fires)`,
        confidence: Math.min(1, overlap),
        evidence: [a, b],
      });
    }
  }
  return out.slice(0, 10);
}

void NOOP_FINGERPRINT;

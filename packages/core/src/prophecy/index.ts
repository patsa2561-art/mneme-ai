/**
 * v2.0.0 -- PROPHECY LETTERS · time-locked cross-version messages
 *
 * Mneme v2.0 writes a letter to its future self (or to a different
 * machine running a different Mneme version). The letter is sealed
 * with the user's HMAC secret + a target-version gate. When a future
 * Mneme version that meets the gate opens the letter, it can grade
 * its past self's predictions:
 *
 *   "Past Mneme (v2.0, 2026-05-13) predicted: 'by v2.5 we'll have
 *    real IBM Quantum wiring.' Current Mneme (v2.5, 2026-09-01) checks
 *    its own state: TRUE. Time-consistency score updated."
 *
 * Pure function. Deterministic. Composable with PASSPORT + audit log.
 */

import { createHmac, createHash } from "node:crypto";

export interface Prophecy {
  /** Stable id. */
  id: string;
  /** Version (semver-ish) that wrote the letter. */
  fromVersion: string;
  /** Minimum semver-ish version that may open the letter. */
  toMinVersion: string;
  /** Wall-clock when sealed. */
  sealedAt: number;
  /** Earliest wall-clock at which the letter may be opened. */
  earliestOpenAt: number;
  /** Free-form letter body. */
  text: string;
  /** Topics — used by grading later. */
  predictions: Array<{ topic: string; claim: string; verifyHint: string }>;
  /** HMAC signature over (fromVersion || toMinVersion || sealedAt || earliestOpenAt || text || predictions). */
  signature: string;
  /** Public key fingerprint. */
  keyFingerprint: string;
}

export interface SealInput {
  fromVersion: string;
  toMinVersion: string;
  text: string;
  predictions: Array<{ topic: string; claim: string; verifyHint: string }>;
  /** Earliest wall-clock to permit opening. Default sealedAt + 30 days. */
  earliestOpenAt?: number;
  /** HMAC secret. */
  secret: Buffer;
}

function fpSecret(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function computeSig(p: Omit<Prophecy, "signature" | "id" | "keyFingerprint">, secret: Buffer): string {
  const h = createHmac("sha256", secret);
  h.update([p.fromVersion, p.toMinVersion, p.sealedAt, p.earliestOpenAt, p.text, JSON.stringify(p.predictions)].join("|"));
  return h.digest("hex");
}

export function sealProphecy(input: SealInput): Prophecy {
  const sealedAt = Date.now();
  const earliestOpenAt = input.earliestOpenAt ?? sealedAt + 30 * 24 * 60 * 60 * 1000;
  const base = {
    fromVersion: input.fromVersion,
    toMinVersion: input.toMinVersion,
    sealedAt,
    earliestOpenAt,
    text: input.text,
    predictions: input.predictions,
  };
  const signature = computeSig(base, input.secret);
  const id = createHash("sha256").update(`${input.fromVersion}|${sealedAt}|${signature.slice(0, 16)}`).digest("hex").slice(0, 12);
  return { id, ...base, signature, keyFingerprint: fpSecret(input.secret) };
}

export type ProphecyVerdict = "SEALED" | "OPENABLE" | "TAMPERED" | "WRONG_KEY";

export interface UnsealResult {
  verdict: ProphecyVerdict;
  reason: string;
  prophecy?: Prophecy;
}

function semverGe(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}

export interface UnsealInput {
  prophecy: Prophecy;
  currentVersion: string;
  secret: Buffer;
  now?: number;
}

export function unsealProphecy(input: UnsealInput): UnsealResult {
  const now = input.now ?? Date.now();
  if (fpSecret(input.secret) !== input.prophecy.keyFingerprint) {
    return { verdict: "WRONG_KEY", reason: `secret fingerprint mismatch` };
  }
  if (!semverGe(input.currentVersion, input.prophecy.toMinVersion)) {
    return { verdict: "SEALED", reason: `current version ${input.currentVersion} < required ${input.prophecy.toMinVersion}` };
  }
  if (now < input.prophecy.earliestOpenAt) {
    return { verdict: "SEALED", reason: `time-lock not expired (open at ${new Date(input.prophecy.earliestOpenAt).toISOString()})` };
  }
  const { signature: _drop, id: _drop2, keyFingerprint: _drop3, ...rest } = input.prophecy;
  void _drop; void _drop2; void _drop3;
  const expected = computeSig(rest, input.secret);
  if (expected !== input.prophecy.signature) {
    return { verdict: "TAMPERED", reason: `signature mismatch` };
  }
  return { verdict: "OPENABLE", reason: "all checks pass", prophecy: input.prophecy };
}

export interface GradeInput {
  prophecy: Prophecy;
  /** User's verdict on each prediction: did it come true? */
  observations: Array<{ topic: string; cameTrue: boolean }>;
}

export interface GradeResult {
  total: number;
  correct: number;
  consistency: number; // 0..1
  byTopic: Array<{ topic: string; predicted: string; cameTrue: boolean }>;
}

export function gradeProphecy(input: GradeInput): GradeResult {
  const obsByTopic = new Map<string, boolean>();
  for (const o of input.observations) obsByTopic.set(o.topic, o.cameTrue);
  const byTopic = input.prophecy.predictions.map((p) => ({
    topic: p.topic,
    predicted: p.claim,
    cameTrue: obsByTopic.get(p.topic) ?? false,
  }));
  const correct = byTopic.filter((b) => b.cameTrue).length;
  return {
    total: byTopic.length,
    correct,
    consistency: byTopic.length > 0 ? correct / byTopic.length : 0,
    byTopic,
  };
}

export function formatProphecyPulseLine(p: Prophecy): string {
  return `PROPHECY · ${p.id} · ${p.fromVersion}→${p.toMinVersion} · ${p.predictions.length} predictions`;
}

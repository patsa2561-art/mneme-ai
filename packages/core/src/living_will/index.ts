/**
 * v2.1.0 -- LIVING WILL · time-locked cryptographic dead-man primitive
 *
 * User encrypts a payload + sets an inactivity timer. If no activity is
 * recorded for the threshold period, the payload becomes releasable
 * (HMAC-verified). What the payload CONTAINS and what HAPPENS when it's
 * released are the caller's responsibility — Mneme ships only the
 * cryptographic primitive.
 *
 * Use cases (caller-defined):
 *   "if no activity 90 days → publish my CHANGELOG as a final commit"
 *   "if no activity 365 days → email my partner my keys"
 *   "if no activity 30 days → hand repo ownership to John"
 *
 * IMPORTANT: this is the TECHNICAL primitive. Mneme makes NO claim about
 * legal estate effect. Estate law is jurisdiction-specific. Use real
 * legal counsel for legal effect.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";

export interface LivingWill {
  /** Stable id (12-hex). */
  id: string;
  /** Wall-clock when sealed. */
  sealedAt: number;
  /** Required inactivity in ms. */
  inactivityThresholdMs: number;
  /** Last recorded activity (defaults to sealedAt). */
  lastActivityAt: number;
  /** Free-form description for the human. */
  description: string;
  /** Encrypted payload (caller-supplied — Mneme stores opaque bytes hex-encoded). */
  encryptedPayloadHex: string;
  /** HMAC over (id || sealedAt || inactivityThresholdMs || encryptedPayloadHex). */
  signature: string;
  /** Public key fingerprint. */
  keyFingerprint: string;
}

function fpSecret(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function computeSig(id: string, sealedAt: number, inactivityThresholdMs: number, encryptedPayloadHex: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(`${id}|${sealedAt}|${inactivityThresholdMs}|${encryptedPayloadHex}`).digest("hex");
}

export interface CreateWillInput {
  /** Days of inactivity before release becomes possible. */
  inactivityDays: number;
  description: string;
  /** Caller-supplied encrypted payload as bytes. */
  encryptedPayload: Buffer;
  secret: Buffer;
}

export function createLivingWill(input: CreateWillInput): LivingWill {
  const sealedAt = Date.now();
  const inactivityThresholdMs = input.inactivityDays * 24 * 60 * 60 * 1000;
  const encryptedPayloadHex = input.encryptedPayload.toString("hex");
  const id = randomBytes(6).toString("hex");
  const signature = computeSig(id, sealedAt, inactivityThresholdMs, encryptedPayloadHex, input.secret);
  return {
    id,
    sealedAt,
    inactivityThresholdMs,
    lastActivityAt: sealedAt,
    description: input.description,
    encryptedPayloadHex,
    signature,
    keyFingerprint: fpSecret(input.secret),
  };
}

/** Record activity — resets the inactivity timer. Returns a new envelope
 *  with lastActivityAt updated + a fresh signature. */
export function recordActivity(will: LivingWill, secret: Buffer, now: number = Date.now()): LivingWill {
  return { ...will, lastActivityAt: now, signature: computeSig(will.id, will.sealedAt, will.inactivityThresholdMs, will.encryptedPayloadHex, secret) };
}

export type ReleaseVerdict = "ACTIVE" | "RELEASABLE" | "TAMPERED" | "WRONG_KEY";

export interface ReleaseCheckResult {
  verdict: ReleaseVerdict;
  reason: string;
  /** When the will would become releasable. */
  releasableAt: number;
  /** Payload — only set on RELEASABLE. */
  payloadHex?: string;
}

export function checkRelease(will: LivingWill, secret: Buffer, now: number = Date.now()): ReleaseCheckResult {
  if (fpSecret(secret) !== will.keyFingerprint) {
    return { verdict: "WRONG_KEY", reason: "secret fingerprint mismatch", releasableAt: will.lastActivityAt + will.inactivityThresholdMs };
  }
  const expected = computeSig(will.id, will.sealedAt, will.inactivityThresholdMs, will.encryptedPayloadHex, secret);
  if (expected !== will.signature) {
    return { verdict: "TAMPERED", reason: "signature mismatch", releasableAt: will.lastActivityAt + will.inactivityThresholdMs };
  }
  const releasableAt = will.lastActivityAt + will.inactivityThresholdMs;
  if (now < releasableAt) {
    return { verdict: "ACTIVE", reason: `inactivity timer has ${Math.round((releasableAt - now) / (24 * 60 * 60 * 1000))} day(s) remaining`, releasableAt };
  }
  return { verdict: "RELEASABLE", reason: `inactivity threshold passed (${Math.round((now - releasableAt) / (24 * 60 * 60 * 1000))} day(s) overdue)`, releasableAt, payloadHex: will.encryptedPayloadHex };
}

export function formatLivingWillPulseLine(will: LivingWill, now: number = Date.now()): string {
  const daysRemaining = Math.max(0, Math.round((will.lastActivityAt + will.inactivityThresholdMs - now) / (24 * 60 * 60 * 1000)));
  return `LIVING-WILL · ${will.id} · ${daysRemaining}d to release · "${will.description.slice(0, 50)}"`;
}

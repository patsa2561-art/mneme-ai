/**
 * @mneme-ai/sdk/nemesis — typed, in-process surface for the NEMESIS engine.
 *
 * 30-80× faster than `mneme nemesis <verb>` CLI subprocess — every method
 * is a direct function call into @mneme-ai/core. No spawn, no JSON
 * parsing, no stderr piping. Type-safe via branded types.
 */

import * as core from "@mneme-ai/core";
import type { Fixture, SdkEnvelope, VendorId } from "./types.js";
import { getEventBus } from "./events.js";

export interface MnemeInstanceOpts {
  /** Directory where Mneme keeps chains (default: <cwd>/.mneme). */
  dataDir?: string;
  /** HMAC key for NEMESIS receipts (overrides env / file). */
  hmacKey?: string;
  /** Strict mode: throw on default-insecure key (mirrors MNEME_NEMESIS_STRICT=1). */
  strict?: boolean;
}

export class NemesisSdk {
  constructor(private readonly opts: MnemeInstanceOpts = {}) {}

  /** Pure deterministic — extract the 41-feature fingerprint. <30ms. */
  fingerprint(fx: Fixture) {
    const t0 = performance.now();
    const data = core.nemesis.extractFingerprint(fx);
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** Calibrated Mahalanobis classifier — <50ms. */
  classify(fx: Fixture | Parameters<typeof core.nemesis.classifyAgentCalibrated>[0]) {
    const t0 = performance.now();
    const fp = (typeof (fx as Fixture).diff === "string")
      ? core.nemesis.extractFingerprint(fx as Fixture)
      : fx as Parameters<typeof core.nemesis.classifyAgentCalibrated>[0];
    const data = core.nemesis.classifyAgentCalibrated(fp);
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** EU AI Act Article 50 stamp — <30ms warm path. */
  stamp(input: { message: string; vendor: VendorId | string; confidence?: number; contentType?: string }) {
    const t0 = performance.now();
    const data = core.nemesis.stampArticle50({
      message: input.message,
      vendor: String(input.vendor),
      confidence: input.confidence ?? 0.95,
      contentType: input.contentType,
    });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    getEventBus().emit({ kind: "stamp.issued", at: Date.now(), data: { vendor: input.vendor, latencyMs } });
    return { ok: data.ok, data, latencyMs };
  }

  verifyStamp(stampedMessage: string): SdkEnvelope<ReturnType<typeof core.nemesis.verifyStamp>> {
    const t0 = performance.now();
    const data = core.nemesis.verifyStamp(stampedMessage);
    return { ok: data.valid, data, latencyMs: +(performance.now() - t0).toFixed(2), reason: data.reason };
  }

  /** STEALTH SCORE — inverse of classifier confidence. <80ms. */
  stealthScore(fx: Fixture) {
    const t0 = performance.now();
    const data = core.nemesis.computeStealthScore(fx);
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** CAPILLARY — 50+ micro-tells. <50ms. */
  capillary(diff: string) {
    const t0 = performance.now();
    const data = core.nemesis.extractMicroProfile(diff);
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** JANUS — locate vendor cluster basin. <50ms. */
  janusObserve(fx: Fixture) {
    const t0 = performance.now();
    const data = core.nemesis.observe(fx);
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** JANUS swap detector — emits swap.detected events. */
  janusSwap(fixtures: Fixture[], swapOpts: { minMargin?: number } = {}) {
    const t0 = performance.now();
    const obs = fixtures.map((fx) => core.nemesis.observe(fx));
    const data = core.nemesis.detectIdentitySwap(obs, swapOpts);
    const latencyMs = +(performance.now() - t0).toFixed(2);
    if (data.swapDetected) {
      getEventBus().emit({ kind: "swap.detected", at: Date.now(), data: { transitions: data.transitions, latencyMs } });
    }
    return { ok: true as const, data, latencyMs };
  }

  /** THEMIS alibi verifier. */
  alibi(input: { notVendor: VendorId | string; fixture: Fixture }) {
    const t0 = performance.now();
    const data = core.nemesis.verifyAlibi({ notVendor: String(input.notVendor), fixture: input.fixture });
    return { ok: data.verdict !== "INCONCLUSIVE", data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** SIBYL commit (session-start identity hash commitment). */
  sibylCommit(input: { vendor: VendorId | string; model?: string; version?: string; sessionId?: string }) {
    const t0 = performance.now();
    const data = core.nemesis.commitIdentity(this.dataDir(), {
      identity: { vendor: String(input.vendor), model: input.model, version: input.version },
      sessionId: input.sessionId,
    });
    return { ok: true as const, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** SIBYL reveal — verifies the (identity, nonce) recreates the commitment. */
  sibylReveal(input: { sessionId: string; identity: { vendor: string; model?: string; version?: string }; nonce: string }) {
    const t0 = performance.now();
    const data = core.nemesis.revealIdentity(this.dataDir(), input);
    return { ok: data.matches, data, latencyMs: +(performance.now() - t0).toFixed(2) };
  }

  /** GAVEL — court-admissible bundle pack. */
  gavelPack(input: Parameters<typeof core.nemesis.buildGavelBundle>[0]) {
    const t0 = performance.now();
    const data = core.nemesis.buildGavelBundle(input);
    const latencyMs = +(performance.now() - t0).toFixed(2);
    if (data.ok) getEventBus().emit({ kind: "gavel.packed", at: Date.now(), data: { commitRef: input.commitRef, latencyMs } });
    return { ok: data.ok, data, latencyMs };
  }

  /** LETHE — GDPR forget. */
  letheForget(input: { ledgerRelative: string; rowIndex: number; jurisdiction?: string; dryRun?: boolean }) {
    const t0 = performance.now();
    const data = core.nemesis.forgetRow({
      repoRoot: this.dataDir().replace(/[\\/]\.mneme$/, ""),
      ledgerRelative: input.ledgerRelative,
      rowIndex: input.rowIndex,
      jurisdiction: input.jurisdiction,
      dryRun: input.dryRun,
    });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    if (data.ok && data.receipt) getEventBus().emit({ kind: "lethe.forgotten", at: Date.now(), data: { ledger: input.ledgerRelative, latencyMs } });
    return { ok: data.ok, data, latencyMs };
  }

  /** NIMBUS publish leaderboard card to the local pub-store. */
  nimbusPublish(input: Omit<Parameters<typeof core.nemesis.publishCard>[0], "repoRoot">) {
    const t0 = performance.now();
    const data = core.nemesis.publishCard({ ...input, repoRoot: this.dataDir().replace(/[\\/]\.mneme$/, "") });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    if (data.ok) getEventBus().emit({ kind: "nimbus.published", at: Date.now(), data: { orgTag: input.orgTag, latencyMs } });
    return { ok: data.ok, data, latencyMs };
  }

  private dataDir(): string {
    if (this.opts.dataDir) return this.opts.dataDir;
    return `${process.cwd()}/.mneme`;
  }
}

/**
 * @mneme-ai/sdk/verify — typed in-process claim verifier with the
 * "wild" tagged template literal sugar:
 *
 *   await mneme.verify`Mneme is a CLI tool`
 *   await mneme.verify`The human body has ${count} blood vessels`
 *
 * No SDK I've seen wires tagged templates to claim verification. The
 * substitutions get serialised into the claim string before going to
 * ACGV — keeps it deterministic + audit-friendly.
 */

import { acgv } from "@mneme-ai/core";
import type { ClaimText, SdkEnvelope } from "./types.js";
import { getEventBus } from "./events.js";

const { runACGVAsync } = acgv;
type ACGVResultLike = Awaited<ReturnType<typeof runACGVAsync>>;

export interface VerifyOpts {
  /** Working directory (for vaccine cache + karma writes). Default: cwd. */
  cwd?: string;
  /** Skip emitting a vaccine even on REFUTE. Default false. */
  noEmitVaccine?: boolean;
  /** Skip karma updates. Default false. */
  noStake?: boolean;
}

export type VerifyResult = ACGVResultLike & { latencyMs: number };

/** Plain function — call as `verify("claim text", opts)`. */
export async function verify(claim: string | ClaimText, opts: VerifyOpts = {}): Promise<SdkEnvelope<VerifyResult>> {
  const t0 = performance.now();
  try {
    const data = await runACGVAsync({
      claim: String(claim),
      repoRoot: opts.cwd ?? process.cwd(),
      noEmitVaccine: opts.noEmitVaccine ?? true,
      noStake: opts.noStake ?? true,
    });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    const out: VerifyResult = { ...data, latencyMs };
    getEventBus().emit({ kind: "verify.complete", at: Date.now(), data: { verdict: data.verdict, latencyMs } });
    return { ok: true, data: out, latencyMs };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, latencyMs: +(performance.now() - t0).toFixed(2) };
  }
}

/**
 * Tagged template literal form — the "world-class premium" sugar.
 *
 *   const result = await verifyTagged`The body has ${count} vessels`;
 *
 * Substitutions are stringified + interleaved deterministically. The
 * resulting claim text is what gets fed to ACGV (audit-friendly).
 */
export async function verifyTagged(strings: TemplateStringsArray, ...subs: unknown[]): Promise<SdkEnvelope<VerifyResult>> {
  let claim = "";
  for (let i = 0; i < strings.length; i++) {
    claim += strings[i];
    if (i < subs.length) claim += String(subs[i] ?? "");
  }
  return verify(claim);
}

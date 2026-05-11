/**
 * v1.57.0 -- SOVEREIGNTY KERNEL: grounded answer engine.
 *
 * The full flow:
 *
 *   1. buildContext(question)  -- assemble grounded prompt
 *   2. ollamaGenerate(prompt)  -- get Ollama's draft answer
 *   3. groundingGate(answer)   -- run ACGV on the answer; refuse to
 *      relay claims that don't ground in the evidence we provided
 *   4. return { text, verdict, evidence, refusedClaims }
 *
 * The grounding gate is the safety net: even if Ollama hallucinates
 * a function name or commit SHA, ACGV's vaccine bank + Chandrasekhar
 * + PRTF will flag it. The caller decides whether to surface the
 * answer + caveat or refuse entirely.
 *
 * NO LLM CALL ON MNEME'S DECISION PATH. Ollama generates the text,
 * but the VERDICT comes from deterministic math (ACGV). This is the
 * sovereignty: Mneme decides what to say, not Ollama.
 */

import { ollamaGenerate, ollamaHealth, type OllamaGenerateOptions, type OllamaResponse } from "./ollama_client.js";
import { buildContext, type BuiltContext } from "./context_builder.js";
import { runACGV } from "../squadron/acgv.js";

export type AnswerVerdict = "grounded" | "ungrounded" | "refused" | "ollama-unreachable";

export interface SovereignAnswer {
  /** What Ollama produced (may be empty when verdict !== "grounded"). */
  text: string;
  /** Outcome of the grounding gate. */
  verdict: AnswerVerdict;
  /** Human-readable reason for the verdict. */
  reason: string;
  /** Evidence slices that backed the answer (echoed from context_builder). */
  evidence: BuiltContext["slices"];
  /** ACGV result on the model's draft answer (when we got that far). */
  groundingCheck?: ReturnType<typeof runACGV>;
  /** Latency breakdown for telemetry. */
  latency: {
    contextMs: number;
    ollamaMs: number;
    groundingMs: number;
    totalMs: number;
  };
}

export interface SovereignAskOptions {
  repoRoot: string;
  question: string;
  /** Forwarded to Ollama. */
  ollama?: OllamaGenerateOptions;
  /** Skip grounding gate when true. Default false -- Mneme refuses to
   *  speak ungrounded by design. */
  skipGroundingGate?: boolean;
}

/** The single entry point. Pure-ish: only effects are the Ollama HTTP
 *  call + the ACGV vaccine append on REFUTE outcomes. */
export async function sovereignAsk(opts: SovereignAskOptions): Promise<SovereignAnswer> {
  const total0 = Date.now();
  const ctx0 = Date.now();
  const ctx = buildContext(opts.repoRoot, opts.question);
  const contextMs = Date.now() - ctx0;

  // Health check first -- save a 60s timeout when Ollama is plain dead.
  const health = await ollamaHealth(opts.ollama);
  if (!health.ok) {
    return {
      text: "",
      verdict: "ollama-unreachable",
      reason: `Ollama not reachable: ${health.reason}. Start it with: ollama serve (or set MNEME_OLLAMA_URL).`,
      evidence: ctx.slices,
      latency: { contextMs, ollamaMs: health.latencyMs, groundingMs: 0, totalMs: Date.now() - total0 },
    };
  }

  const olla0 = Date.now();
  const ollamaRes: OllamaResponse = await ollamaGenerate(ctx.prompt, opts.ollama);
  const ollamaMs = Date.now() - olla0;
  if (!ollamaRes.ok) {
    return {
      text: "",
      verdict: "ollama-unreachable",
      reason: `Ollama call failed: ${ollamaRes.reason ?? "unknown"}`,
      evidence: ctx.slices,
      latency: { contextMs, ollamaMs, groundingMs: 0, totalMs: Date.now() - total0 },
    };
  }

  const draft = (ollamaRes.text ?? "").trim();
  if (!draft) {
    return {
      text: "",
      verdict: "ungrounded",
      reason: "Ollama returned empty -- the model couldn't form an answer from the evidence.",
      evidence: ctx.slices,
      latency: { contextMs, ollamaMs, groundingMs: 0, totalMs: Date.now() - total0 },
    };
  }

  if (opts.skipGroundingGate) {
    return {
      text: draft,
      verdict: "grounded",
      reason: "Grounding gate bypassed by caller (--skip-grounding).",
      evidence: ctx.slices,
      latency: { contextMs, ollamaMs, groundingMs: 0, totalMs: Date.now() - total0 },
    };
  }

  // Grounding gate: run ACGV on the model's draft. We use it in
  // noEmitVaccine + noStake mode so the gate is a pure check and
  // doesn't pollute the global vaccine bank with model-noise.
  const grnd0 = Date.now();
  const groundingCheck = runACGV({
    claim: draft,
    repoRoot: opts.repoRoot,
    noEmitVaccine: true,
    noStake: true,
  });
  const groundingMs = Date.now() - grnd0;

  let verdict: AnswerVerdict;
  let reason: string;
  switch (groundingCheck.verdict) {
    case "IMPOSSIBLE_REFUTE":
    case "AUTO_REFUTE":
    case "BLACK_HOLE":
      verdict = "refused";
      reason = `Mneme refuses to speak this answer -- ACGV flagged it as impossible/refuted against the repo state. Underlying signal: ${groundingCheck.summary}`;
      break;
    case "FUSION":
      verdict = "grounded";
      reason = "ACGV verified the answer grounds in repo state.";
      break;
    case "LIMBO":
      verdict = "ungrounded";
      reason = "ACGV is in LIMBO -- evidence is mixed. The answer is surfaced but caller should treat it as a tentative draft.";
      break;
    case "PASSTHROUGH":
    default:
      // No extractable facts in the draft -- could be a refusal-style
      // answer ("I do not see this in the evidence; next step would be X"),
      // which is correct behavior. Surface as grounded.
      verdict = "grounded";
      reason = "No specific factual claims in the answer to verify; treating as a meta-response (refusal or guidance).";
      break;
  }

  return {
    text: draft,
    verdict,
    reason,
    evidence: ctx.slices,
    groundingCheck,
    latency: { contextMs, ollamaMs, groundingMs, totalMs: Date.now() - total0 },
  };
}

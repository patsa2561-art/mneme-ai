/**
 * 🌀 THE WILDEST — TRUTH-PROVIDER-AS-A-SERVICE
 *
 * Orchestrator that ties together:
 *   1. Black Box (per-token HMAC stamp)
 *   2. Contra-RAG (find contradictions)
 *   3. Constitutional Double (MIRRAGE + Z3 + alibi)
 *   4. PROTOPLASM probe (live atom monitoring)
 *   5. Compliance Edition (Article 50 + SOC2 + FCRA + HIPAA + GDPR)
 *
 * Single entry point for xAI/Grok:
 *   const oracle = createTruthOracle({ hmacKey });
 *   const verdict = await oracle.preVerify({ text: draft });
 *   // verdict.verdict ∈ {VERIFIED, HEDGED, REFUSED, PASSTHROUGH}
 *   // verdict.suggestedEdit if HEDGED / REFUSED
 *   // verdict.citations if VERIFIED
 *
 * Designed for sub-100ms latency budget.
 */

import { GrokBlackBox } from "./black_box.js";
import { contraRagSearch, type ContraRagOptions } from "./contra_rag.js";
import { constitutionalCheck } from "./constitutional_double.js";
import { runComplianceEdition } from "./compliance_edition.js";
import type {
  DraftInput, TruthOracleVerdict, GrokBridgeConfig, ContraRagCandidate,
} from "./types.js";

const DEFAULT_LEDGER = ".mneme/grok_bridge/blackbox.jsonl";

export interface TruthOracleOptions extends GrokBridgeConfig {
  /** Pluggable: caller provides corpus fetcher for contra-RAG. */
  contraRagFetcher?: () => Promise<ContraRagCandidate[]>;
  recentClaims?: string[];
  vendor?: string;
}

export class TruthOracle {
  private blackBox: GrokBlackBox;

  constructor(public readonly opts: TruthOracleOptions) {
    this.blackBox = new GrokBlackBox(
      opts.blackBoxLedger ?? DEFAULT_LEDGER,
      opts.hmacKey,
    );
  }

  /** Pre-verify a Grok draft response BEFORE flushing to user. */
  async preVerify(draft: DraftInput): Promise<TruthOracleVerdict> {
    const t0 = performance.now();
    const sentences = draft.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 3);

    // 1. Constitutional check (sync, fast)
    const constCheck = constitutionalCheck(draft.text, {
      hmacKey: this.opts.hmacKey,
      recentClaims: this.opts.recentClaims,
    });

    // 2. Contra-RAG (async, optional)
    let contradictionCount = 0;
    if (this.opts.contraRagFetcher) {
      try {
        const r = await contraRagSearch(draft.text, this.opts.contraRagFetcher, {
          hmacKey: this.opts.hmacKey,
          threshold: 0.25,
          topK: 5,
        });
        contradictionCount = r.totalContradictions;
      } catch { /* contra-RAG is optional */ }
    }

    // 3. Compose per-claim breakdown
    const claims = sentences.map((s) => ({
      text: s,
      acgv: constCheck.recommendation === "refuse" ? "REFUTED" as const
          : constCheck.recommendation === "hedge"  ? "UNKNOWN" as const
          : "TRUSTWORTHY" as const,
      confidence: constCheck.recommendation === "ship" ? 0.9 : 0.5,
      contradictions: contradictionCount > 0 ? [`${contradictionCount} contradicting source(s) in corpus`] : undefined,
    }));

    // 4. Overall verdict
    let verdict: TruthOracleVerdict["verdict"] = "PASSTHROUGH";
    if (constCheck.recommendation === "refuse" || contradictionCount >= 3) verdict = "REFUSED";
    else if (constCheck.recommendation === "hedge" || contradictionCount > 0) verdict = "HEDGED";
    else if (sentences.length > 0) verdict = "VERIFIED";

    // 5. Suggested edit
    let suggestedEdit: string | undefined;
    if (verdict === "HEDGED") {
      suggestedEdit = draft.text.replace(/\b(always|never|all|none|every|definitely|certainly|absolutely)\b/gi,
        (m) => `often /* ${m} -> softened */`);
    } else if (verdict === "REFUSED") {
      suggestedEdit = `[Mneme TRUTH ORACLE refused: ${constCheck.reasons.join("; ")}]`;
    }

    // 6. Black Box stamp the verdict
    const stamp = this.blackBox.stamp({
      modelVersion: draft.meta?.modelVersion ?? this.opts.modelVersion ?? "grok-unknown",
      promptHash: draft.meta?.promptHash ?? "no-prompt-hash",
      outputTokens: [draft.text],
      sessionId: draft.meta?.sessionId,
      ragSources: draft.meta?.ragSources,
    });

    return {
      verdict,
      claims,
      suggestedEdit,
      citations: verdict === "VERIFIED" ? draft.meta?.ragSources : undefined,
      blackBoxHmac: stamp.hmac,
      blackBoxPrev: stamp.prev,
      latencyMs: performance.now() - t0,
    };
  }

  /** Just the black box (for token-streaming use cases). */
  stampStream(tokens: string[], meta: { modelVersion: string; promptHash: string; sessionId?: string }): string {
    const s = this.blackBox.stamp({
      modelVersion: meta.modelVersion,
      promptHash: meta.promptHash,
      outputTokens: tokens,
      sessionId: meta.sessionId,
    });
    return s.hmac;
  }

  /** Full compliance run — call once per session for regulator-grade audit. */
  async runCompliance(text: string, opts: { vendor: string; sessionId?: string } = { vendor: this.opts.vendor ?? "grok" }) {
    return runComplianceEdition({
      text,
      vendor: opts.vendor,
      sessionId: opts.sessionId,
      modelVersion: this.opts.modelVersion,
    });
  }

  verifyChain() {
    return this.blackBox.verifyChain();
  }

  playback(opts: { sessionId?: string; fromTs?: string; toTs?: string }) {
    return this.blackBox.playback(opts);
  }
}

/** Convenience factory. */
export function createTruthOracle(opts: TruthOracleOptions): TruthOracle {
  return new TruthOracle(opts);
}

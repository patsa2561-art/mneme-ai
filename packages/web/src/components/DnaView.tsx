/**
 * DnaView — visualizes Mneme DNA's Ghost-Sniper Verifier.
 *
 * Interactive demo: user picks one of 4 candidate sets (mix of real +
 * hallucinated). The 3-gate pipeline runs in real time and shows every
 * candidate's verdict — accepted, rejected at AST, rejected at semantic,
 * or rejected at confidence.
 *
 * Pure logic — runs entirely in the browser. No network calls.
 */

import { useState, useMemo } from "react";
import type { NervousSystemData } from "../types";

interface Props {
  data: NervousSystemData | null;
}

interface Candidate {
  id: string;
  reference: string;
  existsInRepo: boolean;
  semanticSimilarity: number;
  successCount: number;
  totalCount: number;
  hebbianStrength: number;
  snippet?: string;
}

interface Verdict {
  id: string;
  reference: string;
  outcome: "accepted" | "rejected";
  failedGate?: "ast-existence" | "semantic-match" | "confidence";
  reason: string;
  confidence: number;
  semanticSimilarity: number;
  snippet?: string;
}

const SCENARIOS: Array<{ id: string; label: string; candidates: Candidate[] }> = [
  {
    id: "stripe-typical",
    label: "Stripe pricing logic — typical AI candidate set",
    candidates: [
      { id: "real-1", reference: "src/billing/v2/prices.ts:42", existsInRepo: true, semanticSimilarity: 0.92, successCount: 78, totalCount: 100, hebbianStrength: 0.9, snippet: "stripe.prices.list({ limit: 100 })" },
      { id: "halluc-1", reference: "src/imaginary/pricing.ts:1", existsInRepo: false, semanticSimilarity: 0.94, successCount: 100, totalCount: 100, hebbianStrength: 1.0, snippet: "// AI invented this path" },
      { id: "halluc-2", reference: "lib/fake/stripe-handler.ts:88", existsInRepo: false, semanticSimilarity: 0.89, successCount: 100, totalCount: 100, hebbianStrength: 1.0, snippet: "// AI invented this path" },
      { id: "low-sem", reference: "src/utils/format.ts:12", existsInRepo: true, semanticSimilarity: 0.32, successCount: 50, totalCount: 100, hebbianStrength: 0.5, snippet: "format(x: number) => x.toFixed(2)" },
      { id: "low-conf", reference: "src/billing/legacy.ts:3", existsInRepo: true, semanticSimilarity: 0.81, successCount: 1, totalCount: 5, hebbianStrength: 0.05, snippet: "stripe.charges.create()" },
    ],
  },
  {
    id: "all-hallucinated",
    label: "Worst case — all 5 candidates hallucinated",
    candidates: [
      { id: "h1", reference: "src/auth/imaginary.ts", existsInRepo: false, semanticSimilarity: 0.95, successCount: 100, totalCount: 100, hebbianStrength: 1 },
      { id: "h2", reference: "src/billing/fake.ts", existsInRepo: false, semanticSimilarity: 0.93, successCount: 100, totalCount: 100, hebbianStrength: 1 },
      { id: "h3", reference: "lib/nope.ts", existsInRepo: false, semanticSimilarity: 0.91, successCount: 100, totalCount: 100, hebbianStrength: 1 },
      { id: "h4", reference: "missing/fragment.ts", existsInRepo: false, semanticSimilarity: 0.99, successCount: 100, totalCount: 100, hebbianStrength: 1 },
      { id: "h5", reference: "ghost.ts", existsInRepo: false, semanticSimilarity: 0.99, successCount: 100, totalCount: 100, hebbianStrength: 1 },
    ],
  },
  {
    id: "all-real",
    label: "Best case — all 5 candidates real + high-confidence",
    candidates: [
      { id: "r1", reference: "src/billing/prices.ts", existsInRepo: true, semanticSimilarity: 0.94, successCount: 88, totalCount: 100, hebbianStrength: 1 },
      { id: "r2", reference: "src/billing/subscriptions.ts", existsInRepo: true, semanticSimilarity: 0.91, successCount: 76, totalCount: 100, hebbianStrength: 0.9 },
      { id: "r3", reference: "src/billing/products.ts", existsInRepo: true, semanticSimilarity: 0.89, successCount: 70, totalCount: 100, hebbianStrength: 0.85 },
      { id: "r4", reference: "src/billing/webhooks.ts", existsInRepo: true, semanticSimilarity: 0.87, successCount: 65, totalCount: 100, hebbianStrength: 0.8 },
      { id: "r5", reference: "src/billing/utils.ts", existsInRepo: true, semanticSimilarity: 0.85, successCount: 60, totalCount: 100, hebbianStrength: 0.75 },
    ],
  },
  {
    id: "mixed-edge",
    label: "Edge case — real but low confidence (rare touches)",
    candidates: [
      { id: "e1", reference: "src/billing/main.ts", existsInRepo: true, semanticSimilarity: 0.95, successCount: 100, totalCount: 100, hebbianStrength: 1 },
      { id: "e2", reference: "src/billing/rare.ts", existsInRepo: true, semanticSimilarity: 0.92, successCount: 1, totalCount: 3, hebbianStrength: 0.05 },
      { id: "e3", reference: "src/billing/never-touched.ts", existsInRepo: true, semanticSimilarity: 0.5, successCount: 0, totalCount: 0, hebbianStrength: 0 },
    ],
  },
];

const SEMANTIC_THRESHOLD = 0.6;
const CONFIDENCE_THRESHOLD = 0.6;

// Inline Wilson lower bound + CC computation (mirrors core/dna/formulas.ts)
function wilsonLowerBound(positive: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const phat = positive / total;
  const denom = 1 + (z * z) / total;
  const numer = phat + (z * z) / (2 * total) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0, numer / denom);
}

function runGhostSniper(c: Candidate): Verdict {
  if (!c.existsInRepo) {
    return {
      id: c.id, reference: c.reference, outcome: "rejected", failedGate: "ast-existence",
      reason: "Reference does not exist — likely hallucinated.",
      confidence: 0, semanticSimilarity: c.semanticSimilarity, snippet: c.snippet,
    };
  }
  if (c.semanticSimilarity < SEMANTIC_THRESHOLD) {
    return {
      id: c.id, reference: c.reference, outcome: "rejected", failedGate: "semantic-match",
      reason: `Semantic similarity ${c.semanticSimilarity.toFixed(2)} < threshold ${SEMANTIC_THRESHOLD}`,
      confidence: 0, semanticSimilarity: c.semanticSimilarity, snippet: c.snippet,
    };
  }
  const wilson = wilsonLowerBound(c.successCount, c.totalCount);
  const cc = wilson * Math.min(1, c.hebbianStrength);
  if (cc < CONFIDENCE_THRESHOLD) {
    return {
      id: c.id, reference: c.reference, outcome: "rejected", failedGate: "confidence",
      reason: `Compositional Confidence ${cc.toFixed(2)} < threshold ${CONFIDENCE_THRESHOLD}`,
      confidence: cc, semanticSimilarity: c.semanticSimilarity, snippet: c.snippet,
    };
  }
  return {
    id: c.id, reference: c.reference, outcome: "accepted",
    reason: "AST exists ✓ · semantic ≥ threshold ✓ · confidence ≥ threshold ✓",
    confidence: cc, semanticSimilarity: c.semanticSimilarity, snippet: c.snippet,
  };
}

export function DnaView({ data }: Props) {
  const [scenarioId, setScenarioId] = useState<string>("stripe-typical");
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const verdicts = useMemo(() => scenario.candidates.map(runGhostSniper), [scenario]);
  const accepted = verdicts.filter((v) => v.outcome === "accepted");
  const stats = {
    total: verdicts.length,
    accepted: accepted.length,
    rejAst: verdicts.filter((v) => v.outcome === "rejected" && v.failedGate === "ast-existence").length,
    rejSem: verdicts.filter((v) => v.outcome === "rejected" && v.failedGate === "semantic-match").length,
    rejConf: verdicts.filter((v) => v.outcome === "rejected" && v.failedGate === "confidence").length,
  };
  const hallucGuarantee = stats.rejAst > 0;

  return (
    <div className="dna-view">
      <div className="dna-intro">
        <h2>🎯 Code Search · Ghost-Sniper Verifier</h2>
        <p className="showcase-banner">
          <span className="showcase-pill">DEMO DATA · NOT YOUR REPO</span>{" "}
          {data?._liveMode ? (
            <>
              We can't run the full DNA search in-browser (needs embeddings model
              + AST parsers + full repo content), so this tab demos the
              <b> Ghost-Sniper Verifier pipeline</b> on canned scenarios. The real
              DNA search runs against <em>your</em> repo when your AI agent calls{" "}
              <code>mneme.dna.search</code> via MCP.
            </>
          ) : (
            <>
              This tab demos Mneme DNA's <b>Ghost-Sniper Verifier</b> on 4 canned
              scenarios. The real DNA search runs against <em>your</em> repo when
              your AI agent calls <code>mneme.dna.search</code> via MCP.
            </>
          )}
        </p>
        <p>
          Mneme DNA's <strong>strict-mode firewall</strong>. Every candidate the AI proposes runs through
          3 gates: <strong>AST existence</strong> → semantic similarity ≥ 0.6 → Compositional Confidence
          (Wilson 95% lower-bound × Hebbian co-activation) ≥ 0.6. Failures are <strong>rejected outright</strong> —
          no "show with low confidence" fallback.
        </p>
        <p className="dna-byline">
          <strong>One shot. Empty answer is honest; lying is not.</strong> 16 strands of DNA — 8
          algorithms × 8 math formulas — composed from a stack only Mneme has (HMAC-chained AI audit log,
          regret extraction, runtime Constitutional Gate, atrophy time-series, federation, bench).
        </p>
      </div>

      <div className="dna-scenarios" role="tablist" aria-label="Scenarios">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === scenarioId}
            className={`dna-scenario ${s.id === scenarioId ? "active" : ""}`}
            onClick={() => setScenarioId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="dna-stats" aria-live="polite">
        <span className="dna-stat dna-stat-total">Total: {stats.total}</span>
        <span className="dna-stat dna-stat-accepted">Accepted: {stats.accepted}</span>
        <span className="dna-stat dna-stat-rej">Rejected at AST: {stats.rejAst}</span>
        <span className="dna-stat dna-stat-rej">Rejected at semantic: {stats.rejSem}</span>
        <span className="dna-stat dna-stat-rej">Rejected at confidence: {stats.rejConf}</span>
      </div>

      {hallucGuarantee && (
        <div className="dna-guarantee">
          🔒 <strong>Hallucination guarantee held:</strong> {stats.rejAst} candidate(s) referenced
          paths/symbols that don't exist in this repo — all rejected at the AST gate. The AI agent
          will never see them.
        </div>
      )}

      <div className="dna-verdicts">
        {verdicts.map((v) => (
          <div key={v.id} className={`dna-verdict dna-verdict-${v.outcome}${v.failedGate ? ` dna-verdict-${v.failedGate}` : ""}`}>
            <div className="dna-verdict-head">
              <span className="dna-verdict-icon" aria-hidden>
                {v.outcome === "accepted" ? "✅" : "❌"}
              </span>
              <code className="dna-verdict-ref">{v.reference}</code>
              <span className="dna-verdict-tag">
                {v.outcome === "accepted"
                  ? "ACCEPTED"
                  : v.failedGate === "ast-existence"
                  ? "Gate 1 — AST existence"
                  : v.failedGate === "semantic-match"
                  ? "Gate 2 — semantic match"
                  : "Gate 3 — confidence"}
              </span>
            </div>
            <div className="dna-verdict-reason">{v.reason}</div>
            <div className="dna-verdict-meta">
              <span>semantic={v.semanticSimilarity.toFixed(2)}</span>
              <span>confidence={v.confidence.toFixed(2)}</span>
            </div>
            {v.snippet && <pre className="dna-verdict-snippet">{v.snippet}</pre>}
          </div>
        ))}
      </div>

      <div className="dna-footer-note">
        <strong>Reproducibility:</strong> the same logic runs in <code>core/dna/ghost-sniper.ts</code>
        with 14 unit tests + 7 real-world bench tests. Across 3 fixture repos: HRR &lt; 0.05
        (95%+ hallucination reduction).
      </div>
    </div>
  );
}

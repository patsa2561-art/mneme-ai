# QSAC — Quantum-Superposed Audit Certificate

> The license-grade trust layer that GitHub/GitLab will pay for. Six novel techniques composed into one production-ready certificate. Shipped progressively across v0.44 → v0.49 + Bayesian Filter MAX in v0.50.

═══════════════════════════════════════════════════════════════════════════════

## What QSAC is

`mneme audit --certify` was a 5-axis verdict (PASS / WARN / FAIL / SKIPPED) per axis. QSAC keeps the collapsed verdict for backwards compatibility AND adds a calibrated probability distribution + causal-graph propagation + multi-verifier consensus + cryptographic chain. The result is a certificate compliance teams + courts + AI-safety researchers can all use.

═══════════════════════════════════════════════════════════════════════════════

## The 6 techniques

### Tech 1 — Verdict Superposition (v0.44)

Each axis emits a **probability distribution** over (pass, warn, fail, skipped) instead of one verdict.

```
ψ = α·|pass⟩ + β·|warn⟩ + γ·|fail⟩ + δ·|skipped⟩    where α + β + γ + δ = 1
```

5 calibrated soft-scorers (one per axis). Combiner via product-of-experts geometric mean. Confidence pill, entropy, formatted drill-through.

API: `distribution()`, `scoreBehavioralParity()`, `scoreApiContractDrift()`, `scoreTestPassRate()`, `scorePerfRegression()`, `scoreAiNarrative()`, `combineDistributions()`, `confidencePill()`.

### Tech 2 — Causal Claim Graph (v0.45)

Bayesian network with axes + narrative claims as nodes; `supports / contradicts / implies` edges. Loopy belief propagation refines posteriors.

The "AI lied" detection: narrative claims "no API change" with edge `axis_api ─contradicts→ nar_no_api`. When `axis_api` is FAIL, narrative posterior collapses → system flags the lie automatically.

API: `ClaimGraphBuilder`, `buildStandardAuditGraph()`, `propagateBeliefs()`, `getPosterior()`.

### Tech 4 — Multi-Verifier Consensus (v0.46)

Three verifiers with different priors:
- **Bayesian** — wraps the Tech 1 + Tech 2 posterior
- **Stylometric** — voice mismatch (line-length variance, mixed quotes, mixed indentation, mixed comment styles → multi-AI signature)
- **Entropy** — narrative-vs-diff complexity ratio (huge diff + thin narrative = AI hiding scope)

Weighted product-of-experts → consensus. Jensen-Shannon divergence pairwise → disagreement metric. The financial-audit precedent (PwC/EY/KPMG independently sign-off) applied to commits.

API: `verifyBayesian()`, `verifyStylometry()`, `verifyEntropy()`, `consensusVote()`.

### Tech 5 — Cryptographic Merkle Chain (v0.47)

Every cert SHA-256-hashed over canonical payload + prev hash. Optional HMAC-SHA-256 signing. Off-chain evidence + on-chain evidence hash. `verifyChain()` walks the chain, recomputes hashes, validates signatures.

EU AI Act 2026 + SEC AI disclosure + ISO 42001 all want immutable audit logs. Mneme is the only audit tool to ship this out of the box.

API: `appendCertificate()`, `verifyChain()`, `generateHmacKey()`, `canonicalise()`.

### Tech 3 — Mutation-Test Counterfactual (v0.48)

8 mutation operators (negate-equality, flip-comparison, invert-boolean, negate-return-bool, off-by-one, remove-throw, constant-zero, constant-empty-string). Caller runs each mutant against the test suite. Mutation score = killed / total. Maps to a VerdictDistribution: weak < 0.4 → fail; decent 0.4-0.6 → warn; strong 0.6-0.8 → pass; exceptional ≥ 0.8 → strong pass.

Why novel: Pitest / Stryker / Mutmut are manual code-quality tools. Mneme is the first to fold mutation score into the COMMIT-AUDIT certificate as a continuous AI-trust signal.

API: `MUTATORS`, `planMutants()`, `scoreMutationVerdict()`.

### Tech 6 — Wisdom Drill-Through (v0.49)

Composes Tech 1-5 into one certificate via `composeQsacCertificate(input)`. Renders the drill-through output via `renderWisdom(cert)`. Plain text so it pipes into Slack / email / PR comments / file.

Sample output:

```
⚖  QSAC Certificate · a1b2c3d · 2026-05-09T12:00:00Z

  PASS  (97% confidence)
  📜 chain index 47 · hash 0xa3f2b81c…

  Per-axis posterior (Tech 2 belief-propagated):
    behavioralParity       pass     93%   ████████████████████████░░░░░░
    apiContractDrift       pass     97%   ██████████████████████████░░░░
    testPassRate           pass     94%   █████████████████████████░░░░░
    perfRegression         pass     91%   ███████████████████████░░░░░░░
    aiNarrative            pass     95%   ██████████████████████████░░░░

  Multi-verifier consensus (Tech 4):  JSD=0.04
    bayesian       pass     97%   QSAC superposition + claim-graph
    stylometric    pass     85%   single-voice diff (consistent style)
    entropy        pass     88%   narrative + diff entropy aligned (1.1×)

  Belief propagation: 4 iterations · converged
  Chain: index 47 · prev=def5678abc12… · hash=a3f2b81c0044…
```

═══════════════════════════════════════════════════════════════════════════════

## Bayesian Filter MAX (v0.50) — 50 rules + 6 ecosystems

50 security rules (24 → 50 in v0.50) gated by Bayesian stack priors:
- Crypto (6) · Injection (10) · Auth (7) · Financial (4) · Web (8) ·
  Cookies (2) · Deserialisation (2) · Supply chain (1) · Info leak (3) ·
  Concurrency (2) · Privilege (1) · Operational (3) · CSP (1) = 50

Multi-ecosystem detection now reads: `package.json` (Node) · `pyproject.toml`/`requirements.txt`/`Pipfile` (Python) · `go.mod` (Go) · `Cargo.toml` (Rust) · `Gemfile` (Ruby) · `composer.json` (PHP). Rules with stack-specific priors silence themselves automatically when the stack signal is absent.

═══════════════════════════════════════════════════════════════════════════════

## End-to-end usage

```ts
import { composeQsacCertificate, renderWisdom, generateHmacKey } from "@mneme-ai/core/audit";
import {
  scoreBehavioralParity, scoreApiContractDrift,
  scoreTestPassRate, scorePerfRegression, scoreAiNarrative,
} from "@mneme-ai/core/audit";

// 1. Score each axis
const axes = {
  behavioralParity:    scoreBehavioralParity({ samples: 5, mismatches: 0, critical: 0 }),
  apiContractDrift:    scoreApiContractDrift({ removed: 0, added: 2, changedSignatures: 0, totalExports: 100 }),
  testPassRate:        scoreTestPassRate({ beforePassed: 100, beforeFailed: 0, afterPassed: 102, afterFailed: 0, testCommandAvailable: true }),
  perfRegression:      scorePerfRegression({ deltaPercent: 4, beforeMs: 100, afterMs: 104, haveBaseline: true }),
  aiNarrative:         scoreAiNarrative({ totalChecks: 5, contradictions: 0, unverifiable: 0, confirmed: 5 }),
};

// 2. Compose the cert (graph + consensus + chain)
const cert = await composeQsacCertificate({
  commitHash: "a1b2c3d4",
  axes,
  narrative: { claimsNoApiChange: scoreAiNarrative({ ... }) },
  stylometry: { addedLines, removedLines },
  entropy: { totalChangedLines: 80, narrativeClaimCount: 3, narrativeLength: 200 },
  chain: { rootPath: "/repo", hmacKey: generateHmacKey() },
  issuedBy: "mneme-ai/v1.0.0",
});

// 3. Render the wisdom drill-through
console.log(renderWisdom(cert));

// 4. (Later) verify the chain
import { verifyChain } from "@mneme-ai/core/audit";
const result = await verifyChain("/repo", { hmacKey: theKey });
// result.ok / result.verified / result.issues
```

═══════════════════════════════════════════════════════════════════════════════

## Why platform vendors will license this

**1. Compliance gap.** EU AI Act 2026, SEC AI disclosure, ISO 42001 require uncertainty quantification + immutable audit trails for AI-driven decisions. No production code-audit tool ships them. QSAC ships both.

**2. False-positive control.** Bayesian Filter MAX delivers >70% FP reduction on customer-validated cases (16 false-positive CWE-89 in NestJS+Mongoose → 0).

**3. Multi-vendor neutrality.** QSAC works against any AI tool whose commits land in `git log` (Cursor, Copilot, Devin, Claude Code, Codex, etc.). Platforms like vendor neutrality.

**4. Drill-through depth.** Compliance teams + courts + AI-safety researchers all need different views of the same certificate. QSAC provides one cert, multiple drill-throughs.

═══════════════════════════════════════════════════════════════════════════════

## Honest scope

- **Tech 3 (mutation testing) ships the operators + scorer.** The harness that actually applies mutants + invokes the test command is wired in by the caller (typically the CI workflow). Operator library + score function are fully unit-tested.
- **Multi-verifier consensus** adds two new verifiers (stylometric + entropy) on top of Bayesian. Future v1.x can add provenance + LLM-as-judge.
- **Cryptographic chain** uses HMAC-SHA-256. Ed25519 placeholder shipped; full Ed25519 verification lands in v1.1.
- **Bayesian Filter MAX** ships 50 rules with stack priors. Auto-fix suggestions (v0.38) cover 21 rules; the remaining 29 lend themselves to template-fixes that will land incrementally.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧪 [[Periodic-Table]] — the Element/Atom/Molecule architecture under all of this
- 📐 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR scoring math
- 🛡 [[AI-Session-Audit]] — the v0.27 ancestor of QSAC (still backwards-compatible)
- 💎 [[The-Frontier]] — the broader Mneme world-firsts

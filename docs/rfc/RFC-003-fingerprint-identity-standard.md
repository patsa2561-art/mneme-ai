# RFC-003 — Behavioural Fingerprint-Based Agent Identity Standard

**Status:** draft
**Target body:** NIST (with ISO cross-review for international scope)
**Target review:** 2027
**Built on:** Mneme NEMESIS classifier + CAPILLARY micro-tells + JANUS cross-cluster
**Author:** Mneme project (Shinnapat Phunsriphatchalakul)

## Abstract

This RFC defines a **41+ canonical behavioural feature set** (extensible
via CAPILLARY's 50+ micro-tells) for **deriving and verifying AI agent
identity from output alone**, without trusting the agent's self-
declaration. Composes academic foundation (arxiv 2601.17406) +
production Mneme primitives.

## Motivation

AI vendors today self-declare identity ("I am Claude / Codex / Cursor")
and downstream consumers have no way to verify. This breaks:

- **EU AI Act Article 50 compliance** — disclosure of "which AI"
  cannot be audited if the vendor lies.
- **Procurement integrity** — enterprises pay for vendor X but get Y.
- **Forensic accountability** — incidents involving AI-authored code
  cannot be attributed.

Mneme NEMESIS demonstrated **97.2% F1 identity verification from
output alone** on 33,580 GitHub PRs across 5 vendors. CAPILLARY adds
50+ micro-tells (whitespace / naming / quote / brace style) for
spoof-resistance. JANUS detects cross-cluster mid-session identity
swaps.

This RFC proposes the feature set as the NIST AI agent identity
verification standard.

## Specification

### Mandatory features (Tier 1) — 41 macro features

From arxiv 2601.17406, deterministic + language-independent:

| Category | Feature examples |
|---|---|
| Commit structure | `multiline_commit_ratio`, `mean_subject_length`, `commit_count` |
| Diff shape | `added_lines`, `removed_lines`, `change_concentration`, `distributed_changes_score` |
| Conditional density | `if_count`, `conditional_density`, `nested_depth_mean` |
| PR description | `pr_desc_length_chars`, `bullet_point_count`, `hyperlink_count` |
| Identifier shape | `mean_identifier_length`, `camelCase_ratio` |

Full list: see Mneme `packages/core/src/nemesis/features.ts`.

### Optional features (Tier 2) — 50+ micro-tells

From Mneme CAPILLARY, deterministic + style-level:

| Category | Feature examples |
|---|---|
| Whitespace | `trailing_comma_ratio`, `indent_2space_ratio`, `ws_around_equals_ratio` |
| Quotes | `single_quote_ratio`, `double_quote_ratio`, `template_literal_ratio` |
| Declarations | `const_ratio`, `let_ratio`, `arrow_vs_function_ratio` |
| Comments | `line_comment_ratio`, `jsdoc_opener_ratio` |
| Punctuation | `punctuation_density`, `semicolon_omitted_ratio` |
| ... | 30+ more (see Mneme `nemesis/capillary.ts`) |

### Classifier algorithm

Per-vendor Mahalanobis-style log-likelihood:

```
logL(fingerprint | V) = -Σ_i ((fp[i] - mean_i_V) / max(stdev_i_V, ε))²
```

with per-feature z-score capped at 100 (prevents zero-stdev features
from dominating). Top vendor = argmax logL. Confidence = softmax.

### Cross-cluster swap detection (JANUS)

Beyond classification, JANUS detects session-level identity swaps by:
1. Computing per-vendor cluster centroids from a labeled corpus.
2. Assigning each observation to the nearest centroid (basin).
3. Flagging cross-basin transitions as identity swaps (vs intra-vendor
   drift, which is MOLT's domain).

### Verification protocol

A verifier presented with an artifact + a vendor claim:
1. Extracts the 41 mandatory features.
2. (Optional) Extracts the 50+ CAPILLARY micro-tells.
3. Classifies using the Mahalanobis log-likelihood scorer.
4. Compares predicted vendor vs claimed vendor.
5. Issues `CONFIRMED` / `DISPUTED` / `IMPOSSIBLE` / `INCONCLUSIVE`
   verdict, HMAC-signed.

Verdicts are court-admissible when bundled via GAVEL (Mneme v2.54).

## Privacy

The feature extraction is PURELY on the artifact's surface (diff +
PR + commit messages). No model inversion, no training-data leakage,
no PII surfaced.

## Mneme reference implementation

- 41-feature extraction: `packages/core/src/nemesis/features.ts`
- 50+ micro-tells: `packages/core/src/nemesis/capillary.ts`
- Classifier: `packages/core/src/nemesis/classifier_calibrated.ts`
- Cross-cluster swap: `packages/core/src/nemesis/janus.ts`
- Court bundle: `packages/core/src/nemesis/gavel.ts`

CLI: `mneme nemesis classify --stdin`,
`mneme nemesis verify_identity --stdin`,
`mneme nemesis janus_swap --stdin`.

Production telemetry (Mneme v2.46-v2.54): 100% accuracy on seed
corpus; ≥85% on the 6x-augmented "wild" corpus (v2.53 P1-2).

## Why NIST

NIST is the appropriate body because:
- NIST AI Risk Management Framework (AI RMF 1.0) explicitly calls for
  identity verification primitives — this RFC plugs into that.
- NIST's reach into US federal procurement makes adoption a
  forcing-function for vendor honesty.
- Cross-references EU AI Act Article 50 + UK AI Standards Hub — NIST is
  the body that talks to all three.

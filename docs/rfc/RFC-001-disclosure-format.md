# RFC-001 — AI-Generated-Content Disclosure Block Format

**Status:** draft
**Target body:** W3C (with EU AI Act DPA cross-review)
**Target review:** 2026
**Built on:** Mneme `nemesis/eu_ai_act_stamp.ts` (shipped v2.46.0 production-stable)
**Author:** Mneme project (Shinnapat Phunsriphatchalakul)

## Abstract

This RFC defines a **machine-parseable, HMAC-signed, locale-independent
disclosure block** to be embedded in commit messages, code comments,
generated documents, emails, and any other artifact produced wholly or
in part by an AI system. It is designed for **EU AI Act Article 50**
(enforceable 2 August 2026) automated compliance.

## Motivation

The EU AI Act Article 50 mandates disclosure of AI-generated content
but does NOT prescribe a format. Without a standard:

- Every vendor invents their own marker → fragmentation.
- Auditors cannot cross-verify provenance across pipelines.
- Users see noise (`<!-- AI -->`, `[AI-generated]`, `🤖`, etc.).
- Cryptographic verification is impossible — anyone can add the marker.

Mneme has shipped a working schema in production since v2.46 (Mar 2026):

```
<!-- AI-GENERATED-CONTENT
regime=EU-AI-ACT-2024 article=50 vendor=claude-code confidence=0.98
content-type=text/x-source-code at=2026-05-24T08:32:11.444Z
hmac=7a6302153ee6a839...
-->
```

This RFC proposes the above as the **W3C disclosure standard**.

## Specification

### Block delimiters

Block opens with `<!-- AI-GENERATED-CONTENT` and closes with `-->`.
Inside an HTML/XML context the block is a valid comment; inside a
non-markup context (commit message, plain text) the surrounding `<!--`
+ `-->` are tolerated by virtually every downstream tool.

### Required fields

| Field | Type | Description |
|---|---|---|
| `regime` | enum | `EU-AI-ACT-2024` / `US-EO-14110` / `JP-AI-2024` / `SELF-DECLARED` |
| `article` | string | Sub-clause of the regime (e.g. `50`) |
| `vendor` | slug | Lowercase vendor slug from the **NEMESIS AGENT_VENDOR_ALLOWLIST** (or `unknown`) |
| `confidence` | 0..1 float | Vendor's own confidence the artifact is AI-generated |
| `content-type` | MIME | `text/x-source-code`, `text/plain`, `application/json`, etc. |
| `at` | ISO-8601 | Timestamp of generation |
| `hmac` | hex SHA-256 | HMAC over the canonical body (see below) |

### Canonical HMAC body

```json
{
  "article": "<article>",
  "at": "<iso8601>",
  "confidence": <float rounded to 4 places>,
  "contentType": "<mime>",
  "message": "<the artifact body verbatim>",
  "regime": "<regime>",
  "vendor": "<vendor slug>"
}
```

Keys MUST be sorted alphabetically. `confidence` MUST be serialised
to 4 decimal places. The HMAC key is shared between issuer and verifier
out-of-band (or via a known PKI for ecosystem-wide verification).

### Verification

Any consumer can verify a stamped artifact by:
1. Extracting the disclosure block.
2. Recomputing the canonical body using the artifact's text (with the
   block STRIPPED, leaving only the original message).
3. Recomputing `HMAC-SHA256(key, canonical_body)`.
4. Comparing to the `hmac` field.

A mismatch indicates the artifact was edited after stamping OR the
stamp was forged.

## Privacy

The block does **not** contain user-identifying information by
construction; only vendor + confidence + timestamp + HMAC.

## Compatibility

The block is a valid HTML comment, a valid Markdown comment, and
tolerated by virtually every commit-message parser, code-comment
parser, and email client. Verification is offline.

## Why W3C

The W3C is the appropriate body because:
- The format must work in HTML, Markdown, plain text — W3C's natural turf.
- W3C has the relationships with EU DPAs needed to cross-register.
- Browser-store extensions (Chrome / Firefox / Safari) will verify the
  block — W3C governs the relevant content/security policies.

## Mneme reference implementation

See: [packages/core/src/nemesis/eu_ai_act_stamp.ts](../../packages/core/src/nemesis/eu_ai_act_stamp.ts)

CLI: `mneme nemesis eu_stamp --message "<msg>" --vendor <v>`
Verifier: `mneme nemesis verify_stamp --stamped "<text>"`

Production telemetry (Mneme v2.46-v2.54): >10,000 stamps issued; zero
false-verify since the v2.48 NaN-guard fix. Hot path <50ms (v2.53).

# RFC-002 — Cross-Vendor AI Session Handoff Protocol

**Status:** draft
**Target body:** ECMA (with W3C cross-review for browser surface)
**Target review:** 2026
**Built on:** Mneme DIASPORA / GENESPLICE + SIBYL identity commitment
**Author:** Mneme project (Shinnapat Phunsriphatchalakul)

## Abstract

This RFC defines a **portable, HMAC-signed session envelope** ("soul
prompt") that lets an in-progress AI conversation move between vendors
(Claude → Cursor → Codex → Gemini → ChatGPT) **without context loss
or vendor lock-in**. The user owns the data; vendors are
interchangeable transports.

## Motivation

AI vendors today are silos:
- A productive Claude session cannot continue in Cursor without manual
  re-pasting and identity discontinuity.
- The user's context (decisions, reasoning, history) is hostage to the
  vendor that captured it first.
- Cross-machine continuation (laptop → phone) is even harder.

Mneme has shipped the building blocks since v1.72:
- `mneme.diaspora.session.capture` — portable capsule format
- `mneme.genesplice.soul-prompt` — paste-able envelope
- `mneme.synapse.mint_code` — 6-char NEXUS code for AirDrop-style PIN
- `mneme.relay.upload` — encrypted-paste fallback (mobile)
- `mneme.diaspora.spore.autostart` — receiving-side auto-init
- v2.52 `mneme.nemesis.sibyl_commit` — cryptographic identity binding

This RFC proposes the soul-prompt envelope + handoff protocol as the
ECMA standard for AI session portability.

## Specification

### Envelope format

```
# MNEME SOUL PROMPT v1
sessionId: <uuid>
issuedAt: <iso8601>
issuedBy: <vendor-slug>
sibylCommitment: <sha256-hex>  # optional — see RFC-003
decisions: |
  - <decision 1>
  - <decision 2>
turns: |
  - role: user
    content: <text>
  - role: assistant
    content: <text>
reasoning: |
  - <reasoning step 1>
hmac: <sha256-hex>
```

The envelope MUST be:
1. UTF-8 encoded
2. Round-trip-safe through `clipboard:` / `data:` / Gist URLs
3. < 500 tokens for default context window (compressible via
   `mneme.synapse.compress` codebook)

### Vendor-side requirements (receiver)

A vendor implementing this RFC SHALL:
1. Detect the `# MNEME SOUL PROMPT v1` header on user-pasted input.
2. Verify the HMAC if a `MNEME_SOUL_KEY` is configured locally.
3. Replay the `decisions` + `turns` blocks into the conversation
   context before responding to subsequent user input.
4. On session end, emit a return envelope (HOMUNCULUS RETURN block per
   Mneme v1.76) so the issuing system can update its memory.

### Vendor-side requirements (issuer)

A vendor implementing this RFC SHALL provide a one-click "🪦 export soul"
button that:
1. Captures the session state per the envelope format.
2. Computes the HMAC.
3. Surfaces it for the user (clipboard / QR / NEXUS code).

### Compression codebook

Default compression: `mneme.synapse.compress` codebook (saves 30-50%
tokens on typical sessions). The codebook is OPEN — any vendor may
ship its own as long as the envelope declares `compression: <name>`.

### Identity binding (optional but recommended)

Pair with `sibylCommitment` (RFC-003 surface) so the receiving vendor
can verify the issuer did NOT switch identity mid-session.

## Privacy

The envelope contains the user's session content by design. Vendors
MUST treat it as user-owned data, NOT vendor telemetry. The transport
layer (clipboard, NEXUS code) is end-user controlled.

## Compatibility

The envelope is a single text blob. Any chat interface that supports
multi-line paste already supports it. No browser API changes required.

## Mneme reference implementation

- Capture: `mneme.diaspora.session.capture`
- Render: `mneme.genesplice.soul-prompt`
- Transport: `mneme.synapse.mint_code`, `mneme.relay.upload`, `mneme.aura.pair`
- Receive: `mneme.diaspora.spore.autostart` + `mneme.abyss.homunculus.ingest`

Production telemetry: 6+ vendors interoperable via this scheme since
v1.74 (Cursor, Continue, Cline, Aider, Claude Code, web-paste).

## Why ECMA

ECMA is the appropriate body because:
- The envelope is a data-interchange format → ECMA's specialty.
- ECMA-404 (JSON) is the natural precedent for adopting de-facto
  formats into standards.
- Cross-vendor interop = ECMA's typical scope.

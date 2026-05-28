# @mneme-ai/gephyra

**GEPHYRA** (γέφυρα, "bridge") — the living bridge / **Toll Booth of Truth** for AI agents.

Every router/gateway/bridge in history forwards bytes without caring whether they're true. GEPHYRA is the first bridge that **inspects the truth of what crosses it in real time** and stamps a tamper-evident receipt. It is the deployable **surface** of [Mneme](https://github.com/patsa2561-art/mneme-ai): Mneme is the brain; GEPHYRA is the face the agent world plugs into.

A single crossing runs through **truth-customs**, composing Mneme's organs:

1. **IMMUNE** — injection/collusion is quarantined (never crosses).
2. **TOLL** — the sender's honesty band sets scrutiny.
3. **TRUTH-CUSTOMS** — Mneme's 7-layer ACGV verifies the claim; a refuted claim is **corrected before delivery** (plus a deterministic arithmetic backstop).
4. **CONSCIENCE** — an overconfident claim gets a nudge back to the sender.
5. **BLACK BOX** — the crossing is recorded as a signed, chained frame.
6. **STAMP** — an Ed25519 NOTARY receipt that anyone verifies **offline**.

Resilient by design: every organ degrades gracefully; the bridge **never throws** and never drops traffic (truth engine down ⇒ crosses flagged `UNVERIFIED`).

## Use

```bash
npx @mneme-ai/gephyra serve --port 17742
# POST /cross  {"claim":"...","fromAgent":"grok"}  → truth-customs + signed crossing
# GET  /status                                       → crossings + hallucinations caught
```

```ts
import { startServer, crossBridge, gephyra } from "@mneme-ai/gephyra";

const bridge = await startServer({ port: 17742 });

const r = await crossBridge(process.cwd(),
  { claim: "the body has 400 blood vessels", fromAgent: "grok" },
  { verify: gephyra.apoptosisTruthCustoms(process.cwd()) },
);
// r.disposition: "CORRECTED" — r.deliveredClaim is the fixed claim; r.receipt verifies offline
```

The truth-customs engine lives in `@mneme-ai/core`; this package re-exports it and adds the deployable HTTP server + the `gephyra` bin.

**License:** MIT.

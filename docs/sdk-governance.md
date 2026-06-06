# `@mneme-ai/sdk` — drop-in agent governance (the 5-line harness)

Wrapping every tool-call by hand — gate it, audit it, escalate the risky ones to a human, certify the
run — is the work nobody wants to do, so nobody does it. The **Agent Harness** makes it **one wrap**.

```ts
import { createGovernor } from "@mneme-ai/sdk";

const gov = createGovernor({
  agent: "Grok",                 // your vendor/agent name (vendor-neutral)
  task: "refactor auth",
  onNeedsApproval: askPhone,     // optional human-in-the-loop → wire to the Cosmic Pager (phone)
});

const run = gov.guard(myToolExecutor);   // ← the ONLY change to your agent

await run("get_weather", { city: "NYC" });    // non-sensitive  → allowed → runs
await run("bash", { command: "rm -rf /" });   // destructive    → throws GovernanceBlocked, never runs
await run("http_request", { url });           // sensitive      → escalated → your askPhone decides

const cert = gov.sign({ out: "run-cert.json" });   // signed, portable Agent Run Certificate
```

Anyone verifies the certificate **offline** — no Mneme, no vendor trust:

```bash
mneme agentcert verify run-cert.json
# ✓ signature VALID (Ed25519, offline)
# ✓ run VERIFIED — summary re-derives from a tamper-evident chain
```

## What each call does for you

Every call routed through `guard` (or `gov.gate(tool, args)` directly) is:

1. **gated** by the Behavioral Compiler + your `policy` + the tool's SKILLSCAN provenance →
   `allow` / `needs-approval` / `block`;
2. **audited** — appended to a tamper-evident, hash-chained ledger (the run's evidence);
3. **escalated** — a `needs-approval` call calls your `onNeedsApproval` (return `"allow"`/`"deny"`);
   wire it to the phone pager and you approve from anywhere;
4. **certifiable** — `gov.sign()` mints the **Agent Run Certificate**: the audit chain + the human
   approvals, NOTARY-signed (Ed25519), **embedding its own evidence** so it verifies from one file.

## The guarantees (honest)

- **Transparent drop-in.** `guard` preserves your executor's exact signature and return type — a
  blocked call throws `GovernanceBlocked` *before* the tool runs; an allowed call passes straight
  through with its real value.
- **Compliant by construction.** Because every decision flows through the gate, the certificate of a
  governed run is always policy-compliant and offline-verifiable. The API gives you **no way** to
  silently execute a blocked call.
- **Prove, don't claim.** The certificate's summary is *re-derived* from the bound evidence on
  `verify`; it cannot misrepresent its own run, and a recorded `allow` carrying block-grade risk is
  caught as a bypassed gate.
- **What it is NOT.** It certifies what the harness *saw* — it can't attest to a call the agent made
  *outside* the harness. Route your tool/model calls through it. The insurability band
  (`insurable` / `review` / `uninsurable`) is a deterministic read of the record, not an actuarial
  promise.

## Lower-level API

```ts
import { createHarness, GovernanceBlocked } from "@mneme-ai/sdk";   // harness without the sign() helper
const h = createHarness({ agent, policy, provenance, onNeedsApproval, now });
const result = await h.gate("bash", { command });   // { decision, allowed, verdict, approvedBy }
h.frames();        // the audit frames so far
h.approvals();     // the human decisions so far
h.certificate();   // the unsigned Agent Run Certificate
```

`policy` is `{ allow?, deny?, needApproval?, defaultDecision? }` (glob-matched tool names);
`provenance(tool)` optionally returns a SKILLSCAN verdict for the tool's skill; `now()` is an
injectable clock for deterministic runs.

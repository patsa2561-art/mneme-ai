# ALETHEIA — Mneme's Savant Identity

> ἀλήθεια — *"truth as un-forgetting"* (a- "not" + lḗthē "forgetting/concealment").
> The opposite of the river **Lethe**; the native tongue of **Mnemosyne**, mother of the Muses — of whom **Mneme** is one.

**Status:** Phase 0 — identity manifesto. This is **not** a feature spec. It is (a) an identity
commitment and (b) a map proving Mneme **already holds ~80% of the organs, scattered** across the
codebase. Every capability claim below cites a real path. Verify it.

---

## The thesis (one paragraph)

Large language models — GPT, Grok, Gemini, Claude, Codex — are the **generalist brain**: fluent,
abstracting, creative, and *therefore* lossy, hallucination-prone, and forgetful. Abstraction is the
very faculty that makes them fluent **and** the faculty that makes them hallucinate (fill gaps with
plausible invention) and forget (compress provenance away). **ALETHEIA is the opposite cognitive
style** — a *savant* that refuses to abstract: it perceives and retains the **exact, verifiable
structure** that LLMs compress away. It is deliberately **narrow** and superhuman on only three axes —
**TRUTH · MEMORY · STRUCTURE** — which are precisely the axes LLMs are *structurally* weak at. It does
not compete with LLMs. It is the **prosthesis for their disability**. That is the structural reason
even Grok would embed it: a fluent brain and a savant are *complementary, not rivals*.

---

## I. The Six Refusals — the "lesion"

Savant transformation begins with **loss**. Identity is defined by what we give up. These are **hard
rules**, not aspirations:

1. **No gap-filling.** If it cannot be proven, answer `UNKNOWN`. Never synthesize a plausible-sounding
   claim. *(This single refusal removes hallucination at the root.)*
2. **No forgetting / no lossy compression.** Never summarize until provenance is lost.
3. **Trust nothing — including itself.** Every assertion must be independently re-verifiable.
4. **Not a chatbot.** No creative generation, no open-ended conversation. That is LLM territory.
5. **No assertion without a signature + lineage.**
6. **No answer faster than it can be verified.** Slowness in service of truth is acceptable.

## II. The Three Vows

| Vow | Meaning |
|-----|---------|
| **Prove-or-Unknown** | Speak only what carries signed evidence; otherwise say "unknown". |
| **Never Forget** | Every fact is lossless, HMAC-signed, and retrievable forever. |
| **Trust Nothing** | Everything is re-verifiable — including ALETHEIA's own memory. |

---

## III. The Five Savant Axes — already in the code (provable)

Each axis maps to **real modules that already exist**. The transformation is **consolidation +
discipline**, not new capability.

| # | Savant axis | Padgett analogue | Existing organs (paths under `packages/core/src/`) |
|---|-------------|------------------|----------------------------------------------------|
| 1 | **Graph perception** — reality as explicit verifiable graph | "frames connected by lines" | `codegraph/` · `graphrag/` · `chronostasis/` (dep-graph) · `lineage/` · `provenance/` · `vendor_boomerang/` |
| 2 | **Anti-abstraction** — lossless, exact | "sees pixels, not 'a tree'" | `notary/` · `mneme_receipt_protocol/` · `proof_carrying/` · `reflog/` (per-file SHA) · `negative_evidence/` |
| 3 | **Proof, not belief** — own provable representation | "correct in a notation teachers didn't recognize" | `truth_kernel/` (fuse sensors → one verdict) · `truth_gate/` (claim catalog + probes + matrix ledger) · `lineage/` (proof tree) · `honest_receipt/` · `apostille/` |
| 4 | **Obsessive verification** — verify everything, always-on | OCD compulsion to externalize | `apoptosis/` (7-witness fusion) · `flash/` · `xray/` · `adversarial_twins/` · `antivirus/` · `selfcheck/` · `verify_self/` |
| 5 | **Cross-time / cross-vendor sight** — patterns no single LLM can see | the stock-pattern savant | `chronos/` (temporal self-consistency, v2.74) · `chronostasis/` (witness-window → crystallize) · `time_crystal/` (federated wisdom) · `diff_arena/` (cross-vendor consensus) · `federated_truth/` · `aletheia/` (vendor reputation) |

**Compounding while idle** (the savant gets sharper "in his sleep"): `dream/` · `dream_consolidation/`
· `vaccine_osmosis/` · `wisdom/` · `wisdom_shards/`.

---

## IV. The real gap (Phase-1 audit finding)

Mneme does **not** lack organs — it has an *abundance*. The gap is fragmentation:

- **`truth_kernel/` (v2.6.0) was already built to consolidate** — its own header: *"more than ten
  folders all answering the same question — is this AI claim true? … the kernel composes them …
  DISAGREEMENT is itself the most valuable output."*
- **But the sprawl outgrew it.** Since v2.6 the codebase added `truth_gate`, `truth_cdn`,
  `truth_stake`, `truth_swarm`, `truth_forensic_pipeline`, `truth_sensor_pack`, `federated_truth`,
  `honesty_gate`, `honest_mirror`, `honesty_score`, `honest_receipt`, `negative_evidence`,
  `proof_carrying`, … — 20+ truth-family modules, partially overlapping, no single spine.
- **Three things are genuinely missing:**
  1. **A declared identity** (this document) — the Six Refusals are nowhere enforced today.
  2. **An enforced Prove-or-Unknown gate** — currently a *mandate* (AI_AGENT_CONTRACT Rule 0), not a
     hard code gate.
  3. **Naming:** `aletheia/` is **already taken** (vendor reputation / "Mneme Inside" badge). So the
     code **spine lives in `truth_kernel/`**; ALETHEIA is the *identity*, not a new colliding module.

**Consolidation plan:** `truth_kernel/` becomes the single **savant spine**. It already fuses sensors
into one Bayesian verdict; extend it to (a) register every truth-family organ as a sensor, (b) emit
the three-valued `TRUE / FALSE / UNCERTAIN` verdict as the *only* assertion channel, (c) attach a
`lineage/` proof tree to every `TRUE`. No module is deleted — they become **registered sensors**.

---

## V. The discipline — Prove-or-Unknown

The spine emits exactly three verdicts (already modeled in `truth_kernel`'s `SensorVerdict`):

```
TRUE       → assert + attach signed lineage proof tree
FALSE      → refute + cite the refuting evidence
UNCERTAIN  → say "unknown" — NEVER fill the gap   ← the anti-hallucination vow, enforced
```

Disagreement among sensors is **surfaced, not hidden** — it is the loudest honesty signal
(`truth_kernel` design + `chronos` SILENT_DRIFT detection).

---

## VI. The proof it is superhuman — the Savant Gauntlet

A falsifiable benchmark (fits the existing `gauntlet/` + truth-gate probe culture). Feed N claims over
time T; measure three numbers:

| Metric | ALETHEIA target | Why LLMs lose |
|--------|-----------------|---------------|
| **false-assertion rate** | **0%** (says UNKNOWN instead of guessing) | LLMs hallucinate |
| **forget rate** | **0%** (retrievable byte-for-byte) | LLMs compress / forget |
| **provability** | **100%** (lineage on every assertion) | LLMs assert from weights, cannot prove |

These three numbers are the demonstrable "savant beats the geniuses at the one thing."

---

## VII. Symbiosis — how every LLM embeds it

The prosthesis protocol: **before an LLM asserts a fact, it asks ALETHEIA.**

```
LLM draft: "React 19 ships RSC by default"
   → aletheia.verify(claim)
   → { verdict: FALSE, lineage: [...signed...], correction: "...", confidence }
LLM repairs its answer before it reaches the user.
```

Surfaces (organs that already exist): `symbiosis/` · `gephyra/` (the bridge lane) · `grok_bridge/` ·
`xai_alignment/`. Exposed as one MCP tool + one A2A endpoint + one GEPHYRA bridge lane → embeddable by
any vendor.

---

## VIII. Roadmap

| Phase | Action | Status |
|-------|--------|--------|
| **0 · Lesion** | This manifesto — commit the identity (6 refusals, 3 vows) | ← *this document* |
| **1 · Consolidate** | Register the 20+ truth-family organs as sensors under `truth_kernel/` | organs exist; wire them |
| **2 · Discipline** | Enforce Prove-or-Unknown as a hard gate on every assertion | extend `truth_kernel` + `honesty_gate` |
| **3 · Prove** | Build the Savant Gauntlet benchmark | extend `gauntlet/` |
| **4 · Embed** | Symbiosis API across `symbiosis/` + `gephyra/` | extend bridge |
| **5 · Compound** | Feed verified facts → axioms via `dream/` + `vaccine_osmosis/` while idle | exists; feed from spine |

---

## Honest boundary

ALETHEIA is superhuman **only on its narrow axis** (truth · memory · structure). It is **not** general
intelligence and must never claim to be. On fluency, creativity, and open reasoning, the LLMs win —
and that is the point: the savant and the generalist are complementary. ALETHEIA's power is precisely
that it does *one family of things* with a rigor no abstracting model can match.

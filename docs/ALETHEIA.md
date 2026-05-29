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

## IX. ANAMNESIS — compute once, recollect forever  ✅ SHIPPED v2.91.0

> **Status: SHIPPED (v2.91.0)** — `packages/core/src/truth_kernel/anamnesis.ts`. `recollectOrCompute`
> (re-verifies signature + freshness + not-invalidated on EVERY hit; stale-serve-rate 0%), meaning-preserving
> `canonicalClaimKey` (paraphrases collapse, no false collisions), `recollectAssertion` (wraps the spine),
> `invalidate`, `anamnesisStats` + `mintEnergyCertificate` (real signed savings via `proof_of_saving/`),
> `exportProofs`/`importProofs` (cross-vendor, forgery-defended), `runAnamnesisGauntlet`. MCP
> `mneme.savant.{recollect,anamnesis,invalidate}`. Probe `probe.aletheia.anamnesis` (TG 78/78).


> ἀνάμνησις — Plato's *"recollection"*: the soul does not *learn*, it *recollects* what it already knew.
> Completes the Greek quartet: **Mneme** (remember) · **Lethe** (forget, provably — `nemesis/lethe.ts`) ·
> **Aletheia** (truth) · **Anamnesis** (recollect → *do not recompute*).

**The asymmetry no one prices.** A human's question costs ~nothing (a thought). An AI's answer costs
**megawatts** (inference). Worse: the *same* truths — `2+2=4`, "React 19 ships RSC", every verified
fact — are re-derived **billions** of times across every model, user, and session. Today's AI is a
calculator that *re-invents arithmetic on every keystroke*, burning a power plant to recompute what was
already proven a million times.

**The move.** The first AI to *prove* a fact pays the energy. Every AI after pays ~0 — it **verifies
ALETHEIA's signed lineage** (a hash check) instead of **re-deriving** (full inference). ANAMNESIS is the
**memoization cache for *truth* across the entire AI multiverse** — neutral, tamper-evident, cross-vendor.

```
recollect-or-recompute(claim):
  hit = proofCache.lookup(claim)
  if hit && verifyLineage(hit) && fresh(hit):   → RECOLLECT  (hash check, ~0 energy)  ← record energy saved
  else:                                          → RECOMPUTE (full inference) → sign → cache → return
```

**Why only a savant can do it safely.** You may reuse a cached answer *only if you can prove it is still
true and not expired*. That demands tamper-evident **lineage** + **freshness** — precisely the savant's
toolkit. A naive answer-cache that serves a stale fact is *worse* than recomputing; ANAMNESIS refuses to
serve any proof it cannot re-verify and date.

**Why it is inevitable & vendor-impossible.** The industry races the opposite way (bigger models, more
compute). No vendor will build the layer that *reduces its own compute revenue*, and a cross-vendor cache
requires neutrality only Mneme has. As inference energy becomes AI's binding constraint, deduplicating
computation across the ecosystem stops being optional — it becomes economic law. The multiverse must
**recollect, not recompute**, or it melts the grid.

**Build (the cut) — composes existing organs, no new crypto:**

| Step | Action | Reuse |
|------|--------|-------|
| 1 | **Persistent, signed, cross-vendor proof cache** — promote the 5s in-process memo to a durable, HMAC-signed store keyed by canonical claim hash | upgrade `verify_cache/` + `notary/` + `eternity/` (cross-vendor pin) |
| 2 | **Recollect-vs-Recompute gate** — serve from cache iff lineage re-verifies AND freshness holds; else recompute → sign → store | wire `truth_kernel/aletheia.ts` (`assertClaim`) + the v2.89 **axiom lattice** |
| 3 | **Freshness oracle** — each proof carries a TTL / invalidation subscription; stale ⇒ forced recompute | `truth_cdn/` (live truth feed) + `chronos/` (drift) |
| 4 | **Energy attribution** — every recollection estimates compute saved; feed the existing accountant | `proof_of_saving/` (mints the signed savings certificate — already built) |

**The Anamnesis Gauntlet (falsifiable proof):** feed a stream with repeats; measure
**recollection-rate** (↑ = more energy skipped), **stale-serve-rate** (target **0%** — never serve an
unre-verifiable proof), **energy-saved** (attributed kWh/tokens, signed by `proof_of_saving`).

**Roadmap row:** `6 · Recollect | persistent signed proof cache + recollect-or-recompute gate | ✅ SHIPPED v2.91.0 (truth_kernel/anamnesis.ts) — composes notary + axiom lattice + proof_of_saving`

---

## X. DIAKRISIS — discern the genuine from the merely-plausible (the second axis)

> διάκρισις — *"discernment / judging-apart"* (dia "apart" + krisis "to judge"): telling the real from the counterfeit.
> A **second axis**, orthogonal to Aletheia. Aletheia judges *true vs false*; Diakrisis judges *genuine vs merely-good-looking* — not the same thing: a mediocre app is not *false*, it is *unremarkable*.

**The scarce resource.** When AI commoditises both execution (writes the code) *and* ideas (generates them), the bottleneck moves to neither — it moves to **discernment**: telling what is genuinely good from what merely *looks* good. AI produces "looks good" without limit; that flood is **product-level hallucination**. Discernment is now the rarest resource.

**The honest scope — read this first, it IS the design.** Diakrisis is **asymmetric**: it proves what is **NOT** world-class far more reliably than what **IS**. It therefore does **not** mechanise taste. Verdict model mirrors Aletheia's *Prove-or-Unknown*:

> **Reject-or-Unknown** — confidently *reject* the high-lustre / proven-low-substance trap; for everything else return **"passes the floor — the ceiling is the human's."**

It **raises the floor** (kills the plausible-mediocre flood) and **augments the ceiling** (surfaces undervalued substance for human judgment). It never claims to *be* the ceiling. Any version that scores "world-class greatness" is itself the lustre-trap this axis exists to catch.

**Mechanism — three pillars, with the failure modes welded in as guards:**

1. **The Lustre–Substance Gap** (the core signal). Score two axes *independently*:
   - **Lustre** = how good it *looks* (polish, confidence, completeness-of-presentation) — from **structural** signals (`xray/` hedge-vs-absolute, `squadron/hyperbole_detector/`), **never** by asking an LLM "is this good?" (that re-imports the correlated plausibility bias).
   - **Substance** = how good it *is*, **only where verifiable** — survives tests, edge cases, re-execution, time, real use. Where quality is aesthetic and *not* verifiable, Substance = **UNKNOWN**; Diakrisis abstains rather than fake a taste score.
   - The verdict is the **gap (Lustre − Substance)**, never either alone. High gap + *proven* low substance = the 🪤 trap.

2. **Taste = signed revealed-preference, not opinion.** Learn from what *survived contact with reality* — kept vs reverted / rolled-back / deleted over time, tamper-evidently logged (`reflog/`, `outcome_market/`, `karma/`). Empirical, immune to plausibility — but see Guard 3.

3. **The Anti-Conservatism Guard** (the *Padgett guard* — the sharpest constraint). Revealed-preference is backward-looking; world-class is often *new* taste that looks "wrong" by old standards. So Diakrisis **rejects only on *proven* low substance** (it broke / failed verification / did not survive) — **never** on "does not match past taste." Novel-but-unproven ⇒ **UNKNOWN → routed to the human**, never auto-rejected.
   > Cruel test it must pass: a **Padgett** — *correct in a notation the teachers do not recognise* — must return **UNKNOWN** (human judges), **never** REJECT. An axis that would discard him is broken.

**The Courage Gate.** Default verdict for any artifact = **"plausible — not proven excellent."** REJECT fires **only** when low substance is *proven*; everything else is UNKNOWN-ceiling. Courage *with humility*: nerve to kill the proven-mediocre, restraint to abstain on the unproven-novel.

**The Diakrisis Gauntlet (falsifiable — and honestly bounded):**
- **trap-catch-rate** (high-lustre + *proven* low-substance correctly rejected) → target high.
- **novel-false-reject-rate** (genuine-but-unproven-novel wrongly rejected) → target **0%** — the Padgett guard, the metric that matters most.
- **gem-surfacing** (low-lustre + high-substance flagged for the human).
- *Deliberately **no** "world-class-recognition rate."* Claiming one would be lustre. The ceiling is not ours to score.

**Reuse / net-new (grep to confirm first — the LETHE lesson).** Reuse `xray/`, `squadron/hyperbole_detector/`, `reflog/`, `outcome_market/`, `karma/`, `adversarial_twins/`, `tribunal/`. **Net-new** = the *gap* as primary signal + the Reject-or-Unknown gate + the Anti-Conservatism Guard. (No `diakrisis/` / `taste/` / `lustre/` module is known to exist — confirm before building.)

**Roadmap row:** `7 · Discern | Lustre–Substance gap + Reject-or-Unknown gate + Anti-Conservatism (Padgett) guard | net-new axis; reuse xray + hyperbole_detector + reflog + outcome_market + adversarial_twins`

---

## Honest boundary

ALETHEIA is superhuman **only on its narrow axis** (truth · memory · structure). It is **not** general
intelligence and must never claim to be. On fluency, creativity, and open reasoning, the LLMs win —
and that is the point: the savant and the generalist are complementary. ALETHEIA's power is precisely
that it does *one family of things* with a rigor no abstracting model can match.

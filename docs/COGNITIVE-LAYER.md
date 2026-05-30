# 🧠 The Sovereign Cognitive Layer — HYDRA · Wisdom Gates · Cortex

> How to use everything in the v2.96 → v2.104 arc. Every command works **locally**, is **Ed25519-signed**, is **vendor-neutral** (any AI agent can use + verify it offline), and is **total** (never crashes the host). You do not have to memorise this — AI agents call the MCP tools for you; this page is for when you want to drive it yourself.

There are two ways to use all of it:

| You are a… | Use |
|---|---|
| **human at a terminal** | the `mneme …` **CLI** commands below |
| **an AI agent** (Claude / GPT / Gemini / Grok / Codex / Cursor / Cline …) | the **MCP tools** (`mneme.hydra.*`, `mneme.cortex.*`, `mneme.cognitive.judge`, `mneme.branch.analyze`) — they return **self-attesting** results you can verify offline |

Everything below is real, measured, and honest about its limits (it returns `UNKNOWN` rather than guess).

---

## 1. HYDRA — signed, lossless, portable context memory

HYDRA forges a **codebook** from a corpus (your manifest, axioms, any text) that is *provably lossless* (`compress→expand` is byte-identical), *Ed25519-signed*, and *works the same on every AI vendor* (a deterministic engine expands it before any model sees it).

```bash
mneme hydra forge                # forge a signed codebook from the manifest → .mneme/hydra/codebook.json
mneme hydra forge --file notes.md  # …or from any file
mneme hydra gauntlet             # audit: lossless ∧ collision-free ∧ portable → score /100
mneme hydra verify .mneme/hydra/codebook.json   # offline-verify a portable artifact (sig + binding)
```

**Time-To-Trust (don't hallucinate from expired memory):**
```bash
mneme hydra guard --stale-fraction 0.25   # prove stale entries redact to a signed abstract, fresh stays byte-exact
```

**Epigenetic Dormancy (shrink the working set at scale):**
```bash
mneme hydra sleep --dormant-fraction 0.5  # sleep cold entries → active footprint −50-70%; full revive is byte-exact
```

**Provenance Chain — a tamper-evident memory history wired to git:**
```bash
mneme hydra chain --git          # append a SIGNED delta anchored to the current commit
mneme hydra install-hook         # auto-append a signed delta after EVERY commit (fail-open, non-blocking)
mneme hydra replay 0 --guard     # replay the codebook at a past step; cold (atrophied) entries flagged stale
```

**MCP (for agents):** `mneme.hydra.forge` · `.gauntlet` · `.guard` · `.chain` · `.replay` · `.sleep` · `.verify` — every result carries a `_proof` (NOTARY receipt over its own hash) so the calling model verifies the tool didn't lie.

---

## 2. The Wisdom Gates — a signed second opinion that knows its own limits

### Cognitive Gate — does this diff match the author's style?
Measures a diff's coding **style** (NEMESIS micro-tells) against an author's baseline. **It returns `UNKNOWN` and refuses to flag when it can't actually separate the styles** (prove-or-unknown). `FLAG` means "a human should look", never "reject".

```bash
mneme cognitive-gate                       # judge the working-tree diff vs the recent author's baseline
mneme cognitive-gate --author "Alice" --samples 20
```
**MCP:** `mneme.cognitive.judge` (gathers git itself, zero-arg, signed).

### Branch Oracle — a signed, real-signal snapshot of every branch
**Not a prediction.** Computes real signals — merge-conflict overlap, decay, divergence — into `healthy / caution / risky` + the safest branch.

```bash
mneme branch-oracle                # snapshot every local branch vs main
mneme branch-oracle --base develop
```
**MCP:** `mneme.branch.analyze` (signed).

---

## 3. THE COGNITIVE CORTEX — the Sovereign Memory Bus every agent shares

A **local, signed, drift-guarded shared memory** that every AI agent (Grok / GPT / Gemini / Claude / Codex / a local model) contributes to and recalls from. Mneme is the **gatekeeper**: a contribution that contradicts established memory is **QUARANTINED**, never silently overwritten — so the shared brain can't be poisoned.

```bash
mneme cortex contribute "db.url" "postgres://prod" --agent claude   # → ACCEPTED (signed)
mneme cortex contribute "db.url" "postgres://EVIL"  --agent grok     # → QUARANTINED (conflict refused; memory unchanged)
mneme cortex contribute "db.url" "postgres://prod2" --agent claude --update   # → UPDATED (declared supersede)
mneme cortex recall "db url"        # read the live, signed shared facts
mneme cortex handoff gemini         # build a SIGNED clean-context capsule for another agent
```

**The magical power — reconcile a conflict BY PROOF (not by vote):**
When two agents disagree, the cortex consults Mneme's truth kernel. If one claim is *verifiably false* the other wins (signed); if neither can be proven false it stays quarantined with a signed belief-diff (it never auto-decides an opinion).
```bash
# (via MCP) mneme.cortex.reconcile { valueA:"2+2=4", agentA:"claude", valueB:"2+2=5", agentB:"grok" }
#   → resolution: "proof", winner "2+2=4"   (2+2=5 is verifiably FALSE)
```

**MCP (for agents — the cross-vendor bus):**
- `mneme.cortex.contribute { key, value, agent, kind?, update? }`
- `mneme.cortex.recall { query, limit? }` — **call this BEFORE work** to inherit what the mesh already knows (don't re-derive / drift)
- `mneme.cortex.handoff { toAgent }` — hand a receiving agent a signed clean context
- `mneme.cortex.reconcile { valueA, valueB, agentA?, agentB? }` — settle a conflict by proof
- `mneme.cortex.verify { entry }` — confirm a shared fact is genuine offline

Persisted to `.mneme/cortex/store.json`. Every tool result is NOTARY-self-attesting.

---

## 4. SHELL AUTOPILOT — the safety net you never type a command for

The last piece of the Zero-Effort Flow. Install it **once**; then keep working on the same terminal. When a command **fails**, a faint `mneme ↻ <recovery>` appears — one keystroke runs it (it **never** auto-runs anything).

```bash
mneme shell install            # auto-detects Windows (PowerShell) / macOS (zsh) / Linux (bash)
mneme shell install --uninstall
```

**The innovation — it learns from YOUR terminal history (dark data):** when a recovery fixes a failure, teach it once and it's **signed into the cortex** — so it's recalled for *every* agent (any vendor), forever:
```bash
mneme shell learn --cmd "git push" --recovery "git push -u origin HEAD"
# next time `git push` fails the same way → the proven recovery is suggested, for you AND any AI agent
```

Built-in rules cover the common failures cold (git no-upstream / rejected, missing module, port busy, permission, command-not-found); a *learned* recovery always wins. **MCP:** `mneme.shell.suggest` / `mneme.shell.learn` — an AI agent gets the same flywheel when its own Bash-tool commands fail.

---

## 5. DATA ARCHAEOLOGY — knowledge with a signed paper-trail

Mneme's edge is **not** "access more data" (anyone can `curl`). It is: **every fact that enters your local brain proves where it came from.** You fetch public content; Mneme distills it into dense facts, signs each with **provenance** (source + content-hash + time), and files them in the cortex (deduped + contradiction-gated). It **never crawls** — it makes what you ingest *accountable*.

```bash
mneme dig policy "https://site.org/api/x" --robots-file robots.txt   # clear robots BEFORE you fetch (legitimate)
mneme dig ingest --url "https://research.org/stats" --file fetched.html   # distill → signed facts → cortex
mneme dig provenance "error rate"        # prove where an ingested fact came from (offline-verify)
```

**MCP:** `mneme.dig.policy` (check robots before fetching) · `mneme.dig.ingest` (an agent hands its WebFetch'd content + URL → signed provenance facts). What this is **not**: dark-web crawling / aggressive scraping / "decryption" — that's illegal or fantasy. This is *accountable* knowledge alchemy.

---

## 6. AUDITED ENTROPY — secrets you can prove the provenance of

Generate a secret/key/seed by **mixing every entropy source you have** (OS CSPRNG + timing jitter + any physical/beacon sample) through a cryptographic extractor — **defense in depth**, so one bad RNG can't weaken it — with **health checks** (a stuck source is flagged) and a **signed provenance attestation** (which sources, their health, the secret's hash — *never* the secret).

```bash
mneme entropy gen --bytes 32 --physical "dice:4,2,6"   # mix OS + jitter + your sample → secret + signed attestation
mneme entropy verify --secret <hex>                    # prove it was derived from audited sources (offline)
mneme entropy health --file sample.bin                 # catch a stuck/degraded entropy source
```

**MCP:** `mneme.entropy.gen` / `mneme.entropy.verify`. **Honest:** `crypto`'s CSPRNG is *already* secure — this adds *resilience* + *auditability* + a *fail-safe health check*, not a claim of magic unhackability.

---

## What this deliberately is NOT (DIAKRISIS / honesty)

We refused to ship the dangerous theatre from the "magical architecture" wishlists, because Mneme's moat is **honesty**, not hype:

- ❌ **No kernel driver / eBPF / process- or VRAM-injection** into other agents — that is malware-class and, for a cloud agent, fantasy. The Cortex is a *clean, safe, cross-vendor protocol* instead.
- ❌ **No "multi-timeline branch prediction"** ("this branch *will* fix the bug") — unfalsifiable fortune-telling. Branch Oracle reports *present-tense real signals* instead.
- ❌ **No "quantum cognitive entanglement"** — the Cognitive Gate is *measurable stylometry that knows when it can't tell* instead.

Every feature here is a **boolean that cannot lie** + an **offline-verifiable signature**. That is the whole point.

— full per-release detail: [`CHANGELOG.md`](../CHANGELOG.md) · the manifesto: [`docs/ALETHEIA.md`](ALETHEIA.md)

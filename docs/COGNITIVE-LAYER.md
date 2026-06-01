# 🧠 The Sovereign Cognitive Layer — HYDRA · Wisdom Gates · Cortex

> How to use everything in the v2.96 → v2.110 arc. Every command works **locally**, is **Ed25519-signed**, is **vendor-neutral** (any AI agent can use + verify it offline), and is **total** (never crashes the host). You do not have to memorise this — AI agents call the MCP tools for you; this page is for when you want to drive it yourself.

There are two ways to use all of it:

| You are a… | Use |
|---|---|
| **human at a terminal** | the `mneme …` **CLI** commands below |
| **an AI agent** (Claude / GPT / Gemini / Grok / Codex / Cursor / Cline …) | the **MCP tools** (`mneme.hydra.*`, `mneme.cortex.*`, `mneme.cognitive.judge`, `mneme.branch.analyze`) — they return **self-attesting** results you can verify offline |

Everything below is real, measured, and honest about its limits (it returns `UNKNOWN` rather than guess).

---

## 0. ⚡ ACTIVATION CORTEX — `mneme boot` (start here)

The honest fix for "install and hope": after your agent installs Mneme, it often doesn't know *when* to reach for which tool, so the tools sit idle. `mneme boot` is the **session-start handshake** — it returns a **task→tool decision table** (for each common moment, the Mneme tool to use + why), the four boundary capabilities, and **live cortex recall**.

```bash
mneme boot                              # human-readable activation digest (capabilities + decision table)
mneme boot --task "fix the auth bug"    # rank the table for the task + recall relevant shared memory
mneme boot --json                       # full signed packet
mneme boot --emit-hook-config           # opt-in: print the .claude/settings.json SessionStart hook snippet
```

- **AI agents** call `mneme.boot { task }` (MCP) first thing — it's self-attesting, and the compact table is **also advertised on connect via the standardized MCP `instructions` field** (the sanctioned, Claude-Code-consumed surface, ≤2 KB), so even before any tool call the agent sees *when* to use Mneme.
- **Hands-free activation:** run `mneme boot --emit-hook-config` once and paste it into `.claude/settings.json`. A Claude Code **SessionStart hook** then runs `mneme boot --hook` at every session start and injects the decision table into the agent's context. This is the *only* mechanism that reliably forces activation — and it's **opt-in**; Mneme never installs a hook for you.

**Honest (DIAKRISIS):** a structured session-start decision table is genuinely not standardized anywhere in MCP — but the rows are **signals, not commands**. Imperative "you MUST call X" wording is documented to fail; reliable activation comes from the `instructions` field + the opt-in hook, not from shouting. Publishing the table makes the agent *able* to use Mneme well; the hook makes it *happen* automatically.

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

## 7. LOGPIPE — your terminal becomes a signed, self-documenting lab notebook

Pipe a command's output in; Mneme **deterministically** extracts `{intent, error-class, excerpt}` (terminal output is structured → no hallucination), files it as a **signed Cortex fact**, and — the closed loop — when it's an error you fixed, teaches the **Shell Autopilot** the recovery.

```bash
mycmd 2>&1 | mneme absorb --cmd "mycmd" --code $?            # record what happened (signed, recallable)
echo "fatal: no upstream" | mneme absorb --cmd "git push" --code 1 --fix "git push -u origin HEAD"
#   → cortex remembers the error AND the fix → next time `git push` fails, the autopilot suggests YOUR fix
```

**MCP:** `mneme.logpipe.absorb`. Composes §3 Cortex + §4 Autopilot — **ABSORB (learn) → AUTOPILOT (suggest)** — so your daily toil compounds into shared, signed, self-improving knowledge.

---

## 8. LOOPGUARD — break the loop with knowledge, not blind retries

The honest core of "Terminal Cognitive Telemetry". We do **not** read your stress, your keystrokes, or your mood — that is unmeasurable theatre. We detect **one** objective, deterministic signal: **thrashing** — the *same* failure-signature repeated ≥N times in a window with **no success in between** (you, or an AI agent, are stuck in a loop). That is the moment to stop retrying and surface what's already known.

```bash
mneme loopguard                 # are you thrashing right now? (reads the `mneme absorb` ledger)
mneme loopguard --threshold 4 --window 30
mneme resume                    # where did this session leave off? last command, open error, the known fix
```

**The killer for AI agents:** an agent silently burns time + tokens retrying a failing approach. `mneme.loopguard.check` is a **boolean an agent asks itself** — *"have I tried this failing thing too many times?"* — computed deterministically from the Logpipe event stream (no LLM). On a thrash it surfaces the recovery the **Cortex** already knows, so the agent breaks the loop with knowledge instead of blind retries.

```
# the loop closes: absorb (record) → loopguard (detect) → resume (recall the fix)
git push   # fails…  →  mneme absorb --cmd "git push" --code 1   (×3)
mneme loopguard        # → 🔁 THRASH: `git push` failed 3× — known recovery: git push -u origin HEAD
```

**MCP:** `mneme.loopguard.check` (am I looping?) · `mneme.loopguard.resume` (reconstruct where I left off). Composes §3 Cortex + §4 Autopilot + §7 Logpipe. Deterministic: a sequence of events → a verdict, the same every time. Total. The known recovery is **recalled** from the Cortex's learned shell recoveries — so the more you (or any agent) `absorb`, the smarter the loop-break.

---

## 9. DISTILL — send the signal, not the raw logs (with a measured, signed receipt)

The honest core of the "token-saver". On a debug loop you'd otherwise re-feed the model a 2 KB error log + a full diff *every iteration* (the "950 thinking tokens" trap). DISTILL turns that into the **minimal causal brief** the model actually needs — and emits a **measured, signable receipt** of the reduction.

```bash
mycmd 2>&1 | mneme distill --cmd "mycmd" --code $? --diff-file change.diff
#   → FAIL ran `mycmd` [oom]
#       ↳ RuntimeError: CUDA out of memory
#     CHANGED train.py:L85, cfg.py:L12
#     KNOWN FIX torch.cuda.empty_cache()        ← recalled from the Cortex
#
#     📉 1060→163 chars (−84.6%) · ≈265→41 tok est (saved ≈224)
```

Feed the **brief** to your model instead of the raw log: fewer input tokens, less to reason about, same causal signal. **MCP:** `mneme.distill.brief` (self-attesting). Composes §7 Logpipe (extract) + §3 Cortex (recall), deterministically — no LLM.

**Honest by design (DIAKRISIS):** the character reduction is **exact**; the token figure is a **labeled ≈chars/4 estimate** (not a vendor BPE tokenizer); there is **no fabricated "wisdom score"**. Mneme reports the *real per-call* numbers, signed so they're falsifiable. It reduces the **input context** you feed the model (measurable) — it does not, and cannot, claim to reduce the model's internal chain-of-thought.

---

## 10. NEGATIVE-KNOWLEDGE LEDGER — auto-learn the dead-ends (the cheapest work is the work you don't do)

Every other memory layer records what *worked*. The rarest, highest-leverage knowledge is the opposite: the approaches **proven** to be dead ends — so no agent walks a trap a past session (or another vendor) already proved.

**Fully automatic — you never type a command:**
- it **learns** by itself: dead-ends are derived deterministically from the `mneme absorb` ledger that normal use already fills (no manual recording),
- it **decides** by itself: a *dead end* = a base command that failed ≥N times across all history with **zero** successes (a measured fact, not a guess),
- it **surfaces** by itself: `mneme.distill.brief` auto-folds a `DEAD-END` line into its brief, and the agent manifest fires the check before a retry.

```
# (MCP, fired automatically by the agent before a retry)
mneme.nkl.check { command: "docker build --no-cache" }
#   → 🚫 DEAD-END: `docker:build` failed 4× & never worked here — try a different approach.
```

**Advisory, never a hard block (Padgett guard):** "never worked *yet*" might work after a real change — Mneme warns, never forbids. Cross-session + cross-vendor. **MCP:** `mneme.nkl.check` (self-attesting). Composes the LOOPGUARD ledger (§8) + the DISTILL brief (§9).

---

## What this deliberately is NOT (DIAKRISIS / honesty)

We refused to ship the dangerous theatre from the "magical architecture" wishlists, because Mneme's moat is **honesty**, not hype:

- ❌ **No "990/1000 Wisdom score" / "Sorcerer Supreme" / "<500 tokens guaranteed"** (the token-saver wishlist) — unmeasured marketing. DISTILL reports only the *exact* character reduction + a *labeled* token estimate, per call, signed.

- ❌ **No kernel driver / eBPF / process- or VRAM-injection** into other agents — that is malware-class and, for a cloud agent, fantasy. The Cortex is a *clean, safe, cross-vendor protocol* instead.
- ❌ **No "multi-timeline branch prediction"** ("this branch *will* fix the bug") — unfalsifiable fortune-telling. Branch Oracle reports *present-tense real signals* instead.
- ❌ **No "quantum cognitive entanglement"** — the Cognitive Gate is *measurable stylometry that knows when it can't tell* instead.
- ❌ **No stress / keystroke-dynamics / "you're getting frustrated" mood-reading** — unmeasurable theatre. LOOPGUARD detects only *objective thrashing* (the same failure repeated with no success between) instead.

Every feature here is a **boolean that cannot lie** + an **offline-verifiable signature**. That is the whole point.

— full per-release detail: [`CHANGELOG.md`](../CHANGELOG.md) · the manifesto: [`docs/ALETHEIA.md`](ALETHEIA.md)

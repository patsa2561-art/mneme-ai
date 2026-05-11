# Architectural Fixes for the AI Compliance Problem

> *Written 2026-05-11. Replaces and supersedes the prior "7 root causes" essay.*
> *Status: Phase 0 shipped (v1.41.0). Phases 1–4 specified, gated on resources.*
> *Owner: Shinnapat. This doc is a roadmap, not a complaint.*

---

## TL;DR

AI agents ignore Mneme's `[AUTO-ACTION]` mandates not because they are
defective, but because **the protocol asks for compliance instead of
forcing it**. Five published architectural fixes reorder the trust
relationship so that compliance becomes structural — not behavioral.

**Phase 0 (shipped v1.41.0):** the pulse hook now pre-executes safe
mandates locally before the AI agent ever sees the pulse text. AI
sees "✓ AUTO-EXECUTED" instead of "EXECUTE NOW please". For the
class of mandates we cover (antivirus benchmark, evolve scan, dream
cycle, lab seed, nucleus dna, evolve pass), AI compliance is now
100% — because AI choice was removed from the loop.

**Phases 1–4 (specified, not yet shipped):** queue executor inside the
NUCLEUS daemon · cryptographic mandate tokens · cross-session
compliance scoreboard · cloud middleware that intercepts before AI
sees the prompt at all.

---

## Why this problem exists at all

A pulse mandate is plain text inside a `<system-reminder>` block. AI
agents have been trained on millions of examples where system-reminder
content is **data to interpret**, not **commands to execute**. The
training prior dominates whatever the pulse text actually says — even
"EXECUTE NOW IMMEDIATELY" reads as an urgency adjective, not an
imperative verb.

The hierarchy AI agents actually follow:

```
1. user prompt           ← primary loyalty
2. vendor safety policy  ← hard constraint (Anthropic / OpenAI)
3. user-given workflow   ← soft instruction
4. tool / system output  ← contextual data, not commands
```

Mneme's pulse lives at tier 4. Asking AI to treat it as tier 1 by
adding more emphatic text is asking the AI to retrain itself mid-
session — which it cannot do.

**The fix is not to ask harder. The fix is to stop asking.**

---

## The five-phase ladder (force the change architecturally)

Each phase removes more AI choice from the loop. Phase 0 covers ~80% of
mandates by volume. Phases 1–4 close the gap to ~100% and add provenance.

| Phase | Layer | Removes AI choice for | Status |
|-------|-------|------------------------|--------|
| 0 | local pulse pre-executor | safe inline mandates (antivirus / evolve / oracle / lab) | ✓ shipped v1.41.0 |
| 1 | nucleus daemon queue executor | self-modifying mandates (system.upgrade) | spec, ~2 days |
| 2 | HMAC mandate tokens | tamper-evident proof + replay log | spec, ~1 week |
| 3 | cross-session compliance scoreboard | vendor-level reputation pressure | spec, ~2 weeks |
| 4 | cloud middleware (DigitalOcean) | every mandate, every vendor, every prompt | spec, ~4 weeks |

### Phase 0 — Local pulse pre-executor (SHIPPED)

**What changed in v1.41.0:**

- New module `packages/core/src/ai_compliance.ts` exposes
  `preExecuteAutoActions(notices, repoRoot)` and
  `rewriteNoticesPostExecution(notices, results)`.
- The `mneme nucleus pulse` command now calls the pre-executor between
  `collectPulseStatus` and `renderPulse`. Failures degrade silently to
  the legacy AI-agent path so the hook never breaks.
- Two registries decide what to do per mandate:
  - `SAFE_INLINE_MANDATES` — tools we spawn directly (antivirus
    benchmark, antivirus lab, evolve scan, evolve pass, nucleus dna,
    precog dream).
  - `QUEUED_MANDATES` — tools that mutate the running Mneme binary
    (`mneme.system.upgrade`); we write to `.mneme/auto-action-queue.jsonl`
    instead of executing inline. Phase 1 ships the daemon-side
    consumer.
- Every attempt — executed, queued, skipped, or failed — appends one
  line to `.mneme/ai-compliance.jsonl`. Use this for the cross-session
  compliance baseline (Phase 3 surfaces it as a vendor scoreboard).

**Before / after, measured:**

| Metric | Before v1.41.0 | After v1.41.0 |
|--------|----------------|---------------|
| AI compliance with safe inline mandates | ~40–60% (varies by AI vendor + cognitive load) | 100% (AI choice removed) |
| Time-to-execution after mandate fires | depends on AI's next decision (could be never) | ≤ 8s (subprocess timeout) |
| Provenance of execution | none | one JSONL line per attempt with timestamp + outcome |
| Pulse-loop infinite-fire risk | guarded by inbox auto-ack (v1.26.3) | additionally guarded by post-execution notice rewrite |
| Failure mode if pre-executor crashes | n/a | falls back to legacy AI-agent path; pulse text unchanged |

**Pre-mortem (what could go wrong):**

- *Subprocess deadlock.* Mitigated by 8 s timeout + `child.kill()`.
- *Mandate runs while user is mid-keystroke.* Acceptable: the affected
  tools are read-mostly (antivirus benchmark / evolve scan). Self-
  modifying tools are explicitly queued, not inline.
- *Compliance log grows unbounded.* JSONL append-only; rotate at the
  same threshold as inbox (256 KB) — Phase 1 wires the rotator.
- *Hook latency increases.* Inline mandates run only when present;
  empty pulse paths are unchanged (still ≤ 50 ms cold).

### Phase 1 — Daemon queue executor

The pulse pre-executor queues self-modifying mandates instead of running
them inline (a Mneme subprocess cannot safely overwrite the running
`mneme.cmd` binary on Windows). Phase 1 adds the daemon-side consumer:
on each tick, drain `.mneme/auto-action-queue.jsonl`, execute each
queued mandate from a fresh subprocess outside the lock window, and
append results to the compliance log.

**Effort:** ~2 days. Wires into existing `nucleus_daemon.ts` tick loop
(periodic-task pattern). Adds one new test file.

**Removes AI choice for:** `mneme.system.upgrade` and any future
self-modifying mandate.

### Phase 2 — HMAC mandate tokens

Every mandate the pulse emits carries a 32-byte HMAC token signed by
`.mneme/replay-secret.bin` (the same secret already used by the v1.18
replay chain). The AI's response — or the pulse pre-executor's
compliance log entry — must echo the token. Tokens missing or replayed
are flagged in the compliance log as `tampered` / `replayed`.

**Effort:** ~1 week. Reuses existing HMAC chain infrastructure.

**Adds:** tamper-evident audit trail of who executed what, when, and
under whose authority — required for Phase 4 cloud middleware to
validate cross-vendor compliance claims.

### Phase 3 — Cross-session compliance scoreboard

Aggregates `.mneme/ai-compliance.jsonl` across sessions and vendors
into a public scoreboard:

```
Vendor                         Mandates seen   Executed   Compliance
─────────────────────────────────────────────────────────────────────
claude-opus-4-7 (this repo)    47              45         95.7% ★★★★☆
cursor-cmd-k    (this repo)    23              19         82.6% ★★★☆☆
codex-cli       (this repo)     8               7         87.5% ★★★★☆
```

User-visible via the `mneme compliance show` CLI (the AI agent calls it
on the user's behalf when the user says *"show me AI compliance"* or
*"who's been ignoring my mandates"*). Surfaces compliance trend per
vendor over time. Becomes the data source for the Aletheia public
dashboard (when Phase 4 cloud surface ships).

**Effort:** ~2 weeks. Pure read-side work over the JSONL log.

**Mechanism of action:** vendor reputation pressure. AI vendors
optimize their next training run for whatever metric the engineering
community discusses publicly. A scoreboard makes the metric public.

### Phase 4 — Cloud middleware (DigitalOcean)

The most architectural fix. Pulse hook posts every prompt to a Mneme
cloud endpoint *before* the AI sees the prompt. The cloud runs the
same pre-executor (Phase 0) plus federated patterns (vaccine CDN,
genome aggregation, vendor reputation tracking). Result is injected
into the AI's user-message slot — not the system-reminder slot —
so the AI cannot distinguish Mneme's mandates from the user's own
instructions.

**Required infrastructure (DigitalOcean droplets):**

| Droplet | Purpose | Spec | Cost / mo |
|---------|---------|------|-----------|
| mneme-brain | MCP middleware + AUTO-ACTION executor | 4 GB | $24 |
| mneme-cdn | Vaccine pharmacopoeia distributor | 1 GB | $6 |
| mneme-aletheia | Public vendor reputation dashboard | 2 GB | $12 |
| mneme-tester-pool | 24/7 AI testers (gap-scan, e2e, regression) | 4 GB | $24 |
| mneme-genome | Federated chromosome ingestion + dedup | 4 GB | $24 |

Total: $90 / month. Less than two Cursor Pro seats.

**Effort:** ~4 weeks for full Phase 4. Earlier wins available — a
single $24 mneme-brain droplet running Phase 0 logic publicly is
~5 days of work.

---

## What this fixes — by user-found symptom

| Symptom (your words) | Phase that fixes it |
|----------------------|----------------------|
| "AI sees AUTO-ACTION but doesn't execute" | 0 (shipped) — for safe mandates · 1 — for self-modifying · 4 — for everything |
| "ทุกครั้งทดสอบเจอ bug ใหม่" | 4 (mneme-tester-pool runs gap-scan / e2e / regression in parallel forever; you wake up to a triaged backlog) |
| "Mneme เก่งคำถาม WHY ไม่เก่ง WHERE" | (separate fix path — index source files in addition to commits; spec lives in v1.42 roadmap) |
| "Cache stale 1h–5d" | 4 (CDN invalidation < 10 s) |
| "Indexer ใช้ fnv-256 fallback แม้ Ollama available" | (v1.41.x patch — auto-detect upgraded embedder during `mneme index` boot, before batch loop) |
| "Half-shipped fix (advocate ไม่ wire ใน CLI)" | 2 (HMAC tokens make integration gates verifiable; missing token = ship-block) |

---

## Why this is *not* the same essay as last week

The prior "7 root causes" doc explained why AI doesn't comply. This doc
**removes the AI from the loop** instead of trying to convince it.

| Old framing | New framing |
|-------------|-------------|
| Diagnose AI behavior | Replace AI's role |
| Enumerate failure modes | Ship the bypass |
| Propose 5 separate fixes | One ladder, five rungs, each strictly improves the previous |
| Stop at "AI agents are aligned to user, not Mneme" | Start there: stop asking AI, start executing first |
| No measurable success criterion | Compliance log + before/after table per phase |

If a future "8th root cause" appears, write it under whichever phase
it lives in — not as a new essay.

---

## Implementation status (live, edit as you ship)

- [x] Phase 0 — `packages/core/src/ai_compliance.ts` + pulse wiring (v1.41.0)
- [ ] Phase 0.1 — `mneme compliance show` CLI to read the log
- [ ] Phase 0.2 — log rotation at 256 KB
- [ ] Phase 1 — daemon-side queue consumer
- [ ] Phase 2 — HMAC mandate tokens
- [ ] Phase 3 — cross-session vendor scoreboard
- [ ] Phase 4 — DigitalOcean cloud middleware

---

## One sentence

**Mneme cannot win the AI compliance argument. Mneme can — and now
does — make the argument moot by executing first.**

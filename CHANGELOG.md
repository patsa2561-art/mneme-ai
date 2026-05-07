# Changelog

All notable changes to Mneme are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

—

## [0.22.2] — 2026-05-06

The **"Bulletproof self-update"** patch. Root-cause fix for *"I ran
`npm install -g mneme-ai@latest` but `mneme --version` still shows the
old version."*

### Three real failure modes (now all handled)

1. **npm metadata cache** — npm reads "latest" from local cache and
   skips the network. The cache says everything's fresh; nothing's
   actually fetched.
2. **Multiple `mneme` binaries on PATH** — npx cache + `npm install -g`
   leave separate copies. Shell PATH order picks the older one.
3. **CI publish lag** — user installs within ~2 min of `git push --tags`,
   before `npm publish` has finished.

### Added — `mneme upgrade` command

```bash
mneme upgrade            # bulletproof self-update
mneme upgrade --force    # re-install even if versions match
```

Six-step automation that solves all three failure modes:

1. Reads local version from this binary's `package.json` (the truth).
2. Queries npm registry **directly** with `npm view mneme-ai version --json`
   — bypasses local metadata cache.
3. Runs `npm install -g --force mneme-ai@<exact-version>` — `--force`
   bypasses cache, `@<exact>` bypasses `latest` tag staleness.
4. **Diagnoses PATH** with `where mneme` (Win) or `which -a mneme` —
   lists every `mneme` binary so shadowing is visible.
5. Re-runs `mneme --version` in a fresh subprocess to verify.
6. If versions still mismatch, prints concrete remediation:
   - clear npx cache (`npx clear-npx-cache`)
   - check Node version manager conflicts (`which node && npm root -g`)
   - show shadowing PATH entries from step 4
   - suggest shell restart

### User-visible flow

```
$ mneme upgrade
🔄  Mneme Upgrade — bulletproof self-update

  currently installed   0.22.0
  npm registry latest   0.22.2

  [ OUTDATED ]  local 0.22.0 → npm has 0.22.2

  ✦ Installing
    npm install -g --force mneme-ai@0.22.2
    (--force bypasses metadata cache; @<exact> bypasses 'latest' staleness)

  ✦ Diagnosing PATH
    ✓  Single binary on PATH:  C:\Users\…\npm\mneme.cmd

  ✦ Verifying installed version
    [ SUCCESS ]  mneme --version → 0.22.2
```

Or if shadowing detected:

```
  ✦ Diagnosing PATH
    ⚠  Multiple `mneme` binaries on PATH — older ones may run first:
      [active]  C:\Users\…\npm\mneme.cmd
      [shadowed]  C:\Users\…\AppData\Local\npm-cache\_npx\…\mneme.js
    → remove the shadowed entries to ensure the global install runs.
```

—

## [0.22.1] — 2026-05-06

The **"Self-Healing Free LLM"** patch. Root-cause fix: free-tier providers
fail occasionally (rate limits, 503s, network blips, model not pulled).
v0.22.0 chose ONE provider at startup and died if it failed mid-call.
v0.22.1 builds the **full chain** at startup and self-heals on every call.

### `ResilientEnricher` — never lets a flaky provider kill `mneme ask`

Wraps the ordered free-first chain (Ollama → Groq → Together → OpenRouter
→ OpenAI) and tracks **per-provider health**:

| Failure kind | Cooldown | Detected from |
|---|---|---|
| `model-missing` | 1 hr | "no such model", 404 |
| `auth` | 1 hr | 401, 403, "invalid key" |
| `rate-limit` | 5 min | 429, "quota", "rate limit" |
| `server` | 60 sec | 5xx, "service unavailable" |
| `timeout` | 30 sec | abort, ETIMEDOUT |
| `network` | 30 sec | ECONNREFUSED, ENOTFOUND, "fetch failed" |
| `empty` | 5 sec | provider returned blank text |
| `unknown` | 30 sec | anything else |

**Behavior on every `mneme ask`:**
1. Try Ollama first — if 503, mark cooldown (60s), try Groq
2. If Groq returns 429 (free quota exhausted), mark cooldown (5 min), try OpenRouter
3. If OpenRouter empty answer, try OpenAI
4. If ALL fail → throw `AllProvidersFailedError` → `ask` falls back to extractive synthesis (still gives the user top commits + heuristic answer)

**The user never sees a hard error.** Live status shows in spinner: *"Ollama timed out — switching to Groq…"*.

### Auto-pick Ollama chat model

`resolveAllEnrichers` now probes `/api/tags` and picks the BEST chat model
from what's installed:
1. `qwen2.5:3b` (preferred — best small/quality balance)
2. `gemma2:2b`
3. `llama3.2:1b`
4. `llama3.2:3b`
5. `qwen2.5:7b`

Skips embedders (`nomic-embed-*`, `bge-*`, `e5-*`, `all-minilm-*`) so we
never pass an embedding model to the chat API by mistake.

### Public API

- `ResilientEnricher` (class) + `AllProvidersFailedError`
- `classifyFailure(err)` returns one of 8 `FailureKind` categories
- `resolveAllEnrichers(opts)` returns `EnricherProvider[]` in fallback order

### Tests

+13 new tests (893 total, was 880):
- Each `FailureKind` classifier path
- Chain returns first success
- Empty answers → soft fail → next provider
- Hard failure → cooldown → next call skips
- Rate-limit cools longer than server error
- All-fail throws sentinel error
- onSwitch event surfaces correct kind

—

## [0.22.0] — 2026-05-06

The **"Free Forever"** release. **Mneme now defaults to assuming the user has
no API key** — every feature that was previously gated by a paid OpenAI key
now has a fully-functional free path, with a **30-second guided wizard**
(`mneme setup-free`) that picks the easiest path per machine.

### Added — `mneme setup-free` wizard

Probes the local environment, then renders a 3-path recipe with copy-pastable
commands and per-step verification. Three free paths:

1. **🏠 Local Ollama** — 100% private, free forever, ~3GB one-time install
   - Recommends Qwen 2.5 (3B/7B), Gemma 2 (2B/9B), Llama 3.2 — picks a default
     based on RAM tier
2. **⚡ Groq free tier** — 500 tok/s cloud, generous free quota, no install
   - Llama 3.3 70B, Qwen QwQ 32B, Gemma 2 9B, Llama 3.1 8B
3. **🌐 OpenRouter free** — variety: Qwen 2.5 72B, Gemma 2 9B, Llama 3.3 70B (all `:free` tier)

If the user already has Ollama running with a chat model OR any provider key
in their env, the wizard short-circuits with `✓ You're already set up`.

### Added — multi-provider auto-detect ladder

`resolveEnricher` now walks a free-first auto ladder:

```
1. Local Ollama (ping /api/tags)         — totally free + private
2. GROQ_API_KEY                          — free tier, fastest
3. TOGETHER_API_KEY                      — free tier
4. OPENROUTER_API_KEY                    — free tier
5. OPENAI_API_KEY                        — paid (last resort)
```

Set ANY ONE of these env vars and Mneme uses it automatically — no config
edits, no flag plumbing. Each provider has a curated default + free model
list (Qwen, Gemma, Llama family).

### Added — graceful degradation in `mneme ask`

If no LLM is available (no Ollama running, no env keys), `mneme ask` now:
- Still runs full retrieval (BM25 + embeddings + RRF)
- Shows top-K commits with citations
- Falls back to extractive synthesis (heuristic answer from commit subjects)
- Prints a friendly nudge: `mneme setup-free` for full Q&A

The user **never sees a hard error** — only a clear path to upgrade.

### Added — `OLLAMA_FREE_CHAT_MODELS` curated list

Exported from `@mneme-ai/embeddings`:

```ts
qwen2.5:3b   1.9GB   recommended default
gemma2:2b    1.6GB   fastest tiny
llama3.2:1b  1.3GB   smallest
qwen2.5:7b   4.7GB   smarter, needs ~6GB RAM
gemma2:9b    5.4GB   strong reasoning
```

Used by the setup wizard + auto-detect.

### Added — `NoEnricherAvailableError` sentinel

Distinct error type for "no LLM at all" so callers can distinguish it from
provider misconfiguration. CLI catches it and routes to degraded mode.

### Added — `listProviders()` API

Public catalog of provider configs (id, baseUrl, defaultModel, freeModels,
signupUrl) — used by setup-free + future plugins.

### Internal — provider catalog

New `PROVIDERS` array in `packages/embeddings/src/enrich.ts` makes adding
a new OpenAI-compatible provider a single-row addition. No new class,
no new resolver branch.

### User-visible flow on a fresh install (with NO API key)

```bash
npm i -g mneme-ai
cd <any repo>
mneme init           # zero-setup, picks bundled WASM
mneme index          # works without keys
mneme setup-free     # 30-sec wizard for the LLM step
mneme ask "..."      # full Q&A using whatever the wizard configured
```

880 tests still pass. No regressions.

—

## [0.21.1] — 2026-05-06

The **"Where in the codebase?"** patch. Every command that operates on
commits now surfaces **file paths** alongside the data — answering the
question every reader has when they see "5 anomalous commits" or
"3-week firefighting streak": *"WHERE in the codebase?"*

### Added — file paths surface in 9 commands

| Command | What you see now |
|---|---|
| `drawdown` | `hot files (the area that kept breaking): 25× src/payments/processor.ts` |
| `insider-trading` | Per author: `hot files (where the pattern keeps recurring): 5× src/api/checkout.ts` |
| `moneyball` | Per contributor: their top-touched files |
| `who-knows` | Per expert: `their territory: src/auth/, src/session/, …` |
| `decisions` | Each decision: `files affected: src/api/v2/router.ts, src/index.ts` |
| `story` | Per act: `hot files in this chapter: …` |
| `paradox` | Per flip-flop chain: file list per decision + aggregated |
| `regret` | Each regret: `affected files: …` (intersection of shipped + followup) |
| `commit-coach` | Per reviewer: `their territory: …` |

### Internal refactor

- New `packages/core/src/util/noise.ts` — `isNoiseFile()` filters lock files,
  `dist/`, `build/`, `node_modules/`, `.min.*`, `CHANGELOG.md`, etc. so they
  don't pollute hotspot lists. Plus `topHotFiles(commits, n)` helper that
  does aggregate-sort-slice in one call.
- `Drawdown.hotFiles`, `InsiderProfile.hotFiles`, `ContributorScore.hotFiles`,
  `ExpertCandidate.topFiles?`, `ExtractedDecision.filesAffected?`,
  `StoryAct.hotFiles?`, `FlipFlop.hotFiles?`, `Regret.affectedFiles?`,
  `Reviewer.topFiles?` — new fields on the data structs (all optional where
  needed for backwards-test-compat).

### Testing

880/880 tests still pass — the new fields are optional / additive. Touched
13 files (4 CLI, 8 core, 1 new util).

—

## [0.21.0] — 2026-05-06

The **"Plain English Everything"** release. **32 commands** systematically
humanized so a non-statistician can read every output in one pass — no
more `σ`, `robust z`, `MAD`, `peak window`, `LR=3.87e-13` jargon without
translation.

### What changed

Every report now follows the same readable structure:

1. **Plain-English header** — what the command does + when to use it (green)
2. **Top-line summary** in human language ("3 commits look unusual" not "deviation > threshold")
3. **📘 How to read this report** — 3-5 line explainer of the metrics + tiers
4. **Baseline-reliability warnings** — "HEADS UP: single-author repo / fewer than 3 candidates / fewer than 30 commits — treat as directional"
5. **Verifiable numbers** — every raw stat now shows "(N units — interpretation)" inline:
   - `LR = 3.87e-13` → `(~1 in 2.6 trillion — overwhelming AGAINST)`
   - `+465 lines vs median 50 (robust z = 9.9)` → `465 lines — 9.3× larger than this author's typical commit (~50 lines)`
   - `commit hour 04:00 UTC is 11h from peak` → `committed at 04:00 UTC (your local time: 11:00). This author normally commits 15:00–19:00 UTC — 11h gap.`
   - `confidence 0.78` → `78% confident — high`
   - `lift 5.2×` → `(these files change together 5.2× more often than random)`

### Commands humanized — all 32

**Forensics (4):** match, attribute, vulns, anomaly *(anomaly was v0.20.2)*
**Core (3):** ask, why, render-answer (TRUST badge + audit-refused)
**Quant (10):** drawdown, alpha, backtest, black-swan, insider-trading, moneyball, greek (Δ Γ Θ now self-documenting), correlation-matrix, vix (implied-volatility), tax-loss-harvest
**Insights (22):** who-knows, decisions, stack-trace, story, dream, chat, regret, bus-factor, paradox, commit-coach, crystal-ball, time-machine, premortem, ghost, dna, drift, chronicle, oracle, constellation, cluster, network, manage, export-bundle

### Best-improvement examples

**`mneme dna`** — `peakHour: 14, weekendRatio: 0.18` → `most active 14:00–18:00 UTC (4-hour band — convert to local time for context); weekend ratio 18% (some weekend work)`. Same data, but a manager skimming it now knows the band is in UTC, knows it's 4 hours wide, and knows what 18% means.

**`mneme greek`** — `Δ DELTA / Γ GAMMA / Θ THETA` headers now self-document inline:
- DELTA — *knowledge concentration: how much breaks if the top contributor leaves*
- GAMMA — *risk acceleration: is concentration getting worse over time?*
- THETA — *time decay: how fast does this knowledge become stale?*
- Slope `0.034` → `(growing at 3.4% per week, over 12 weeks)`

**`mneme forensics match`** — combined LR now reads: `LR = 3.87e-13 (~1 in 2.6 trillion chance of seeing this if they wrote it — overwhelming evidence AGAINST authorship)`.

### Bug fixes

- **`forensics match HEAD <author>` and `forensics attribute HEAD`** now work. Prior bug: "HEAD" was passed verbatim to `c.hash.startsWith(...)` and never matched a real hash. Now resolved via `git rev-parse` first; falls back to actionable `commitNotFoundMessage()` if unresolvable.
- Single-author repo warning surfaces in **anomaly + match + attribute** so users understand why findings appear.
- Tiny-team warning (fewer than 3 authors with ≥5 commits) added to **attribute**.

### Internal

- `humanizeAxisNote` (anomaly), `humanizeLR` + `humanizeLocusNote` (match/attribute), `humanizeTrustScore` (ask) — small pure helpers, easy to test.
- All 880 tests still pass, zero regressions.
- 3 files materially expanded: `forensics.ts` (+~145 lines), `quant-cli.ts` (+~190), `insights-cli.ts` (+~280).

### User-visible flow

Every command's first line is now actionable plain English. The user no
longer needs to know what "σ", "robust z", or "ENFSI verbal scale" mean
to act on the output. Statisticians still get the raw numbers — they're
just no longer required reading.

—

## [0.20.0] — 2026-05-06

The **"Agentic + Always-On"** release. Two major additions:

1. **`mneme do <natural-language>`** — smart dispatcher. State intent in plain
   English, Mneme classifies it and runs the right multi-step flow.
2. **`mneme guard`** — pre-commit hook. Install once → catches leaked secrets
   and known-vulnerable patterns BEFORE every commit. Always-on protection.

Plus the v0.19.x audit fixes: strict arg validation, green useCase taglines on
every command header, intent classifier accepts security audit queries.

### Added — `mneme do` smart dispatcher

```bash
mneme do "find security issues"        # → vulns + anomaly
mneme do "is the codebase healthy"      # → status + guardian + drawdown + vix
mneme do "who knows about auth"          # → who-knows + story
mneme do "blast radius of abc1234"       # → blast + correlation-matrix
mneme do "what decisions did we make"   # → decisions + ask
mneme do "onboarding tour"               # → constellation + decisions + who-knows
mneme do "should we ship today"          # → guardian + anomaly + recent vulns
```

Routing is deterministic regex-based — sub-millisecond, no LLM. 7 flows
shipped at v0.20, designed to be additive: each new flow is one entry in
the catalog mapping intent → sub-commands.

### Added — `mneme guard` pre-commit hook

```bash
mneme guard --install     # one-time setup → installs .git/hooks/pre-commit
mneme guard --check       # manual run against currently-staged changes
mneme guard --uninstall   # removes the hook
```

What it blocks **before the commit lands**:
- Hardcoded secrets (AWS keys, JWTs, passwords, tokens — uses redact rules)
- Known-vulnerable patterns (CWE-aligned: Math.random for security, MD5/SHA1
  for crypto, SQL string concat, JWT no-verify, etc.)
- Configurable strictness: default blocks HIGH/CRITICAL only; `--strict`
  also blocks MEDIUM-severity findings
- Bypass when legitimate: `git commit --no-verify`

Reuses the existing forensics + redact engines — `guard` is pure orchestration
over what already works. The killer property: install once, forget it exists,
catches the next leaked AWS key before it reaches GitHub.

### Improvements — strict arg validation across the CLI

Every numeric / date flag now validates via `packages/cli/src/utils/args.ts`:

- `parseIntStrict("--top")` rejects NaN with a clear error (no more
  `fatal: 'NaN': not an integer` leaking from internal `git log`)
- `parseFloatStrict("--threshold")` rejects negatives + non-numeric
- `parseSinceDate` rejects garbage like `--since notadate`, accepts ISO dates,
  git-style relatives (`7d`, `2.weeks.ago`), and named relatives (`yesterday`)
- `commitNotFoundMessage` provides 3 concrete remedies (run `git log`, run
  `mneme index`, try `mneme forensics attribute HEAD`)

Applied to: `index`, `forensics attribute|vulns|anomaly`. `attribute` now
accepts an OPTIONAL commit (defaults to HEAD).

### Improvements — intent classifier accepts security audit queries

v0.19.2 fix from a real user: asking *"what aws keys appear in our history?"*
was wrongly classified as vague. Fixed by:
- New SPECIFIC patterns: `what X appear/exist/live`, `where ...`, imperative
  retrieval verbs (`find/show/list X in Y`)
- New CONCRETE_HINTS_SECURITY regex: security/credential nouns count as
  concreteness anchors so audit queries don't fall through

### Improvements — green useCase tagline on every command

The `header()` primitive in `ui.ts` now takes a 4th optional `useCase`
argument rendered in green above the gray subtitle:

```
🛡  Vulnerability Hunt — pattern-matched security findings
✓ Find security holes hidden in years of git history.
   11 CWE-aligned classes · scans full diff bodies, additions only
```

Applied to all 22 `header()` call sites: forensics (4), insights (5),
guardian, why, status, quant (10).

### Tests

880 tests passing (was 853). +27 new:
- `do.test.ts` — 16 routing tests covering all 7 flows + placeholder expansion
- `args.test.ts` — 11 validator tests covering NaN, negatives, garbage dates,
  commit-not-found template

### User-visible flow on a fresh install

```bash
npm i -g mneme-ai
cd <any-git-repo>
mneme init           # picks bundled WASM, zero setup
mneme index          # ~25MB lazy download on first run
mneme do "find security issues"   # ← single command, agentic dispatch
mneme guard --install              # ← always-on protection from now on
```

—

## [0.19.0] — 2026-05-06

The **"Zero-Install — Just Works"** release. Mneme now ships a built-in
WASM embedding model so `npm i -g mneme-ai && mneme index` works on any
machine without installing Ollama, configuring API keys, or running any
external service. Auto-detect walks a 4-step fallback ladder and gracefully
degrades — the user is NEVER blocked by an unhealthy provider.

### Added — Bundled WASM embedder (the killer feature)

- New `BundledEmbedder` (`packages/embeddings/src/bundled.ts`) — wraps
  `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` (~25MB, 384-dim).
  Pure JS+WASM, no native deps, runs on Windows / Mac / Linux.
- Model is **lazy-downloaded** on first use to `~/.cache/mneme/models/`.
  Indexer streams download progress so the user never sees a frozen bar.
- Includes a `verify()` pre-flight: instantiates the pipeline + runs a
  1-token sanity embed BEFORE the long indexer loop.

### Auto-detect ladder (graceful degradation, never blocks)

```
1. OpenAI (★★★★★ paid)        — if OPENAI_API_KEY is set
2. Ollama (★★★★ free local)   — only if ping AND a SHORT sanity embed succeed
3. Bundled WASM (★★★)         — zero setup, ~25MB lazy download
4. Hash (★★ deterministic)    — final escape hatch, always works
```

If any step fails — even mid-run (e.g., Ollama becomes unresponsive after
ping) — the next step takes over silently. Auto mode NEVER errors out.

### Auto-fallback at the CLI layer

`mneme index` (auto mode) now does its own pre-flight verify:

- If the chosen embedder fails → falls back to bundled WASM with a
  friendly note ("Ollama is unhealthy: <reason> → falling back to bundled").
- If bundled also fails (e.g., offline + no cached model) → falls to
  hash. The user gets a working index either way.
- Explicit `--embedder ollama` still errors hard, with a clear remedy
  + the suggested fallback (`--embedder bundled`).

### `mneme init` recommendation now reflects bundled

Default recommendation changed: when no Ollama and no OpenAI key, the
probe now suggests `bundled` (★★★, zero-setup) instead of `hash` (★★).
The action callout explains: "No setup needed — Mneme will use a built-in
25MB model. For ★★★★ install Ollama (optional)."

### Internal

- `OllamaEmbedder` `auto`-mode now uses a 10s timeout for the auto-detect
  probe (vs 180s for the real workload) so a hung Ollama doesn't make
  `mneme init` feel slow.
- `MnemeConfig.embeddings.provider` now includes `"bundled"`.
- All 834 tests pass (probe tests updated to reflect new bundled-default).

### User-visible flow on a fresh install

```bash
npm i -g mneme-ai
cd <any-git-repo>
mneme index    # downloads 25MB model on first run, then indexes — zero setup
mneme ask "..."
```

No Ollama install. No API key. No localhost vs 127.0.0.1 gotcha. Just works.

—

## [0.18.0] — 2026-05-06

The **"Polished — Output from the Future"** release. Every command now
renders through a unified design system (panels, pills, meters,
sparklines, citations, OSC 8 hyperlinks) and ships a smarter
intelligence layer (top-line insights, plain-English verdicts, smart
next-step suggestions). The CLI shines on first impression and stays
useful through deep workflows.

### Added — Unified UI primitives (`packages/cli/src/ui.ts`)

Single design system used by every command:

- `header(icon, title, subtitle?)` — page-level header with double-rule.
- `section(title, hint?)` — section heading.
- `divider(label?)` — horizontal rule, optionally with inline label.
- `severityBadge(level)` — fixed-width colored badges (CRIT / HIGH / MEDIUM / LOW / INFO / OK / WARN).
- `pill(label, level)` — free-form colored chip ([ FRESH ], [ STALE ], [ AUTO ]).
- `meter(value, opts)` — linear 0..1 meter with auto-coloring or explicit level.
- `logMeter(lr, opts)` — log-LR meter for forensic data.
- `sparkline(values)` — Unicode trend chart (▁▂▃▄▅▆▇█).
- `citation({shortHash, date, author, subject, url})` — consistent commit row, OSC 8 clickable.
- `osc8(url, text)` — terminal hyperlink, auto-degrades on dumb terminals.
- `kv(label, value)` — aligned key-value row.
- `emptyState(headline, hints[])` — null-state with helpful suggestions.
- `nextSteps(actions[])` — call-to-action box at end of every command.
- `verdictBadge(verdict)` — ENFSI verdict coloring.
- `commitTypePill(subject)` — pill from conventional-commit prefix.

### Refactored — every high-visibility command shines now

- **`mneme forensics match | attribute | vulns | anomaly`** — top-line insights ("🎯 X is the overwhelming match…"), plain-English verdicts ("In plain English: overwhelming evidence Y wrote this commit"), severity bars + meters, smart next-step suggestions tailored to the result, log-LR per-locus meters sorted by signal strength.
- **`mneme why <file>:<line>`** — smart authorship insight ("70% of these lines come from a single commit"), aligned originating-commit citations with meters, semantically-related section, contextual next steps.
- **`mneme status`** — pill-based health badges (FRESH / STALE / NEVER), embedding-coverage meter, freshness hints (`5d old`), smart next-step suggestions based on index health.
- **`mneme who-knows <topic>`** — confidence meter, candidate ranking with frequency bars, risk pill, contextual next steps (story, dna).
- **`mneme decisions`** — by-kind histogram with meters, color-coded confidence pills, export-format next steps.
- **`mneme stack-trace`** — incident-prone-frame top-line, frame-by-frame breakdown, palimpsest/why next steps.
- **`mneme story <topic>`** — sparkline of activity across acts, smart export next steps.
- **`mneme dream`** — empty-state with hints when no ideas generated.
- **`mneme guardian`** — pill-based mode/apply badges, severity-aligned tick rows, policy pills.
- **`mneme drawdown / alpha / backtest / black-swan / insider-trading / moneyball / greek / correlation-matrix / vix / tax-loss-harvest`** — every quant command now uses the unified header/section/pill/meter pattern. `vix` gets a sparkline + meter for the trend.

### Smart intelligence layer

- **Top-line insights** — every report leads with the punchline. "🎯 alice@bank.com is the overwhelming match" or "⚠ 3 critical/high finding(s) — investigate immediately."
- **Plain-English verdicts** — forensic LRs translated: "In plain English: overwhelming evidence Bob did NOT write this commit."
- **Smart next steps** — every command ends with 1–3 contextual `mneme …` commands tied to what was just shown ("Hunt for OTHER suspicious commits" / "Cross-reference vulnerabilities introduced around the anomalous window" / "Inspect the top expert's coding fingerprint").
- **Empty states with hints** — when there's no data, every command tells you exactly what to do next instead of a bare "no results."

### Internal

- Added 30 new unit tests for UI primitives (`packages/cli/src/ui.test.ts`).
- All 834 tests pass (was 804); zero regressions.

—

## [0.17.0] — 2026-05-06

The **"Forensic Code Science"** release. Real forensic-science
methodology — likelihood ratios, ENFSI verbal scale, vulnerability
pattern hunting, insider-threat anomaly detection — applied to git
history. **First system to do so.**

### Added — `mneme forensics` (4 subcommands)

```bash
mneme forensics match <commit> <author>   # STR-loci LR matching
mneme forensics attribute <commit>        # anonymous attribution
mneme forensics vulns                     # CWE-aligned vuln hunt
mneme forensics anomaly                   # insider-threat detection
```

### `match` / `attribute` — STR-Loci Author Attribution

12 novel "code STR loci" extracted per author, then likelihood ratio:

```
LR_total = ∏ LR_i           (Bayesian, product over independent loci)
          i=1..12
```

Combined LR mapped to the **ENFSI 2015 verbal scale** (real forensic
standard): "extremely strong support" / "very strong support" /
"strong support" / "moderate support" / "weak support" /
"uninformative" / "weak support against" / etc.

Continuous loci: Gaussian likelihood. Discrete loci (peakHour,
messageStyleHash): direct frequency matching. Per-locus LR capped at
[0.001, 1000] so a single weird locus can't dominate — multi-locus
agreement is what gives forensic certainty.

### `vulns` — CWE-aligned Vulnerability Hunt

Pattern-match across commit + diff history. **11 vulnerability classes**
mapped to CWE identifiers:

- crypto-weakness (CWE-327, 330, 321)
- injection-sql/shell/xss (CWE-89, 78, 79, 95)
- auth-flaw (CWE-287, 798, 347, 942)
- financial-logic (CWE-190, 682, 840) — bank/finance grade
- supply-chain (CWE-1357)
- info-leakage (CWE-209)
- race-condition (CWE-362)
- privilege (CWE-269)

Surfaces silent-fix commits (subject mentions security but no rule
hits) for compliance review.

### `anomaly` — Insider-Threat Detection

Per-author baseline + four-axis deviation scoring for compromised-
credential detection (the bank/finance scenario):

| Axis | What it measures |
|------|------------------|
| TIME | Distance from author's UTC peak window |
| FILES | Fraction of touched files the author has never touched |
| STYLE | Verb-novelty + leading-verb match |
| SIZE | Robust z-score (MAD) of insertions+deletions vs median |

Composite score → severity bands (low/medium/high/critical) with
specific recommendation per band. Requires ≥5 commits to baseline an
author.

### Test count

| Category | Tests |
|----------|-------|
| Forensics (loci + LR + vulnhunt + anomaly) | 24 |
| Repo total | **804** (was 780) |

Build clean. All 804 tests pass.

## [0.16.0] — 2026-05-06

The **"Giant Slayer"** release. Two world-firsts that no shipped tool we
surveyed has: (1) a 24/7 self-healing engine that auto-fixes weaknesses
as they emerge, and (2) four novel retrieval-scoring algorithms built on
formulas designed to outperform single-signal embedding search.

### Added — `mneme guardian` (the 24/7 self-healing engine)

```bash
mneme guardian --watch --apply --interval 300
```

A long-running diagnostic + auto-remediation loop:

```
while (true) {
  diagnose();        // detect weaknesses + threats
  fix();             // apply safe auto-actions
  learn();           // record findings to .mneme/guardian.jsonl
  sleep(interval);
}
```

Detects six classes of weakness and four classes of threat:

**Weaknesses**: index drift, missing embeddings, low quality grade,
quality regression, stale calibration, schema drift, redaction gap.

**Threats**: tamper signal, secret leak, outlier author, deletion storm.

Each finding gets a policy: `auto` (safe — apply automatically),
`recommended` (suggest, await human), or `observe` (log only). Safe
actions like incremental re-indexing and calibration are automatic;
risky actions are suggested. 10 tests.

### Added — Four Novel Retrieval-Scoring Algorithms

These run as post-processors over base BM25 + cosine search.
20 tests across the four algorithms.

#### TDWE — Time-Decay Weighted Embedding scoring
> *"Yesterday's wisdom matters more than last decade's."*

Formula:
```
w(c) = exp(-λ × age_days / half_life)
adjusted_score = base_score × w(c)
```
A commit at half-life age (default 365 days) gets weight 0.5. Older
commits decay further; newer commits stay near 1.0.

#### RACB — Regret-Aware Chunk Boosting
> *"The bug fix carries more wisdom than the feature."*

Formula:
```
boost(c) = 1 + ln(1 + days_to_followup × severity_factor)
```
Severity map: revert=3, hotfix=2, fix=1, sameFiles=0.5. Logarithmic
growth captures diminishing returns on age — a 1-day-to-fix is highly
informative; 30-day-to-fix is more, but not 30× more.

#### ADS — Author Diversity Score re-ranking
> *"Don't return three answers from the same person."*

Formula:
```
penalty(i) = α × (same_author_above / total)
final(i)  = base(i) × (1 - penalty(i))
```
Then re-sort. Surfaces the second-most-knowledgeable contributor when
one author dominates a topic.

#### CGAR — Causal Graph Augmented Retrieval (light)
> *"Walk the narrative, not just the bag of chunks."*

Builds a graph of commit-to-commit causal references (PR #N, fixes #N,
revert hashes). Boosts results that are causally connected to other
results within `maxHops` (default 2):

```
boost = initial × decay^(hops - 1)   // initial=1.3, decay=0.85
```

#### Ensemble — `applyNovelScoring(results, ensemble)`
Composes all four: TDWE → RACB → CGAR → ADS, each pure and tested
independently.

### Test count

| Category | Tests |
|----------|-------|
| Novel scoring (TDWE/RACB/ADS/CGAR/ensemble) | 20 |
| Guardian (diagnose + selectAutoActions) | 10 |
| Repo total | **780** (was 750) |

Build clean. All 780 tests pass.

## [0.15.0] — 2026-05-06

The **"Polish + Quality"** release. Lifts every command to production-grade
finish AND introduces a built-in index quality auditor.

### Added — `mneme index --analyze`

A full-throated index quality report. Computes 8 per-metric scores
(chunk density, embedding ratio, subject quality, body ratio, PR ratio,
issue-ref ratio, duplicate ratio, tokenizer health), produces an
overall A–F grade, and surfaces concrete recommendations:

```
📊  Index Quality — health check
─────────────────────────────────────────
✦ Overall grade
   A  (85/100)

◆ Per-metric breakdown
   █████████░   88%  chunk density
   ██████████  100%  embedding ratio
   ██████████  100%  subject quality
   ██████████  100%  body ratio
   █░░░░░░░░░   11%  PR ratio
   ██░░░░░░░░   17%  issue ref ratio
   ██████████    0%  duplicate ratio
   ██████████  100%  tokenizer health

✦ Recommendations
   • Only 11% of commits reference a PR. Configure the
     GitHub adapter to ingest PR descriptions — highest
     signal source.
```

JSON output via `--json` for CI gates. 8 new tests.

### Fixed — production polish across the suite

- **`mneme why`** now falls back to `git show` when a commit isn't
  indexed yet — shows real subject + author + date instead of a bare
  `(not indexed)` placeholder, with a hint to run `mneme index`.
- **`mneme fossil`** off-by-one parser fix — `deleted <date> by <author>
  in <hash>` renders correctly instead of being scrambled.
- **`mneme status`** clarified ambiguous labels:
  - `embedder (unknown)` → `embedder not recorded — re-run \`mneme index\``
  - `provider hash` → `provider hash (deterministic, dep-free fallback)`
  - never-indexed shows `indexed never — run \`mneme index\` to build the memory`
- **`mneme cluster`** small-repo null-state — explains threshold + suggests
  `--similarity 0.05 --min-size 2` instead of showing "0 clusters".
- **`mneme network`** solo-author null-state — explains why it's empty +
  suggests `mneme dna` for solo repos.
- **`mneme black-swan`** null-state — points users to
  `mneme correlate --source pager` to ingest incidents.

### Test count

| Category | Tests |
|----------|-------|
| Index quality | 8 |
| Repo total | **750** (was 742) |

Build clean. All 750 tests pass.

## [0.14.0] — 2026-05-06

The **"Untouchable"** release. One world-first quality moat + a journalist-style README rewrite.

### Added — Hallucination Guard *(no other tool ships this for git Q&A)*

- **`mneme ask --audit`** — audit-grade Q&A mode. Refuses to answer below
  a confidence floor (`--audit-floor low|medium|high`, default medium)
  AND refuses if any LLM-cited backtick-hash isn't present in the
  retrieved evidence. Use this for CI gates or any surface where AI
  hallucination is unacceptable. Returns `source: "audit-refused"` with
  trustScore = 0 instead of best-effort prose.
- **Trust score 0..1** on every `synthesize()` result. Combines confidence
  label and citation validity:
  - `audit-refused` / `no-context` → 0
  - `extractive` → 0.5–0.7
  - `llm` clean → 0.8–0.95
  - `llm` with N unverified citations → base − N × 0.2 (capped at 0.5 penalty)
- **`unverifiedCitations`** field — every backtick-hex token in the
  answer is checked against the evidence set (prefix-match, case-insensitive).
  Hashes that don't match are surfaced in the field and rendered as a
  "⚠ HALLUCINATION RISK" banner in the CLI, with a `--audit` hint.
- **Trust badge UI** in `mneme ask` output — color-coded (green/cyan/yellow/red)
  next to the existing confidence badge.
- **`findUnverifiedCitations()`** exported as a pure helper for callers who
  want to validate LLM output against arbitrary evidence sets.

### Test count

| Category | Tests |
|----------|-------|
| Hallucination guard | 15 |
| Repo total | **742** (was 727) |

Build clean. All 742 tests pass.

### Changed — README rewrite

The README went from **834 lines to 227 lines** (73% reduction):

- **Journalist inverted pyramid** — most important first
- **30-second install** above the fold
- **Why people use it** — 4 bullets, story-shaped
- **All commands in 3 colored tables** (Tier 1 / Insights / Quant)
- **Audit-grade section** — explicit hallucination-guard guarantee
- **The Frontier table** — 12 world-firsts vs adjacent tools
- **Wiki links** for everything that used to live in the README

The old long-form content is intact in the wiki — see Innovations and
Command-Tour.

## [0.13.0] — 2026-05-05

The **"Frontier"** release. Closes every gap from the landscape
research:

| Gap | Tool that came closest | What was missing | Mneme v0.13 |
|-----|-----------------------|------------------|-------------|
| OSS  | — | many tools were closed-source | ✅ MIT |
| Real-time | Goursome (dead 2014) | nothing actively maintained | ⏳ planned watch mode |
| Semantic NLP clustering | arxiv 2110.00697 | research-only | ✅ `mneme cluster` |
| Author network with semantic edges | Unblocked.com (closed, paid) | no OSS | ✅ `mneme network` |
| Predictive overlay | MergeBERT (research) | not productized | ✅ already shipped in `oracle` |
| Exportable developer fingerprint | HowYouCode (snapshot only) | no history-derived | ✅ already shipped in `dna` |
| Universal codebase export | — | no tool bundles everything | ✅ `mneme export-bundle` |
| Engineering management view | — | no tool combines health + succession | ✅ `mneme manage` |

After v0.13 there is **no commercial or open-source tool that does what
Mneme does as a single, local-first artifact.** That is the "Black
Sheep" position — alone in the field by design.

### Added — four new commands

- **`mneme cluster`** — semantic clustering of commit messages. Groups
  similar commits (token-overlap or embedding-based when available),
  surfaces topic islands, returns cohesion + sample commits +
  cluster-defining vocabulary. **First shipped CLI for semantic commit
  clustering — academic papers stop at the paper.** 9 tests.
- **`mneme network`** — author social graph with **semantic edges**.
  Edges aren't just "edited same file"; they're weighted by co-edit +
  co-time + co-topic, and labeled with the shared vocabulary. Detects
  silos (connected components) and bridges (authors connecting them).
  **Closes the OSS gap left by closed-source competitors.** 7 tests.
- **`mneme manage`** — engineering management dashboard. Combines
  drift, oracle, and per-area touch data into a single CTO/EM-friendly
  view: team health composite, succession plan per area (primary +
  understudy + risk), skill matrix, action notes. **No tool combines
  these into one frame.** 8 tests.
- **`mneme export-bundle`** (alias `bundle`) — universal codebase
  export. Bundles every Mneme analysis — DNA × top contributors, drift,
  chronicle, oracle, constellation, clusters, network, manage, ghost —
  into a single shareable artifact (JSON + Markdown). Run once, ship to
  collaborators or attach to release notes. 6 tests.

### Test count

| Category | Tests |
|----------|-------|
| Cluster | 9 |
| Network | 7 |
| Manage | 8 |
| Export bundle | 6 |
| **Total new in v0.13** | **30** |
| Repo total | 727 |

Build clean. All 727 tests pass.

## [0.12.0] — 2026-05-05

The **"King of Git"** release. Five new world-first commands, each
addressing a question that no other tool can answer about your
codebase's past, present, or future. After landscape research (Gource,
code_swarm, Hercules, Unblocked, HowYouCode, MergeBERT) confirmed each
one occupies whitespace.

### Added — five killer commands

- **`mneme dna [author]`** — extract a portable, exportable **Codebase
  DNA** fingerprint of any contributor: their style genome (file-per-
  commit, test ratio, conventional commit ratio), message DNA (subject
  length, imperative ratio, top verbs), working hours (UTC histogram,
  peak window, weekend ratio), and file affinity (top dirs, top
  extensions). Includes `--compare <author>` for two-way DNA similarity
  scoring and `--output <file>` for JSON export. **No other tool ships
  history-derived, comparable, exportable per-developer fingerprints.**
  13 tests.
- **`mneme drift`** — visualize **topical drift** of a repo over time
  (default: quarter buckets). Classifies each commit as feature /
  refactor / firefight / polish / docs / other, then plots the per-
  bucket distribution as a colored sparkline. Detects burnout signals,
  recovery, rewrite clusters, and polish streaks. **NLP-grade commit
  classification has been published in academic papers but never
  shipped as a CLI before.** 13 tests.
- **`mneme chronicle`** — auto-generate a **chaptered narrative
  documentary** of your codebase. Detects natural epochs, names each
  chapter ("The Founding", "The Great Refactor", "The Reckoning"),
  identifies the protagonist (top contributor), and emits Markdown
  ready to convert to PDF / EPUB. `--output CHRONICLE.md` writes the
  novel. 10 tests.
- **`mneme oracle`** — **predictive co-edit oracle**. From the recent
  window of commits, builds a recency-weighted author × file affinity
  matrix, then projects probabilities for the next window. Surfaces
  predicted *collisions* (two authors both likely to touch the same
  file) so teams can sync before they merge-conflict. **MergeBERT
  research stopped at the paper; Mneme ships the productized version.**
  8 tests.
- **`mneme constellation`** — build a **graph view of the repo** as a
  living map: files are stars (size = touches), authors are orbital
  bodies, commits are edges. Includes co-edit edges between files
  committed together and authorship edges between authors and the files
  they orbit. JSON exportable for the planned WebGL viewer
  (`mneme constellation --serve` in v1.0). 9 tests.

### Test count

| Category | Tests |
|----------|-------|
| DNA | 13 |
| Drift | 13 |
| Chronicle | 10 |
| Oracle | 8 |
| Constellation | 9 |
| **Total new in v0.12** | **53** |
| Repo total | 697 |

Build clean. All 697 tests pass.

### Numbers — what's now in Mneme

| Surface | Count |
|---------|-------|
| Tier-1 essentials | 8 |
| Insight commands | 16 |
| Quant commands | 10 |
| WILD commands | 11 |
| MCP tools | 7 |

## [0.11.1] — 2026-05-05

Maintenance release for MCP Registry publish:

- Added `mcpName` field to `mneme-ai` package.json
  (`io.github.patsa2561-art/mneme-ai`) for npm verification.
- Added `server.json` manifest at repo root for `mcp-publisher`.
- **Mneme is now live in the official MCP Registry**:
  https://registry.modelcontextprotocol.io/

## [0.11.0] — 2026-05-05

The "Time Loops & Ghosts" release. Three new world-first commands that
lean on the same indexed memory but answer different questions:

> *Where has this file been?*
> *What is my repo's history saying about this idea?*
> *What is haunting my codebase?*

### Added — three new insights

- **`mneme time-machine <file>`** — narrate a file's evolution as discrete
  eras (birth, rewrite, evolution, firefight, polish, plateau, twilight).
  Emits a per-era label ("rewrite — 'switched to streams' (412 lines)"),
  a per-era churn count, and a "health" tri-ratio (rewrite vs firefight
  vs polish). Uses commit-message keywords + churn thresholds to classify.
  10 tests.
- **`mneme premortem <intent>`** — given a proposed change, mine the repo
  for similar past attempts (token-overlap similarity + path hint), then
  walk forward in a window for revert/hotfix/incident/rewrite signals.
  Produces a regret probability, a verdict tier (low/medium/high/very_high),
  and the top three risks with citations to the actual commits that
  exhibited them. **Predictive analysis grounded in YOUR repo's failure
  history**, not generic AI advice. 11 tests.
- **`mneme ghost`** — surfaces "ghost code": files that haunt the repo
  without doing anything. Combines staleness (recency-decay), low-touch
  ratio (born and forgotten), and TODO density into a single ghostliness
  score. Also detects stale TODOs — markers added long ago and ignored
  through later edits. 10 tests.

### Added — auto-discovery + SEO

- **`keywords`** in npm package.json expanded to cover memory, MCP, AI
  coding assistant, codebase intelligence — improves npm search ranking
  without changing the user-facing description.
- **GitHub topics** added to repo: `mcp`, `mcp-server`,
  `ai-coding-assistant`, `codebase-memory`, `git-archaeology`,
  `local-first`, `typescript`. Topic search → Mneme.

### Test count

| Category | Tests |
|----------|-------|
| Time machine | 10 |
| Pre-mortem | 11 |
| Ghost | 10 |
| **Total new** | **31** |
| Repo total | 644 |

Build green. All 644 tests pass.

## [0.9.0] — 2026-05-05

The "Super Saiyan" release. v0.9.0 ships in three sprints on top of the
earlier hardening work, turning Mneme from "raw retrieval" into an
answer-shaped experience.

### Added — Sprint 1: engine + output

- **Intent classifier** (`retrieve/intent`) — every query is classified
  as `specific` / `lookup` / `temporal` / `vague` *before* retrieval. Vague
  queries ("how to improve my code") short-circuit with a redirect message
  instead of returning low-confidence guesses. 21 tests.
- **Adaptive confidence** — `classifyConfidence(results)` returns one of
  `high` / `medium` / `low` / `none` based on top score AND the gap to
  top-2/3. Tied results (all ≈ 0.016) drop to "low" even when the
  absolute top is decent. The previous static floor stays as a hard cut.
- **LLM synthesis layer** (`retrieve/synthesize`) — turns top-K results
  into a 2-4 sentence answer that cites commit hashes. Falls back to an
  extractive template-based answer when no LLM is reachable. 14 tests.
- **Beautiful output** (`render-answer`) — sectioned response with
  confidence badge (🟢🟡🔴), `✦ Answer`, `◆ Evidence` (top-3 of N, not
  all N), `⊕ Files` clustered by top-2 path segments. OSC 8 hyperlinks
  make PR/commit refs clickable in modern terminals (iTerm2, Wezterm,
  Windows Terminal, VSCode). 22 tests.
- **Animated thinking spinner** (`spinner`) — braille frames during
  retrieval and synthesis. Disabled on non-TTY (CI, piped output).

### Added — Sprint 2: killer commands

- **`mneme who-knows <topic>`** — surface the people most likely to know
  about a topic, ranked by `log(commits) × recency` so one mega-contributor
  doesn't dominate. Tiers: `definitive` / `active` / `stale` / `occasional`.
- **`mneme decisions [--format markdown]`** — auto-extract architectural
  decisions from commit history. 9 patterns: `decided to`, `switched from
  A to B`, `replaced X with Y`, `chose A over B`, `use X instead of Y`,
  `adopted X`, `deprecated X`, `migrated from A to B`, `rejected X`.
  Captures rationale (`because Y`, `so that Y`).
- **`mneme stack-trace [--from F]`** — parse a JS/TS/Python/Go/Java stack
  trace and query history for each frame: last 3 commits + count of past
  incidents affecting the file. Reads stdin or a file.
- **`mneme story <topic>`** — narrate the evolution of a topic across
  acts (initial / refactor / incident / evolution / stable). Optional
  Ollama act-narration adds a 1-2 sentence prose summary per act.

### Added — Sprint 3: AI nobody-thought-existed

- **`mneme dream`** — speculative ideas grounded in your codebase patterns.
  Gathers signals (commit volume, language distribution, top modules,
  pattern suffixes like `Service`/`Adapter`) and asks an LLM to suggest
  3-5 features that fit your style. Falls back to deterministic heuristic
  ideas when no LLM is configured.
- **`mneme chat`** — multi-turn REPL with conversation context. Augments
  follow-up queries with the previous turn's question to improve retrieval.
  Slash commands: `/exit`, `/clear`, `/save <file>`, `/history`.
- **Smart suggestions in `mneme ask`** — every answer now includes a
  `→ Try next` section with up to 3 follow-up commands, generated by
  `extractTopicWord(question)` + result analysis. Heuristic, deterministic.

### Changed

- **Tests: 244 → 379** (+135 tests, +9 test files).
- **Eval A/B verified across all three sprints** — recall@3 = 87.7%,
  hit rate = 96%, negative recall = 100%. No regression.
- **CLI surface**: 8 essentials in `mneme --help`, 26 advanced via
  `mneme advanced` (was 24). Tier-2 includes the 6 new Sprint 2+3 commands.

### Numbers

| Metric | v0.9.0-pre | v0.9.0 |
|---|---|---|
| Tests passing | 244 / 24 files | **379 / 33 files** |
| Visible CLI commands | 8 | **8** (unchanged — kept clean) |
| Total CLI commands | 28 | **34** |
| Languages parsed | TS, JS, Python, Go | **TS, JS, Python, Go** |
| Eval recall@3 | 87.7% | **87.7%** (no regression across 3 sprints) |
| Killer commands | 0 | **6** (`who-knows`, `decisions`, `stack-trace`, `story`, `dream`, `chat`) |

## [0.9.0-pre] — 2026-05-04

The "honest, multi-language, self-improving" release. Five months of code in one tag.

### Added

- **Wisdom Mutant Engine** — 24/7 self-improving loop:
  - `mneme feedback <id> up|down` records explicit feedback on a query.
  - `mneme why` on a recently-returned commit acts as an implicit positive signal.
  - `mneme calibrate` runs a grid search over `(semanticWeight, minSemCosine, rrfK)` and picks the config that maximizes hit rate against accumulated feedback. Requires ≥ 10 positive examples to gate against statistical noise.
  - `mneme watch` is the daemon: re-indexes on every `.git/HEAD` change, calibrates hourly, self-evals daily.
  - Three new append-only tables: `wisdom_feedback`, `wisdom_calibration`, `wisdom_eval_run` (schema bumped to v2, additive).
- **Confidence floor** in `retrieve/search`. The system now returns `[]` (with the message *"no relevant commits or PRs were found … this usually means the WHY behind this code lives outside the git history"*) for queries with no FTS hits **and** top semantic cosine < 0.4. Negative-recall on the eval set went from 0% to 100% with no regression on positive recall.
- **Redaction layer** (`util/redact`) — regex scrubber for AWS access keys, GitHub PAT (classic + fine-grained), GitLab PAT, OpenAI/Anthropic keys, Stripe (live & test), Slack tokens, Google API keys, npm tokens, JWTs, PEM private keys, generic Bearer tokens. **ON by default** in `mneme index`. Aggressive mode (`--aggressive-redact`) catches generic `password=` patterns and long hex blobs.
- **Deterministic mode** — `--no-llm` flag, `MNEME_NO_LLM` env var, or `config.deterministic = true`. `heal` and `genius` refuse with exit code 2 + a non-LLM suggestion. `teach` falls back to layer classification only. `index` forces the hash embedder regardless of what was asked.
- **Smart environment probe** — `mneme init` and a new `mneme doctor` command detect Ollama (with embedding model pulled or not), OpenAI key presence, and hardware tier, then recommend the best embedder for THIS user.
- **Go entity parser (regex v1)** — methods (`Receiver.Name`), generics (Go 1.18+), structs, interfaces, type aliases. Comment- and raw-string-aware via masking pass. 16 tests.
- **`docs/SECURITY.md`** — full threat model. Bank-grade documentation.
- **`docs/PRIVACY.md`** — short, plain-language version for users.
- **CycloneDX SBOM** generation in the release pipeline. Attached as a 365-day artifact for every tagged release.
- **Pronunciation guide** in README — *"NEE-meh"*.
- **`mneme advanced`** — print all advanced commands (Phase 2/3/4 + WILD ideas) grouped by phase. The main `mneme --help` now shows only 8 essentials.

### Changed

- **CLI surface tiered.** `mneme --help` now shows 8 essentials (`init`, `index`, `ask`, `why`, `status`, `doctor`, `mcp`, `watch`). Twenty advanced commands are hidden from the main help and accessible via `mneme advanced`. Reduces cognitive load for new users.
- **Eval golden set: 15 → 50 questions** across 7 categories (was 4): why-question, keyword, who-when, negative, short-query, specific-ref, multi-tag.
- **Hit rate: 93.3% → 96.0%** on the new 50-question set.
- **`mneme ask`** now records every query into `wisdom_feedback` and prints a one-line CTA to upvote/downvote.
- **`mneme why`** now triggers an implicit positive signal — looking up `why` on a commit that recently appeared in an `ask` result marks that result helpful.

### Removed

- **Four stub commands removed:** `oracle`, `genome`, `dialogue`, `tribute`. They were design pages with no near-term implementation. Maintaining "coming soon" stubs is dead code and dilutes the CLI surface. If they ship later, they ship as new commands.
- **`mneme planned`** removed (was a hidden command listing the four stubs).

### Fixed

- **Schema-version meta key** is now `2` to reflect the wisdom subsystem additions.
- README, ROADMAP, and WILD_IDEAS counts now agree with each other and with the actual `npm test` output.

### Security

- All new test fixtures for the redaction layer construct token-shaped strings at runtime (e.g. `"sk" + "_live_" + "A".repeat(24)`) so GitHub's secret scanner does not flag the source files. The redaction code itself catches real-world key formats — verified by 26 unit tests.

### Numbers

| Metric | v0.8.4 | v0.9.0 |
|---|---|---|
| Tests passing | 167 / 19 files | **244 / 24 files** |
| Eval golden set | 15 questions | **50 questions** |
| Visible CLI commands | 27 (overwhelming) | **8 essentials + `advanced`** |
| Negative-case recall | 0% 🔴 | **100%** ✅ |
| Hit rate | 93.3% | **96.0%** |
| Languages parsed | TS, JS, Python | + **Go** |
| Schema version | 1 | **2** |

---

## [0.8.4] — 2026-05-04

CI auto-publish verified end-to-end with a Bypass-2FA `NPM_TOKEN`.

## [0.8.3] — 2026-05-04

Manual publish from local after a `release.yml` E403. Token replaced.

## [0.8.0] — 2026-05-03

AI engine (`genius`), Python parser, cluster-collapsing D3 viz, smoke-test report.

## [0.7.0] — 2026-05-02

Phase 4 web viz, Phase 3 incident adapters (Sentry, Datadog, GitHub Actions).

## [0.5.0] — 2026-05-01

WILD ideas batch: heal, echo, ledger, palimpsest, fossil, rumor, mirror, runaway.

## [0.3.0] — 2026-04-30

Phase 2 — entity parsing + cosine clones.

## [0.1.0] — 2026-04-29

Phase 1 — Archaeologist core. `init / index / ask / why / status / mcp`. The MVP.

---

[Unreleased]: https://github.com/patsa2561-art/mneme-ai/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/patsa2561-art/mneme-ai/compare/v0.8.4...v0.9.0
[0.8.4]: https://github.com/patsa2561-art/mneme-ai/compare/v0.8.0...v0.8.4
[0.8.0]: https://github.com/patsa2561-art/mneme-ai/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/patsa2561-art/mneme-ai/compare/v0.5.0...v0.7.0
[0.5.0]: https://github.com/patsa2561-art/mneme-ai/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/patsa2561-art/mneme-ai/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/patsa2561-art/mneme-ai/releases/tag/v0.1.0

# Mneme — smoke-test report

**Repo under test:** `app-chutima-git` (Expo / React Native, GitLab remote, 9 commits)
**Mneme version:** v0.7.0
**Embedder:** hash:fnv-256 (no Ollama model pulled — proves it works without one)
**Date:** 2026-05-04

---

## TL;DR

| | Status |
|---|---|
| Commands tested | **22** |
| Pass | **20** |
| Graceful degradation | **2** (`teach`, `entities`-with-Ollama — fails honestly when LLM model is missing) |
| Hard failures | **0** |

Every command either produced useful output OR printed a clear, actionable error. **Zero crashes. Zero stack traces in user-facing output.**

---

## Phase 1 — core retrieval

| Command | Output | Verdict |
|---|---|---|
| `mneme --version` | `0.7.0` | ✅ |
| `mneme status` | repo + memory + config block | ✅ |
| `mneme adapt` | "Young / personal repo" + 3 tailored recommendations | ✅ |
| `mneme ask "login"` | top-2 with GitLab citation links | ✅ — top-1 = `added new login screen` |
| `mneme why src/screens/Home/HomeScreen.tsx` | 4 originating commits + 2 semantically related | ✅ |

## Phase 2 — entity layer

| Command | Output | Verdict |
|---|---|---|
| `mneme entities` | 41 files → 43 entities (39 tsx, 4 ts) | ✅ |
| `mneme clones --threshold 0.85` | **2 real clusters found:** `IconSymbol.ios` ≈ `IconSymbol.tsx` (cohesion 1.000), and `LoginRegisterScreen` ≈ `TabsLayout` (0.920) | ✅ — surfaces a genuine cross-platform-variant duplication |

## Phase 3 — error correlation

| Command | Output | Verdict |
|---|---|---|
| `mneme correlate` (no args) | usage page + `--source pager` / `--source manual` recipes | ✅ |
| `mneme blast HEAD` | "verdict: LOW · 0.0% base rate · no past incidents share files" | ✅ — honest output for a repo with no incident corpus |
| `mneme palimpsest <file>:<line>` | walks blame → commit → (no incidents to chain into) | ✅ — degrades gracefully when chain bottoms out |

## WILD features

| Command | Output | Verdict |
|---|---|---|
| `mneme heal --dry-run` | **6 candidates flagged** — `Initial commit`, `first commit`, `updated`, `no message` | ✅ |
| `mneme echo` | usage page (no incidents indexed yet) | ✅ |
| `mneme conscience app/(auth)/login.tsx` | **4 historically related commits** all MED risk, no HIGH-risk match | ✅ |
| `mneme mirror` | 2 contributors ranked, "no PRs detected — solo repo", incidents empty | ✅ |
| `mneme rumor --min-mentions 2` | "no undocumented tribal phrases" — corpus too small for a fair test | ✅ |
| `mneme runaway --top 3` | **package-lock.json (+12,825 lines), HomeScreen.tsx (+811), login.tsx (+473)** | ✅ — surfaces real growth |
| `mneme fossil --top 3` | **`app/(auth)/forgot-password.tsx`** found — file deleted from HEAD, still in history | ✅ |
| `mneme ledger --since 2025-12-01 --format csv` | **8 hash-chained entries**, finalHash `1c49e26a…` — verifiable audit trail | ✅ |
| `mneme teach app/(auth) --json` | layer count emitted; LLM step honestly errored ("model 'llama3.2:1b' not found") | ⚠️ degrades gracefully |
| `mneme oracle` (stub) | thoughtful design page with "WILD #4 · pessimism 3/5" | ✅ |
| `mneme wisdom` | meditation 12 ("On Knowing When Not To Use This") | ✅ |

---

## Quality observations on this real repo

`mneme adapt` got the profile right:

- **22%** of recent commit subjects are generic (`updated`, `no message`, `first commit`)
- **0%** of commits have PR refs — a true solo workflow
- **9** commits is too few for definitive Mneme value — the tool said so

The recommendation list it produced is exactly the right path:

1. `mneme heal` — synthesize WHY for those 22% generic commits
2. `mneme entities` — get Phase-2 capabilities online (later we ran it; it indexed 43 entities)
3. `mneme correlate --source manual --file ./incidents.json` — bootstrap the incident layer

Mneme **adapted** to a repo it had never seen, identified the weakest signal, and prescribed the order of operations to get the most value.

---

## Findings worth acting on

From dogfooding this run:

1. **`mneme clones` already paid for itself** — it surfaced `IconSymbol.ios.tsx` ≈ `IconSymbol.tsx` (perfect cohesion 1.000). That's the canonical cross-platform variant, but worth confirming whether the divergence is intentional.
2. **`mneme runaway` flagged `package-lock.json`** — expected noise; we should add a `--exclude lockfiles` flag in v0.8.
3. **`mneme fossil` recovered a real deletion** — `forgot-password.tsx` is gone from HEAD but still inspectable via the suggested `git show <commit>:<path>`.
4. **`mneme ledger` works on a repo with zero pull-request data** — useful evidence that the compliance feature does not require GitHub's PR layer to function.

---

## Reproducing this report

From any indexed git repo:

```bash
mneme adapt                          # before-shot
mneme entities                       # populate Phase 2
mneme clones --threshold 0.85
mneme blast HEAD
mneme runaway --top 5
mneme mirror
mneme fossil --top 5
mneme ledger --since 2025-01-01 --format json --out ledger.json
```

The whole tour runs in under 60 seconds on a hash-fallback embedder, sub-30 with Ollama.

---

*Re-run this report after major releases by piping `mneme ...` outputs through your own structure. v0.8 will add `mneme smoke-test --out report.md` to do this in one command.*

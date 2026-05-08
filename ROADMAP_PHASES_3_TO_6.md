# Mneme — Architecture Spec for Phases 3-6

**Status:** Architecture spec only. Implementation deferred to v1.6.0+.

This document captures the Phase 3-6 designs from the v1.5.0 strategic
review (May 2026). Each phase is a separate ship; total estimated effort
is 4-8 weeks of focused work.

═══════════════════════════════════════════════════════════════════════

## Phase 3 — Daemon Mode + Predictive Pre-fetch

### Vision

Mneme runs as a long-lived background daemon that watches the user's IDE,
filesystem, and git activity. **Before** the user asks their AI a
question, Mneme has already pre-fetched relevant context into a
shared cache. AI tool calls hit warm context, not cold storage.

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                  user's machine                                    │
│                                                                    │
│  IDE / editor (VS Code, Cursor, Claude Desktop) ─────┐             │
│         │ filesystem.watch (chokidar)                │             │
│         ▼                                            │             │
│  ┌───────────────────────────┐                       │             │
│  │  mneme-daemon (Node)      │ <─── unix socket ─────┤             │
│  │  • watches .git/HEAD      │   /tmp/mneme.sock     │             │
│  │  • watches src/ open files│      or named pipe    │             │
│  │  • indexes incrementally  │      on Windows       │             │
│  │  • pre-loads atrophy +    │                       │             │
│  │    related commits +      │                       │             │
│  │    incidents into RAM     │   AI tool MCP server  │             │
│  └────────────┬──────────────┘   queries the daemon  │             │
│               │                  (instead of disk)   │             │
│               ▼                          ▲           │             │
│         .mneme/cache/                    │           │             │
│         (warm RAM-backed                 │           │             │
│          + on-disk LRU)                  │           │             │
│                                          │           │             │
│  Claude Code / Cursor / Codex / ... ─────┘           │             │
│                                                      ▼             │
└──────────────────────────────────────────────────────────────────┘
```

### Implementation plan

1. **`mneme daemon start`** — spawns long-lived process, writes PID to `.mneme/daemon.pid`, listens on Unix socket (`/tmp/mneme-${repo-hash}.sock`) or Windows named pipe.
2. **Filesystem watcher** — uses `chokidar` to detect `git commit`, file open events (via OS-specific hooks; on macOS via FSEvents, on Windows via ReadDirectoryChangesW).
3. **Incremental indexing** — when `git commit` lands, daemon `git diff`s the new commit + updates SQLite + recomputes affected atrophy + invalidates cache for touched files.
4. **Pre-fetch heuristic** — when a file open event fires, daemon pre-loads:
   - Top-5 atrophy entries for that file
   - 3 most-related commits (BM25 + cosine)
   - Incidents that touched the file
   - Bus-factor + telepathy data for the file's author cluster
5. **MCP server proxy** — the existing `mneme mcp` server detects an active daemon and proxies tool calls through the socket instead of opening SQLite directly. Latency drops from 80ms → <5ms per call.
6. **Lifecycle** — `mneme daemon stop`, `mneme daemon status`, `mneme daemon logs`.

### Effort estimate

- Daemon process + IPC: 4-6 days
- Filesystem watcher + incremental index: 3-4 days
- MCP proxy: 2-3 days
- Tests + cross-platform polish: 4-5 days
- **Total: 2-3 weeks**

### Risks

- **Cross-platform IPC** — Unix sockets vs Windows named pipes need careful abstraction.
- **Indexing race conditions** — daemon writes + CLI writes need coordination via file lock.
- **Memory drift** — long-lived daemon must aggressively bound RAM (LRU cap, periodic compaction).

═══════════════════════════════════════════════════════════════════════

## Phase 4 — Mneme Court (12-jury arbitration)

### Vision

For high-stakes commits (production deploy, security patch, contract
code, EU AI Act compliance evidence), Mneme convenes a **jury of 12
specialized AI verifiers**. Each verifier votes on the commit's safety;
Mneme acts as foreman, summarizes verdicts, and prints a cryptographically
signed "court ruling" PDF.

### The 12 jurors

1. **Bayesian prior verifier** — posterior probability the commit matches its claim
2. **Stylometric verifier** — does the commit match the author's voice?
3. **Entropy verifier** — is the diff information-dense or padded?
4. **LLM judge (Claude)** — Claude grades the commit
5. **LLM judge (GPT-4)** — GPT-4 grades the commit
6. **LLM judge (Gemini)** — Gemini grades the commit
7. **Mutation counterfactual** — flip a key claim, does verdict change?
8. **Adversarial probe** — inject false premise, does the commit accept it?
9. **Citation density** — every claim traces to a real prior commit?
10. **CWE pattern matcher** — does the diff introduce known vuln patterns?
11. **Atrophy guard** — is the author still active in this area?
12. **Incident-history checker** — has this file footprint caused incidents before?

### Output: cryptographic court ruling

```json
{
  "ruling": "GUILTY OF REGRESSION RISK" | "ACQUITTED" | "MISTRIAL",
  "consensus": 0.83,
  "verdicts": [/* 12 individual verdicts */],
  "majority_opinion": "...",
  "dissent": "...",
  "evidence": [/* commit hashes cited by jurors */],
  "signature": "<Ed25519 signature>",
  "timestamp": "2026-05-08T12:00:00Z"
}
```

Plus a rendered PDF for compliance archives.

### Implementation plan

1. **Juror interface** — each juror is a `MnemeJuror` with `vote(commit) → Verdict` signature.
2. **9 deterministic jurors** — implement using existing core modules (Bayesian, stylometric, entropy, mutation, adversarial, citation, CWE, atrophy, incident).
3. **3 LLM jurors** — call Claude, GPT-4, Gemini via existing LLM enricher abstraction. Falls back gracefully if a key is missing (jury size becomes 9-11).
4. **Foreman algorithm** — Jensen-Shannon divergence to detect jury disagreement; majority opinion synthesis; minority dissent capture.
5. **Court ruling PDF** — render via existing puppeteer-core peer dep.
6. **CLI**: `mneme court <commit>`, `mneme court --jury 12 <commit>`, `mneme court --quorum 9 <commit>`.

### Effort estimate

- Juror interface + 9 deterministic jurors: 1 week
- 3 LLM jurors + cost guards: 3-4 days
- Foreman + ruling synthesis: 3-4 days
- PDF rendering + signature: 2-3 days
- **Total: 2 weeks**

═══════════════════════════════════════════════════════════════════════

## Phase 5 — Cross-repo Wisdom Federation (privacy-preserving)

### Vision

Mneme instances across repositories share **learned patterns** (NOT raw
code) via differential privacy. You opt in; you contribute aggregate
signals; you receive aggregate signals. Anti-Copilot positioning:
"Copilot trains on your code (and you're forced to share). Mneme
federates wisdom WITHOUT touching your code."

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mneme Federation Hub                         │
│           (run by anyone; multiple hubs OK)                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Aggregate signals only:                                 │   │
│  │  • "247 repos with Stripe SDK saw regret-spike when     │   │
│  │     LRU cache added without TTL"                        │   │
│  │  • "Across 1,800 repos, atrophy half-life on auth code  │   │
│  │     averages 180d"                                      │   │
│  │                                                          │   │
│  │  NEVER stored:                                           │   │
│  │  • specific commit hashes                                │   │
│  │  • specific repo URLs                                    │   │
│  │  • author identities                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│            ▲                              │                      │
│            │ submit signal                │ subscribe to signals │
│            │ (differential privacy)       ▼                      │
│  ┌─────────┴───────┐              ┌─────────────────────┐       │
│  │  your Mneme     │              │  another Mneme      │       │
│  │  (opt-in)       │              │  (opt-in)           │       │
│  └─────────────────┘              └─────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Privacy guarantees

1. **Differential privacy** — Laplace noise added to all aggregates such that any single repo's contribution is statistically indistinguishable from absence (ε ≤ 1.0).
2. **k-anonymity** — signals are emitted only when ≥k=20 repos contributed.
3. **No raw data** — submitted signal types: `{pattern, regret_count, repo_count}` only. Never code, commits, file names, or authors.
4. **Tamper-evident** — every contribution is signed with the contributor's Ed25519 key; tampering is detectable.

### Implementation plan

1. **Federation protocol spec** — JSON-RPC over HTTPS, Ed25519 signed envelopes.
2. **Local opt-in flag** — `mneme federation join <hub-url>` writes `.mneme/federation.json`.
3. **Signal extraction** — periodic job extracts privacy-safe aggregates from local repo (regret patterns, atrophy averages, vuln-class frequencies).
4. **Hub server** — separate package `@mneme-ai/federation-hub` that anyone can run; ships with reference implementation backed by Postgres.
5. **Signal subscription** — local Mneme queries hub for matching signals when user asks "is this risky?".
6. **CLI**: `mneme federation join`, `mneme federation status`, `mneme federation contribute`, `mneme federation query <pattern>`.

### Effort estimate

- Federation protocol spec + crypto: 1 week
- Signal extraction + DP noise: 1 week
- Hub server (reference impl): 1 week
- Local CLI integration: 4-5 days
- Tests + privacy validation: 1 week
- **Total: 4-5 weeks**

### Risks

- **DP epsilon calibration** — getting the privacy/utility tradeoff right is nontrivial. Need formal DP analysis.
- **Hub trust** — even with DP, users must trust the hub operator. Multiple hubs encouraged.
- **Adversarial contributors** — sybil attacks on signal submission. Need rate limiting + reputation.

═══════════════════════════════════════════════════════════════════════

## Phase 6 — SaaS Dashboard (cross-org rollups)

### Vision

Multi-repo, multi-team Mneme instance hosted as a SaaS. Engineering
managers, CTOs, security teams get a single pane of glass: cross-repo
atrophy heatmaps, fleet-wide audit verdicts, incident correlation
graphs across all your codebases.

### Architecture

Already designed in [`docs/sales/03-SAAS-V2-ARCHITECTURE.md`](docs/sales/03-SAAS-V2-ARCHITECTURE.md).

Stack:
- **Backend**: Fastify (Node 22) + Postgres + Redis
- **Frontend**: Next.js 14 + Tailwind + d3
- **Multi-tenant**: row-level security in Postgres
- **Auth**: WorkOS / Auth0 (SSO required for enterprise)
- **Crypto**: Ed25519 audit chain inherited from CLI

### Effort estimate

- Backend skeleton + multi-tenant data model: 2 weeks
- Mneme-data ingest pipeline (CLI pushes to SaaS): 1 week
- Dashboard UI (atrophy / audit / forensics views): 3 weeks
- Auth + billing + admin: 1-2 weeks
- Tests + production hardening: 2 weeks
- **Total: 9-11 weeks (the big one)**

═══════════════════════════════════════════════════════════════════════

## Phase 7 (bonus) — Mneme Time Capsule

### Vision

End-of-quarter "time capsule" — single tarball containing the repo's
nervous-system snapshot, atrophy state, decisions, ghost code clusters.
New hires open the tarball; their AI tool replays it chronologically;
they go from 0 → expert in 30 minutes.

### Implementation

`mneme time-capsule export --quarter 2026-Q1 --out capsule.tar.gz`

Capsule contents:
- `nervous-system.json` — full passport snapshot
- `atrophy.json` — heatmap at the snapshot moment
- `decisions.json` — auto-extracted ADRs
- `ghost-clusters.json` — grouped half-finished features
- `wisdom-rules.json` — top-50 derived rules
- `replay-script.md` — chronological narrative for AI consumption

`mneme time-capsule import capsule.tar.gz` — restores into `.mneme/`,
generates a `replay.md` that the user pastes into their AI tool.

### Effort: 1 week

═══════════════════════════════════════════════════════════════════════

## Total roadmap (Phases 3-7)

- Phase 3 (Daemon): 2-3 weeks
- Phase 4 (Court): 2 weeks
- Phase 5 (Federation): 4-5 weeks
- Phase 6 (SaaS): 9-11 weeks
- Phase 7 (Time Capsule): 1 week

**Grand total:** 18-22 weeks if shipped sequentially. Can be parallelized
to 12-14 weeks with 2 contributors. SaaS (Phase 6) is the longest tail
and benefits most from a dedicated team.

═══════════════════════════════════════════════════════════════════════

## Recommended ship order

1. **Phase 7 (Time Capsule)** — fastest ship, biggest WOM ("send me your repo's time capsule" = viral mechanism)
2. **Phase 4 (Court)** — directly extends QSAC; high enterprise sales lever; <2 weeks
3. **Phase 3 (Daemon)** — performance unlock for power users; medium effort, high impact
4. **Phase 5 (Federation)** — anti-Copilot positioning; long but defensible
5. **Phase 6 (SaaS)** — biggest commercial opportunity but biggest commitment; right when there's funding/team

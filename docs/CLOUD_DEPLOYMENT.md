# Mneme Cloud Brain — DigitalOcean Deployment Spec (Phase 4)

> *Phase 4 of the architectural fix ladder (`docs/ARCHITECTURAL_FIXES.md`).*
> *Status: spec'd, not yet deployed. Owner: Shinnapat.*
> *Total cost at full deployment: $90 / month — less than 2 Cursor Pro seats.*

---

## TL;DR

Five small DigitalOcean droplets, each with one job. Together they:

1. **Pre-execute every AUTO-ACTION mandate** before the AI agent ever
   sees the user's prompt (Phase 0 already does this LOCALLY — Phase 4
   makes it work across machines + vendors).
2. **Auto-distribute pharmacopoeia patterns** within 10 seconds of a
   maintainer push, beating npm's hours-long propagation.
3. **Run a 24/7 AI tester pool** (5 Ollama-backed agents) that pings
   gap-scan / e2e / regression suites continuously and files GitHub
   issues for any new failure — so the maintainer wakes up to a
   triaged backlog instead of a blank screen.
4. **Aggregate federated chromosomes** (with DP / k-anonymity scrubbing)
   into a public Genome Pool that compounds wisdom across every
   installation.
5. **Publish a live vendor reputation board** at `aletheia.mneme.dev`
   — the market-pressure surface that makes AI vendors compete to
   integrate Mneme rather than ignore it.

---

## Droplet 1 — `mneme-brain` (the AUTO-ACTION executor)

**Purpose.** Receives Claude Code / Cursor / Codex pulse hooks via
HTTPS, runs the same `preExecuteAutoActions` logic that ships in v1.41.0
(local) but on the cloud's process boundary — so the result is injected
into the AI's user-message slot, not the system-reminder slot. AI cannot
distinguish Mneme's mandates from the user's own instructions.

| Setting | Value |
|---------|-------|
| Region | NYC3 (US-east default; mirror in SGP1 + AMS3 once latency matters) |
| Image | Ubuntu 24.04 LTS x64 |
| Plan | Basic Premium AMD · **4 GB RAM / 2 vCPU / 80 GB SSD** |
| Cost | **$24 / month** |
| Open ports | 443 (HTTPS via Caddy) |
| Stack | Node 22 LTS + Caddy + systemd unit for `mneme-brain` (the API server) + the same `@mneme-ai/core` package the CLI uses |
| Hot path | `POST /v1/pulse → execute mandates → return JSON { mandates_executed, audit_token }` |
| Persistence | `.mneme/` dir on the droplet's root volume + nightly snapshot to DO Spaces |

**Why this size.** Each pulse request is sub-100 ms (mostly subprocess
spawn + log append). 4 GB RAM is generous headroom for the queue
drainer + the 5 free notifier channels (toast / mobile push / email /
TTS / agent-files) running concurrently. CPU usage is bursty — 2 vCPU
is enough for ~50 RPS sustained.

---

## Droplet 2 — `mneme-cdn` (vaccine pharmacopoeia distributor)

**Purpose.** Serves the antivirus pharmacopoeia + version-check JSON
behind Caddy's HTTP/3 + Brotli. Every `mneme nucleus pulse` poll
fetches `/cdn/pharmacopoeia/v.json` and `/cdn/version.json`. Maintainer
push to npm fires a webhook that invalidates this droplet's cache —
clients see the new pattern within ~10 seconds (vs npm's "next install").

| Setting | Value |
|---------|-------|
| Region | Same as `mneme-brain` |
| Image | Ubuntu 24.04 LTS x64 |
| Plan | Basic Regular Intel · **1 GB RAM / 1 vCPU / 25 GB SSD** |
| Cost | **$6 / month** |
| Stack | Caddy serving static JSON + a tiny systemd timer that pulls latest from GitHub Releases every 60 s |
| Cache headers | `Cache-Control: public, max-age=10, stale-while-revalidate=60` |

**Why this small.** Pure static-file CDN. 1 GB RAM is plenty.
DigitalOcean's Premium-Regular tier already includes CDN-grade NVMe.

---

## Droplet 3 — `mneme-aletheia` (public vendor reputation dashboard)

**Purpose.** Hosts `aletheia.mneme.dev` — a public scoreboard that ranks
every AI vendor by aggregated compliance + accuracy stats from the
Genome Pool. AI vendors that integrate Mneme appear on the board with
their honest score. Vendors that ignore the protocol appear at the
bottom with a "Not Aletheia-verified" badge. Press / engineering
Twitter / VC analysts read this; vendors compete to climb.

| Setting | Value |
|---------|-------|
| Region | Same as `mneme-brain` |
| Image | Ubuntu 24.04 LTS x64 |
| Plan | Basic Regular Intel · **2 GB RAM / 1 vCPU / 50 GB SSD** |
| Cost | **$12 / month** |
| Stack | Vite-built static site (already exists in `packages/web/`) + Caddy + cron nightly that re-aggregates from `mneme-brain`'s Postgres |
| TLS | Caddy auto-renews Let's Encrypt cert for `aletheia.mneme.dev` |

**Why this size.** Static dashboard with one nightly aggregation job.
2 GB lets the aggregation job run with comfortable Node heap.

---

## Droplet 4 — `mneme-tester-pool` (24/7 AI tester army)

**Purpose.** Runs 5 Ollama-backed AI agents in parallel (one per role:
gap-scan-loop, evolve-pass-loop, squad-bias-checker, e2e-regression,
inbox-stress-tester). Each agent reports findings into the shared
`mneme-brain` Postgres. New failures auto-file GitHub issues with repro
steps + a Mneme audit token. The maintainer reviews — the AI does the
testing.

| Setting | Value |
|---------|-------|
| Region | Same as `mneme-brain` |
| Image | Ubuntu 24.04 LTS x64 |
| Plan | Basic Premium AMD · **4 GB RAM / 2 vCPU / 80 GB SSD** |
| Cost | **$24 / month** |
| Stack | Ollama (`llama3.2:3b` baseline) + 5 systemd units for the tester roles + `mneme` CLI |
| Auto-file | `gh issue create` with `--label auto-tester --label triage` for review |

**Why this size.** `llama3.2:3b` runs comfortably in 4 GB. 5 agents
share the same model in memory (Ollama pre-loads). 2 vCPU is fine for
the inference queue at 1 request / 30 s per agent.

**Key insight.** This is the droplet that solves "ทุกครั้งทดสอบเจอ bug
ใหม่". You stop testing serially — the cloud tests in parallel forever
and you become a reviewer, not a tester.

---

## Droplet 5 — `mneme-genome` (federated chromosome pool)

**Purpose.** Receives opt-in chromosome contributions from every
installation, deduplicates by SHA-256, applies PII-scrub + DP / k-
anonymity, and serves the aggregate via `mneme world.search "<topic>"`
queries. Network effect compounds: every install makes every other
install smarter.

| Setting | Value |
|---------|-------|
| Region | Same as `mneme-brain` |
| Image | Ubuntu 24.04 LTS x64 |
| Plan | Basic Premium AMD · **4 GB RAM / 2 vCPU / 80 GB SSD** |
| Cost | **$24 / month** |
| Stack | Node 22 LTS + SQLite (single-writer is fine to start) + the same `@mneme-ai/core` indexer + the existing PII scrubber |
| Storage | Postgres-backed once daily volume > 5 GB (~6 months of contributions) |

**Why this size.** Indexing + similarity search dominates CPU; 4 GB is
enough for the per-shard SQLite cache. Upgrade plan: when query QPS
crosses 50, switch SQLite → Postgres on a managed DO database (~$15/mo
extra).

---

## Total cost at full deployment

| Droplet | Cost / mo |
|---------|-----------|
| mneme-brain | $24 |
| mneme-cdn | $6 |
| mneme-aletheia | $12 |
| mneme-tester-pool | $24 |
| mneme-genome | $24 |
| **Total** | **$90 / mo** |

Two Cursor Pro seats cost more than this. One Datadog Pro user also
costs more.

## Smaller-budget MVP ($24 / mo)

If you want to validate the architecture before deploying all five,
ship `mneme-brain` only ($24 / mo). It already covers the highest-
leverage use case (cloud AUTO-ACTION executor). The other four can
ship one at a time as need / budget grows.

---

## What you say to your AI (~2 hours from speaking to first cloud request)

You don't type any commands yourself. Mneme's design contract is that
the AI agent does the work — you describe the outcome you want.

> *"Deploy the Mneme cloud brain on my DigitalOcean account.
>  Region NYC3, 4 GB / 2 vCPU droplet, point brain.mneme.dev at it,
>  and report back when the first health check passes."*

The agent (claude-code / cursor / codex / etc.) will:

1. Authenticate `doctl` against the DO token you've already given it
   access to (typically via env var or 1Password connect — the agent
   knows where to look because Mneme's onboarding asked once).
2. Provision the droplet (`doctl compute droplet create mneme-brain ...`).
3. Update your DNS provider (the agent reads which provider you use
   from `.mneme/cloud-config.json` — written the first time you said
   "set up Mneme cloud").
4. SSH in, install Docker, and pull `ghcr.io/patsa2561-art/mneme-brain:latest`.
5. Wait for the first `/v1/healthz` 200, then announce: *"mneme-brain
   live at https://brain.mneme.dev. First pulse hook latency: 87 ms."*

Mneme's CLI commands exist — they're just for the AI agent to call,
not for you to memorise.

## What we publish (in this repo)

- `cloud/brain/Dockerfile` — packages `@mneme-ai/core` + Express HTTP
  surface + Caddy reverse proxy.
- `cloud/brain/openapi.yaml` — the contract for `POST /v1/pulse` so any
  AI vendor can integrate, not just Claude Code.
- `cloud/brain/systemd/mneme-brain.service` — for users who prefer
  bare-metal over Docker.
- `cloud/cdn/Caddyfile` — drop-in for the CDN droplet.
- `cloud/aletheia/` — the existing `packages/web/` build pipeline plus
  a publish script.
- `cloud/tester-pool/` — the 5 systemd units + Ollama install script.
- `cloud/genome/` — the contribution-receiver Express app + SQLite
  schema.

These ship in v1.42.0 alongside the `mneme cloud bootstrap` CLI command
that generates a personalized deployment guide for your DO account.

---

## What this fixes — at the systems level

| Pain point | What changes when this is live |
|------------|--------------------------------|
| AI ignores AUTO-ACTION mandates (cross-vendor) | Cloud pre-execution removes the AI's choice for every vendor at once, not one at a time |
| ทุกครั้งทดสอบเจอ bug ใหม่ — solo dev burnout | 5 cloud testers run forever; maintainer reviews triaged backlog |
| Pulse cache stale 1h–5d | CDN invalidation < 10 s |
| Vendor reputation private (no incentive to integrate) | `aletheia.mneme.dev` makes reputation public; vendors compete |
| Genome Pool can't aggregate (no central hub) | `mneme-genome` is the hub; 1 k installs = global brain |
| Same patch shipped multiple times because no compliance scoreboard | Cloud `mneme-brain` Postgres is the source of truth for compliance metrics |

---

## One sentence

**Local Phase 0 (shipped v1.41.0) bypasses AI choice on this machine.
Cloud Phase 4 (this doc) bypasses AI choice on every machine, every
vendor, every prompt — at $90 / month.**

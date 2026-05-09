# MneMeiosis Protocol — Cross-Session AI Inheritance

> _"Brain doesn't tell itself 'remember this' — it just remembers."_
>
> Mneme = Memory. **MneMeiosis** = the act of compressing one session into
> a heritable Chromosome that the next session inherits — automatically.

---

## The problem

Every AI agent has the same gap: **close the laptop → context dies**.
Open a new session, even with the same AI, and the agent doesn't remember:

- What you were just working on
- Which files matter and which don't
- The patterns it learned to avoid (hallucination-prone, dead-end)
- The molecules of tools it composed that worked

The current ecosystem makes it worse:
- **Claude Memory** — vendor-locked to Anthropic
- **Cursor history** — vendor-locked to Cursor
- **OpenAI Memory** — vendor-locked to ChatGPT
- **mem0 / supermemory** — third-party SaaS lock-in
- **Long context windows** — restart kills it; tool switch kills it

Nothing is **vendor-neutral**, **local-first**, **AI-tool-agnostic**, AND
**cross-machine** under user control.

That's MneMeiosis.

---

## The metaphor — biology, mapped exactly

| Biology | Mneme already had | MneMeiosis adds |
|---|---|---|
| Gene | Atom (1 tool call) | — |
| Operon | Molecule (atom co-fire) | — |
| Chromosome | — | **Compressed snapshot of one session** |
| Genome | — | **Lineage = chromosomes + family tree** |
| Spore | — | **Portable artifact for cross-machine sync** |
| Meiosis | — | **Session-end compression** |
| Fertilization | — | **Session-start: inherit from ancestors** |
| Mutation | — | confess verdict adjusts karma + mutates molecule recipes |
| Selection pressure | ALETHEIA karma | Atoms with karma < 0 quarantined; lethal recessives culled |
| Speciation | — | **Sub-lineage detection via Jaccard distance** |

---

## The four layers

### Layer 1 — Chromosome (compressed session)

When a session ends (process exit, idle 45 min, context-pressure
checkpoint, or manual `mneme lin crystallize`), Mneme compresses the
working memory into a signed Chromosome:

```jsonc
{
  "schemaVersion": 1,
  "id": "2026-05-09T140000Z-claude-opus-4-7-a3f9b21c",
  "vendor": "claude-opus-4-7",
  "machineId": "<sha256 hostname+cwd, 16 hex>",
  "parents": ["<chromosome-id>", "<chromosome-id>"],
  "vectorClock": { "<machineA>": 5, "<machineB>": 3 },
  "topic": "auth refactor",
  "atomKarmaDeltas": { "<tool>": { "karma": +3, "invocations": 12, ... } },
  "molecules": [{ "name": "ask__certify", "atoms": [...], "fireCount": 5 }],
  "courtVerdicts": [...],
  "confessOutcomes": { "verified": 12, "hallucination": 1, "avgSelfConfidence": 0.78 },
  "voiceFingerprint": { "topPhrases": [...], "topTopics": [...] },
  "constitutionCandidates": [{ "rule": "always pair X with Y" }],
  "lethalRecessives": ["<atom-flagged-as-hallucination>"],
  "session": { "startedAt": "...", "endedAt": "...", "totalCalls": 47, "endReason": "exit-signal" },
  "signedBy": "<ed25519 PEM>",
  "signature": "<ed25519 sig hex>",
  "contentHash": "<sha256 of canonical JSON>"
}
```

Stored at `.mneme/lineage/chromosomes/<id>.chromosome.json`.
Tamper-evident (signature + hash both verify). PII-scrubbed
(emails / paths / API tokens) before persistence.

### Layer 2 — Lineage tree (DAG)

Every chromosome has 0-2 parents → DAG of family history at
`.mneme/lineage/tree.json`. Lookups in O(1):

- `mneme lin ancestors [N]` — last N chromosomes
- `mneme lin show <id>` — full content of one
- `mneme lin diff <a> <b>` — Mendelian distance + per-atom delta

### Layer 3 — DNA Spore (cross-machine)

Sync via **git** — using the repo's existing remote, on an orphan
branch `mneme-lineage`:

- `mneme spore init` auto-detects git origin (no setup if you already have one)
- `mneme spore push` pushes lineage payload to orphan branch
- `mneme spore pull` fetches new chromosomes from other machines
- Network failures are SILENT (vector clock advances; retries on next push)
- Identity keypair is .gitignored — **private key never travels**

**The "account" = your Ed25519 public key.** No Mneme cloud, no vendor login.

### Layer 4 — Mendelian inheritance (when ancestors disagree)

When two parents are merged into a child (boot fertilize, OR pulling from
spore), Mneme applies **Mendel laws**:

| Trait | Rule |
|---|---|
| Both atoms positive | Max (dominant trait inherits stronger karma) |
| Both negative | Min (lethal recessive — penalty deepens) |
| Mixed signs | Mean (heterozygous; expression masked) |
| One-sided | Additive (new info enters gene pool) |
| Counters (invocations, verified, hallucinations) | Sum |
| Lethal-recessive intersect | Atom in BOTH parents' lethal set stays culled |
| Lethal-recessive union | Atom in EITHER parent's set is dropped from karma |
| Vector clock | Per-machine max (Lamport-style) |
| Molecules | Same name → fireCount=max, karma=sum |
| Topic | Longest (richer description wins) |
| Court verdicts | Dedupe by claim text (newest wins) |
| Constitution candidates | Dedupe by rule text (highest confidence wins) |
| Voice fingerprint | Avg sentence len = mean; phrases / topics = top by frequency |

**Properties guaranteed:**
- Commutative: `fertilize(A, B) === fertilize(B, A)`
- Idempotent: lethal in A∩B stays lethal
- Additive in counters
- Bounded: child cannot have an atom both parents lethal-flagged

---

## Cross-AI pedigree — the "Mneme is teacher to all AIs" payoff

If you use **Claude in the morning, Cursor in the afternoon, Codex at
night**, Mneme tracks each as a separate vendor in the same lineage.
Tools surface this:

- `mneme lin pedigree` — per-vendor stats: chromosome count, total karma,
  verified rate, best atoms
- `mneme.lineage.vendor_karma` — leaderboard
- `mneme.lineage.routing_hint(query)` — for a free-text query, recommends
  which vendor's track record fits best

The next AI agent that opens the session inherits **all three vendors'
DNA** through Mendelian merge. It starts the day already knowing what
worked across the team of AIs.

---

## Two modes (parallel, not competing)

### Mode 1 — Auto-magic (default UX)
User asks AI agent: "install Mneme from `<URL>`". From there:

```
AI agent → npm install -g mneme-ai && mneme mcp --install
mneme detects non-TTY install → applies SAFE DEFAULTS silently:
  ✓ Lineage on
  ✓ Spore remote = auto-detected git origin (orphan branch mneme-lineage)
  ✓ PII scrub on
  ✓ Encryption-at-rest off (planned for v1.20)
AI agent → calls mneme.welcome → gets handoff payload
AI agent → translates userMessageTemplate to user's language
AI agent → User: "ติดตั้ง Mneme เรียบร้อย — Lineage เปิดอยู่ที่ sync ไป
                  branch mneme-lineage. บอกผม 'ปิด lineage' ถ้าไม่อยากใช้"
```

User typed once. Never types again.

### Mode 2 — Manual control (power-user / debugging)
Every operation has a CLI command (mirror of the MCP tool, same backend):

```bash
mneme welcome                       # mirror of mneme.welcome
mneme spore init [--remote <url>]   # one-time setup
mneme spore push / pull / sync      # explicit sync
mneme spore status                  # connection + clock state
mneme lin status                    # lineage summary
mneme lin on / off                  # toggle
mneme lin crystallize               # manual checkpoint
mneme lin fertilize                 # preview inheritance
mneme lin ancestors [--limit N]     # list recent
mneme lin show <id>                 # one chromosome
mneme lin diff <a> <b>              # Mendelian distance
mneme lin species                   # speciation events
mneme lin pedigree                  # cross-AI family tree
mneme lin routing-hint <query>      # vendor recommendation
mneme lin lethal                    # culled atoms
mneme lin purge --confirm           # nuke all lineage data
```

All accept `--json` for scripting.

---

## Performance budgets

| Operation | Budget | How |
|---|---|---|
| Auto-fertilize at boot | < 300ms | Top-3 ancestors, no embedder, JSON streaming |
| Auto-crystallize on exit | < 2s | Incremental flush during session, finalize on exit |
| Sleep-mode consolidation | < 5s, async | Background worker, never blocks dispatch |
| Spore push | < 10s | Diff-only commit on orphan branch |
| Spore pull + merge | < 8s | Fetch + materialize via `git show` |
| `mneme lin ancestors` (10) | < 50ms | Pure disk listing + JSON parse |
| `mneme lin pedigree` | < 200ms | Linear scan + per-vendor aggregation |

Tested: 1000 atoms crystallizes in **< 500ms** (perf guard test).

---

## KPIs (production-grade, surfaced via `mneme.lineage.metrics`)

```
totalChromosomes          # how many sessions Mneme has remembered
totalCallsAggregate       # sum of session.totalCalls across lineage
lethalRecessiveCount      # atoms culled by hallucination flag
vendorCount               # unique AI vendors that contributed
speciationEvents          # detected sub-lineage forks
storageOverheadKb         # disk footprint of .mneme/lineage/
sporeConfigured           # boolean
identityFingerprint       # 16-char SHA-256 of public key
```

---

## Privacy model

- **Identity keypair** — Ed25519, generated on first run, lives in
  `.mneme/lineage/identity/`. Private key mode 0600. NEVER pushed.
- **PII scrub** — emails / absolute paths / API tokens / UUIDs scrubbed
  from chromosomes before write. Reversible enough to keep DOMAINS
  (`<email>@acme.com`) for vendor-level signal without identifying
  individuals.
- **Spore** — only the public key + signed chromosomes travel. Identity
  private + working/ directory are .gitignored at init.
- **Encryption-at-rest** — opt-in via `mneme lin encrypt on` (planned v1.20).

---

## Roadmap

- **v1.19.0** (this release) — all 4 layers + 18 MCP tools + 13 CLI commands + auto-triggers
- **v1.20** — encryption-at-rest (AES-256-GCM with identity-derived key); voice fingerprint augmentation via sampling primitive
- **v1.21** — vaccine federation across MCP Mesh peers
- **v1.22** — public AI-vendor trust dashboard at `lineage.mneme.dev` (opt-in, anonymized aggregate of confess scoreboards)

---

## How to adopt MneMeiosis in another MCP server

1. Implement Layer 1 — define a Chromosome shape (steal ours; Apache-2.0-friendly)
2. Implement Layer 2 — DAG of parent → children
3. Implement Layer 3 — git-backed Spore (or any user-owned storage)
4. Implement Layer 4 — Mendelian merge (the math is in `packages/core/src/lineage/mendel.ts`)
5. Expose tools matching the namespaces:
   - `<server>.lineage.*`
   - `<server>.spore.*`
   - `<server>.welcome`
6. Mirror the file layout: `.<server>/lineage/`

The win is the open standard, not the implementation. Mneme is the
reference impl; we'd love it if Claude / Cursor / Continue adopt it.

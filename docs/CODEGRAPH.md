# LIVING SOUL CODEGRAPH (v2.25.0)

> CodeGraph maps your code. Mneme's LIVING SOUL knows **who** touched it, **when**, **why**, and refuses to lie about what's there.

A typical static codegraph (e.g. `@colbymchenry/codegraph` v0.8.0) renders file imports + function references — a "Google Maps of Codebase". Mneme ships the same graph plus 8 differentiation primitives layered on top.

## What's in v2.25.0

| # | Feature | CodeGraph | LIVING SOUL |
|---|---------|:---------:|:-----------:|
| 1 | File deps + symbol references | ✅ | ✅ |
| 2 | **HMAC-chained provenance** per edge — every edge cryptographically attested | ❌ | ✅ |
| 3 | **Drift sentinel** — detects broken edges since last build | ❌ | ✅ |
| 4 | **Time-travel hint** — every edge carries `firstSeenCommit` | partial | ✅ |
| 5 | **Vendor attribution** (`touchedBy`) — every edge tracks who created it | ❌ | ✅ |
| 6 | **Hallucination vaccine** — AI-hallucinated edges get permanent warning | ❌ | ✅ |
| 7 | **Merkle root** — cross-machine sync in O(log N) without full transfer | ❌ | ✅ |
| 8 | **MCP-native** — graph queries reachable via MCP for any AI agent | ❌ | ✅ |
| 9 | Persistence to `.mneme/codegraph/` + append-only drift ledger | ❌ | ✅ |
| 10 | Deterministic build across rebuilds (Merkle root excludes wall-clock) | ❌ | ✅ |

## Measured (Mneme repo self-build)

- 2000 file nodes · 9818 total nodes · 13507 edges
- **~400ms cold build** on Windows / Node 24
- 0 drift events post-build (sanity)
- HMAC chain verifies in <5ms across all 13507 edges
- Merkle root stable across rebuilds

## CLI

```bash
# Build the graph for this repo (writes .mneme/codegraph/)
mneme codegraph build

# Query (auto-routed via MCP universal router)
mneme codegraph query --json '{"kind":"function","symbol":"verify"}'
mneme codegraph query --json '{"pathContains":"acgv"}'
mneme codegraph query --json '{"warningsOnly":true}'

# Detect drift since last build
mneme codegraph drift                       # peek
mneme codegraph drift --record true         # persist to drift.jsonl

# Cross-machine sync — compare these between two installs
mneme codegraph root

# Verify HMAC chain integrity
mneme codegraph verify

# Mark an edge as hallucination (AI hallucinated it; warn future agents)
mneme codegraph warn --edgeId <id> --reason "AI hallucinated this call"
```

## MCP tools (AI-agent surface)

| Tool                          | What it does |
|-------------------------------|--------------|
| `mneme.codegraph.build`       | Build + persist. Returns stats + Merkle root + HMAC signature. |
| `mneme.codegraph.query`       | Filter nodes/edges. AI agent uses to reason about codebase. |
| `mneme.codegraph.drift`       | Returns broken/stale edges. AI calls before editing risky files. |
| `mneme.codegraph.root`        | Returns Merkle root for cross-machine sync. |
| `mneme.codegraph.verify`      | Verifies HMAC chain integrity. |
| `mneme.codegraph.warn`        | Marks an edge as hallucination-vaccine warning. |

## Edge schema

```ts
interface CodeEdge {
  id: string;
  src: string;                // CodeNode.id
  dst: string;                // CodeNode.id
  kind: "imports" | "exports" | "calls" | "references" | "extends" |
        "implements" | "tests" | "co-changes";
  confidence: number;         // 1.0 = AST/regex evidence; lower = statistical
  lastSeen: string;
  touchedBy?: string;         // AI vendor / human who created or last modified
  firstSeenCommit?: string;   // commit at which edge first observed
  vaccineWarning?: boolean;   // AI hallucinated this; warn future agents
  warningReason?: string;
  hmac: string;               // chain link
}
```

## How the HMAC chain works

Each edge body (everything except `hmac` + `lastSeen`) is canonicalized + HMAC'd with the **previous** chain link. The chain seed is 64 zeros. Receivers verify by re-deriving the chain from the canonical bodies.

Tampering with any edge breaks the chain at that position. `verifyChain()` returns the index + edge id of the first break — actionable for forensics.

## How Merkle sync beats full re-transfer

Two machines compute their `merkleRoot` (32 bytes). Identical → graphs match. Different → drill into layer-1 hashes to find the divergent subtree, fetch only the differing leaves. Cross-machine sync cost ≈ O(log N) instead of O(N).

For v2.25.x we'll ship the actual diff-fetch protocol; v2.25.0 ships the root primitive.

## How drift sentinel works

`detectDrift()` scans every edge:
- `dst-missing` — imported file no longer exists (severity high)
- `src-missing` — owning file deleted (severity high)
- `file-deleted` — non-import edge to a missing file (medium)
- `edge-stale` — src changed > 24h after graph built (low)

Daemon-tick organ runs this every N ticks; severity≥high fans out to the notifier. AI agents can poll it via `mneme.codegraph.drift` before applying edits.

## Hallucination vaccine

If an AI proposes a function call to `foo.bar()` and `bar` doesn't actually exist on `foo`, the user/operator calls `mneme.codegraph.warn` with the hallucinated edge. The warning persists in the graph forever. Future agents querying the graph see `vaccineWarning: true` + `warningReason` — they know not to re-propose the edge.

CodeGraph has no analogue. Mneme's graph is a self-immunizing memory.

## Time-travel (partial in v2.25.0; full in v2.25.x)

Every edge carries `firstSeenCommit`. Today's query: "when was this edge first observed?" — answered offline from the snapshot.

v2.25.x will ship `git checkout`-based rebuilding so the graph can be queried at ANY commit, not just the build snapshot. The data model is ready.

## Honest limits

- v2.25.0 ships **regex parsing** for TypeScript / JavaScript. AST-grade parsing (with type-aware `calls` edges) is v2.25.x.
- Python / Go / Rust support is v2.26.x.
- The 24/7 daemon-tick drift organ is wired but the threshold-based notifier integration ships in v2.25.x.
- Time-travel `at(commit)` is data-model-ready but the rebuild orchestrator is v2.25.x.
- Co-change edges (`kind: "co-changes"`) are scaffolded; the git-log analyzer that populates them ships in v2.25.x.

## Composes with

- **MCP fuzzer (v2.24.0)** — 109-vector pack adds graph-query attack vectors in v2.25.1
- **Trust Capsule** — `mneme.codegraph.root` is wrappable in a trust capsule for cross-org attestation
- **MCP-CANDOR/0.1** — schema export in v2.25.x so any MCP server consumes Mneme's graph
- **DOJO** — 7th sensei "graph drift" sparring partner ships in v2.25.x

## Comparison with the competitor

| Question | CodeGraph (v0.8.0) | Mneme LIVING SOUL (v2.25.0) |
|----------|--------------------|-----------------------------|
| Cost claim | 35% cheaper / 70% fewer tool calls | drift detection + HMAC = no cost wasted on hallucinated edges |
| Install | `npx @colbymchenry/codegraph` | `npm install -g mneme-ai` (bundled with 700+ other tools) |
| AI agents supported | Claude Code / Cursor / Codex / opencode | Any MCP client + any Mneme-aware CLI |
| Per-edit truth verification | ❌ | ✅ (drift + vaccine + ACGV) |
| Cross-machine integrity | ❌ | ✅ Merkle root |
| Vendor attribution | ❌ | ✅ |
| Anti-hallucination memory | ❌ | ✅ vaccine warnings |
| HMAC tamper-evident | ❌ | ✅ |
| Standalone graph format | proprietary | open (MCP-CANDOR ready) |
| Bus factor | 1 (solo dev) | growing community (Mneme) |
| License | MIT | MIT |

## What's next (v2.25.x)

- AST-grade TypeScript parser (resolves `calls` + `references` precisely)
- Time-travel via `git checkout` rebuild
- 24/7 daemon-tick drift organ → notifier
- Merkle diff-fetch protocol (cross-machine sync without full transfer)
- Co-change edges from git log
- MCP-CANDOR graph schema export
- Python / Go / Rust support

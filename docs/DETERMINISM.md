# Determinism Semantics (v2.23.2)

> What Mneme guarantees about same-input → same-output, and the explicit boundaries where that guarantee breaks. Written so adversarial CLI audits can cite this file instead of guessing.

## Why determinism matters

A truth-verifier that returns different verdicts for the same claim is a coin flip with extra steps. AI agents calling `mneme verify` must be able to assume that `verify "X" == verify "X"` across:

- Repeated calls within a process
- Repeated calls in separate processes
- Concurrent calls from different agents
- Calls on different installs (e.g. cross-machine peer comparison)

This doc lays out exactly where each layer is deterministic, where it is **explicitly non-deterministic** (with the reason), and how to detect drift.

## Deterministic layers

| Layer | Determinism | How verified |
|------|-------------|--------------|
| Hyperbole detector (`squadron/hyperbole_detector.ts`) | **100% pure regex** — same string → same `{flagged, matches, vaccineSignature}` | `acgv_v23_2.test.ts` runs each claim 3× + checks `JSON.stringify` equality |
| ACGV Layer -1 (empty/whitespace/control-char) | **100% pure** — function of `claim` alone | Same harness |
| Coercion Taxonomy (`coercion_taxonomy/`) | **100% pure regex** | `coercion_taxonomy.test.ts` |
| Physics Lathe axioms (`physics_lathe/axioms.ts`) | **100% pure math** | `physics_lathe.test.ts` |
| MCP-CANDOR handshake / spec / classify | **100% pure** | `mcp_candor.test.ts` |
| Trust Capsule HMAC sig | **Deterministic per input** — same payload + secret → same sig | `trust_capsule.test.ts` |
| Hyperbole verdict via `mneme verify` CLI | **Deterministic** when claim has no repo-grounded sub-claims | `v23_2-audit-fixes.test.ts` — same claim 3× pinned to REFUTE |

## Explicitly non-deterministic layers

These are not bugs — they are inputs to the verdict that legitimately change over time. Each is documented + each emits a caveat so callers can detect.

| Layer | Why non-deterministic | Caveat surfaced |
|------|----------------------|-----------------|
| Chandrasekhar grounding | Reads live git history + filesystem; verdict depends on repo state at call time | `chandrasekhar.timestamp` in `result.layers` |
| Vaccine cache (`acgv_vaccine`) | Cache grows monotonically — once a lie is refuted, future calls hit the cache | `caveats: ["AUTO_REFUTE_FROM_VACCINE"]` |
| Z3 SAT solver | Runs in worker subprocess; under load may time out and fall back to propositional | `result.engine: "z3" | "propositional"` |
| Live MCP tool catalog | Tools registered/deprecated over versions; `mneme.X.Y is registered` flips when the tool ships | Verdict carries `result.engine`; `caveats: ["LIVE_CATALOG_CHECK"]` |

**Rule for callers**: if you need cross-call stability, freeze the relevant inputs. `mneme verify --counter-evidence "..."` lets you pin the confession layer; for the repo-state layers, take a `git rev-parse HEAD` snapshot before the call.

## Concurrent-read story

The audit asked: if two AI agents call `mneme verify` against the same install simultaneously, can they corrupt each other's state?

- **Reads (verify / candor classify / hyperbole)**: pure functions over claim + repo state. Concurrent reads are safe — no shared mutable state, no lock needed.
- **Vaccine cache writes**: append-only to `.mneme/vaccines/*.jsonl`. Node.js append writes < 4KB are atomic on POSIX + Windows. Two agents emitting the same vaccine concurrently produces two identical lines, which the deduper folds on next read.
- **Trust Capsule**: HMAC sig is computed from the canonical payload + a per-install secret. Two concurrent issues for different payloads produce two valid capsules; same payload twice produces the same sig.
- **Conductor `PREVIEW → GATE → EXECUTE → ATTEST`**: each step takes a `lockfile` at `.mneme/conduct/<intent>/.lock`. Second concurrent caller gets `LOCK_HELD` immediately, no partial state.

## Daemon stale-cache caveat (v2.23.2 finding)

The daemon (`nucleus_daemon.ts`) loads `dist/index.js` once into a warm V8 heap. CLI commands on the WARMCALL allowlist (`verify`, `status`, `groups`, `capabilities`, `version`, `welcome`, `doctor`, `browse`, `ask`, `why`, `premortem`, `honesty`, `phoenix`, `system`) talk to the daemon over a UDS / named pipe and let it execute in that heap.

**Consequence**: if you `npm install -g mneme-ai@new-version` but the daemon was started before the upgrade, your `mneme verify` calls hit the daemon's STALE code until the daemon restarts.

**Detection**: the v2.23.2 audit fixes (hyperbole detector, explainer changes, verify_claims positional, empty-input verdict) all confirmed correctly on cold processes but appeared "broken" via daemon. We've added two protections:

1. **Test isolation**: `tests/regression/helpers.ts` sets `MNEME_WARMCALL=0` and `MNEME_MUSCLE_BYPASS=0` in subprocess env so regression tests always run against freshly-built dist code.
2. **User remedy**: `mneme system upgrade` already calls `mneme.diaspora.spore.autostart` which respawns the daemon. Users who upgraded via direct `npm` can `pkill mneme || taskkill /F /IM node.exe` (drastic) or wait for the next daemon supernova cycle (~10 min).

**Long-term fix** (future release): daemon should fs.watch `dist/index.js` mtime + self-restart on change. Tracked in roadmap.

## How to detect drift

```bash
# Pin a verdict + re-verify across releases:
mneme verify "Mneme cured cancer" --json > /tmp/v0.json
# ...upgrade...
mneme verify "Mneme cured cancer" --json > /tmp/v1.json
diff /tmp/v0.json /tmp/v1.json
# Expected diff:
#   - "engine" (z3 vs propositional)
#   - timestamp fields
# UNEXPECTED diff:
#   - "verdict" — file a bug
#   - "confidence" delta > 0.05
```

## Honest limits

- The Z3 solver is deterministic given the same query, BUT the propositional fallback uses a different proof search and may return a different `core` list. Both layers MUST agree on the verdict; mismatches are an explicit caveat (`LAYERS_DISAGREE`).
- Cross-machine determinism requires the same Mneme version + the same physics_lathe axiom set. Pin both before comparing.
- The vaccine OSMOSIS feature adds time-decay; verdicts on borderline claims may flip from REFUTED → PASSTHROUGH 30 days after the original refute. This is intentional (stale lies retire) but is a determinism boundary worth noting.

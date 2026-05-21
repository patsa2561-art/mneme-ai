# Verb Engine — Companion + Conductor (v2.22.0)

> AI agents normally call Mneme verbs by guessing args, reading docs reactively, and recovering from failures.
> v2.22.0 wraps every verb in a **Companion** (auto-derived contract + spec + storyline + outcome stats) and orchestrates multi-step intents through a **Conductor** with atomic commit/rollback.

This is the chassis for the transactional verb engine roadmap (v2.22 chassis · v2.23 SAT planner · v2.24 ZK contract proofs · v2.25 adversarial learn-loop).

## Companion — 5 components per verb

| Pillar | What it does | Source |
|--------|--------------|--------|
| **Contract** | Pre/post-conditions, side-effects, DEFCON tier (1-5), idempotency level | Auto-derived from manifest; override file optional |
| **Autospec** | JSON Schema for args + `validateArgs()` to catch bad invocations BEFORE the verb runs | Parsed from manifest `command` template |
| **Doppelganger** | Copy-on-write fs overlay dry-run + diff (added / changed / removed files) | Universal interceptor; reports `leakage: possible` for native/network verbs |
| **Storyline** | Markov chain over pheromone log — "what verb commonly follows / precedes this one" | Reads `.mneme/atlas/pheromones.jsonl` |
| **Learn-loop** | Per-verb outcome stats + common-mistakes miner with privacy redaction | Failure-only mining; opt-IN replay deeper mining |

**Single call** — `mneme verb <name>` returns all 5 in one structured response (~400 bytes for known-cold verb, more once live data accumulates).

## DEFCON tiers (Companion contract output)

| Tier | Meaning | Doppelganger required? |
|------|---------|-----------------------|
| 5 | Read-only (atlas, hot, tags, route, verify-self) | No |
| 4 | Mutates local state (probe, grant, verdict) | Recommended |
| 3 | Reaches external network (federation push, transmit) | Yes |
| 2 | Destructive but recoverable (revoke, uninstall) | Required |
| 1 | Irreversible (mortuary fire, publish, deploy) | Required + explicit confirm |

## Conductor — transactional engine

Natural-language intent → atomic execution with all-or-nothing semantics:

```
PLAN     greedy router (atlas intent) → ordered verb sequence with contracts attached
PREVIEW  every step run through doppelganger; aggregate file diff
GATE     DEFCON + arg-validity policy; reject if leakage on destructive plans
EXECUTE  verbs run against staged shadow; on first failure → rollback; on success → atomic apply
ATTEST   HMAC-signed receipt (v2.22.0); ZK proof placeholder for v2.24
```

```bash
$ mneme conduct "verify trust"
🎼 PLAN — plan_a3f2
  Intent:        verify trust
  Steps:         3
  Worst DEFCON:  5
  Args valid:    yes
  1.  mneme verify-self --score   (DEFCON 5, read-only)
  2.  mneme rights                (DEFCON 5, read-only)
  3.  mneme receipts ledger       (DEFCON 5, read-only)

👁  PREVIEW — plan a3f2
  Aggregate exit:  0
  Files:           +0 / Δ0 / -0
  Leakage:         exact

Gate: ✓ approved

  dry-run only. Pass --commit to execute the plan for real.
```

## Examples

```bash
# Read the companion for a verb you've never used
mneme verb earthquake drift

# Coverage report for the whole catalog
mneme verb x --coverage

# Plan + preview (dry-run by default)
mneme conduct "detect vendor drift on claude; surface verdict"

# Actually execute the plan atomically
mneme conduct "detect vendor drift" --commit

# Force explicit confirmation even on safe plans
mneme conduct "verify trust" --commit --confirm

# Receipt audit
ls .mneme/conductor/receipts.jsonl
```

## Roadmap

| Version | Adds | ETA |
|---------|------|-----|
| **v2.22.0** (now) | Chassis — Companion 5 pillars + Conductor PLAN/PREVIEW/GATE/EXECUTE/ATTEST | shipped |
| v2.22.x | Real verb-simulator wiring (currently `noop` placeholder) per TIER_0 verb | 1-2 weeks |
| v2.23 | SAT-based planner over verb graph (replaces greedy router) | 1-2 months |
| v2.24 | Zero-knowledge contract proofs (each verb proves contract held without revealing args) | 2-3 months |
| v2.25 | Adversarial learn-loop — synthetic agent fuzzes verbs, contract auto-updates | 1-2 months |

## Risks + honest limits

- **Doppelganger leakage** — native modules (sharp/sqlite) bypass the JS-level interceptor. Verbs known to use native code flag `leakage: possible`. AI agents must verify visually when leakage ≠ none.
- **Cold start** — new verbs have no pheromone data; storyline + outcome stats are empty for the first 30 days.
- **Autospec false positives** — auto-derived JSON Schema may reject valid invocations on edge cases (variadic + positional mix). Override file at `companion/overrides/<slug>.json` is the escape.
- **Greedy planner** can pick suboptimal verb sequences (v2.23 SAT planner addresses).
- **HMAC receipt only** in v2.22.0; ZK contract proofs ship v2.24.

## Tests

51 deep tests pass:
- 30 companion (contract derivation × DEFCON tiers · autospec validation · doppelganger fs-overlay round-trip · Markov storyline · outcome stats + common mistakes · composed companion view · coverage report)
- 17 conductor (plan with contracts attached · preview aggregates effects · gate denies on validation failure · execute rejected/committed/rolled-back paths · receipt chain integrity + tamper detection)
- 4 CLI integration (verb introspect · verb --coverage · conduct dry-run · conduct on weird input handled cleanly)

## Compose with the rest

- **Atlas Help** — Companion is Layer 4½ between INTENT route and FULL wall
- **Consent Fabric** — Conductor receipts feed the Article 7 audit ledger
- **Trust Capsule** — companion contracts could be signed by install key (planned v2.23)
- **Dormancy Registry** — verbs without companion data + zero pheromone hits = strong cull signal for v3.0
- **Atlas pheromone** — Storyline reads, Conductor writes (drop pheromone per executed step)

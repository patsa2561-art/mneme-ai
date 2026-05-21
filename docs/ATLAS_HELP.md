# Atlas Help — six-layer command discovery

> Mneme has 300+ commands. The old `mneme --help` cost ~14 KB ≈ 14 000 tokens.
> Atlas is the cure — no command deleted, AI agents save ~14 k tokens per discovery call.

Since **v2.21.8** the default `mneme --help` is already Atlas Layer 0 (~200 bytes). The legacy 14 KB wall is opt-in via `mneme --help --full`.

## The six layers

| Layer | Verb | Size | What it is |
|------:|------|------|------------|
| 0 | `mneme atlas` | ~3 KB composed | TASTE (5 verbs) + BLOOM + HOT + TAGS in one call |
| 1 | `mneme bloom` | ~340 bytes | Bloom filter over all 300+ verbs. Probe membership in O(1). |
| 1 | `mneme bloom --probe verify-self` | exit code | "Does mneme have verb X?" Yes/No in 1 ms. |
| 2 | `mneme hot` | ~200 bytes | Top-20 verbs by pheromone-weighted recent use (stigmergy). |
| 3 | `mneme tags --tag <name>` | ~1 KB | 300 commands collapsed under ~30 semantic tags. |
| 4 | `mneme route "<intent>"` | ~80 bytes | NL → top-3 commands with score + rationale. |
| 5 | `mneme --help --full` | ~14 KB | Legacy escape hatch. Scripts that piped `--help` use this. |

## Layer 1 — why it's novel

Bloom filters (Burton Howard Bloom, 1970) are in BigTable, Redis, every database. No CLI on earth had shipped them as a discovery primitive before Mneme v2.21.5. Conventional wisdom says "users want to read the menu." Wrong: AI agents don't. 300 verbs in 256 bytes, 100% recall, <5% false-positive at production scale.

## Examples

```bash
# Discrete discovery, ~200 bytes total
mneme atlas

# Bloom probe (1 ms each)
mneme bloom --probe earthquake      # ✓ probably exists
mneme bloom --probe nope             # ✗ definitely does not

# Stigmergy — what's hot in this repo right now
mneme hot

# Capability map — drill down by domain
mneme tags --tag drift               # earthquake · polygraph · bug_prophet
mneme tags --tag handoff             # clone · genesplice · synapse · relay

# Natural-language route (any language)
mneme route "verify vendor drift on claude"
mneme route "ส่ง brain ไปมือถือ"

# Legacy escape — scripts piping --help should switch to this
mneme --help --full
```

## Technical details

- Bloom: m = 2048 bits / k = 3 hashes / FP ~5% at n = 300 / ~340 B encoded
- Pheromone log: `.mneme/atlas/pheromones.jsonl`, HMAC-chained, exponential decay τ = 7 days, failure outcome × 0.5
- Tags: `tagFor()` collapses 90+ manifest groups into ~30 semantic tags
- Intent router: pure local (no LLM); tokenises + scores against `(command + what + when)` per manifest entry
- 27 module tests + 5 CLI integration tests + atlas blob signed by install key (composes with [TRUST CAPSULE](TRUST.md))

## Compose with the rest

- **Trust Capsule** — atlas blob signed by per-install key
- **Consent Fabric** — `pheromone` is one of the 8 telemetry features (opt-IN per Article 2)
- **Dormancy Registry** — pheromone hits feed the v3.0 data-driven cull (90-day window starting v2.21.8)

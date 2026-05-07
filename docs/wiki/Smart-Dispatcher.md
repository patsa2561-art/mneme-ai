# `mneme do` — talk to Mneme like a human

> Don't memorize 50 commands. Describe what you want. Mneme classifies the intent, runs the right sub-engines in sequence, and prints one synthesized report.

═══════════════════════════════════════════════════════════════════════════════

## What it looks like

```bash
mneme do "find security issues"          # → forensics vulns + anomaly + secret scan
mneme do "is the codebase healthy"        # → status + guardian + drawdown + vix
mneme do "who knows about auth"           # → who-knows + story
mneme do "blast radius of HEAD"           # → blast + correlation-matrix
mneme do "should we ship today"           # → guardian + anomaly + recent vulns
mneme do "onboarding tour"                # → constellation + decisions + experts
mneme do "what changed last week"         # → story --since + drawdown
```

Each route runs MULTIPLE sub-engines in sequence and merges their output into one journalist-style report.

═══════════════════════════════════════════════════════════════════════════════

## How routing works (no LLM, sub-millisecond)

`mneme do` uses **deterministic regex classification**, not an LLM call. Means:

- ✅ No latency for intent classification (~<1ms)
- ✅ No API cost for dispatch
- ✅ Reproducible — same query always routes the same way
- ✅ Auditable — see exactly which sub-engines were chosen

Each of the 7 routes is a flow definition with: regex patterns + ordered sub-engine list + merge strategy.

═══════════════════════════════════════════════════════════════════════════════

## The 7 built-in flows (v0.20)

| Pattern matches | Sub-engines invoked |
|---|---|
| `security`, `vulns`, `secrets`, `leaks` | `forensics vulns` + `forensics anomaly` + `redact-check` |
| `health`, `healthy`, `status`, `state of` | `status` + `guardian --once` + `drawdown` + `vix` |
| `who knows`, `expert on`, `bus factor` | `who-knows` + `story` |
| `blast`, `radius`, `impact of` | `blast` + `correlation-matrix` |
| `ship`, `ready`, `safe to merge`, `release` | `guardian` + `forensics anomaly` + `forensics vulns --since 30d` |
| `onboarding`, `tour`, `getting started` | `constellation` + `decisions` + `who-knows` |
| `changed`, `last week/month`, `recent` | `story --since` + `drawdown` |

If none match, the dispatcher falls back to plain `mneme ask` (LLM synthesis grounded in retrieval).

═══════════════════════════════════════════════════════════════════════════════

## Why a dispatcher?

**Cognitive load.** Mneme has 50+ commands. A new user doesn't know which 3 to run for "is my codebase healthy?". `mneme do` removes that friction.

**Composability.** Most real questions need MULTIPLE primitives. Sequencing them by hand is annoying. `do` does it.

**Reliability.** Regex routing means the same query always produces the same flow — important for tutorials, CI scripts, and team onboarding.

═══════════════════════════════════════════════════════════════════════════════

## Adding your own routes

Routes live in `packages/cli/src/commands/do.ts`. Each is a `Flow` object:

```typescript
{
  id: "security-audit",
  patterns: [/\b(vuln|leak|secret|exposed)\b/i, /security\s+(scan|audit)/i],
  steps: [
    { engine: "forensics-vulns", flags: { topN: 50 } },
    { engine: "forensics-anomaly", flags: { threshold: 0.7 } },
  ],
  merge: "synthesize-report",
}
```

PRs welcome. Common patterns we'd love added: cost-tracking, dependency-audit, license-check.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🛡 [[Guardian]] — pre-commit hook, separate "always-on" entry point
- 🌟 [[Innovations]] — every command `do` can route to
- 📦 [[Hierarchical-Memory]] — `do` benefits from HTC compression when the route runs `ask`

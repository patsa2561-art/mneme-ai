# 🛑 Architectural Regression Firewall

> The gate for AI-generated change. When producing code costs nothing, the expensive thing is **proving the code an AI just generated didn't silently break an architectural contract the system has stood on for years.** Everyone ships a code *generator*; this is the *gate* that remembers what contracts hold and blocks the moment one is about to be violated.

## What it does

```
$ mneme arch-firewall --baseline main

🛑 ARCHITECTURAL FIREWALL — BLOCKED
1 violation(s) · 1 critical · 0 warn · 0 info · 38 contract(s) checked
🔴 CRITICAL — violated invariant "table wallet single-writer" (held 426d, through 312 commits, set at a1b2c3)
     ↳ refundHandler, charge
```

An AI opens a PR that adds a second writer to `Wallet` → CI runs the firewall → the build goes red with the contract's whole history: how long it stood, how many commits it held through, and the exact symbol that just broke it.

## How (it composes what Mneme already proves)

| Layer | Primitive | Role |
|---|---|---|
| Baseline contracts | `mineInvariants` | the rules the repo upheld at `--baseline` (zero-config) |
| Regression | `analyzeRegressions` | which contracts the current code VIOLATES, with the counterexample |
| Load-bearing strength | `arch_lineage` | how long each violated contract has stood (age weights severity) |
| Policy | the firewall's DSL | architect-declared rules + severities (`.mneme/arch-policy.txt`) |
| Enforcement | exit code · MCP deny · report | CI gate, real-time agent block, PR-comment-ready output |

**Severity is weighted by age:** breaking a contract that has stood for years is a `critical` BLOCK; breaking one that is days old is `info` — normal evolution. The age does the weighting, measured from git, not guessed.

## Policy DSL (`.mneme/arch-policy.txt`)

```
# severity prefix is optional (default: warn)
critical table wallet single-writer
critical table credentials private
warn     endpoint POST /admin/payout exists
```

A declared severity overrides the age-derived one — the architect has the final say. A declared rule the code does **not** satisfy is itself a violation (not only regressions are caught).

## Enforcement surfaces

- **CI gate** — `mneme arch-firewall --baseline main` exits `2` on BLOCK. Drop it in any pipeline.
- **Real-time agent deny** — MCP `mneme.arch.firewall { baseline }` returns `PASS / WARN / BLOCK`; on BLOCK the agent must stop and surface the violation instead of committing it.
- **PR comment** — the report (`firewallReport`) is plain text ready to post on the PR.

## Honest scope (DIAKRISIS)

Every violation is a contract **proven** to hold at the baseline and **proven** violated now — re-checkable, with the counterexample, never a guess; age is measured from git. A BLOCK is a strong signal, **but a violation can still be an intended evolution** — which is exactly why an architect can declare a rule's severity, or ratify the change by moving the baseline. The firewall decides and surfaces; it does not pretend the change is malicious.

The composition — *mine contracts automatically + prove regression + point at the line + weight by age + block AI in real time* — is the part that, as a complete set, no one else ships. The moat isn't the algorithm; it's each customer's accumulating **contract store + lineage over time** — the longer it runs, the deeper it knows the system.

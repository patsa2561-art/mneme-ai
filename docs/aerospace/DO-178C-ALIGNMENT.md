# Mneme — DO-178C / ED-12C alignment for AI-generated flight software

**Status:** Spec sheet v1 (shipped v2.56.0)
**Target audience:** Aerospace + automotive teams shipping AI-assisted code into safety-critical environments
**Companion primitives:** GAVEL · SIBYL · LETHE · DRAGON EJECT · LAUNCH WINDOW

---

## Why this matters now

FAA + EASA are converging on **mandatory disclosure of AI involvement** in flight-software development by 2027. EU AI Act Article 50 (Aug 2026) is the first deadline; aviation-specific rulemaking follows.

DO-178C / ED-12C objectives require:
- **Provenance** of every code change
- **Tamper-evident audit trail**
- **Verifiable rollback** capability
- **Identity binding** of contributor (human or tool)

Mneme already ships all four as primitives. This document maps each DO-178C objective to the Mneme primitive that satisfies it.

---

## Coverage matrix

| DO-178C objective | Mneme primitive | How it satisfies |
|---|---|---|
| **A-2.7** Source code traceable to requirements | EU stamp (`mneme nemesis eu_stamp`) | HMAC-signed disclosure block on every commit |
| **A-5.6** Configuration item identification | SIBYL commit (`mneme nemesis sibyl_commit`) | Hash-commitment binds vendor identity at session-start |
| **A-7.8** Verification of verification process | TRUTH GATE (`mneme truth_gate run`) | 33 marketing claims bound to in-process probes |
| **A-9.1** Software configuration index | NIMBUS card (`mneme nemesis nimbus_publish`) | Per-org leaderboard with HMAC-signed envelope |
| **A-10.x** Quality assurance records | GAVEL bundle (`mneme nemesis gavel_pack`) | THEMIS + EU stamp + SIBYL → court-admissible Merkle bundle |
| **DAL-A rollback verification** | DRAGON EJECT (`mneme dragon eject <commit>`) | Forensic-evidence rollback with WHY bundle |
| **Right-to-erasure (GDPR Art 17 cross-ref)** | LETHE (`mneme nemesis lethe_forget`) | Merkle exclusion proof — row erased + chain still valid |
| **Pre-tag readiness review** | LAUNCH WINDOW (`mneme launch_window`) | SpaceX-style GO/NO-GO aggregator across all gates |
| **Identity verification of contributor** | NEMESIS classify (`mneme nemesis classify --stdin`) | 41-feature fingerprint + 90-fixture seed corpus + augmented validation |

---

## Recommended pre-flight workflow

For every commit that ships into flight software:

1. **At session-start** — `mneme nemesis sibyl_commit --vendor <agent>` → returns nonce; save offline.
2. **At code-generation time** — Mneme SDK (`@mneme-ai/sdk`) embedded in IDE auto-stamps every commit with EU Article 50 block.
3. **At PR review** — `mneme nemesis themis --stdin` produces alibi defense for procurement-banned vendors.
4. **At session-end** — `mneme nemesis sibyl_reveal --stdin` proves no mid-session vendor swap.
5. **Pre-tag** — `mneme launch_window` aggregates ALL gates → single GO / NO-GO / HOLD verdict.
6. **At emergency rollback** — `mneme dragon eject <commit> --rationale "..." --confirm` → reverts + emits GAVEL-grade forensic bundle.
7. **At regulatory inquiry** — `mneme nemesis gavel_pack --stdin` produces single bundle binding (THEMIS + EU stamp + SIBYL + Merkle tree). Court-admissible offline.
8. **At GDPR erasure request** — `mneme nemesis lethe_forget --ledger <p> --row <n>` produces Merkle exclusion proof — row removed but chain still verifies.

---

## Performance characteristics (DO-178C requires deterministic latency)

| Op | Warm budget | Cold budget | Determinism |
|---|---|---|---|
| `extract_fingerprint` | <30 ms | <100 ms | ✓ pure deterministic |
| `classify_calibrated` | <50 ms | <200 ms | ✓ pure deterministic |
| `eu_stamp` | <30 ms | <200 ms | ✓ HMAC over canonical body |
| `stealth_score` | <50 ms | <250 ms | ✓ deterministic |
| `janus_observe` | <50 ms | <200 ms | ✓ deterministic |

All measured by `mneme perf budget`. TG probe `probe.perf.budgets_met` (severity=block) gates the release.

---

## Open-source corpus (STARGATE)

`mneme stargate publish --out corpus.json` outputs the **augmented calibration corpus** (15 fixtures × 6 vendors × 6 augmentations = 540 fixtures) under MIT license with HMAC seal. Aerospace teams can:

- Train independent identity-verification classifiers against the same ground truth
- Cross-validate Mneme's classifier output for safety reviews
- Submit to ASTM F38 / SAE G-34 working groups as reference data

---

## Integration with existing toolchains

- **PolySpace / Coverity** — Mneme primitives run side-by-side; no toolchain conflict
- **DOORS / Jama** — link Mneme's HMAC-signed receipts as requirement evidence
- **Git** — Mneme works on standard git; install via `git config core.hooksPath` for auto-stamp
- **CI/CD** — `mneme launch_window` as GitHub Actions / GitLab CI / Bamboo pre-deploy gate

---

## Standards reference

- DO-178C / ED-12C — Software Considerations in Airborne Systems
- DO-330 / ED-215 — Software Tool Qualification Considerations
- DO-200B / ED-76A — Standards for Processing Aeronautical Data
- EU AI Act Article 50 (enforceable 2 Aug 2026)
- FAA Order 8110.49 — Software Approval Guidelines

---

## Contact

Mneme project: [https://github.com/patsa2561-art/mneme-ai](https://github.com/patsa2561-art/mneme-ai)
For aerospace-specific integration support, contact via GitHub issues with tag `aerospace`.

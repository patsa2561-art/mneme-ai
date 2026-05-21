# Physics Lathe — formal axiom verifier for LLM claims (v2.22.1)

> The "rocket needs 50 km/s to reach LEO" hallucination class costs aerospace + AI-training teams real money.
> Physics Lathe is a deterministic, LLM-free verifier that catches it.

Extracts (value, unit) pairs from free text → normalises to SI → checks against a curated set of physics axioms and well-known numerical references. No LLM is called; verdicts are reproducible.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| **CONFIRMED** | Claim is consistent with at least one axiom or known-value within tolerance |
| **REFUTED** | Claim is inconsistent with a reference by more than its tolerance |
| **OUT_OF_AXIOM_SET** | Units parsed but no axiom or known-value matches — the lathe cannot speak |
| **INSUFFICIENT_DATA** | No numeric quantities with units detected |

## Axiom catalog (v2.22.1)

10 axioms · 11 SpaceX-relevant known values · 15 physical constants:

- **Axioms** — Tsiolkovsky rocket equation, Newton's 2nd law, kinetic energy, circular orbital velocity, escape velocity, Kepler's 3rd law, ideal gas, Stefan-Boltzmann, mass-energy equivalence, Boltzmann thermal energy.
- **Known values** — LEO orbital velocity (7.66 km/s), Earth/Mars/Moon escape velocity, ISS altitude (400 km), GEO altitude, LEO altitude range, delta-v budgets (LEO/Moon/Mars).
- **Constants** — c, G, g₀, k_B, h, N_A, R, σ, Earth/Moon/Mars mass + radius, AU, solar mass.

## Examples

```bash
$ mneme physics-check "LEO orbital velocity is about 7.66 km/s"
🔬 PHYSICS LATHE — ✓ CONFIRMED
  Claim is consistent with 1 reference(s) within tolerance.
  Extracted quantities:
    - 7.66 km/s  →  7.660e+3 m·s^-1 (guess: v)
  Evaluations:
    ✓ known-value: LEO orbital velocity
         observed 7.660e+3 vs expected 7.660e+3 (rel err 0.0% / tol 5.0%)
         citation: Compute from v=√(GM/r) at r=R_E+400km

$ mneme physics-check "To reach LEO you need 50 km/s"
🔬 PHYSICS LATHE — ✗ REFUTED
  Claim is inconsistent with 1 reference(s). Largest mismatch: 552.7% (tol 5.0%).
  Evaluations:
    ✗ known-value: LEO orbital velocity
         observed 5.000e+4 vs expected 7.660e+3 (rel err 552.7% / tol 5.0%)

$ mneme physics-check "Earth escape velocity is 11.2 km/s"
🔬 PHYSICS LATHE — ✓ CONFIRMED ...

$ mneme physics-check "My weight is 70 kg"
🔬 PHYSICS LATHE — · OUT_OF_AXIOM_SET
  Quantities extracted (70 kg) but no axiom or known-value applied.
```

## Implementation

- **axioms.ts** — hardcoded equations + constants + known values; each axiom carries its variables, units, tolerance, and a pure `apply()` function that returns predicted scalar
- **units.ts** — SI base-vector parser with prefix support (k/M/G/m/μ/n/p), handles `km/s`, `m·s⁻²`, `N/m²`, `GPa`, `eV`, `psi`, `atm`, `bar`
- **extractor.ts** — regex-based (value, unit) extraction from free text with quantity guessing from context keywords + unit signatures
- **verifier.ts** — substitutes extracted values into matching axioms; matches against known values; emits CONFIRMED/REFUTED/OUT_OF_AXIOM_SET/INSUFFICIENT_DATA + per-citation proof tree

## Why this matters

| Use case | Without Physics Lathe | With Physics Lathe |
|----------|----------------------|---------------------|
| LLM generates rocket spec | Engineer spot-checks math by hand or fires another LLM call (recursive uncertainty) | `mneme physics-check "<spec>"` returns verdict + cited axiom in ~1 ms |
| xAI training data audit | Manual sample + Wolfram Alpha cross-check | Deterministic CI gate over millions of claims |
| Mission Control auto-pilot | Domain-specific verifier per system | Generic primitive composable across systems |
| ITAR-sensitive args | Cloud Wolfram/external tools forbidden | All compute local; offline-capable |

## Compose with the rest

- **Truth Suite (`mneme verify`, `mneme.truth.check`)** — Physics Lathe is the "physics" branch of the verifier; can be invoked under the unified pipeline
- **Chronostasis** — confirmed axiom hits could crystallise into Chronostasis axioms for repo-scoped truth gravity
- **Conductor** — verb plans that involve physics-bounded operations can gate on Physics Lathe verdict before execution
- **Earthquake** — earthquake drift detector + physics lathe = "is the LLM still capable of correct physics reasoning?"

## Limits

- 10 axioms + 11 known values is a starter set; aerospace + thermodynamics-leaning. Add more via PR to `axioms.ts`.
- Regex extractor handles common forms but unusual phrasings ("9.8 metres per second squared" written out in words) need an NER swap-in.
- Tolerance bands are deliberately permissive (1-10% relative). Tighter bounds need either narrower axioms or a confidence-conditional verdict layer (planned v2.22.x).

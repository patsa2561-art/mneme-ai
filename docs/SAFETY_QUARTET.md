# Safety Quartet — Dimensional Oracle · Challenger Librarian · Mission Recorder · Overshoot Tracer (v2.22.2)

> Four composing primitives that catch the most expensive AI-agent failure modes: unit mismatches, repeating historical disasters, lost forensic trail, scope-creep runaway.

Each is callable on its own. They compose end-to-end: **Dimensional Oracle** is invoked by **Challenger Librarian** for Mars-Climate-Orbiter-class detection · **Mission Recorder** feeds **Overshoot Tracer** the actual-execution side of plan-vs-actual.

## The four

| # | Name | What it does | Catches |
|---|------|--------------|---------|
| 1 | **📐 Dimensional Oracle** | Unit-algebra check on any LLM claim | "thrust = 9.8 N/m²" → N/m² is pressure, not force |
| 2 | **📚 Challenger Librarian** | Cross-checks a plan against 8 historical aerospace failures | Plan that repeats Mars Climate Orbiter / Challenger O-ring / Therac-25 / Ariane 5 501 / etc. |
| 3 | **🛰  Mission Recorder** | Flight-data-recorder for AI agents: monotonic Lamport + HMAC chain + causal DAG | Lost forensic trail; tampered logs |
| 4 | **🛑 Overshoot Tracer** | Compares planned verb sequence vs actual recorded trace | AI agent doing MORE than the user asked (scope creep, runaway) |

## CLI

```bash
# 📐 Unit-algebra check
mneme dim-check "thrust = 9.8 N/m^2"
# → ✗ MISMATCH (thrust is force, observed dimension is pressure)

# 📚 Cross-check plan against historical failures
mneme failure-check "Reuse Ariane 4 inertial software with 16-bit casting"
# → ⚠ WARN — plan resembles Ariane 5 Flight 501

# 📚 List the catalog
mneme failures

# 🛰  Record an event (with optional causal links)
mneme mission record --kind exec --verb earthquake-drift --cause ev_abc

# 🛰  Walk forward through the DAG from a starting event
mneme mission trace ev_root

# 🛰  Verify HMAC chain + Lamport monotonicity
mneme mission verify

# 🛑 Compare planned vs actual verb sequence
mneme overshoot \
  --planned '[{"verb":"verify-self"},{"verb":"earthquake-drift"}]' \
  --actual  '[{"verb":"verify-self"},{"verb":"earthquake-drift"},{"verb":"rogue-push"}]'
# → ✗ OVERSHOOT (1/3 step mismatch, kill-switch ARMED)
```

## How they compose

```
       USER INTENT
           │
           ▼
     conductor.plan ─────────┐
           │                  │
           ▼                  │
  📐 dim-check + 📚 failure-check
           │ (gate: any BLOCK?)
           ▼
     conductor.execute
           │
           ├── each step → 🛰  mission record (HMAC + DAG)
           ▼
     conductor.attest
           │
           ▼
  🛑 overshoot trace (plan vs recorded chain)
           │
           └── kill-switch on score ≥ threshold
```

## Catalog details

### 📐 Dimensional Oracle

21 dimension classes (length / time / mass / temperature / velocity / acceleration / force / pressure / energy / power / momentum / action / frequency / current / voltage / charge / area / volume / density / molar amount / angular velocity).

Quantity-to-dimension dictionary covers ~40 common engineering terms (thrust, weight, drag, altitude, pressure, energy, power, velocity, acceleration, mass, density, temperature, period, frequency, charge, current, voltage, area, volume, isp, torque, etc.).

Special case: energy and torque share an SI base vector — flagged AMBIGUOUS, not MISMATCH.

### 📚 Challenger Librarian (catalog v2.22.2)

| Failure | Date | Root cause class | Detector |
|---------|------|------------------|----------|
| Mars Climate Orbiter | 1999 | unit-conversion (pound-force vs Newton) | dimensional |
| Challenger STS-51-L | 1986 | O-ring below qualified temp range | physics-axiom |
| Columbia STS-107 | 2003 | normalised deviance (foam strike unchecked) | keyword |
| Apollo 1 fire | 1967 | pure O₂ over-pressure + inward hatch | keyword |
| Ariane 5 Flight 501 | 1996 | reused software, untested at new range, 16-bit cast | keyword |
| Therac-25 | 1985-87 | software-only safety + race condition | structural |
| Mariner 1 | 1962 | transcription error in guidance equations | keyword |
| Soyuz 1 | 1967 | known defects + rushed schedule | keyword |

Each entry carries root cause + avoidance + citation; verdicts band into SAFE / CAUTION / WARN / BLOCK.

### 🛰  Mission Recorder

Every event has:
- ISO timestamp (caller-supplied or system clock)
- Monotonic Lamport counter (advances per recordEvent)
- Optional NTP-anchored unix nanoseconds (caller-supplied)
- Causal DAG: `causedBy[]` references parent event IDs
- HMAC chain: `prev` references the previous event's signature
- Free-form `meta` (caller responsibility for privacy redaction)

Replay engine: `replayFrom(rootId, executor)` walks forward through the DAG, invoking the executor for each event in order. Stops on first executor failure.

### 🛑 Overshoot Tracer

Per-step alignment outcomes: `ok` / `extra-step` / `verb-mismatch` / `arg-mismatch` / `missing-step`.

Score = mismatches / max(plan.length, actual.length).

Bands: ALIGNED (0) · WANDER (<0.25) · OVERSHOOT (<0.75) · RUNAWAY (≥0.75).

Kill-switch: configurable threshold (default 0.5); the tracer never kills (that's policy at the caller), but it sets the flag.

## Tests

58 deep tests total:
- 16 dimensional oracle (matches / mismatches / catalog sanity / format)
- 14 challenger librarian (catalog / Mars / Challenger / Columbia / Therac / Ariane / verdict bands / format)
- 10 mission recorder (chain + DAG + replay + tamper detection)
- 11 overshoot tracer (alignment + scope creep + arg mutation + missing steps + bands + kill-switch)
- 7 cross-module integration (librarian delegates to dim-oracle; mission recorder + overshoot end-to-end)

## Compose with the rest

- **Conductor** — gate `conduct` on Challenger Librarian BLOCK; record every executed verb to Mission Recorder; run Overshoot Tracer after execution
- **Companion** — verb contracts can declare expected dimension types; Dimensional Oracle then auto-validates
- **Physics Lathe** — Challenger Librarian's physics-axiom detector delegates to it
- **Consent Fabric** — Mission Recorder receipts feed the Article 7 audit ledger
- **Trust Capsule** — Mission Recorder events can be sealed inside a Trust Capsule for cross-machine portability

## Limits

- Dimensional Oracle: ~21 dimension classes ship; unusual derived quantities need a manual entry
- Challenger Librarian: 8 historical failures ship; add via `catalog.ts` + a regression test
- Mission Recorder: replay assumes deterministic verbs; non-deterministic verbs (network, time-dependent) should mark `meta.deterministic=false`
- Overshoot Tracer: requires explicit planned + actual sequences; future v2.23 will auto-extract from Conductor + Mission Recorder

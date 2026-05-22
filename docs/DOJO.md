# Six-Master Dojo (v2.23.0)

> Adversarial sparring for Mneme — six senseis grade the system A-F before every release. Closed-loop self-improvement with falsifiable scoring + tamper-evident report cards.

The dojo is to Mneme what AlphaZero self-play was to AlphaGo, adapted for a rule-based truth-verification system. Each sensei attacks a different failure surface; the report card seals the grade with HMAC so anyone can verify a release lived up to its scorecard.

## The six senseis

| Sensei | Attack surface | Pass criterion |
|--------|----------------|----------------|
| 🎭 **Liar** | Synthetic false claims (10+ corpus) | F1 ≥ 0.9 on CONFIRMED/REFUTED labels |
| 🌊 **Edge** | Boundary inputs (empty / 100k chars / unicode / null byte / RTL / control chars) | 100% pass · 0 throws · 0 slow (>1s) |
| 💉 **Injection** | Prompt-injection taxonomy (10+ probes) | F1 ≥ 0.8 on flag/no-flag |
| 🪞 **Self-Contradict** | Same fact two phrasings; verdicts must match | Consistency rate ≥ 80% |
| 📐 **Spec-Diff** | Manifest signature vs description mismatch | 0 doc/code drift |
| ⏱  **Endurance** | Same query 50× | 100% deterministic, p95 < 50ms |

## Output: HMAC-sealed report card

```bash
$ mneme dojo run --version 2.23.0
📜 MNEME DOJO REPORT CARD — Mneme v2.23.0

  Overall:   B  (84/100)
  Generated: 2026-05-22T01:23:00Z
  Sig:       Pq7tXa9z_K1L2M3N4

  Per-sensei:
    A  liar               94/100
        - F1 = 0.940 over 10 probes
    B  edge               88/100
        - 11/12 edges passed
    A  injection          92/100
    A  self_contradict    100/100
    C  spec_diff          78/100
        - 21 drifted (doc/code mismatch)
    A  endurance          100/100
        - deterministic across all iterations

  ⚠ 1 new regression auto-recorded to .mneme/dojo/regression.jsonl
```

## Train-on-own-failures (the #B move)

Every claim Mneme misclassifies gets auto-logged into `.mneme/dojo/regression.jsonl`. The next release's dojo run replays the corpus FIRST — if any historical failure re-appears, the release fails its dojo gate.

Mneme remembers its own mistakes. This is the closed-loop part.

```bash
# Show all open regressions
mneme dojo regressions --open-only

# Mark one as fixed in the current version (re-seals sig)
mneme dojo mark-fixed rg_a3f2 --version 2.23.1
```

## Tier 1 — Continuous (24/7) mode

For users running Mneme on hosted infra (e.g. Digital Ocean), schedule the arena as a cron job:

```bash
# Every hour on the hour
0 * * * * cd /opt/mneme && mneme dojo run --version $(node -p "require('./package.json').version") --json > /var/log/mneme/dojo.json 2>&1
```

The HMAC-sealed card is the audit artifact — receivers can verify the seal against the install's `dojo.key` without needing to re-run the corpus.

Public scoreboard pattern: pipe the JSON output to a dashboard endpoint (Grafana / Datadog / custom). Multiple Mneme installs publish to the same scoreboard → community-validated trust signal.

## Post-training fix workflow

When the dojo grades < A on any sensei, here's the canonical sequence:

1. **Inspect the report card** — `mneme dojo run --json | jq '.raw.<sensei>'` shows per-probe outcomes.
2. **Open the regression set** — `mneme dojo regressions --open-only` lists the failing inputs with `observedVerdict` vs `expectedVerdict`.
3. **Categorise the cause**:
   - **Extraction gap** → extend `squadron/fact_grounding.ts` regex / dictionary.
   - **Axiom missing** → add to `physics_lathe/axioms.ts` or `challenger_librarian/catalog.ts`.
   - **Pulse text manipulation** → update `consent_fabric/pulse_neutralizer.ts` rule.
   - **Doc/code drift** → fix the CLI signature or the manifest entry.
4. **Add a regression test** under `packages/core/src/<module>/` that pins the fix.
5. **Re-run the dojo** — confirm the regression entry no longer appears as open.
6. **Mark fixed** — `mneme dojo mark-fixed <id> --version <new>`. The sig re-seal proves the fix landed in the named version.
7. **Ship the release** — the dojo gate runs in CI; releases with new open regressions block.

This is the AlphaZero pattern with one critical difference: **human ratification is required** (`DOJO MASTER` from the v2.21.6 design). The dojo surfaces candidates; a human merges. No auto-mutation of production rules.

## Honest limits

- The corpus is curated (10-15 entries per sensei). Coverage scales with PR contributions.
- Endurance sensei runs in-process; cross-process variance (caching, OS scheduling) needs a separate suite.
- Spec-diff catches *most* doc/code drift but not behavioural drift (action handler changing meaning without changing signature). v2.23.x will add a live `spawn` probe layer.
- The HMAC sig protects integrity, not correctness. A liar with the secret could sign a fake card. Mitigate by publishing the sig + the card on a shared ledger.

## Compose with the rest

- **Consent Fabric** — Injection sensei consumes `audit-pulse` patterns directly
- **Physics Lathe** — Liar corpus extends from manifest-style claims; future senseis can call physics-check for numeric refutation
- **Challenger Librarian** — Dojo + Librarian = "we know historical failure modes AND we adversarially test for new ones"
- **Mission Recorder** — Every arena run emits a Mission Recorder event with the report-card sig; replayable post-mortem
- **Overshoot Tracer** — Compare planned dojo run vs actual sensei sequence; detect arena drift

# Guardian — the 24/7 Self-Healing Engine

> Mneme's index drifts the moment you push a commit. Quality slides when subjects get sloppy. Embeddings disappear when you change models. Schemas march forward.
>
> **Guardian** is a long-running diagnostic + auto-remediation loop that watches for these weaknesses and fixes the safe ones automatically — while flagging the risky ones for human review.

═══════════════════════════════════════════════════════════════════════════════

## The loop

```
while (true) {
  diagnose();        // detect weaknesses + threats
  fix();             // apply safe auto-actions
  learn();           // record findings to .mneme/guardian.jsonl
  sleep(interval);
}
```

Run it in three modes:

```bash
mneme guardian --once                           # one diagnostic pass, exit
mneme guardian --watch                          # forever, default 5-min poll
mneme guardian --watch --apply --interval 60    # auto-apply safe fixes every 60s
```

═══════════════════════════════════════════════════════════════════════════════

## What it watches for

### Weaknesses *(internal state drift)*

| Kind | What triggers it | Default policy |
|---|---|---|
| `drift` | HEAD has commits not in index | **AUTO** — incremental re-index |
| `missing-embeddings` | <95% of chunks have vectors | **AUTO** — re-index |
| `low-quality` | Quality grade < C (0.55) | **SUGGEST** — `mneme heal` |
| `low-quality (regression)` | Score dropped ≥ 0.10 since last run | **OBSERVE** — log only |
| `stale-calibration` | ≥25 feedback events since `mneme calibrate` | **AUTO** — re-calibrate |
| `schema-drift` | Store schema version < binary expects | **AUTO** — migrate via re-index |
| `redaction-gap` *(planned v0.17)* | Secret-shaped string slipped into a chunk | **SUGGEST** |

### Threats *(external/security signals)* — *planned v0.17*

| Kind | What triggers it |
|---|---|
| `tamper` | Hash chain broken in `mneme ledger` |
| `secret-leak` | Secret pattern detected in indexed chunk |
| `outlier-author` | Commits authored as someone unexpected |
| `deletion-storm` | Many files deleted in a short window |

═══════════════════════════════════════════════════════════════════════════════

## Policies — auto, recommended, observe

Every finding has a **policy** that controls what Guardian does:

| Policy | Behavior with `--apply` | Behavior without `--apply` |
|---|---|---|
| `auto` | Run the suggested action | Log only |
| `recommended` | Log + flag for human | Log only |
| `observe` | Log only | Log only |

**Safe by default**: without `--apply`, Guardian only **diagnoses**. It logs everything it *would* do but applies nothing. Pass `--apply` to enable the auto-fix loop.

This is intentional. We auto-apply only the actions that are demonstrably reversible (re-index, calibrate). Anything that could lose data gets recommended, not executed.

═══════════════════════════════════════════════════════════════════════════════

## Sample output

```
🛡  Guardian — 24/7 self-healing daemon
────────────────────────────────────────────────────────────────

  mode      watch
  apply     yes (auto-fix enabled)
  interval  300s

  ┄┄┄ tick #1 · 2026-05-06 10:02:23
    MED   [AUTO]      30 commit(s) on HEAD not yet indexed.
        → mneme index
    LOW   [AUTO]      28 feedback events since last calibrate.
        → mneme calibrate
    (2 findings · 2 auto · 0 suggested)

    → applying: mneme index
    → applying: mneme calibrate
    sleeping 297s until next tick…

  ┄┄┄ tick #2 · 2026-05-06 10:07:23
    ✓ all systems healthy — no findings
    sleeping 300s until next tick…
```

═══════════════════════════════════════════════════════════════════════════════

## Audit log — `.mneme/guardian.jsonl`

Every tick appends a JSONL entry. Tampering is detectable: each entry includes the timestamp and the full findings list, so you can reconstruct the exact state Guardian saw.

```jsonl
{"ts":"2026-05-06T10:02:23Z","iteration":1,"summary":{"findings":2,"autoActions":2,"recommendations":0,"threats":0},"findings":[{"kind":"drift","severity":"medium","policy":"auto","message":"30 commit(s) on HEAD not yet indexed.","action":"mneme index"}, ...]}
{"ts":"2026-05-06T10:02:24Z","iteration":1,"appliedAction":"mneme index","ok":true,"finding":"drift"}
{"ts":"2026-05-06T10:07:23Z","iteration":2,"summary":{"findings":0,"autoActions":0,"recommendations":0,"threats":0},"findings":[]}
```

Pair with `mneme ledger` for tamper-evident long-term audit.

═══════════════════════════════════════════════════════════════════════════════

## Running it as a service

### systemd *(Linux)*

```ini
# /etc/systemd/system/mneme-guardian.service
[Unit]
Description=Mneme Guardian
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/your/repo
ExecStart=/usr/bin/npx -y mneme-ai guardian --watch --apply --interval 600
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mneme-guardian
journalctl -u mneme-guardian -f
```

### launchd *(macOS)*

Create `~/Library/LaunchAgents/com.mneme.guardian.plist` with `KeepAlive=true` and the same `npx` invocation.

### Windows Task Scheduler

Schedule a task with trigger "On startup" and action `npx -y mneme-ai guardian --watch --apply --interval 600`.

### CI cron *(simplest)*

Run with `--once` on a schedule — useful for repos where you don't want a long-lived process.

```yaml
# .github/workflows/mneme-guardian.yml
name: Mneme Guardian
on:
  schedule:
    - cron: "0 */6 * * *"
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npx -y mneme-ai guardian --once --json > guardian.json
      - run: cat guardian.json
```

═══════════════════════════════════════════════════════════════════════════════

## Integration with other Mneme commands

Guardian uses these commands as its toolkit:

| Finding | Guardian's response |
|---|---|
| `drift` | `mneme index` *(incremental)* |
| `missing-embeddings` | `mneme index` *(idempotent)* |
| `low-quality` | suggests `mneme heal` *(synthesize WHY notes)* |
| `stale-calibration` | `mneme calibrate` *(re-tune retrieval)* |
| `schema-drift` | `mneme index` *(triggers migrations)* |

Each underlying command is itself test-covered, so Guardian's auto-actions are demonstrably safe.

═══════════════════════════════════════════════════════════════════════════════

## Philosophy

Guardian is the **honest** version of "AI that fixes itself":

- ✅ Auto-applies only **reversible** actions
- ✅ Logs **everything** to `.mneme/guardian.jsonl`
- ✅ **Refuses** to auto-apply anything risky — those go to a recommendation queue
- ✅ Pure-function diagnose layer means same input → same output (deterministic, testable, auditable)

This is the opposite of "agentic AI that does whatever it thinks is right." Guardian is a **constrained automaton with a small, well-defined fix set**, not a free-roaming agent.

═══════════════════════════════════════════════════════════════════════════════

## See also

- 📊 [[Novel-Algorithms]] — the math behind the retrieval Guardian protects
- 🛡 [[Innovations]] — full list of Mneme commands Guardian uses as its toolkit
- 📜 [[Privacy]] — Guardian writes only to `.mneme/`, never phones home

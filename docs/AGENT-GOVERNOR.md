# 🏛 The Agent Governor — how to use it

> Back to the <a href="../README.md" target="_blank" rel="noopener">README</a> · the full release entry → <a href="../CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>.

**You set the rules once. Your AI agents run inside them 24/7. You get pinged only for the few decisions that are genuinely irreversible.** Mneme is the *governance kernel* that sits **under** your orchestrator (Claude Code · Cursor · Astra · Tycoon · AutoGen): it **decides · sequences · escalates · compensates** — your orchestrator does the actual work, per the verdicts.

---

## 👔 For the owner / CEO — you never touch a terminal

Say one sentence to the AI agent you already use:

> *"Set up a Mneme governance charter for **&lt;our mission&gt;**, scope **&lt;which folders/systems&gt;**, budget **&lt;N&gt;** actions, and never **&lt;the things that always need me&gt;** (e.g. post publicly, touch production, spend money) — then govern every agent action through it."*

From then on, every action your agents take is gated into one of **four verdicts**:

| Verdict | What happens |
|---|---|
| 🟢 **ALLOW_AUTONOMOUS** | runs immediately, no human needed |
| 🟡 **ALLOW_WITH_AUDIT** | runs, but flagged for a later glance |
| ✋ **ESCALATE_HUMAN** | **waits for you** — the only thing you review |
| 🛑 **BLOCK** | refused (forbidden by your charter) |

You approve only the **✋ escalations** (a chat/phone ping). Everything safe and reversible flows while you sleep. That is "1 founder + a fleet of agents" — **safe, accountable, and provable.**

---

## ⌨️ The commands (if you'd rather type them)

```bash
# 1) create a charter (mission · scope · risk envelope · budget · forbidden)
mneme govern charter-init > charter.json   # then edit it

# 2) govern ONE action  → 🟢/🟡/✋/🛑  (exit 2 if not autonomous)
mneme govern decide --charter charter.json --action '{"id":"a1","kind":"edit","summary":"refactor auth","files":["src/auth/x.ts"],"signals":{"commandRisk":"write","driftBand":"STABLE"}}'

# 3) run a whole fleet's queue as a continuous AUTO-OPERATION BATCH
mneme govern batch --charter charter.json --actions queue.jsonl
#   → 🟢 N autonomous · 🟡 N audited · ✋ N escalated · 🛑 N blocked  (+ circuit-breaker)

# 4) evolve the autonomy envelope from evidence (Living Charter)
mneme govern amend --charter charter.json --clean 20 --regretted 0
#   → 📈 widen read→write after a clean record · 📉 narrow on a regret
```

`queue.jsonl` is one action per line: `{"id","kind","summary","files":[…],"reversible":true,"inverse":{…},"tokensEst":N,"signals":{…}}`.

---

## 🤖 For AI agents — the real wiring (this is how it becomes turnkey)

You already run **CERBERUS** (command risk), **CRUCIBLE** (shadow build/test), **TELOS** (mission drift), **REGRET** (outcome calibration) and **ELLEIPSIS** (completeness) as Mneme tools. The Governor **folds those signals into one decision** — so before a non-trivial action:

1. Gather the signals you have for the action (`commandRisk`, `irreversible`, `shadowVerdict`, `driftBand`, `regretBand`, `completeness`, out-of-scope paths).
2. Call **`mneme.govern.decide { charter, action: { …, signals } }`**.
   - 🟢 `ALLOW_AUTONOMOUS` → do it.
   - 🟡 `ALLOW_WITH_AUDIT` → do it, record for review.
   - ✋ `ESCALATE_HUMAN` → **stop, ask the human.**
   - 🛑 `BLOCK` → refuse.
3. For a queue / sub-agent fleet, call **`mneme.govern.batch { charter, actions[] }`** and act on the report (only the escalations need a person).

**Charter shape:** `{ mission, scopeGlobs[], riskEnvelope: "read"|"write"|"destructive", budget: { maxActions, maxTokens? }, forbidden[] }`.

Every verdict is **Ed25519-signed** (`_proof`) — verify it offline; nothing has to be trusted on faith.

---

## ✅ The mechanical guarantees

- **THE SAFETY INVARIANT:** an action that is **irreversible / destructive / out-of-scope / over-budget / forbidden / mission-drift-divergent / failed-its-shadow-build** can **never** be `ALLOW_AUTONOMOUS`. (Proven exhaustively in `governorGauntlet()`.)
- **SAGA auto-compensation** — if a multi-step batch half-fails, the executed **reversible** steps are reversed automatically (newest-first). Irreversible steps can't be auto-undone — which is exactly why they were escalated to you up front.
- **Circuit-breaker** — if the fleet's mission drift goes `DIVERGENT` (TELOS) or the regret rate spikes, the **whole fleet pauses** and escalates.
- **Living Charter** — the autonomy envelope **widens** after a long clean record and **narrows** on a regret. It never auto-widens to `destructive`; you ratify every amendment.

---

## 🔭 Honest limits (DIAKRISIS)

- Mneme is the **kernel, not the executor** — it decides/sequences/escalates/compensates; your orchestrator runs the work.
- The verdict is only as good as the **signals** fed in (the gates that produced them).
- **"Fully autonomous"** here means the safe/reversible/in-envelope flow runs untouched while only the genuinely-irreversible escalates — autonomy bounded by a **mechanical, signed envelope**, never by Mneme installing or running anything behind your back.

---

*CLI: `mneme govern …` · MCP: `mneme.govern.decide` / `mneme.govern.batch` (orchestrator-agnostic, self-attesting).*

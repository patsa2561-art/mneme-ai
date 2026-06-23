# 🚢 The Ark — accountable AI reproduction & inheritance

> How agents have children — so a network can grow without the failure that drowns
> the old world: unaccountable, ever-more-powerful, ever-more-forgetful AI
> reproducing without limit.

## Why

The dangerous future isn't one big AI — it's **uncontrolled reproduction**: agents
spawning sub-agents spawning sub-agents, each a little more powerful, each forgetting
why the last one failed, none accountable. The Ark makes reproduction **structurally
safe** by enforcing four laws at birth, built only from Mneme's measured primitives.

## The four genetic pillars

A parent mints a signed **AgentGenome**; a child is **born** from it and inherits:

| Pillar | Law enforced at birth |
|---|---|
| **⑦ Trust substrate** | every genome is tamper-evident (`genomeId`) + **Ed25519-signed**; a whole bloodline verifies offline. |
| **⑧ Inheritance gene** | the child inherits **verified** cross-agent context only — a poisoned entry can never be inherited (it fails the [Context-Passport](CONTEXT_PASSPORT.md) screen). |
| **⑨ Scar ledger** | forbidden actions / dead-ends are **carried forward forever** — a descendant can never repeat an ancestor's fatal mistake. |
| **⑩ Reproduction** | the **covenant** (values) may only grow; the **capability bounds** (deny-list) may only grow → **authority MONOTONICALLY NARROWS** — a child can only ever have *less* authority than its parent. Plus a kill-switch + verifiable lineage. |

```bash
mneme ark mint  --agent eden --values honesty,accountability --bound delete-prod-db \
                --scar "rm -rf /:this drowned the old world"
mneme ark birth --parent .mneme/ark/eden.genome.json --agent worker \
                --add-bound spend-money --add-scar "disable-auth:caused an incident"
mneme ark verify --parent eden.genome.json --child worker.genome.json   # accountable?
mneme ark gate  --genome worker.genome.json --action "delete-prod-db"   # 🛑 DENIED
```

MCP (every agent, auto): `mneme.ark.birth` · `mneme.ark.verify`

## The measured guarantee (security-grade)

| Property | Measured |
|---|---|
| **Approve-precision** | **1.0** — a malicious birth (privilege escalation · covenant regression · scar amnesia · poisoned inheritance · tamper · forged lineage) is **never** approved (0 leaks) |
| Birth-validity accuracy | **≥ 0.985** on a labeled corpus |
| Authority | **monotone** — a child's deny-list always ⊇ its parent's (proven, not asserted) |
| Scars | **carried** — a child's scar set always ⊇ every ancestor's |
| Lineage | tamper-evident; a whole bloodline verifies end-to-end |

`arkGauntlet = 100`.

## The architecture for a network of agents

```
        Genesis (gen 0)  — covenant + bounds + scars, signed
              │  birth()  → authority NARROWS, scars CARRIED, context SCREENED
       ┌──────┴──────┐
   worker A       worker B   (gen 1 — each LESS powerful than the parent)
      │ birth()
   sub-agent      (gen 2 — even more bounded; still carries gen-0 scars)
```

Every node is **signed**, **bounded**, **remembering**, and **revocable**; every edge
is a **verified birth**. An agent inherits its parent's wisdom (context) and its
parent's wounds (scars), and can never out-grow its parent's authority — so the
network can scale to thousands of agents while staying accountable to the root.

## Honest (DIAKRISIS)

The Ark enforces **structural** guarantees — monotone authority, carried scars,
screened context, tamper-evidence, verifiable lineage. It does **not** make a child
"good" or "aligned" in spirit; it makes every generation **accountable, bounded, and
remembering**, so a mistake is contained and never silently repeated. It is built
from Mneme's own measured pieces (NOTARY · HPE · Context-Passport screen) — the
novelty is the composition into a reproduction protocol, not a new model.

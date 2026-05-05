# Recipes — practical use cases

Real-world workflows combining multiple Mneme commands. Each recipe is one paragraph + a copy-paste shell block.

═══════════════════════════════════════════════════════════════════════════════

## 🧑‍💻 Onboard a new engineer in 30 minutes

Drop them into the repo + give them a guided tour of the people, files, and decisions they'll need.

```bash
# Day 1 — onboarding dossier
mneme adapt                                  # repo profile + recommended path
mneme mirror                                 # 5 PRs, 3 people, 2 incidents to read
mneme decisions --format markdown --out docs/ADR.md

# Pick one topic they'll work on, e.g. payments:
mneme story payments                         # 4-act timeline of how it evolved
mneme who-knows payments                     # verdict: who's the expert + backup
mneme bus-factor                             # which files only one person knows
```

═══════════════════════════════════════════════════════════════════════════════

## 🩺 Quarterly engineering retrospective

Surface the periods, files, people, and patterns that ate your quarter.

```bash
mneme drawdown --min-length 3                # firefighting periods
mneme regret --window-days 14                # shipped + immediately fixed
mneme paradox                                # architectural flip-flops
mneme implied-volatility                     # IV trend over 12 weeks
mneme moneyball                              # undervalued contributors
```

═══════════════════════════════════════════════════════════════════════════════

## 🚨 Pre-deploy risk audit

Before merging a critical PR.

```bash
git diff --staged | mneme commit-coach --stdin     # message + reviewers + warnings
git diff --staged | mneme crystal-ball --stdin     # CI failure prediction (Bayesian)
mneme blast HEAD                                   # blast radius prediction
mneme conscience --diff-file pr.patch              # similar past PRs and their fate
```

═══════════════════════════════════════════════════════════════════════════════

## 🔍 Incident postmortem (after a P0)

Walk the causal chain backwards from the broken file.

```bash
echo "TypeError: ..." | mneme stack-trace          # parse trace + history per frame
mneme palimpsest src/payment.ts:42                 # full causal chain
mneme echo --query "stripe webhook crash"          # similar past incidents
mneme black-swan                                   # was this file already known tail risk?
```

═══════════════════════════════════════════════════════════════════════════════

## 🏦 Banker / regulated-industry audit

Generate the evidence pack a security/compliance team needs.

```bash
mneme ledger --since 2025-01-01 --format sox > audit/sox-export.json
mneme decisions --format markdown --out audit/decisions.md
mneme bus-factor --top 50 > audit/bus-factor.txt
mneme greek > audit/greeks.txt
mneme implied-volatility > audit/iv.txt
mneme paradox > audit/paradox.txt
npm run sbom                                       # CycloneDX SBOM
```

Use deterministic mode for reproducible output:

```bash
echo '{ "deterministic": true }' > .mneme/config.json
mneme index --no-llm --aggressive-redact
```

═══════════════════════════════════════════════════════════════════════════════

## 💰 Sprint planning with quant rigor

Turn "we should fix tech debt" into a Kelly-optimal allocation.

```bash
# 1. Generate a candidate list of TD items (manually or scripted from issues)
cat > items.json <<EOF
[
  {"id":"1","name":"Extract PaymentAdapter","edge":0.18,"variance":0.02,"effortDays":9},
  {"id":"2","name":"Replace lodash with native","edge":0.12,"variance":0.01,"effortDays":8},
  {"id":"3","name":"Migrate Express to Fastify","edge":0.35,"variance":0.28,"effortDays":15}
]
EOF

# 2. Compute Kelly-optimal allocation
mneme alpha --items items.json --budget-days 25
```

═══════════════════════════════════════════════════════════════════════════════

## 🎓 Coach a struggling engineer

Surface the patterns + give them concrete pair-programming partners.

```bash
mneme insider-trading --min-patterns 2             # who fixes own bugs
mneme who-knows <topic-they-struggle-with>         # who they should learn from
mneme story <topic>                                # how the topic evolved
```

═══════════════════════════════════════════════════════════════════════════════

## 🌾 Annual codebase pruning

Delete dead code to "harvest losses" against accumulating tech debt.

```bash
mneme tax-loss-harvest --min-stale-days 365
mneme fossil                                       # deleted files still in history
```

═══════════════════════════════════════════════════════════════════════════════

## 📚 Generate an Obsidian vault

Turn your codebase memory into a wiki-linked second brain.

```bash
mneme decisions --format obsidian --out my-vault/
mneme story authentication --obsidian-out my-vault/
```

Drop the folder into Obsidian: File → Open vault as folder. Every backlink + tag works out of the box.

═══════════════════════════════════════════════════════════════════════════════

## 🤖 Wire into your AI assistant (the headline use case)

```bash
# 1. Add MCP config (claude_desktop_config.json or .cursor/mcp.json)
# (see MCP-Integration page)

# 2. Run the daemon for live updates
mneme watch                                        # 24/7: re-index + calibrate + self-eval

# 3. Now ask Claude / Cursor questions about your repo's history
#    The AI will use mneme_ask, mneme_why, mneme_search_commits
#    instead of guessing.
```

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[MCP Integration](MCP-Integration)** — full setup for Claude / Cursor / Continue / Copilot
- **[Commands-Tier-2-Quant](Commands-Tier-2-Quant)** — finance-style analysis details
- **[FAQ](FAQ)** — extended Q&A

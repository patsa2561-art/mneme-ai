# 🎯 Cheatsheet — every command, one line each

> **Stressed by the long command list? Read this page. Bookmark it. You're done.**
>
> Every Mneme command in one line of plain English. No git knowledge needed.
> If you can read a one-sentence email, you can read this page.

═══════════════════════════════════════════════════════════════════════════════

## 🚦 If you only learn 5 commands

These five cover 80% of daily use. Learn these first. Ignore the rest until you need it.

| Command | What it does (plain English) |
|---|---|
| `mneme init` | Set up Mneme in this folder. Run once. |
| `mneme ask "<question>"` | Ask anything about your codebase. Get a cited answer. |
| `mneme do "<goal>"` | Describe what you want. Mneme picks the right command. |
| `mneme audit --certify` | Check whether the latest AI commit broke anything. |
| `mneme nervous-system` | One-page health report for the whole repo. |

═══════════════════════════════════════════════════════════════════════════════

## 🛠 Setup — *one-time things*

| Command | What it does |
|---|---|
| `mneme init` | Set up the memory folder for this repo. |
| `mneme doctor` | Check if your environment is ready (LLM, hardware, network). |
| `mneme setup-free` | Wizard that picks a free LLM you can use without paying. |
| `mneme upgrade` | Update Mneme to the latest version. |
| `mneme index` | Read git history → save searchable memory. Secrets auto-removed. |
| `mneme status` | Has anything changed since the last index? |

═══════════════════════════════════════════════════════════════════════════════

## 💬 Daily questions — *the ones you'll actually use*

| Command | Use when… |
|---|---|
| `mneme ask "<question>"` | You want a cited answer about your repo. |
| `mneme why <file>:<line>` | "Who wrote this line and why?" |
| `mneme do "<goal>"` | Don't know which command — describe the goal in words. |
| `mneme who-knows <topic>` | "Who is the expert on rate limiting / payments / auth?" |
| `mneme decisions` | List every architectural decision auto-extracted from history. |
| `mneme story <topic>` | Tell the story of how a feature evolved over time. |
| `mneme echo "<incident>"` | "Did this kind of incident happen before?" |
| `mneme stack-trace` | Paste an error → get historical context for each frame. |
| `mneme chat` | Open a chat REPL over your repo's history. |

═══════════════════════════════════════════════════════════════════════════════

## 👥 People — *what GitHub can't see*

| Command | Use when… |
|---|---|
| `mneme passport <email>` | One person's full report — style, expertise, teammates, influence. |
| `mneme atrophy <email>` | Knowledge fading? Show what this person used to know but is forgetting. |
| `mneme telepathy` | Find pairs who never co-author but write similar code — invisible teams. |
| `mneme nemesis` | Find pairs who keep rewriting each other's code. |
| `mneme influence` | Who writes patterns that everyone else copies? (PageRank for code.) |
| `mneme lineage <file>` | Whose interpretation of whose intent ended up in this file? |
| `mneme bus-factor` | Files where one person owns 75%+ — single-point-of-failure risk. |
| `mneme dna [email]` | Extract a person's coding fingerprint (style, hours, file affinity). |
| `mneme moneyball` | Undervalued contributors — high impact, low LOC. |
| `mneme mirror "<topic>"` | Onboarding dossier for a new hire on a topic. |
| `mneme manage` | Engineering manager dashboard — health, succession, skills. |

═══════════════════════════════════════════════════════════════════════════════

## 🔍 The big-picture report

| Command | What you get |
|---|---|
| `mneme nervous-system` | The flagship: one report combining all the people + health signals. |
| `mneme nervous-system --pdf out.pdf` | Same report, PDF format. Send to your VP. |
| `mneme repo-mri` | 20-axis health diagnostic — like an MRI for your code. |
| `mneme heartbeat` | Today's pulse — anomalies above 2σ from the rolling baseline. |
| `mneme constellation` | Visual map of files and authors. |
| `mneme network` | Author collaboration graph. |
| `mneme export-bundle` | Everything dumped into one bundle — DNA + drift + chronicle + more. |

═══════════════════════════════════════════════════════════════════════════════

## 🛡 Security & risk

| Command | Use when… |
|---|---|
| `mneme guard --install` | Install a pre-commit hook that runs anomaly + vuln + secret checks. |
| `mneme guardian` | Run a 24/7 self-healing engine that fixes safe issues automatically. |
| `mneme forensics vulns` | Scan history for security holes (SQL injection, secrets, etc). |
| `mneme forensics anomaly` | Find suspicious commits — insider threat / credential compromise. |
| `mneme forensics match <commit> <email>` | "Did this person really write this commit?" |
| `mneme forensics attribute <commit>` | Rank likely authors for a commit. |
| `mneme deps audit` | Cross-check dependencies against OSV.dev — known CVEs and GHSAs. |
| `mneme conscience <files>` | Risk-score a PR against your repo's history. |
| `mneme suppress <id>` | Mark a forensics finding as a false positive. |
| `mneme show <id>` | Open a forensics finding with full context + the line of code. |

═══════════════════════════════════════════════════════════════════════════════

## 🤖 AI Session Audit — *the trust certificate for AI commits*

> Works with Claude Code · Cursor · Codex · Devin · Sweep · Aider · Copilot.

| Command | Use when… |
|---|---|
| `mneme audit --baseline` | Snapshot HOW the code behaves before letting an AI work on it. |
| `mneme audit --trace` | See exactly what the AI changed + which AI did it. |
| `mneme audit --verify` | Did the AI's commit message actually match the diff? |
| `mneme audit --certify` | 5-axis pass/fail trust certificate. CI-friendly exit code. |
| `mneme audit --watch` | Continuous CI gate — re-runs every N seconds. |
| `mneme audit --report --out audit.md` | Markdown audit trail (SOX / SOC2 / EU AI Act 2026). |
| `mneme ledger` | Tamper-evident audit log. |

═══════════════════════════════════════════════════════════════════════════════

## 🔮 Predicting the future

| Command | What it predicts |
|---|---|
| `mneme premortem "<intent>"` | Will this change probably regress? Based on similar past attempts. |
| `mneme commit-coach` | Pre-commit AI partner — message · reviewers · scope · past warnings. |
| `mneme crystal-ball` | CI failure probability before you push. |
| `mneme oracle` | Which files will collide on the same author next? |
| `mneme blast <commit>` | Predict incidents likely to follow shipping this commit. |
| `mneme dream` | Speculative ideas grounded in your codebase patterns. |

═══════════════════════════════════════════════════════════════════════════════

## 🩺 Quality, debt & decay

| Command | Use when… |
|---|---|
| `mneme karma` | TODO/FIXME debt ledger — who carries the most unkept promises. |
| `mneme promise` | Every "I'll fix this later" across commits and PRs. |
| `mneme ghost` | Half-finished features and stale TODOs haunting your repo. |
| `mneme regret` | Commits that were shipped and immediately fixed/reverted. |
| `mneme drawdown` | Worst losing streaks — pure firefighting periods. |
| `mneme tax-loss-harvest` | Dead-code candidates — delete to clear technical debt. |
| `mneme runaway` | Files growing silently — leak or scope-creep indicator. |
| `mneme fossil` | Files deleted from HEAD but still alive in git history. |
| `mneme paradox` | Architectural flip-flops — A → B → A decisions. |
| `mneme black-swan` | Rare-but-catastrophic file patterns. |
| `mneme insider-trading` | Authors who repeatedly fix bugs they themselves introduced. |
| `mneme correlation-matrix` | Hidden behavioral coupling between files. |
| `mneme implied-volatility` | Project chaos predicted from commit-message tone. |
| `mneme greek` | Codebase Greeks (Δ Γ Θ) — sensitivity across files. |
| `mneme drift` | Topical drift — feature → refactor → firefight → polish over time. |
| `mneme cluster` | Group commits into topics. |

═══════════════════════════════════════════════════════════════════════════════

## 🎓 Onboarding & explanation

| Command | Use when… |
|---|---|
| `mneme teach <folder>` | Explain a folder in plain language. |
| `mneme genius "<question>"` | Multi-step AI agent for hard questions. |
| `mneme rumor` | Tribal phrases mentioned in commits but no doc explains. |
| `mneme heal` | Synthesize WHY notes for commits with poor messages. |
| `mneme entities` | Parse + embed every function/class — semantic search ready. |
| `mneme clones` | Find functions doing the same thing under different names. |
| `mneme palimpsest <file>:<line>` | Causal chain of a single line. |
| `mneme cognitive-twin <email>` | Author voice fingerprint — optionally rewrite a commit subject in their voice. |
| `mneme counterfactual <email>` | "What if this person hadn't been here?" — shadow projection only. |
| `mneme time-machine <file>` | A file's life as eras (birth → rewrite → firefight → plateau). |
| `mneme chronicle` | Auto-generate a narrative documentary of the whole repo. |

═══════════════════════════════════════════════════════════════════════════════

## 🧪 Periodic Table & Second Brain — *new in v0.40-v0.43*

> Compose any operation Mneme can do, save the recipe, run it again later.

| Command | Use when… |
|---|---|
| `mneme periodic-table` | Browse every primitive Mneme has — like a chemistry table. |
| `mneme periodic-table <id>` | Detail page for one primitive. |
| `mneme compose "<intent>"` | Translate plain English → a runnable plan from the periodic table. |
| `mneme compose "<intent>" --execute` | Same, then actually run the plan. |
| `mneme run <alias-or-id>` | Run a saved recipe by name. |
| `mneme library` | List all saved recipes. |
| `mneme library --promote <id> --alias <name>` | Promote a recipe to a named shortcut. |
| `mneme library --eligible` | Show recipes used enough to deserve promotion. |
| `mneme library --archived` | Recipes unused for 30+ days. |
| `mneme library --forget <id>` | Remove a recipe. |

═══════════════════════════════════════════════════════════════════════════════

## 💎 Holy Grails — *new in v0.43*

| Command | Use when… |
|---|---|
| `mneme heartbeat` | Today's pulse vs the last 7 days — anomalies > 2σ. |
| `mneme rewind <ref>` | Replay history up to that ref — frozen view of the past. |
| `mneme dna-fold` | Stylometric folding — group authors by writing style only. |

═══════════════════════════════════════════════════════════════════════════════

## 🧠 Memory compression

| Command | What it does |
|---|---|
| `mneme htc-build` | Compress every commit + cluster into LLM-ready cache (~10× smaller). |
| `mneme htc-stats` | Coverage + compression ratio. |

═══════════════════════════════════════════════════════════════════════════════

## 📊 Wisdom Mutant — *the engine that gets better with use*

| Command | Use when… |
|---|---|
| `mneme feedback <id> up` | An answer was helpful. |
| `mneme feedback <id> down` | An answer was wrong. |
| `mneme calibrate` | Re-tune search knobs against accumulated feedback. |
| `mneme adapt` | Mneme inspects this repo and recommends 1-3 commands. |
| `mneme wisdom` | A short meditation from the manifesto. |
| `mneme manifesto` | Read the full canon. |

═══════════════════════════════════════════════════════════════════════════════

## 🔌 Plug into AI tools

| Command | What it does |
|---|---|
| `mneme mcp` | Run as MCP server — Claude Code / Cursor / Codex / Continue can call Mneme as a tool. |
| `mneme bot` | Run as a bot endpoint. |
| `mneme dashboard` | Open a local web dashboard. |
| `mneme org` | Cross-repo organization view. |

═══════════════════════════════════════════════════════════════════════════════

## 🛟 Help

| Command | What it does |
|---|---|
| `mneme advanced` | List every command grouped by phase (including hidden ones). |
| `mneme <anything> --help` | Show options + flags for that one command. |

═══════════════════════════════════════════════════════════════════════════════

## 🗺 Where to go next

- **[[Quickstart]]** — install + first run in 60 seconds
- **[[Command-Tour]]** — every command told as a Day-0 → Day-12 story
- **[[Recipes]]** — ready-made multi-command workflows
- **[[QSAC]]** — the audit certificate engine, deep-dive
- **[[Architecture-Overview]]** — 5-min tour of the v0.40-v1.1 architecture
- **[[FAQ]]** · **[[Troubleshooting]]** — when things go wrong

═══════════════════════════════════════════════════════════════════════════════

> *"You don't need to memorize 90 commands. You need to remember this page exists."*

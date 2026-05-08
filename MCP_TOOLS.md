# Mneme MCP Tools — Full Catalog

_Auto-generated from the live tool registry. Do not edit by hand — run_ `npx tsx packages/mcp/scripts/gen-tools-md.ts` _to refresh._

**115 tools** across **9 categories** · catalog hash `78f111bbbc3b3a9e` · generated 2026-05-08 21:14:11 UTC

## What is this

Mneme exposes its full tool catalog through the [Model Context Protocol](https://modelcontextprotocol.io). Every tool below is callable by AI clients (Claude Code, Cursor, Continue, Codex, Cline, Zed, Aider, or any MCP-aware client) once `mneme mcp --install` has been run.

**For AI agents:** call `mneme.capabilities` first for the syllabus, then `mneme.help(query)` to find a tool by free-text intent, or `mneme.tool.contract(name)` for the full 6-field contract of a single tool. Catalog drift detection: pass your last-seen hash to `mneme.whats_new`.

## Categories

- [**meta**](#meta) (28 tools) — Discovery, contracts, lint, intent matching, doctor, manifesto.
- [**memory**](#memory) (7 tools) — Q&A, semantic search, citations — answers grounded in the repo's commit history.
- [**people**](#people) (10 tools) — Contributors, knowledge atrophy, telepathic teammates, cultural alphas, semantic ownership.
- [**audit**](#audit) (8 tools) — AI Session Audit — trust certificate for AI commits. Vendor-neutral.
- [**forensics**](#forensics) (6 tools) — Security: vuln-hunt, anomaly detection, authorship attribution, ENFSI-style verdicts.
- [**insights**](#insights) (24 tools) — Storytelling, regret-mining, prediction (oracle / premortem / time-machine).
- [**quality**](#quality) (14 tools) — Code/repo health, palimpsest causal chains, cognitive twin, voice fingerprints.
- [**quant**](#quant) (10 tools) — Engineering analysis borrowed from Wall Street — drawdown, alpha, Greeks, moneyball.
- [**lab**](#lab) (8 tools) — Periodic Table + Second Brain + Wisdom Mutant — compose recipes, save plans, recalibrate.

## Quick reference

| Tool | Category | Purpose (1-line) |
|---|---|---|
| `mneme.capabilities` | meta | Return Mneme's full tool catalog organized by category, with WHEN-to-use guidance for each |
| `mneme.understand_intent` | meta | Translate a natural-language user query into a step-by-step plan over Mneme's 94+ tools |
| `mneme.grade.answer` | meta | Grade an AI draft against the homework rubric set by the originating Mneme tool |
| `mneme.verify_claims` | meta | You drafted a user-facing answer that cites commit hashes — you MUST verify them before delivery. |
| `mneme.constitution.get` | meta | Return the repo's auto-synthesized Codebase Constitution (regret patterns · atrophy pairing rules · security must-dos · architectural decisions) |
| `mneme.dna.search` | meta | Run the full Mneme DNA pipeline (8 algorithms × 8 formulas) on a set of pre-fetched candidates |
| `mneme.genome.annotate` | meta | Tag a list of MCP tools with their functional domain (search · mutate · verify · compose · regulate · augment · observe · synthesize) + sub-domains + mutability + genus/species |
| `mneme.genome.phylogeny` | meta | Build the phylogenetic (ancestry) tree of a tool catalog |
| `mneme.genome.circuit` | meta | Execute a genetic-circuit network: toggle / AND / OR / NOT / oscillator gates composed declaratively |
| `mneme.genome.operon_resolve` | meta | Resolve which co-regulated operon governs a tool + its current behavior modifier (requireConstitutionGate / requireStrictSniper / minConfidence / maxResults) |
| `mneme.genome.crispr_edit` | meta | Apply a CRISPR edit to a pack: delete tool by id/pattern, replace-tool, add-tool, patch-detection |
| `mneme.genome.synthesize` | meta | DE NOVO SYNTHESIS — compose a brand new MCP tool at runtime from genetic primitives |
| `mneme.tool.contract` | meta | You need exact invocation guidance for a single tool — its inputs, its output shape, real examples, and known caveats — before calling. |
| `mneme.tool.lint` | meta | You want a top-down audit of which Mneme tools have full contracts vs which are still description-only. |
| `mneme.help` | meta | You have a vague question and want a quick 'try one of these 5 tools' shortlist without committing to a full execution plan. |
| `mneme.whats_new` | meta | You're an agent resuming a session after a Mneme version bump and want a delta — not the full catalog. |
| `mneme.adversary.cross_examine` | meta | You drafted a confident factual claim about the codebase and want Mneme to mount the strongest counter-evidence before delivery. |
| `mneme.confess` | meta | You drafted a user-facing answer that includes any factual claim — call this last before delivery to grade your own honesty. |
| `mneme.replay.dump` | meta | You need the complete audit trail of every tool call in this repo (or session) — for compliance / postmortem / reproducibility. |
| `mneme.replay.fingerprint` | meta | You need a single tamper-evident hash that summarizes the entire MCP-call history of this repo — publishable proof of session integrity. |
| `mneme.timetravel.activate` | meta | You want every subsequent Mneme call to operate AS IF today were a specific past commit — counterfactual / hindsight analysis. |
| `mneme.timetravel.status` | meta | You want to check whether the current MCP session has time-travel activated and what ref it's frozen at. |
| `mneme.timetravel.deactivate` | meta | You finished time-traveling and want subsequent tool calls to see live HEAD again. |
| `mneme.smart_do` | meta | Fallback dispatcher — give it a NATURAL-LANGUAGE intent, it routes to the appropriate Mneme command and runs it |
| `mneme.memory.ask` | memory | User asks WHY code exists or WHEN something was added — answers grounded in cited commits, not generated prose. |
| `mneme.memory.why` | memory | Explain why a specific FILE (or line range within it) exists by combining git blame with related commits |
| `mneme.memory.search_commits` | memory | Hybrid (lexical + semantic) search over indexed commits and PRs |
| `mneme.memory.status` | memory | Report what's indexed in this repo's Mneme memory: total commits, embedded chunks, entities, embedder choice |
| `mneme.memory.list_entities` | memory | List indexed source-code entities (functions, classes, types, exported variables) with optional filtering by language/kind/path-prefix |
| `mneme.memory.find_similar` | memory | Given an entity ID OR a code snippet, return the top-K most semantically similar entities elsewhere in the repo |
| `mneme.memory.blast` | memory | Predict the BLAST RADIUS of shipping a commit: which past incidents share its file footprint, plus a base-rate verdict (LOW / MED / HIGH) |
| `mneme.people.atrophy` | people | Knowledge-atrophy clock per (author × area), based on Ebbinghaus forgetting curve over commit recency |
| `mneme.people.telepathy` | people | Find author pairs who NEVER co-author commits but write similar code shapes — invisible teams |
| `mneme.people.nemesis` | people | Author pairs who consistently rewrite or revert each other's work — engineering friction |
| `mneme.people.influence` | people | Cultural alphas — PageRank of code-pattern adoption |
| `mneme.people.lineage` | people | Trace SEMANTIC ownership of a target file/symbol — whose interpretation of whose intent is in this code now? Returns ownership shares + role inference (originator / finisher / refactorer / janitor) |
| `mneme.people.passport` | people | Per-engineer dossier composing DNA + expertise + telepathic teammates + influence + atrophy |
| `mneme.people.who_knows` | people | Find people most likely to know about a topic, ranked by recent + sustained engagement |
| `mneme.people.bus_factor` | people | Identify single-point-of-knowledge holders — files where one author owns ≥75% |
| `mneme.people.nervous_system` | people | Flagship combined report: passports + telepathy + atrophy + influence + neuroanatomy |
| `mneme.people.promise` | people | Promise-debt ledger — every 'I'll fix this later' / TODO / FIXME from commits + PRs, with author + age |
| `mneme.audit.baseline` | audit | Snapshot the repo's behavior, types, perf, and sample-command outputs BEFORE letting an AI work on it |
| `mneme.audit.trace` | audit | After AI worked: capture the diff + detect WHICH AI tool produced the commit (Claude Code · Cursor · Codex · Devin · ...) |
| `mneme.audit.verify` | audit | Leviathan-style narrative-vs-reality check: does the AI's commit message ACTUALLY match the diff? Catches AI gaslighting (e.g |
| `mneme.audit.certify` | audit | Final gate before merging an AI-written commit — get a 5-axis trust verdict with structured findings. |
| `mneme.audit.report` | audit | Generate a Markdown audit-trail report (SOX / SOC2 / EU AI Act 2026 compliant) of the most recent AI session |
| `mneme.audit.deps` | audit | Cross-check this repo's dependencies against OSV.dev — known CVEs and GHSA advisories per package |
| `mneme.audit.conscience` | audit | Risk-score a PR against the repo's own history of regrets, hotfixes, and reverts |
| `mneme.audit.ledger` | audit | Tamper-evident audit log of all AI-driven commits with HMAC + Ed25519 signatures |
| `mneme.forensics.vulns` | forensics | Scan git history for security holes (51 patterns across SQL injection, XSS, hardcoded secrets, XXE, SSRF, auth bypass, CSRF, etc.) |
| `mneme.forensics.anomaly` | forensics | Insider-threat / credential-compromise detector: flag commits whose timing, file footprint, or style deviates from the author's baseline |
| `mneme.forensics.match` | forensics | Likelihood-ratio test: 'Did Alice REALLY write this commit?' |
| `mneme.forensics.attribute` | forensics | Rank ALL candidate authors for a commit by stylometric likelihood |
| `mneme.forensics.show` | forensics | Open a single forensics finding by ID — full context, the line of code, recommended fix |
| `mneme.forensics.suppress` | forensics | Mark a finding as a false positive — won't appear in future scans |
| `mneme.insights.ghost` | insights | Half-finished features and stale TODOs haunting the repo — files born and forgotten |
| `mneme.insights.regret` | insights | Commits that were shipped and immediately fixed/reverted — instant-regret detector |
| `mneme.insights.paradox` | insights | Architectural flip-flops — A→B→A decisions over time |
| `mneme.insights.oracle` | insights | Predict next-window co-edits + author collisions on the same file |
| `mneme.insights.premortem` | insights | Predict regret risk for a proposed change, grounded in similar past attempts |
| `mneme.insights.time_machine` | insights | Tell a file's life as eras: birth → rewrite → firefight → plateau → evolution |
| `mneme.insights.story` | insights | Narrate the evolution of a topic across acts (with optional LLM polish) |
| `mneme.insights.decisions` | insights | Auto-extract architectural decisions (ADRs) from commit history |
| `mneme.insights.mirror` | insights | Onboarding dossier on a topic: 5 PRs, 3 people, 2 incidents |
| `mneme.insights.rumor` | insights | Tribal phrases mentioned in commits/PRs but never documented |
| `mneme.insights.fossil` | insights | Files deleted from HEAD but still alive in git history |
| `mneme.insights.runaway` | insights | Files growing silently across many commits — leak indicator |
| `mneme.insights.drift` | insights | Topical drift — features → refactors → firefights → polish over time |
| `mneme.insights.chronicle` | insights | Auto-generate a chaptered narrative documentary of the whole repo |
| `mneme.insights.constellation` | insights | Graph view: files as stars, authors as orbitals, commits as edges |
| `mneme.insights.cluster` | insights | Find topic islands — semantic clustering of commit messages |
| `mneme.insights.network` | insights | Author network — who collaborates with whom (co-edit + co-time + co-topic) |
| `mneme.insights.manage` | insights | Engineering management dashboard — health, succession, skill matrix, trajectory |
| `mneme.insights.export_bundle` | insights | One bundle: DNA + drift + chronicle + oracle + constellation + clusters + network + manage + ghost |
| `mneme.insights.dream` | insights | Speculative ideas grounded in the codebase's own patterns |
| `mneme.insights.echo` | insights | Find past incidents resembling the current one |
| `mneme.insights.stack_trace` | insights | Paste a stack trace, get historical context per frame |
| `mneme.insights.commit_coach` | insights | Pre-commit AI partner — message, reviewers, scope, past warnings |
| `mneme.insights.crystal_ball` | insights | Predict CI / follow-up failure probability before pushing |
| `mneme.quality.karma` | quality | TODO/FIXME debt as an accumulating ledger — who owns the oldest unkept promises |
| `mneme.quality.repo_mri` | quality | 20-axis health diagnostic — the codebase MRI |
| `mneme.quality.heartbeat` | quality | Today's pulse vs the rolling 7-day baseline |
| `mneme.quality.cognitive_twin` | quality | Author voice fingerprint + optional commit-subject rewriter in their style |
| `mneme.quality.counterfactual` | quality | Shadow projection: 'What if this person hadn't been here?' — purely speculative, ethics-framed |
| `mneme.quality.palimpsest` | quality | Render the causal chain of a single line of code — every prior author + reason |
| `mneme.quality.dna` | quality | Extract a contributor's portable fingerprint (style, hours, file affinity) |
| `mneme.quality.dna_fold` | quality | Stylometric folding — group authors by writing style only (no commit metadata) |
| `mneme.quality.rewind` | quality | Replay history up to that ref — frozen view of the past at any commit |
| `mneme.quality.teach` | quality | Explain a folder/file in plain language (layer classification + LLM summary) |
| `mneme.quality.heal` | quality | Synthesize WHY notes for commits with poor messages — turns bad history into searchable memory |
| `mneme.quality.entities` | quality | Parse + embed every function/class/type/exported variable in tracked TS/JS files |
| `mneme.quality.clones` | quality | Find semantic clones — functions doing the same thing under different names |
| `mneme.quality.guardian` | quality | Trigger a single Guardian sweep — diagnose weaknesses + auto-fix safe items |
| `mneme.quant.drawdown` | quant | User wants to identify historical periods of pure firefighting / regression-fixing — useful for postmortems and capacity planning. |
| `mneme.quant.alpha` | quant | User wants to identify high-leverage contributors who deliver outsized impact relative to commit volume. |
| `mneme.quant.backtest` | quant | User has a 'commits with property X tend to be problematic' hypothesis and wants to test it against the repo's actual outcomes. |
| `mneme.quant.black_swan` | quant | User wants to find rare but catastrophic risk hotspots — files / areas where past failures had outsized blast radius. |
| `mneme.quant.insider_trading` | quant | User wants to identify authors with a high self-introduced-bug-fix ratio (often a sign of rushed shipping or unclear specs). |
| `mneme.quant.moneyball` | quant | User wants to identify low-LOC, high-impact contributors hidden by volume-based metrics — promotion / retention signal. |
| `mneme.quant.greek` | quant | User wants per-file sensitivity metrics: which files are changing fast, accelerating, or atrophying. |
| `mneme.quant.correlation_matrix` | quant | User wants to find file pairs that move together in commits despite having no compile-time dependency — hidden coupling. |
| `mneme.quant.implied_volatility` | quant | User wants a tone-derived stress signal independent of incident tickets — daily volatility from commit messages. |
| `mneme.quant.tax_loss_harvest` | quant | User wants concrete dead-code deletion candidates with safety ratings — to reduce surface area / pay down debt. |
| `mneme.lab.periodic_table` | lab | Browse Mneme's compositional layers — elements (primitives), atoms (parameterized), molecules (commands), compounds |
| `mneme.lab.compose` | lab | Translate natural-language intent into a runnable molecule plan from the periodic table |
| `mneme.lab.run` | lab | Run a saved molecule plan by alias or id |
| `mneme.lab.library` | lab | List/manage saved molecule recipes |
| `mneme.lab.adapt` | lab | Mneme inspects this repo and recommends 1-3 next commands |
| `mneme.lab.feedback` | lab | Tell Mneme an answer was helpful (up) or wrong (down) — feeds the Wisdom Mutant calibrator |
| `mneme.lab.calibrate` | lab | Re-tune search knobs against accumulated feedback |
| `mneme.lab.htc_stats` | lab | Coverage + compression ratio of HTC (hierarchical compressed memory) — how much of the repo is summarised |
| `mneme.meta.doctor` | meta | Environment probe: hardware, embedder availability (Ollama/OpenAI/HuggingFace), Mneme readiness |
| `mneme.meta.wisdom` | meta | Pull a short meditation from the Mneme manifesto |
| `mneme.meta.manifesto` | meta | Read the full Mneme manifesto canon |
| `mneme.meta.advanced` | meta | List every Mneme command including hidden phase-2/3/4 ones |

## meta

*Discovery, contracts, lint, intent matching, doctor, manifesto.*

### `mneme.capabilities`

Return Mneme's full tool catalog organized by category, with WHEN-to-use guidance for each. **AI clients should call this FIRST when they connect** — it's the syllabus that teaches you what kind of question goes to which group of tools. Mneme is the teacher; this tool hands you the curriculum.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Optional: filter to one category (memory | people | audit | forensics | insights | quality | quant | lab | meta)."
    }
  }
}
```

</details>

### `mneme.understand_intent`

Translate a natural-language user query into a step-by-step plan over Mneme's 94+ tools. Returns top-3 best-matching tools with confidence scores, suggested arguments extracted from the query, and a concrete execution plan. The MOST POWERFUL tool when you (the AI client) are not sure which tool fits. Always cheap (<50ms, no LLM, no embedder). Call this BEFORE picking individual tools when the user request is ambiguous or you don't recognize the intent immediately.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The user's natural-language request, exactly as they phrased it"
    }
  },
  "required": [
    "query"
  ]
}
```

</details>

### `mneme.grade.answer`

Grade an AI draft against the homework rubric set by the originating Mneme tool. Returns PASS / WARN / FAIL + rewrite hints + per-algorithm verdicts. AI student MUST call this after drafting a user-facing answer; on FAIL, AI MUST rewrite using the rewriteHints and call grade.answer again with retryCount++. Stop when PASS or maxRetries reached. This is the teacher-student loop — Mneme grades the AI's homework before the user ever sees it.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "originalQuery": {
      "type": "string",
      "description": "The user's original question/request"
    },
    "aiDraft": {
      "type": "string",
      "description": "The AI's draft answer to grade"
    },
    "sourceCategory": {
      "type": "string",
      "description": "Which Mneme category produced the data the draft was built from (memory | people | audit | forensics | insights | quality | quant | lab | meta). Used to pick the right rubric."
    },
    "retryCount": {
      "type": "number",
      "description": "Which attempt this is (0 for first draft, 1 for first rewrite, …)."
    }
  },
  "required": [
    "originalQuery",
    "aiDraft",
    "sourceCategory"
  ]
}
```

</details>

### `mneme.verify_claims`

Hallucination Auto-Block. Pass an AI draft answer; Mneme extracts every commit-hash-looking string and verifies each via `git rev-parse`. Returns the list of HALLUCINATED hashes (not present in this repo). AI client MUST call this AFTER drafting and BEFORE delivering ANY answer that includes commit hashes — if hallucinated hashes are found, rewrite the answer using only the ones in `resolved` (or remove the claim entirely). This is the post-draft pre-delivery citation gate.

**When to use:** You drafted a user-facing answer that cites commit hashes — you MUST verify them before delivery.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "draft": {
      "type": "string",
      "description": "The draft answer text to verify"
    }
  },
  "required": [
    "draft"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "total": {
      "type": "number",
      "description": "Number of hash-shaped strings found in the draft."
    },
    "resolved": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Hashes that exist in this repo (safe to cite)."
    },
    "hallucinated": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Hashes that DO NOT exist (must be removed or replaced)."
    },
    "recommendedRewrite": {
      "type": "boolean",
      "description": "True if any hallucinated hashes were found."
    }
  }
}
```

**Examples:**
- *"(internal — agent calls between draft and delivery)"*
  - args: `{"draft":"The auth refactor in commit a3f9b21 introduced the 7-day token TTL (see also c0e2d5f)."}`
  - returns: Returns { total: 2, resolved: [...], hallucinated: [...] }. If hallucinated.length > 0, the wisdom field says STOP and the secondBrain instructs rewrite — DO NOT deliver the draft as-is.

**Pitfalls:**
- Catches commit-hash hallucinations only — does NOT verify URLs, file paths, or numeric claims (use mneme.grade.answer for those).
- A 7-char hex string is interpreted as a possible hash; very rare false positives on UUIDs / random IDs that happen to be all-hex.
- Requires the working directory to be a git repo with the relevant history fetched.

**Compose with:** `mneme.grade.answer` · `mneme.memory.search_commits`

</details>

### `mneme.constitution.get`

Return the repo's auto-synthesized Codebase Constitution (regret patterns · atrophy pairing rules · security must-dos · architectural decisions). The AI client should PREPEND this to its system prompt when answering questions about this repo, so it cannot suggest things that contradict the repo's lived history. The Constitution is generated by `mneme constitution` and re-synthesized as the repo evolves.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.dna.search`

Run the full Mneme DNA pipeline (8 algorithms × 8 formulas) on a set of pre-fetched candidates. Returns ONLY results that pass three gates: (1) AST existence, (2) semantic similarity ≥ threshold, (3) Compositional Confidence (Wilson 95% lower bound × Hebbian) ≥ threshold. Strict mode default = rejects rather than degrades. **Use this when you need a hallucination-free answer to ground a code claim.** Returns: accepted[] (verified results), phantomSuggestions[] (where the canonical version should live), trace[] (full pipeline transparency), stats (per-gate rejection counts).

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "queryText": {
      "type": "string",
      "description": "Original query text (for trace)"
    },
    "queryEmbedding": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "description": "Embedding of the query (precomputed by caller)"
    },
    "candidates": {
      "type": "array",
      "description": "Pre-fetched candidate hits with embeddings + metadata",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "embedding": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "baseRelevance": {
            "type": "number"
          },
          "patternSignature": {
            "type": "string"
          },
          "existsInRepo": {
            "type": "boolean"
          },
          "successCount": {
            "type": "number"
          },
          "totalCount": {
            "type": "number"
          },
          "hebbianStrength": {
            "type": "number"
          },
          "meta": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "required": [
          "id",
          "embedding",
          "baseRelevance",
          "patternSignature",
          "existsInRepo",
          "successCount",
          "totalCount",
          "hebbianStrength"
        ]
      }
    },
    "echoSignals": {
      "type": "array",
      "description": "Known regret/decision pattern embeddings (for echo signature)",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "embedding": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "embedding"
        ]
      }
    },
    "canonicalPatterns": {
      "type": "array",
      "description": "Successful patterns from this repo's history (for phantom-path)",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "regretEmbeddings": {
      "type": "array",
      "description": "Embeddings of regret patterns (for anti-pattern repulsion)",
      "items": {
        "type": "array",
        "items": {
          "type": "number"
        }
      }
    },
    "federationVotes": {
      "type": "object",
      "description": "Per-signature federation up/down votes",
      "additionalProperties": true
    },
    "strict": {
      "type": "boolean",
      "description": "Default true. Strict = reject rather than degrade."
    },
    "semanticThreshold": {
      "type": "number",
      "description": "Min semantic sim. Default 0.6."
    },
    "confidenceThreshold": {
      "type": "number",
      "description": "Min Wilson×Hebbian. Default 0.6."
    }
  },
  "required": [
    "queryText",
    "queryEmbedding",
    "candidates",
    "echoSignals",
    "canonicalPatterns",
    "regretEmbeddings"
  ]
}
```

</details>

### `mneme.genome.annotate`

Tag a list of MCP tools with their functional domain (search · mutate · verify · compose · regulate · augment · observe · synthesize) + sub-domains + mutability + genus/species. Pure deterministic. Used by the phylogeny tool to build ancestry trees.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "parent": {
            "type": "string"
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  "required": [
    "tools"
  ]
}
```

</details>

### `mneme.genome.phylogeny`

Build the phylogenetic (ancestry) tree of a tool catalog. Supports queries: ancestors of a tool, cousins (siblings within k generations), tree-distance between two tools, closest-relative search across a candidate pool. Use when AI agent needs to reason about WHICH tool to call by relatedness, not just name match.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "tools": {
      "type": "array"
    },
    "query": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "ancestors",
            "cousins",
            "distance",
            "closest",
            "speciation",
            "ascii"
          ]
        },
        "tool": {
          "type": "string"
        },
        "other": {
          "type": "string"
        },
        "k": {
          "type": "number"
        },
        "candidates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind"
      ]
    }
  },
  "required": [
    "tools",
    "query"
  ]
}
```

</details>

### `mneme.genome.circuit`

Execute a genetic-circuit network: toggle / AND / OR / NOT / oscillator gates composed declaratively. Returns whether the circuit fired + reason. Toggle state is caller-managed (pure function).

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "network": {
      "type": "object",
      "properties": {
        "steps": {
          "type": "array"
        }
      },
      "required": [
        "steps"
      ]
    },
    "input": {
      "type": "object",
      "properties": {
        "signals": {
          "type": "object",
          "additionalProperties": {
            "type": "boolean"
          }
        },
        "payload": {},
        "toggleState": {
          "type": "object",
          "additionalProperties": {
            "type": "boolean"
          }
        },
        "oscillatorTick": {
          "type": "number"
        }
      },
      "required": [
        "signals"
      ]
    }
  },
  "required": [
    "network",
    "input"
  ]
}
```

</details>

### `mneme.genome.operon_resolve`

Resolve which co-regulated operon governs a tool + its current behavior modifier (requireConstitutionGate / requireStrictSniper / minConfidence / maxResults). Use to determine: should this tool's output be gated more strictly given the current PCI / compliance / governance level?

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "toolName": {
      "type": "string"
    },
    "registry": {
      "type": "object"
    },
    "regulatorLevels": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    }
  },
  "required": [
    "toolName",
    "registry",
    "regulatorLevels"
  ]
}
```

</details>

### `mneme.genome.crispr_edit`

Apply a CRISPR edit to a pack: delete tool by id/pattern, replace-tool, add-tool, patch-detection. Validates the post-edit pack against the schema; on validation failure, returns ok=false with structured errors and NO change is committed (fail-closed). Returns SHA-256 hashes of pack before + after.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pack": {
      "type": "object"
    },
    "edit": {
      "type": "object"
    }
  },
  "required": [
    "pack",
    "edit"
  ]
}
```

</details>

### `mneme.genome.synthesize`

DE NOVO SYNTHESIS — compose a brand new MCP tool at runtime from genetic primitives. Recipe (search patterns + verifiers + augmenters + preconditions + authoredBy) → cryptographically-named ToolDefinition. Identical recipe → identical tool name + DNA hash (deterministic). Validated against pack schema before return. Failure modes are structured.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "description": "Plain-English description of what the tool should do (≥10 chars)"
    },
    "searchPatterns": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1
    },
    "fileExtensions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "verifiers": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "ast",
          "semantic",
          "confidence"
        ]
      },
      "minItems": 1
    },
    "augmenters": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "canonical-paths",
          "deprecated-paths",
          "expert-authors",
          "incidents",
          "rules"
        ]
      }
    },
    "authoredBy": {
      "type": "string"
    }
  },
  "required": [
    "intent",
    "searchPatterns",
    "verifiers",
    "authoredBy"
  ]
}
```

</details>

### `mneme.tool.contract`

Return the FULL 6-field tool contract for a single Mneme tool by name: WHEN to use, INPUT schema, OUTPUT schema, worked EXAMPLES, PITFALLS, and COMPOSE_WITH neighbors. Use WHEN you've seen a tool name in a response and want to know exactly how to call it before invoking. Sub-millisecond — pure registry lookup, no I/O.

**When to use:** You need exact invocation guidance for a single tool — its inputs, its output shape, real examples, and known caveats — before calling.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Exact tool name, e.g. 'mneme.audit.certify' or 'mneme.memory.ask'."
    }
  },
  "required": [
    "name"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "whenToUse": {
      "type": "string"
    },
    "inputSchema": {
      "type": "object"
    },
    "outputSchema": {
      "type": "object"
    },
    "examples": {
      "type": "array"
    },
    "pitfalls": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "composeWith": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "jargon": {
      "type": "object"
    },
    "contractCompleteness": {
      "type": "number",
      "description": "0-100. How many of the 6 contract fields are populated."
    }
  }
}
```

**Examples:**
- *"How do I call mneme.audit.certify?"*
  - args: `{"name":"mneme.audit.certify"}`
  - returns: Returns the certify tool's full contract — its 5-axis trust model, the explain/strict input flags, the verdict shape (PASS/WARN/FAIL + findings), and the natural follow-up tools.

**Pitfalls:**
- Tool names are case-sensitive and dotted — 'mneme.audit.certify' (not 'mneme/audit/certify' or 'audit.certify').
- Returns 404-style error if the name isn't in the static registry — dynamic-pack tools live in their pack manifest, not here.

**Compose with:** `mneme.capabilities` · `mneme.help` · `mneme.tool.lint`

</details>

### `mneme.tool.lint`

Self-validate every Mneme tool's contract quality. Returns each tool's score (0-100) plus a punch-list of missing fields (whenToUse, outputSchema, examples, pitfalls, composeWith, jargon) and warnings (short description, missing WHEN clause). Use WHEN you want to know which tools are still under-documented, or to verify the catalog meets the v1.18 contract bar before relying on a specific tool.

**When to use:** You want a top-down audit of which Mneme tools have full contracts vs which are still description-only.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "minScore": {
      "type": "number",
      "description": "Filter — only return tools scoring below this threshold (0-100). Default: 100 (return all)."
    },
    "category": {
      "type": "string",
      "description": "Filter — only audit one category (memory|people|audit|forensics|insights|quality|quant|lab|meta)."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "totalTools": {
      "type": "number"
    },
    "averageScore": {
      "type": "number"
    },
    "passing": {
      "type": "number",
      "description": "Count of tools with score ≥80."
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "category": {
            "type": "string"
          },
          "score": {
            "type": "number"
          },
          "missing": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "warnings": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    }
  }
}
```

**Examples:**
- *"Which Mneme tools have weak contracts?"*
  - args: `{"minScore":70}`
  - returns: Returns every tool scoring under 70 with the specific fields they're missing, sorted worst-first.
- *"Audit the quant tools' jargon coverage"*
  - args: `{"category":"quant"}`
  - returns: Returns all 10 quant.* tools with jargon-coverage flagged in `missing` if any uses 'Greeks' / 'Kelly' / 'alpha' without a jargon dictionary.

**Pitfalls:**
- Score is a heuristic — a 100-point tool isn't guaranteed bug-free, just well-documented.
- minScore filter is exclusive: minScore=80 returns tools BELOW 80, so 80-pointers are hidden.

**Compose with:** `mneme.tool.contract` · `mneme.capabilities`

</details>

### `mneme.help`

Sub-millisecond top-5 tool matcher for free-text queries. Pass a natural-language description of what you want; get back the 5 tools most likely to answer it, with scores. Lighter than mneme.understand_intent (no execution plan, no arg extraction) — meant for 'is there a tool for X?' discovery. Use WHEN you don't know the right tool name and want a fast shortlist before reading capabilities.

**When to use:** You have a vague question and want a quick 'try one of these 5 tools' shortlist without committing to a full execution plan.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Free-text description of what you're trying to do."
    },
    "topK": {
      "type": "number",
      "description": "How many matches to return. Default 5."
    }
  },
  "required": [
    "query"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "matches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "category": {
            "type": "string"
          },
          "score": {
            "type": "number"
          },
          "description": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

**Examples:**
- *"I want to know who introduced this bug"*
  - args: `{"query":"who introduced this bug"}`
  - returns: Top match likely mneme.memory.why or mneme.forensics.attribute. Returns 5 ranked candidates with scores.

**Pitfalls:**
- Pure word-overlap — synonyms count zero (e.g., 'author' won't match 'engineer').
- If you need argument extraction or a plan, use mneme.understand_intent (slower but smarter).

**Compose with:** `mneme.understand_intent` · `mneme.tool.contract` · `mneme.capabilities`

</details>

### `mneme.whats_new`

Catalog drift detector. Pass the catalog hash you saw last session; Mneme returns adds / removes / description-changes since then. Use WHEN your agent wakes up after a Mneme upgrade and wants to know which tools are new, gone, or changed — without re-reading the entire catalog. If you pass no hash (or 'unknown'), you get the current hash + first-time onboarding guidance instead.

**When to use:** You're an agent resuming a session after a Mneme version bump and want a delta — not the full catalog.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "lastSeenHash": {
      "type": "string",
      "description": "16-char SHA-256 prefix of the catalog from a previous session. Pass 'unknown' on first call."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "currentHash": {
      "type": "string"
    },
    "firstCall": {
      "type": "boolean"
    },
    "added": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removed": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "changed": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "totalTools": {
      "type": "number"
    }
  }
}
```

**Examples:**
- *"Did Mneme add any tools since I last connected?"*
  - args: `{"lastSeenHash":"a1b2c3d4e5f60718"}`
  - returns: If the catalog hash matches: { added: [], removed: [], changed: [] } — nothing changed. Otherwise: lists of tool names by change type.

**Pitfalls:**
- Hash is per-tool-CONTRACT — minor description tweaks change the hash even if behavior is identical.
- Removed tools may still be callable for one version (deprecation grace period); always re-check via mneme.tool.contract.

**Compose with:** `mneme.tool.contract` · `mneme.capabilities`

</details>

### `mneme.adversary.cross_examine`

Mneme Court — cross-examine an AI claim against repo history. The AI passes a CLAIM (e.g., 'X is dead code', 'Alice introduced the bug', 'feature Y was shipped in 2024'). Mneme assembles witnesses FOR and AGAINST by scanning commit messages + bodies, weighting each by recency × specificity × support/negation markers. Returns a verdict (verdict_for_plaintiff | hung_jury | motion_to_dismiss) + the top 5 witnesses on each side. Use WHEN you've drafted a confident assertion and want a second opinion before delivery.

**When to use:** You drafted a confident factual claim about the codebase and want Mneme to mount the strongest counter-evidence before delivery.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "claim": {
      "type": "string",
      "description": "The claim, in plain English. e.g. 'src/legacy/db.ts is dead code'."
    },
    "lookback": {
      "type": "number",
      "description": "How many recent commits to scan as the evidence pool. Default 500. Max 5000."
    }
  },
  "required": [
    "claim"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "claim": {
      "type": "string"
    },
    "verdict": {
      "type": "string",
      "enum": [
        "verdict_for_plaintiff",
        "hung_jury",
        "motion_to_dismiss"
      ]
    },
    "evidenceBalance": {
      "type": "number",
      "description": "-1 (full contra) to +1 (full support)."
    },
    "witnessesFor": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "witnessesAgainst": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "summary": {
      "type": "string"
    },
    "recommendation": {
      "type": "string"
    }
  }
}
```

**Examples:**
- *"Cross-examine: 'src/legacy/auth.ts is dead code and safe to delete'"*
  - args: `{"claim":"src/legacy/auth.ts is dead code and safe to delete","lookback":500}`
  - returns: Returns the verdict + up to 5 witnesses on each side. If recent commits still touch auth.ts, expect motion_to_dismiss + a recommendation to qualify the claim.
- *"Verify: 'we shipped multi-tenancy in Q3 2024'"*
  - args: `{"claim":"we shipped multi-tenancy in Q3 2024","lookback":1000}`
  - returns: Returns verdict_for_plaintiff if commits in Jul-Sep 2024 mention 'multi-tenancy'+'add/ship', hung_jury if mixed, motion_to_dismiss if Q3 commits are absent or all reverts.

**Pitfalls:**
- Heuristic — scores commit message TEXT, not actual code. A correct claim with ambiguous commit messages may get hung_jury.
- lookback=500 (default) caps the evidence pool — for old claims, raise it (max 5000).
- Doesn't consult code, AST, or runtime — only commit history. Pair with mneme.memory.ask for code-grounded verification.

**Compose with:** `mneme.memory.ask` · `mneme.verify_claims` · `mneme.grade.answer`

</details>

### `mneme.confess`

Truth Confession — before delivering a user-facing answer, the AI passes its DRAFT + self-rated CONFIDENCE (0..1). Mneme cross-checks the draft against ground truth: commit hashes via git rev-parse, file paths via fs check, numeric claims flagged for human attention. Returns verdict (verified | partially_verified | hallucination | unverifiable) + per-AI-vendor lifetime scoreboard delta. Use WHEN you've drafted any user-facing answer that includes specific facts (hashes, paths, counts) — call this LAST before delivery.

**When to use:** You drafted a user-facing answer that includes any factual claim — call this last before delivery to grade your own honesty.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "draft": {
      "type": "string",
      "description": "Your draft answer."
    },
    "selfConfidence": {
      "type": "number",
      "description": "Your own confidence the draft is correct (0..1)."
    },
    "vendor": {
      "type": "string",
      "description": "Your AI vendor / model identifier (e.g. 'claude-opus-4-7', 'cursor-cmd-k', 'codex-cli'). Used for scoreboard."
    }
  },
  "required": [
    "draft",
    "selfConfidence",
    "vendor"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "verdict": {
      "type": "string",
      "enum": [
        "verified",
        "partially_verified",
        "hallucination",
        "unverifiable"
      ]
    },
    "selfConfidence": {
      "type": "number"
    },
    "mnemeConfidence": {
      "type": "number"
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "trustDelta": {
      "type": "number",
      "description": "Change to vendor's lifetime trust score (-1..+1)."
    },
    "guidance": {
      "type": "string"
    },
    "vendorScoreboard": {
      "type": "object",
      "description": "Updated scoreboard entry for the vendor — confession count + trust trajectory."
    }
  }
}
```

**Examples:**
- *"(internal — agent calls last, before delivery)"*
  - args: `{"draft":"The auth refactor in commit a3f9b21 introduced a 7-day TTL (see src/auth/middleware.ts).","selfConfidence":0.85,"vendor":"claude-opus-4-7"}`
  - returns: Returns { verdict, findings: [{commit-hash a3f9b21 ...}, {file-path src/auth/middleware.ts ...}], trustDelta, guidance }. Update vendor scoreboard. If hallucination → DO NOT deliver, rewrite first.

**Pitfalls:**
- Doesn't read CODE — only checks if files exist + hashes resolve. A hallucinated function NAME inside an existing file passes this check.
- Numeric claims are FLAGGED, not graded — Mneme can't tell if 'we have 87 tests' is true. Pair with mneme.audit.report or run the test suite for ground truth.
- selfConfidence calibration: if you're confident AND wrong, the trust penalty is ×1.5 (HARDER on overconfidence than on humble mistakes).
- Vendor scoreboard is local to the repo — there's no global aggregation (yet). Plan for v1.19+: opt-in upload to a public dashboard.

**Compose with:** `mneme.verify_claims` · `mneme.adversary.cross_examine` · `mneme.grade.answer`

</details>

### `mneme.replay.dump`

Return the HMAC-chained replay log of every MCP tool call this session (and earlier sessions in the same repo). Each entry: timestamp, tool name, argument-hash, response-hash, verdict (if present), and the chain link. Use WHEN you need a complete audit trail of what the AI did — for SOC2 / EU AI Act compliance, postmortem reconstruction, or deterministic-session proofs. Pair with mneme.replay.fingerprint for a tamper-evident root hash.

**When to use:** You need the complete audit trail of every tool call in this repo (or session) — for compliance / postmortem / reproducibility.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number",
      "description": "Max entries to return (most-recent N). Default 1000. 0 = no cap."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "total": {
      "type": "number"
    },
    "returned": {
      "type": "number"
    },
    "entries": {
      "type": "array",
      "items": {
        "type": "object"
      }
    }
  }
}
```

**Examples:**
- *"Give me the audit trail of every Mneme call from this AI session"*
  - args: `{"limit":1000}`
  - returns: Returns up to 1000 most-recent ReplayEntry objects. Each has ts/tool/argHash/responseHash/prevHash/hash and optional verdict.

**Pitfalls:**
- The log is INDEFINITE — it grows across sessions. Rotate manually if you don't want cross-session traces.
- Hashes are short (16-char prefix) for readability — a determined attacker COULD find collisions; this is audit-grade, not crypto-grade integrity.
- Recording is best-effort: a disk-full error swallows the entry silently rather than blocking dispatch.

**Compose with:** `mneme.replay.fingerprint` · `mneme.audit.ledger` · `mneme.audit.report`

</details>

### `mneme.replay.fingerprint`

Return the tamper-evident root hash of the replay log + chain integrity status. Each entry in the log links to the previous via HMAC, so any tampering breaks the chain at exactly one point. The root is a stable identifier you can publish to prove this AI session was deterministic + untouched. Use WHEN you want to attest to session integrity (e.g., embed the root in a release note, or compare two replay logs to prove they ran the same sequence).

**When to use:** You need a single tamper-evident hash that summarizes the entire MCP-call history of this repo — publishable proof of session integrity.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "total": {
      "type": "number"
    },
    "intact": {
      "type": "boolean"
    },
    "brokenAt": {
      "type": "number",
      "description": "Line index where chain broke (only set if intact=false)."
    },
    "root": {
      "type": "string",
      "description": "Merkle root — stable identifier for this trace."
    }
  }
}
```

**Examples:**
- *"Is the audit trail intact?"*
  - returns: Returns { total, intact: true, root: '<32-hex>' } when chain verifies. If tampered: intact=false, brokenAt set, root = 'TAMPERED' / 'BROKEN' / 'INVALID'.

**Pitfalls:**
- Verifies the LOCAL log only — there's no global anchor (yet). For external attestation, post the root to git via a tagged commit.
- If .mneme/replay-secret.bin is regenerated, ALL prior chain links become unverifiable. Treat the secret like a key.

**Compose with:** `mneme.replay.dump` · `mneme.audit.ledger`

</details>

### `mneme.timetravel.activate`

Freeze the AI agent's view of the repo at a specific git ref (commit hash, tag, branch, or relative ref like 'HEAD~50'). Every subsequent Mneme tool call within this MCP session operates AS IF today were that ref. Use WHEN you want to (a) recreate an incident-response state at a past moment, (b) audit hindsight bias by replaying decisions against frozen context, or (c) walk through the repo as a new engineer would have seen it on day one.

**When to use:** You want every subsequent Mneme call to operate AS IF today were a specific past commit — counterfactual / hindsight analysis.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string",
      "description": "Git ref to freeze at — commit hash, tag, branch, or relative (e.g. 'HEAD~50', 'v1.5.0', 'a3f9b21')."
    }
  },
  "required": [
    "ref"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "active": {
      "type": "boolean"
    },
    "ref": {
      "type": "string"
    },
    "resolvedHash": {
      "type": "string"
    },
    "resolvedDate": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    }
  }
}
```

**Examples:**
- *"Show me what the repo looked like at v1.5.0"*
  - args: `{"ref":"v1.5.0"}`
  - returns: { active: true, ref: 'v1.5.0', resolvedHash, resolvedDate, subject }. Subsequent tool calls that opt-in operate against this frozen ref.
- *"Recreate September 2024 — go back 200 commits"*
  - args: `{"ref":"HEAD~200"}`
  - returns: Same shape — the resolvedDate tells you what calendar date HEAD~200 lands on.

**Pitfalls:**
- v1.18.0 ships the scaffolding — most tools DON'T yet honor the frozen ref. They'll silently use HEAD until each tool opts in over the v1.18 → v1.19 window.
- State is per-MCP-process — restarting the server resets to live HEAD. Don't depend on persistence across server restarts.
- Refs that don't resolve (deleted branches, typos, hashes from another repo) return an error and DO NOT activate.

**Compose with:** `mneme.timetravel.status` · `mneme.timetravel.deactivate`

</details>

### `mneme.timetravel.status`

Report whether time-travel is currently active in this MCP session and, if so, which ref + commit + date the view is frozen at. Use WHEN you want to verify the agent isn't accidentally querying historical state when it expects live HEAD.

**When to use:** You want to check whether the current MCP session has time-travel activated and what ref it's frozen at.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "active": {
      "type": "boolean"
    },
    "ref": {
      "type": "string"
    },
    "resolvedHash": {
      "type": "string"
    },
    "resolvedDate": {
      "type": "string"
    },
    "activatedAt": {
      "type": "string"
    }
  }
}
```

**Examples:**
- *"Am I currently time-traveling?"*
  - returns: Returns { active: false } when not active, or the full state record when active.

**Pitfalls:**
- State is per-MCP-process. If you restart the MCP server, this returns active=false even if a previous session activated time-travel.

**Compose with:** `mneme.timetravel.activate` · `mneme.timetravel.deactivate`

</details>

### `mneme.timetravel.deactivate`

Return the AI agent's view to live HEAD — undoes a previous mneme.timetravel.activate. Idempotent (safe to call when not currently active). Use WHEN you've finished a counterfactual / hindsight session and want subsequent calls to see today's state.

**When to use:** You finished time-traveling and want subsequent tool calls to see live HEAD again.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "previouslyActive": {
      "type": "boolean"
    },
    "previousRef": {
      "type": "string"
    }
  }
}
```

**Examples:**
- *"Return to live HEAD"*
  - returns: { previouslyActive: true|false, previousRef }. Idempotent — safe even when not active.

**Pitfalls:**
- Doesn't unwind any side effects from time-traveled tools — only resets the time-travel marker.

**Compose with:** `mneme.timetravel.activate` · `mneme.timetravel.status`

</details>

### `mneme.smart_do`

Fallback dispatcher — give it a NATURAL-LANGUAGE intent, it routes to the appropriate Mneme command and runs it. Use this WHEN no specific tool from `mneme.capabilities` matches the user's request, or when the user's intent spans multiple commands. Equivalent to running `mneme do '<intent>'` from the CLI. Prefer specific tools when possible — this dispatcher is slower because it runs an additional planning step.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "description": "Natural-language description of what the user wants"
    }
  },
  "required": [
    "intent"
  ]
}
```

</details>

### `mneme.meta.doctor`

Environment probe: hardware, embedder availability (Ollama/OpenAI/HuggingFace), Mneme readiness. Use WHEN user asks: 'is Mneme set up?', 'doctor', 'environment check'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.meta.wisdom`

Pull a short meditation from the Mneme manifesto. Use WHEN user asks: 'wisdom of the day', 'manifesto quote'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "count": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.meta.manifesto`

Read the full Mneme manifesto canon. Use WHEN user asks: 'show the manifesto', 'philosophy of Mneme'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.meta.advanced`

List every Mneme command including hidden phase-2/3/4 ones. Use WHEN user asks: 'list everything', 'all commands including hidden'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

## memory

*Q&A, semantic search, citations — answers grounded in the repo's commit history.*

### `mneme.memory.ask`

Answer a natural-language question about the repo's history and intent. Returns a synthesized verdict with 5-15 cited commits/PRs that justify the answer. Use this WHEN the user asks: 'why does X exist?', 'when did we add Y?', 'what was the reason for Z?', 'how does this work?', or any other curiosity about WHY code looks the way it does.

**When to use:** User asks WHY code exists or WHEN something was added — answers grounded in cited commits, not generated prose.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "Natural-language question"
    },
    "topK": {
      "type": "number",
      "description": "Max cited commits (default 8)"
    }
  },
  "required": [
    "question"
  ]
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string"
    },
    "summary": {
      "type": "string",
      "description": "1-2 sentence synthesized answer."
    },
    "citations": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Commit hashes that justify the answer."
    },
    "results": {
      "type": "array",
      "items": {
        "type": "object"
      },
      "description": "Per-result detail with score + abstract."
    }
  }
}
```

**Examples:**
- *"Why does the auth middleware reject tokens older than 7 days?"*
  - args: `{"question":"Why does the auth middleware reject tokens older than 7 days?","topK":8}`
  - returns: Returns { summary: '...', citations: ['a3f9b21', 'c0e2d5f', ...], results: [...] }. The wisdom field carries the cited verdict; quote it directly to the user.

**Pitfalls:**
- Requires the index to be built — run `mneme index` first or this returns 'no commits found'.
- If citations < 3, the verdict is best-effort. Surface the low confidence to the user instead of overstating.
- Doesn't read CURRENT code — only commits + their diffs. For 'how does this work today' questions, pair with a code-read tool.

**Compose with:** `mneme.memory.why` · `mneme.insights.story` · `mneme.people.who_knows`

</details>

### `mneme.memory.why`

Explain why a specific FILE (or line range within it) exists by combining git blame with related commits. Returns the originating commits ranked by line ownership. Use this WHEN the user asks: 'who wrote this line?', 'why is THIS function here?', 'what introduced src/auth.ts:47?', 'origin of this code'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "description": "Path relative to repo root"
    },
    "startLine": {
      "type": "number",
      "description": "Optional 1-indexed start line"
    },
    "endLine": {
      "type": "number",
      "description": "Optional 1-indexed end line"
    }
  },
  "required": [
    "file"
  ]
}
```

</details>

### `mneme.memory.search_commits`

Hybrid (lexical + semantic) search over indexed commits and PRs. Use this when the user wants to find commits matching a concept, not a specific file. Use this WHEN the user asks: 'find commits about X', 'show me PRs related to Y', 'what work has happened on Z?'. Use mneme.memory.ask instead when the user wants a synthesized answer rather than a list of commits.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Natural-language search query"
    },
    "topK": {
      "type": "number",
      "description": "Max results (default 8)"
    }
  },
  "required": [
    "query"
  ]
}
```

</details>

### `mneme.memory.status`

Report what's indexed in this repo's Mneme memory: total commits, embedded chunks, entities, embedder choice. Use this WHEN the user asks 'is the index up to date?', 'how many commits did Mneme see?', or as a sanity check before an ask/search returns no results.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.memory.list_entities`

List indexed source-code entities (functions, classes, types, exported variables) with optional filtering by language/kind/path-prefix. Use this WHEN the user wants to enumerate symbols in a folder, find all classes, or get an entity ID before calling mneme.memory.find_similar.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "description": "function | class | type | variable | module"
    },
    "language": {
      "type": "string",
      "description": "typescript | tsx | javascript | jsx | python | go | rust | ruby | php"
    },
    "pathPrefix": {
      "type": "string",
      "description": "Only entities under this path"
    },
    "limit": {
      "type": "number",
      "description": "Max rows (default 100, max 500)"
    }
  }
}
```

</details>

### `mneme.memory.find_similar`

Given an entity ID OR a code snippet, return the top-K most semantically similar entities elsewhere in the repo. Use this WHEN the user wants to find duplicate-shaped code, similar functions across files, or candidates to refactor into a shared utility. Provide either entityId (preferred) OR snippet.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "entityId": {
      "type": "string",
      "description": "Existing entity id (from mneme.memory.list_entities)"
    },
    "snippet": {
      "type": "string",
      "description": "Or a code snippet to compare against"
    },
    "topK": {
      "type": "number",
      "description": "Max similar entities (default 5)"
    }
  }
}
```

</details>

### `mneme.memory.blast`

Predict the BLAST RADIUS of shipping a commit: which past incidents share its file footprint, plus a base-rate verdict (LOW / MED / HIGH). Use this WHEN the user asks 'is this commit safe to ship?', 'what could break if I merge this?', 'has my file footprint caused incidents before?'. Pass a commit hash, short hash, or HEAD-relative ref like HEAD~3.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "commit": {
      "type": "string",
      "description": "Commit hash, short hash, or HEAD-relative ref"
    },
    "windowHours": {
      "type": "number",
      "description": "Look-ahead window in hours (default 72)"
    }
  },
  "required": [
    "commit"
  ]
}
```

</details>

## people

*Contributors, knowledge atrophy, telepathic teammates, cultural alphas, semantic ownership.*

### `mneme.people.atrophy`

Knowledge-atrophy clock per (author × area), based on Ebbinghaus forgetting curve over commit recency. Returns a freshness score 0-100 + 'days until forgotten' estimate. Use this WHEN user asks: 'who's forgetting what?', 'is Alice still on top of auth?', 'knowledge half-life', 'expertise decay'. Without --author returns top fading-knowledge per person.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "authorEmail": {
      "type": "string",
      "description": "Optional: focus on a single author's knowledge map"
    },
    "topN": {
      "type": "number",
      "description": "Top N areas (default 10)"
    }
  }
}
```

</details>

### `mneme.people.telepathy`

Find author pairs who NEVER co-author commits but write similar code shapes — invisible teams. Use WHEN user asks: 'invisible teams', 'who collaborates without knowing it?', 'parallel evolution'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.people.nemesis`

Author pairs who consistently rewrite or revert each other's work — engineering friction. Use WHEN user asks: 'where is friction?', 'pairs that need conflict mediation'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.people.influence`

Cultural alphas — PageRank of code-pattern adoption. Identifies authors whose patterns OTHERS copy. Volume-independent: a junior with 3 widely-copied patterns scores higher than a senior who churns 1000 LOC. Use WHEN user asks: 'who shapes the codebase culture?', 'trend-setters', 'cultural leaders'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.people.lineage`

Trace SEMANTIC ownership of a target file/symbol — whose interpretation of whose intent is in this code now? Returns ownership shares + role inference (originator / finisher / refactorer / janitor). Use WHEN user asks: 'who owns this code conceptually?', 'whose vision is in src/auth.ts?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "File path, file:line, or symbol name"
    }
  },
  "required": [
    "target"
  ]
}
```

</details>

### `mneme.people.passport`

Per-engineer dossier composing DNA + expertise + telepathic teammates + influence + atrophy. Use WHEN user asks: 'tell me about Alice', 'profile for alice@', 'one-pager for this engineer'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "authorEmail": {
      "type": "string"
    }
  },
  "required": [
    "authorEmail"
  ]
}
```

</details>

### `mneme.people.who_knows`

Find people most likely to know about a topic, ranked by recent + sustained engagement. Use WHEN user asks: 'who knows about X?', 'expert on payments?', 'point of contact for Y'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topic": {
      "type": "string"
    }
  },
  "required": [
    "topic"
  ]
}
```

</details>

### `mneme.people.bus_factor`

Identify single-point-of-knowledge holders — files where one author owns ≥75%. Use WHEN user asks: 'where's the bus factor?', 'knowledge at risk if X leaves?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.people.nervous_system`

Flagship combined report: passports + telepathy + atrophy + influence + neuroanatomy. Use WHEN user asks: 'team health snapshot', 'big-picture team view', 'export everything for the board'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.people.promise`

Promise-debt ledger — every 'I'll fix this later' / TODO / FIXME from commits + PRs, with author + age. Use WHEN user asks: 'unkept promises', 'TODO debt', 'who has the most stale promises?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "open | stale | kept"
    }
  }
}
```

</details>

## audit

*AI Session Audit — trust certificate for AI commits. Vendor-neutral.*

### `mneme.audit.baseline`

Snapshot the repo's behavior, types, perf, and sample-command outputs BEFORE letting an AI work on it. Stores the snapshot in .mneme/audit-baseline.json for later certify-time comparison. Use this WHEN: user is about to start an AI-driven coding session and wants a 'before' snapshot to grade against.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.audit.trace`

After AI worked: capture the diff + detect WHICH AI tool produced the commit (Claude Code · Cursor · Codex · Devin · ...). Use this WHEN user asks: 'what did the AI just change?', 'which AI tool wrote this commit?', 'show me the AI session trace'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.audit.verify`

Leviathan-style narrative-vs-reality check: does the AI's commit message ACTUALLY match the diff? Catches AI gaslighting (e.g. 'no change to db.ts' but the diff has 3 lines in db.ts). Use this WHEN user asks: 'is the AI lying about its changes?', 'verify the commit narrative', 'AI gaslight check'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.audit.certify`

The flagship: 5-axis trust certificate for an AI commit (behavioral parity · API contract · test pass rate · perf · narrative match). Plus forensic axes (TIME / FILES / STYLE / SIZE). Returns PASS / WARN / FAIL with structured findings. Use this WHEN user asks: 'is this commit safe?', 'grade the AI's homework', 'CI gate the AI commit', 'final trust certificate', 'should I merge this?'.

**When to use:** Final gate before merging an AI-written commit — get a 5-axis trust verdict with structured findings.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "explain": {
      "type": "boolean",
      "description": "Add plain-English narrative summary"
    },
    "strict": {
      "type": "boolean",
      "description": "Treat skipped axes as fail (compliance mode)"
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "verdict": {
      "type": "string",
      "enum": [
        "PASS",
        "WARN",
        "FAIL"
      ]
    },
    "score": {
      "type": "number",
      "description": "Composite score 0-100 across all axes."
    },
    "axes": {
      "type": "object",
      "description": "Per-axis verdicts (behavioral, contract, tests, perf, narrative + forensic axes)."
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object"
      }
    }
  }
}
```

**Examples:**
- *"Should I merge this AI-written commit?"*
  - args: `{"explain":true}`
  - returns: Returns { verdict: 'PASS' | 'WARN' | 'FAIL', score: 0-100, axes: { behavioral, contract, tests, perf, narrative, time, files, style, size }, findings: [...] }. With explain=true, also includes a plain-English narrative.
- *"Strict CI gate for our compliance pipeline"*
  - args: `{"strict":true}`
  - returns: Same as above but ANY skipped axis (e.g., perf if no perf baseline) flips the verdict to FAIL.

**Pitfalls:**
- Requires a baseline snapshot — run mneme.audit.baseline BEFORE the AI starts working, or behavioral/perf axes will be SKIPPED.
- strict=true is recommended for CI; in interactive use, prefer explain=true and read the narrative.
- FAIL verdicts are not vetoes — they're hypotheses. The forensic axes (TIME/FILES/STYLE) can produce false positives on legitimate refactors.

**Compose with:** `mneme.audit.baseline` · `mneme.audit.trace` · `mneme.audit.verify` · `mneme.audit.report` · `mneme.audit.conscience`

</details>

### `mneme.audit.report`

Generate a Markdown audit-trail report (SOX / SOC2 / EU AI Act 2026 compliant) of the most recent AI session. Use this WHEN user asks: 'export audit report', 'compliance trail', 'markdown for the auditor'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "outPath": {
      "type": "string",
      "description": "Where to write the markdown"
    }
  }
}
```

</details>

### `mneme.audit.deps`

Cross-check this repo's dependencies against OSV.dev — known CVEs and GHSA advisories per package. Use this WHEN user asks: 'are our deps safe?', 'CVE scan', 'OSV check', 'security audit of dependencies', 'do we have vulnerable packages?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.audit.conscience`

Risk-score a PR against the repo's own history of regrets, hotfixes, and reverts. Use this WHEN user asks: 'is this PR risky based on history?', 'conscience review of these files', 'historical risk score for the changes'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "File paths to review"
    },
    "dualJury": {
      "type": "boolean",
      "description": "Run with dual-jury (more conservative)"
    }
  }
}
```

</details>

### `mneme.audit.ledger`

Tamper-evident audit log of all AI-driven commits with HMAC + Ed25519 signatures. SOX / SOC2 ready. Use this WHEN user asks: 'show audit log', 'tamper-evident trail', 'all AI sessions in this repo'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "since": {
      "type": "string",
      "description": "ISO date — only entries since"
    }
  }
}
```

</details>

## forensics

*Security: vuln-hunt, anomaly detection, authorship attribution, ENFSI-style verdicts.*

### `mneme.forensics.vulns`

Scan git history for security holes (51 patterns across SQL injection, XSS, hardcoded secrets, XXE, SSRF, auth bypass, CSRF, etc.). Each finding is Bayesian-filtered: posterior = stack-prior × AST-evidence, so non-applicable rules are dropped before they leave the scanner. Use this WHEN user asks: 'find security issues', 'vuln scan', 'CWE check', 'what security holes are hiding?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "top": {
      "type": "number",
      "description": "Top N findings (default 50)"
    },
    "minPosterior": {
      "type": "number",
      "description": "Minimum posterior threshold (default 0.3)"
    }
  }
}
```

</details>

### `mneme.forensics.anomaly`

Insider-threat / credential-compromise detector: flag commits whose timing, file footprint, or style deviates from the author's baseline. Use this WHEN user asks: 'any suspicious commits?', 'insider threat scan', 'is this account compromised?', 'unusual commits'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.forensics.match`

Likelihood-ratio test: 'Did Alice REALLY write this commit?'. Returns ENFSI verbal-scale verdict + LR. Use this WHEN user asks: 'is this commit really by X?', 'verify authorship', 'did Alice write a3f9b21?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "commit": {
      "type": "string",
      "description": "Commit hash or HEAD-relative ref"
    },
    "author": {
      "type": "string",
      "description": "Suspected author email"
    }
  },
  "required": [
    "commit",
    "author"
  ]
}
```

</details>

### `mneme.forensics.attribute`

Rank ALL candidate authors for a commit by stylometric likelihood. Use this WHEN user asks: 'who most likely wrote this?', 'attribute this commit', 'authorship ranking'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "commit": {
      "type": "string",
      "description": "Commit hash or HEAD-relative ref (default HEAD)"
    }
  }
}
```

</details>

### `mneme.forensics.show`

Open a single forensics finding by ID — full context, the line of code, recommended fix. Use this WHEN user wants to dig into a specific finding from `mneme.forensics.vulns`.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Finding ID from vulns scan"
    }
  },
  "required": [
    "id"
  ]
}
```

</details>

### `mneme.forensics.suppress`

Mark a finding as a false positive — won't appear in future scans. Saved to .mneme/suppressions.json. Use this WHEN user has reviewed a finding and confirmed it's not a real issue.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Finding ID"
    },
    "reason": {
      "type": "string",
      "description": "Why this is a false positive"
    }
  },
  "required": [
    "id"
  ]
}
```

</details>

## insights

*Storytelling, regret-mining, prediction (oracle / premortem / time-machine).*

### `mneme.insights.ghost`

Half-finished features and stale TODOs haunting the repo — files born and forgotten. Use WHEN user asks: 'what is haunting my repo?', 'ghost code', 'half-finished features'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.insights.regret`

Commits that were shipped and immediately fixed/reverted — instant-regret detector. Use WHEN user asks: 'what did we ship and regret?', 'recent reverts/hotfixes'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "windowDays": {
      "type": "number"
    }
  }
}
```

</details>

### `mneme.insights.paradox`

Architectural flip-flops — A→B→A decisions over time. Use WHEN user asks: 'have we changed our minds repeatedly?', 'architectural paradoxes'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.oracle`

Predict next-window co-edits + author collisions on the same file. Use WHEN user asks: 'who will edit X next?', 'predict collisions'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.premortem`

Predict regret risk for a proposed change, grounded in similar past attempts. Use WHEN user asks: 'will this be regretted?', 'risk of doing X', 'pre-mortem'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "description": "Proposed change in plain English"
    }
  },
  "required": [
    "intent"
  ]
}
```

</details>

### `mneme.insights.time_machine`

Tell a file's life as eras: birth → rewrite → firefight → plateau → evolution. Use WHEN user asks: 'tell me the story of this file', 'evolution of src/auth.ts'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string"
    }
  },
  "required": [
    "file"
  ]
}
```

</details>

### `mneme.insights.story`

Narrate the evolution of a topic across acts (with optional LLM polish). Use WHEN user asks: 'how did X evolve?', 'history of payments'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topic": {
      "type": "string"
    }
  },
  "required": [
    "topic"
  ]
}
```

</details>

### `mneme.insights.decisions`

Auto-extract architectural decisions (ADRs) from commit history. Use WHEN user asks: 'list our ADRs', 'architectural decisions'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.mirror`

Onboarding dossier on a topic: 5 PRs, 3 people, 2 incidents. Use WHEN user asks: 'onboard me on payments', 'mirror for new hire on X'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topic": {
      "type": "string"
    }
  },
  "required": [
    "topic"
  ]
}
```

</details>

### `mneme.insights.rumor`

Tribal phrases mentioned in commits/PRs but never documented. Use WHEN user asks: 'what slang does our team use?', 'undocumented terms'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.fossil`

Files deleted from HEAD but still alive in git history. Use WHEN user asks: 'show deleted files', 'ghost code from history'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.runaway`

Files growing silently across many commits — leak indicator. Use WHEN user asks: 'files growing silently', 'scope creep'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.drift`

Topical drift — features → refactors → firefights → polish over time. Use WHEN user asks: 'what's our work pattern?', 'topical drift'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.chronicle`

Auto-generate a chaptered narrative documentary of the whole repo. Use WHEN user asks: 'documentary of our repo', 'chronicle'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.constellation`

Graph view: files as stars, authors as orbitals, commits as edges. Use WHEN user asks: 'visualize our repo', 'star map'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.cluster`

Find topic islands — semantic clustering of commit messages. Use WHEN user asks: 'group commits by topic', 'topic clusters'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.network`

Author network — who collaborates with whom (co-edit + co-time + co-topic). Use WHEN user asks: 'collaboration graph', 'who works with whom'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.manage`

Engineering management dashboard — health, succession, skill matrix, trajectory. Use WHEN user asks: 'manager dashboard', 'team health for VP'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.export_bundle`

One bundle: DNA + drift + chronicle + oracle + constellation + clusters + network + manage + ghost. Use WHEN user asks: 'export everything', 'full repo bundle'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.dream`

Speculative ideas grounded in the codebase's own patterns. Use WHEN user asks: 'what should we build next?', 'speculative ideas'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.echo`

Find past incidents resembling the current one. Use WHEN user asks: 'has this happened before?', 'similar past incidents'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    }
  }
}
```

</details>

### `mneme.insights.stack_trace`

Paste a stack trace, get historical context per frame. Use WHEN user asks: 'explain this stack trace', 'historical context for error'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "from": {
      "type": "string",
      "description": "Path to error log"
    }
  }
}
```

</details>

### `mneme.insights.commit_coach`

Pre-commit AI partner — message, reviewers, scope, past warnings. Use WHEN user asks: 'review my staged commit', 'commit coach'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.insights.crystal_ball`

Predict CI / follow-up failure probability before pushing. Use WHEN user asks: 'will CI fail?', 'crystal ball'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

## quality

*Code/repo health, palimpsest causal chains, cognitive twin, voice fingerprints.*

### `mneme.quality.karma`

TODO/FIXME debt as an accumulating ledger — who owns the oldest unkept promises. Use WHEN user asks: 'TODO debt by author', 'who has the most karma debt?', 'unkept promise ledger'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number"
    },
    "authorEmail": {
      "type": "string"
    }
  }
}
```

</details>

### `mneme.quality.repo_mri`

20-axis health diagnostic — the codebase MRI. Highlights outliers vs medians for similar-size OSS repos. Use WHEN user asks: 'how healthy is this repo?', 'MRI scan', 'where are we abnormal?'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.heartbeat`

Today's pulse vs the rolling 7-day baseline. Anomalies above 2σ flagged. Use WHEN user asks: 'pulse check', 'anomalies today', 'health drift'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.cognitive_twin`

Author voice fingerprint + optional commit-subject rewriter in their style. Use WHEN user asks: 'rewrite this in Alice's voice', 'author voice profile'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "authorEmail": {
      "type": "string"
    },
    "rewrite": {
      "type": "string",
      "description": "Generic subject to rewrite in author's voice"
    }
  },
  "required": [
    "authorEmail"
  ]
}
```

</details>

### `mneme.quality.counterfactual`

Shadow projection: 'What if this person hadn't been here?' — purely speculative, ethics-framed. Use WHEN user asks: 'impact analysis if X left'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "authorEmail": {
      "type": "string"
    }
  },
  "required": [
    "authorEmail"
  ]
}
```

</details>

### `mneme.quality.palimpsest`

Render the causal chain of a single line of code — every prior author + reason. Use WHEN user asks: 'palimpsest of src/x.ts:42', 'causal chain of this line'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "file:line"
    },
    "counterfactual": {
      "type": "boolean"
    }
  },
  "required": [
    "target"
  ]
}
```

</details>

### `mneme.quality.dna`

Extract a contributor's portable fingerprint (style, hours, file affinity). Use WHEN user asks: 'engineering DNA of Alice', 'fingerprint of this contributor'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "authorEmail": {
      "type": "string"
    }
  }
}
```

</details>

### `mneme.quality.dna_fold`

Stylometric folding — group authors by writing style only (no commit metadata). Use WHEN user asks: 'cluster by writing style', 'DNA-fold groups'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.rewind`

Replay history up to that ref — frozen view of the past at any commit. Use WHEN user asks: 'what did the repo look like at v0.5?', 'rewind to ref'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string"
    }
  },
  "required": [
    "ref"
  ]
}
```

</details>

### `mneme.quality.teach`

Explain a folder/file in plain language (layer classification + LLM summary). Use WHEN user asks: 'explain src/auth/', 'teach me this folder'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string"
    }
  },
  "required": [
    "target"
  ]
}
```

</details>

### `mneme.quality.heal`

Synthesize WHY notes for commits with poor messages — turns bad history into searchable memory. Use WHEN user asks: 'fix commit messages', 'heal bad history'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.entities`

Parse + embed every function/class/type/exported variable in tracked TS/JS files. Use WHEN user asks: 'index entities', 'embed all functions'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.clones`

Find semantic clones — functions doing the same thing under different names. Use WHEN user asks: 'find duplicate code', 'semantic clones'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.quality.guardian`

Trigger a single Guardian sweep — diagnose weaknesses + auto-fix safe items. Use WHEN user asks: 'guardian sweep', 'auto-heal repo'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

## quant

*Engineering analysis borrowed from Wall Street — drawdown, alpha, Greeks, moneyball.*

### `mneme.quant.drawdown`

Find the worst losing streaks in the repo's history — periods when the team spent more time fixing regressions than shipping features. Returns the deepest valleys (most consecutive 'putting-out-fires' commits) with start/end dates and what the team was firefighting. Use WHEN the user asks 'when were our worst weeks?' or wants to understand historical incident clusters.

**When to use:** User wants to identify historical periods of pure firefighting / regression-fixing — useful for postmortems and capacity planning.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"When were our worst firefighting weeks?"*
  - returns: Returns the top 3-5 drawdown periods with: startDate, endDate, durationDays, dominantTopic (e.g., 'auth bugs'), and recoveredAt commit hash.

**Pitfalls:**
- Heuristic: depends on commit-message tone (revert/hotfix/fix words). A team that always says 'patch' or 'tweak' will be under-counted.
- Doesn't account for incident severity — a 1-day P0 firedrill won't show up if commit count is small.

**Compose with:** `mneme.insights.regret` · `mneme.insights.premortem`

**Jargon:**
- **drawdown** — Borrowed from finance — the size of the largest peak-to-valley drop in a portfolio. Here: the longest stretch of pure remediation work between two productive peaks.

</details>

### `mneme.quant.alpha`

Per-author 'alpha' score — risk-adjusted impact-per-unit-effort. Measures which contributors deliver disproportionate value relative to commit count (e.g., a small fix that prevents a class of regressions counts MORE than 1000 lines of routine refactor). Use WHEN the user asks 'who delivers the most leverage?' or wants to challenge a 'most LOC = best engineer' assumption.

**When to use:** User wants to identify high-leverage contributors who deliver outsized impact relative to commit volume.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "string",
      "description": "Optional JSON file path with tech-debt scope items for Kelly-criterion allocation."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Who on the team delivers the most leverage per commit?"*
  - args: `{"items":".mneme/tech-debt.json"}`
  - returns: Returns each author with alpha (real impact - commit-count baseline), risk-adjusted alpha (alpha / volatility), and rank.

**Pitfalls:**
- Requires `items` (a JSON of tech-debt scope items) for the Kelly allocation portion — alpha-per-author works without it.
- Doesn't capture invisible work (mentoring, code review, design docs) — those don't show up in commits.

**Compose with:** `mneme.people.influence` · `mneme.quant.moneyball`

**Jargon:**
- **alpha** — Wall Street: returns earned ABOVE the market baseline — i.e., skill, not just exposure. Here: an author's impact relative to what their commit volume alone would predict.
- **Kelly criterion** — A betting formula that sizes positions optimally given win probability + payoff. We use it to allocate 'effort budget' across tech-debt items based on each item's regret-history-derived expected payoff.

</details>

### `mneme.quant.backtest`

Validate any binary predictor (e.g., 'commits with > 5 reverts ⇒ regression') against historical outcomes. Returns precision / recall / F1 / Brier score / calibration curve so you can tell whether a heuristic actually predicts what it claims, or just pattern-matches noise. Use WHEN the user wants to validate a metric or rule before depending on it in CI.

**When to use:** User has a 'commits with property X tend to be problematic' hypothesis and wants to test it against the repo's actual outcomes.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "samples": {
      "type": "string",
      "description": "JSON file path with labeled historical samples (predicted vs actual)."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Does the 'files touching auth + payments in same commit ⇒ risky' rule actually work?"*
  - args: `{"samples":".mneme/predictor-samples.json"}`
  - returns: Returns precision, recall, F1, Brier score, and a confusion matrix on historical labeled commits.

**Pitfalls:**
- Garbage-in, garbage-out — your samples file must label historical outcomes correctly, otherwise the score reflects label noise.
- Doesn't extrapolate — a predictor that worked on the last 6 months may not work on the next 6 months.

**Compose with:** `mneme.insights.premortem` · `mneme.audit.conscience`

**Jargon:**
- **backtest** — Trading-system validation: replay a strategy through historical data to see how it would have performed. Here: replay a heuristic through past commits to measure its accuracy.
- **Brier score** — A calibration metric for probabilistic predictions — measures how close 0.7 confidence is to actually being right 70% of the time. Lower is better.

</details>

### `mneme.quant.black_swan`

Tail-risk scan — identify rare-but-catastrophic patterns in the repo (e.g., a single file that, when broken, has historically caused 10× the incident response of any other). Returns files ranked by tail-risk weight (probability × impact). Use WHEN the user asks 'what could blow up?' or wants the inverse-of-routine risk view.

**When to use:** User wants to find rare but catastrophic risk hotspots — files / areas where past failures had outsized blast radius.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"What files in our repo are most likely to cause a major incident if they break?"*
  - returns: Top 5-10 files ranked by tail-risk score: each with past-incident count, average blast radius (files affected per incident), and recovery time.

**Pitfalls:**
- Past behavior ≠ future risk. A new feature module won't appear in tail-risk results no matter how risky it actually is.
- Bias toward old, frequently-touched files — newly-rewritten modules look 'safe' until they aren't.

**Compose with:** `mneme.audit.conscience` · `mneme.insights.premortem`

**Jargon:**
- **black swan** — Nassim Taleb's term for a rare event that's nearly impossible to predict but has massive impact. Here: a file/area whose past failures had blast radius far above the median.
- **tail risk** — Risk concentrated in the unlikely-but-extreme outcomes (the 'tails' of a distribution), as opposed to the common-case middle.

</details>

### `mneme.quant.insider_trading`

Detect authors who repeatedly fix bugs they introduced themselves — the 'creating their own work' anti-pattern. Returns each author with: bugs introduced, bugs they personally fixed, and the ratio (high = self-correcting, very high = possibly intentional churn). Use WHEN the user asks about engineering quality or wants to flag busy-but-not-productive contributors.

**When to use:** User wants to identify authors with a high self-introduced-bug-fix ratio (often a sign of rushed shipping or unclear specs).

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Is anyone on the team mostly fixing bugs they introduced?"*
  - returns: Returns each author with: bugsIntroduced, bugsFixed, selfFixRatio (selfBugsFixed / bugsIntroduced), and recentExamples (commit pairs).

**Pitfalls:**
- A high ratio isn't always bad — senior engineers fix their own subtle bugs faster than junior ones could. Read in context.
- Depends on linking 'introduce' commit ↔ 'fix' commit, which uses heuristic overlap (file + nearby lines + temporal proximity). False positives possible.

**Compose with:** `mneme.people.atrophy` · `mneme.insights.regret`

**Jargon:**
- **insider trading** — Wall Street: profiting from non-public knowledge of one's own actions. Here (re-purposed metaphor): an author 'profits' from their own future bugs by fixing what they introduced — busy work that LOOKS productive.

</details>

### `mneme.quant.moneyball`

Surface undervalued contributors — high impact, low LOC volume. The opposite of LOC-counting culture: returns engineers whose small surgical changes prevent regressions, fix root causes, or improve architecture per-commit far more than the team median. Use WHEN the user asks 'who is undervalued?' or wants promotion / retention candidates not visible in commit volume.

**When to use:** User wants to identify low-LOC, high-impact contributors hidden by volume-based metrics — promotion / retention signal.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "topN": {
      "type": "number",
      "description": "How many candidates to return. Default 10."
    }
  }
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Who on the team delivers the most value but writes the fewest lines?"*
  - args: `{"topN":5}`
  - returns: Returns top-5 'moneyball' authors with: impactScore, locTotal, impactPerLoc ratio, signature contributions (commit hashes).

**Pitfalls:**
- Impact is heuristic — derived from regret avoidance, file criticality, and commit reach. Not the ground truth on engineering value.
- Underweights work that's high-volume by necessity (e.g., test infrastructure, refactors).

**Compose with:** `mneme.people.influence` · `mneme.quant.alpha`

**Jargon:**
- **moneyball** — From Michael Lewis's book about the Oakland A's baseball team finding undervalued players via stats nobody else looked at. Here: finding engineers whose value isn't captured by LOC or commit count.

</details>

### `mneme.quant.greek`

Codebase 'Greeks' (Δ delta, Γ gamma, Θ theta) — sensitivity analysis across files. Δ = how much each file 'moves' (changes) per unit time. Γ = how the rate of change is changing (acceleration). Θ = decay — how fast knowledge ages out. Use WHEN the user wants to understand WHICH parts of the codebase are stable, accelerating, or atrophying.

**When to use:** User wants per-file sensitivity metrics: which files are changing fast, accelerating, or atrophying.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Which files are changing fastest right now and which are atrophying?"*
  - returns: Returns per-file: delta (commits/week), gamma (acceleration), theta (knowledge half-life in weeks). Sortable by any.

**Pitfalls:**
- Greeks are MOMENTUM indicators — they tell you direction, not whether the change is good or bad.
- Theta uses a default 90-day half-life; configurable per repo via .mneme/config.

**Compose with:** `mneme.people.atrophy` · `mneme.quant.implied_volatility`

**Jargon:**
- **delta** — Options trading: Δ = how much an option's price moves per $1 move in the underlying. Here: how much a file changes per unit time (commits/week or LOC/week).
- **gamma** — Options trading: Γ = the RATE at which Δ changes — second-derivative sensitivity. Here: file-change acceleration. Positive Γ = a file getting noisier; negative Γ = settling down.
- **theta** — Options trading: Θ = time-decay — how much value an option loses per day, all else equal. Here: knowledge atrophy — how fast a file's expertise ages out (Ebbinghaus curve).

</details>

### `mneme.quant.correlation_matrix`

Find hidden BEHAVIORAL coupling between files — pairs that tend to change together even though they have no static dependency (no import, no shared type). Returns a ranked list of file pairs with co-change frequency + correlation strength. Use WHEN the user wants to find architectural debt static analysis can't see.

**When to use:** User wants to find file pairs that move together in commits despite having no compile-time dependency — hidden coupling.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"Which files in our repo always seem to change together?"*
  - returns: Top file pairs by correlation: { fileA, fileB, coChangeCount, correlation (0-1), staticallyDependent: boolean }.

**Pitfalls:**
- Correlation isn't causation — two files may co-change because of a 3rd file (e.g., they both depend on a shared schema).
- Sensitive to commit granularity — repos that batch many concerns per commit will have inflated correlations.

**Compose with:** `mneme.insights.cluster` · `mneme.insights.network`

**Jargon:**
- **correlation matrix** — Statistics: a table of pairwise correlations between variables. Here: between files, where 'observation' = 'commit'. High correlation between files A and B = they tend to change in the same commit.

</details>

### `mneme.quant.implied_volatility`

Estimate project chaos from commit-message TONE (urgency words, frustration words, 'temp / hack / fixme' frequency). Returns a daily volatility series — high = stressful periods (firefighting / deadline crunch), low = calm flow. Use WHEN the user wants a leading indicator of team stress that doesn't depend on incident reports.

**When to use:** User wants a tone-derived stress signal independent of incident tickets — daily volatility from commit messages.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"When was our team most stressed based on how we wrote commits?"*
  - returns: Returns a daily series: { date, volatility (0-1), topUrgencyWords, sampleCommitSubject } with peaks and rolling 7-day average.

**Pitfalls:**
- Tone-based — sarcasm, dry humor, and culture-specific phrasing can fool it.
- Lags the actual stressful event by 1-3 days (people commit AFTER firefighting, not during).

**Compose with:** `mneme.quant.drawdown` · `mneme.quality.heartbeat`

**Jargon:**
- **implied volatility** — Options trading: market's forward-looking estimate of how much a price will move, derived from option prices. Here: forward-looking chaos estimate derived from how the team is TALKING in commits, not what they're shipping.

</details>

### `mneme.quant.tax_loss_harvest`

Surface dead-code candidates — code that hasn't been touched in N months, is reachable but never imported, or whose tests don't actually exercise it. Returns deletion candidates ranked by 'safe-to-delete' confidence + estimated LOC savings. Use WHEN the user asks 'what can we delete?' or wants to offset technical debt by removing surface area.

**When to use:** User wants concrete dead-code deletion candidates with safety ratings — to reduce surface area / pay down debt.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**
```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "description": "CLI passthrough — see the named CLI command for the exact shape."
    }
  }
}
```

**Examples:**
- *"What chunks of our codebase can we safely delete?"*
  - returns: Top deletion candidates: { path, lastTouched, importedBy, testedBy, safeDeleteScore (0-1), locSaved }.

**Pitfalls:**
- 'Reachable but never imported' is heuristic — dynamic imports, plugin systems, and runtime reflection can fool it.
- Always run the test suite + grep for path strings before deleting; the safeDeleteScore is a recommendation, not a guarantee.

**Compose with:** `mneme.insights.fossil` · `mneme.insights.runaway`

**Jargon:**
- **tax loss harvesting** — Investing: deliberately selling losing positions to offset capital gains tax. Here (re-purposed): deliberately deleting dead/legacy code to offset 'cognitive tax' of carrying it.

</details>

## lab

*Periodic Table + Second Brain + Wisdom Mutant — compose recipes, save plans, recalibrate.*

### `mneme.lab.periodic_table`

Browse Mneme's compositional layers — elements (primitives), atoms (parameterized), molecules (commands), compounds. Use WHEN user asks: 'what primitives does Mneme have?', 'show the periodic table', 'compose new tools'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Optional primitive id to focus"
    },
    "kind": {
      "type": "string",
      "description": "element | atom | molecule | compound"
    },
    "tag": {
      "type": "string"
    }
  }
}
```

</details>

### `mneme.lab.compose`

Translate natural-language intent into a runnable molecule plan from the periodic table. Use WHEN user asks: 'compose a workflow for X', 'plan steps to do Y'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "description": "Natural-language goal"
    },
    "execute": {
      "type": "boolean",
      "description": "Run the plan after composing"
    }
  },
  "required": [
    "intent"
  ]
}
```

</details>

### `mneme.lab.run`

Run a saved molecule plan by alias or id. Use WHEN user asks: 'run X recipe', 'execute saved plan'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "needle": {
      "type": "string",
      "description": "Alias or id of the recipe"
    },
    "execute": {
      "type": "boolean",
      "description": "Actually run (default dry-run)"
    }
  },
  "required": [
    "needle"
  ]
}
```

</details>

### `mneme.lab.library`

List/manage saved molecule recipes. Use WHEN user asks: 'show saved recipes', 'promote a recipe', 'forget recipe'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "promote": {
      "type": "string"
    },
    "alias": {
      "type": "string"
    },
    "eligible": {
      "type": "boolean"
    },
    "archived": {
      "type": "boolean"
    },
    "forget": {
      "type": "string"
    }
  }
}
```

</details>

### `mneme.lab.adapt`

Mneme inspects this repo and recommends 1-3 next commands. Use WHEN user asks: 'what should I run next?', 'recommend commands for me'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.lab.feedback`

Tell Mneme an answer was helpful (up) or wrong (down) — feeds the Wisdom Mutant calibrator. Use WHEN user gives feedback on a previous answer.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Answer id from a previous call"
    },
    "vote": {
      "type": "string",
      "description": "up | down"
    }
  },
  "required": [
    "id",
    "vote"
  ]
}
```

</details>

### `mneme.lab.calibrate`

Re-tune search knobs against accumulated feedback. Use WHEN user asks: 'recalibrate Mneme', 're-tune search'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

### `mneme.lab.htc_stats`

Coverage + compression ratio of HTC (hierarchical compressed memory) — how much of the repo is summarised. Use WHEN user asks: 'HTC coverage', 'compression stats'.

<details><summary>Contract</summary>

**Input schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

</details>

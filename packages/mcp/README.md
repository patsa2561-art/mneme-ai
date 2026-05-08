# @mneme-ai/mcp

MCP server that exposes [Mneme](https://github.com/patsa2561-art/mneme-ai) to AI clients
(Claude Code, Cursor, Continue, Codex CLI, Cline, Zed, Aider, or any MCP-aware client).

You normally don't import this directly — the `mneme-ai` CLI exposes it via:

```bash
mneme mcp --install    # auto-detects + wires up Claude Code / Cursor / Continue / etc.
mneme mcp              # start server on stdio
```

## What's in this server (v1.18.0)

**131+ MCP tools across 9 categories**, plus full
[MCP-spec-2025-06-18](https://modelcontextprotocol.io) primitive support
(tools, resources, prompts, completion). The complete catalog is in
[`MCP_TOOLS.md`](https://github.com/patsa2561-art/mneme-ai/blob/main/MCP_TOOLS.md)
(auto-generated from the registry).

### Categories

- **memory** — Q&A, semantic search, citations grounded in commit history
- **people** — atrophy, telepathy, influence, lineage, passport
- **audit** — 5-axis trust certificate for AI commits + tamper-evident ledger
- **forensics** — vuln scan, anomaly, ENFSI authorship attribution
- **insights** — story, regret, premortem, oracle, time-machine, chronicle
- **quality** — repo MRI, cognitive twin, palimpsest, voice fingerprint
- **quant** — drawdown, alpha, Greeks, moneyball, black-swan _(every term has an inline jargon dictionary in v1.18)_
- **lab** — periodic table, library, compose, run, calibrate
- **meta** — discovery (capabilities / help / contract / lint / whats_new)

### v1.18.0 firsts (no other MCP server has these)

| Feature | Tool(s) | What it does |
|---|---|---|
| **Tool Contract Schema** | (every tool) | 6-field contract: WHEN, INPUT, OUTPUT, EXAMPLES, PITFALLS, COMPOSE_WITH, JARGON. |
| **Catalog drift detector** | `mneme.whats_new` | Pass your last-seen hash → get adds / removes / changes. |
| **Sub-50ms tool matcher** | `mneme.help` | Free-text → top-5 tools without LLM. |
| **Self-validating contracts** | `mneme.tool.lint` | Every tool scored 0-100 on contract quality. |
| **Mneme Court** | `mneme.adversary.cross_examine` | Red-team your own AI claims against repo history. |
| **Truth Confession** | `mneme.confess` | Per-AI-vendor lifetime trust scoreboard. |
| **HMAC replay log** | `mneme.replay.dump` / `.fingerprint` | SOC2-grade tamper-evident session trace. |
| **Time-travel MCP** | `mneme.timetravel.activate` | Freeze repo view at a past commit for hindsight analysis. |
| **Genome Marketplace** | `mneme.genome.publish` / `.install` | Pack & share team conventions across repos. |
| **MCP Mesh** | `mneme.mesh.peers` / `.federate` | Cross-repo federation (scaffolding in 1.18, transport in 1.19). |
| **ALETHEIA security** | `mneme.aletheia.*` | Open MCP security framework — see [ALETHEIA.md](https://github.com/patsa2561-art/mneme-ai/blob/main/ALETHEIA.md). |

### MCP primitives exposed

- **tools** ✓ — 115+
- **resources** ✓ — `mneme://catalog`, `mneme://catalog/{cat}`, `mneme://constitution`, `mneme://aletheia/karma`, `mneme://passport/{email}`
- **prompts** ✓ — `/refactor-safety`, `/incident-postmortem`, `/onboarding-pack`, `/code-review-with-history`
- **completion** ✓ — tab-complete tool names, categories, and arg enums
- **logging** ✓ — wired
- **sampling** — coming v1.19 (reverse-MCP for chronicle / story polish)
- **roots** — coming v1.19 (multi-repo workspaces)
- **elicitation** — coming v1.19 (disambiguation prompts)

## How to discover what's available (for AI agents)

When you connect to Mneme, call **in this order**:

1. `mneme.capabilities` — full syllabus + WHEN-to-use guidance per tool
2. `mneme.whats_new(lastSeenHash)` — diff vs your last session (or pass `unknown` on first connect)
3. `mneme.help(query)` — fast top-5 matcher when you're not sure which tool fits
4. `mneme.tool.contract(name)` — full 6-field contract for any specific tool

Every tool response carries a `secondBrain` field that suggests next-step
molecules — read it on every call to compose richer answers.

## Client config

```json
{
  "mcpServers": {
    "mneme": {
      "command": "npx",
      "args": ["-y", "mneme-ai", "mcp"],
      "cwd": "/abs/path/to/your/repo"
    }
  }
}
```

Or run `mneme mcp --install` and Mneme writes the config for whichever
clients you have installed.

## License

MIT.

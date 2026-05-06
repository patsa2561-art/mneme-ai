# Privacy & Security

> Mneme is **local-first by design**. Your code never leaves your machine unless you explicitly enable a cloud LLM. Even then, only commit text + PR/issue text is sent — never source code.

═══════════════════════════════════════════════════════════════════════════════

## In 60 seconds

| Concern | Default behavior |
|---|---|
| 📂 Where does my code go? | **Nowhere.** SQLite stays in `.mneme/` *(gitignored)*. |
| 🤖 LLM calls? | **Off by default.** Opt in with Ollama *(local)* or OpenAI *(your key)*. |
| 🔑 Secrets in commits? | **Auto-redacted** before indexing — 12 built-in patterns. |
| 📡 Telemetry? | **Zero.** No phone home. No analytics. No accounts. |
| 📜 Tamper-evident audit log? | `mneme ledger --since 2025-01-01` *(SOX/SOC2-friendly)* |

═══════════════════════════════════════════════════════════════════════════════

## Where everything lives

```
your-repo/
├── .mneme/              ← gitignored automatically by `mneme init`
│   ├── memory.db        ← SQLite index (commits, PRs, blame, embeddings)
│   ├── config.json      ← per-repo Mneme settings
│   └── ledger.jsonl     ← tamper-evident audit log
└── (your code)          ← untouched
```

`.mneme/` never leaves the machine. Mneme has no remote storage and no cloud sync.

═══════════════════════════════════════════════════════════════════════════════

## Secret redaction (12 patterns)

Before any commit text or diff is indexed, Mneme runs a redactor over it. Detected patterns are replaced with `[REDACTED:<kind>]` markers. Patterns covered:

- **Cloud:** AWS access keys, AWS secret keys
- **Tokens:** GitHub Personal Access Tokens (classic + fine-grained), GitLab tokens
- **Auth:** JWT bearer tokens, OAuth client secrets
- **Payments:** Stripe live/test secret keys
- **Comms:** Slack webhook URLs, Slack bot tokens
- **Database:** Postgres / MySQL connection strings with passwords
- **Generic:** API keys matching `[a-z]+_[a-zA-Z0-9]{32,}` style

You can extend redaction with custom regex via `.mneme/config.json` → `redaction.extraPatterns`.

> 💡 If you find a secret pattern that *isn't* caught, please file an issue. Redaction is a moving target, and your repo's particular flavor of secrets may need a new rule.

═══════════════════════════════════════════════════════════════════════════════

## LLM data flow — what gets sent where

| Mode | What is sent | Where |
|---|---|---|
| `--no-llm` | Nothing | Local-only (extractive answers) |
| Ollama | Commit subjects, PR titles, body excerpts | localhost:11434 *(your machine)* |
| OpenAI | Commit subjects, PR titles, body excerpts | OpenAI API *(via your key)* |

**Source code is never sent to an LLM.** Only the indexed text (commit subjects, PR/issue text, file paths) gets included in prompts. The actual *contents* of files stay on disk.

═══════════════════════════════════════════════════════════════════════════════

## Audit-grade for compliance

Two features pair well for compliance review:

### 1. Tamper-evident ledger

```bash
mneme ledger --since 2025-01-01
```

Every Mneme query is appended to `.mneme/ledger.jsonl` with a hash chain. Tampering with any line invalidates every line that follows. Useful for:

- **SOX/SOC2** evidence — *"who asked what, when?"*
- **Internal audit** — point at the ledger to prove answer provenance
- **Incident retrospective** — pair with `mneme correlate` to align Mneme queries with timeline of an incident

### 2. Audit-grade Q&A

```bash
mneme ask --audit "is this safe to merge?"
```

In audit mode, Mneme refuses below confidence floor *and* refuses if any cited commit hash isn't in the retrieved evidence. The CLI returns a `trustScore 0–100%` with every answer.

═══════════════════════════════════════════════════════════════════════════════

## Network calls — the complete list

By default, Mneme makes **zero outbound HTTP calls**.

The exceptions, all opt-in:

| Trigger | Endpoint | Purpose |
|---|---|---|
| `mneme init` (one-time, opt-out via `--skip-probe`) | `localhost:11434` | Detect Ollama |
| Embedding via Ollama | `localhost:11434/api/embeddings` | Local-only |
| Embedding via OpenAI | `api.openai.com/v1/embeddings` | Your API key |
| LLM synthesis via OpenAI | `api.openai.com/v1/chat/completions` | Your API key |
| `mneme correlate --source pager` | Sentry/Datadog/PagerDuty | Your API key |

There is **no telemetry endpoint**, **no usage analytics**, **no error reporting**. The project does not learn from you.

═══════════════════════════════════════════════════════════════════════════════

## Threat model — quick summary

The full threat model lives in [docs/SECURITY.md](https://github.com/patsa2561-art/mneme-ai/blob/main/docs/SECURITY.md). The short version:

| Threat | Mitigation |
|---|---|
| Secret leakage via LLM | Redaction pre-index + opt-in cloud LLM |
| Index tampering | Schema-versioned migrations + ledger |
| Supply chain | MIT license, signed releases, SBOM in release pipeline |
| Side-channel via embeddings | Local Ollama option (zero cloud calls) |
| Cross-repo leakage | Each repo has its own `.mneme/` — no global store |

═══════════════════════════════════════════════════════════════════════════════

## See also

- 🏗 [ARCHITECTURE.md](https://github.com/patsa2561-art/mneme-ai/blob/main/ARCHITECTURE.md) — full architecture deep-dive
- 🔒 [docs/SECURITY.md](https://github.com/patsa2561-art/mneme-ai/blob/main/docs/SECURITY.md) — full threat model + reporting policy
- 📜 [docs/PRIVACY.md](https://github.com/patsa2561-art/mneme-ai/blob/main/docs/PRIVACY.md) — full privacy policy
- ❓ [[FAQ]] · [[Troubleshooting]]

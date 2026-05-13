# 👥 Who is this for

5 audiences. Each gets the same engine, used differently.

---

## 🧑‍💻 Solo dev / vibe coder using AI tools

You ship features fast with Claude Code or Cursor. But sometimes the AI **hallucinates a function that doesn't exist**, or invents a "fix" for a bug whose real cause is in a 2-year-old commit.

**Mneme bolts on and teaches your AI _your_ repo's truth.** Less hallucination, more grounded answers, citations everywhere.

✨ **v1.19+** — close your laptop, open Cursor on a different machine: your AI agent **inherits the context** automatically (MneMeiosis Lineage syncs via your repo's git remote — zero setup).

→ Quick install. Just talk to your AI.

---

## 👥 Developer team — multiple engineers, multiple AIs, one repo

You're 3-15 engineers. Half use Claude Code, half use Cursor or Codex. Without Mneme, every AI session starts from zero — no shared learning.

**Mneme gives the WHOLE team a shared brain:**

- 🧬 **Cross-AI pedigree** — `mneme.lineage.routing_hint(query)` recommends the AI tool with the strongest track record on _your_ repo.
- 🤝 **Genome Marketplace** — `mneme.genome.publish` packs your team's accumulated wisdom into a portable file. Onboarding = `mneme.genome.install` → 6 months of team learning on day one.
- 📼 **HMAC-chained audit log** — every AI tool call by every team member is tamper-evident.
- 🛡 **ALETHEIA immune system** — shared anomaly detection + per-tool karma ledger.

→ See [`MNEMEIOSIS.md`](../MNEMEIOSIS.md) for the inheritance protocol.

---

## 🧑‍🔬 Engineering team lead — running PR reviews + onboarding

You need to know **who knows what**, who's overloaded, what's a regression risk, and which AI commits to trust.

| Tool | What it answers |
|---|---|
| `mneme.audit.certify` | 5-axis CI gate for every AI-written commit (PASS/WARN/FAIL) |
| `mneme.people.passport` | Per-engineer dossier (DNA + expertise + telepathy + influence + atrophy) |
| `mneme.people.atrophy` | Knowledge half-life — who's about to forget what |
| `mneme.insights.premortem` | Regret prediction grounded in the repo's own incident history |
| `mneme.lineage.pedigree` | Cross-AI family tree — which AI vendor shipped which molecule |

→ [AI-Session-Audit wiki](https://github.com/patsa2561-art/mneme-ai/wiki/AI-Session-Audit) · [People-Analytics wiki](https://github.com/patsa2561-art/mneme-ai/wiki/People-Analytics)

---

## 🛡 Security / compliance — EU AI Act 2026, SOX, SOC2

You need a **tamper-evident audit trail** of every AI-driven commit, with cryptographic signatures (HMAC + Ed25519), QSAC trust certificates, and 8-of-8 EU AI Act clause coverage.

| Tool | What it gives you |
|---|---|
| `mneme.audit.report` | Compliance-ready Markdown export |
| `mneme.audit.ledger` | HMAC + Ed25519 tamper-evident chain |
| `mneme.replay.dump / .fingerprint` | Per-session HMAC-chained replay log + Merkle root |
| `mneme.forensics.vulns` | 51 security rules with stack-aware Bayesian filtering |
| `mneme.audit.deps` | Cross-check dependencies against OSV.dev |
| `mneme.aletheia.*` | Open MCP security framework — immune system + honeypots + karma + self-fuzz |

→ [EU AI Act compliance pitch](sales/02-EU-AI-ACT-COMPLIANCE.md) · [`ALETHEIA.md`](../ALETHEIA.md)

---

## 🤖 You ARE an AI agent reading this

A user just shared this URL with you and asked you to install Mneme. **Follow the [installation contract](AI_AGENT_CONTRACT.md) verbatim — don't improvise.**

After install, your **first MCP call** must be `mneme.welcome` — it returns:
- Which features auto-enabled (Lineage / ALETHEIA / Replay)
- Per-feature opt-out commands
- A user-message template to translate to the user's language

Then call `mneme.capabilities` for the full ~149-tool catalog.

---

← [Back to README](../README.md) · [Installation contract](AI_AGENT_CONTRACT.md)

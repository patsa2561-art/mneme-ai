# Mneme — Security & Threat Model

*Last reviewed: 2026-05-04 · For: security reviewers, regulated industries (banks, healthcare, gov), and curious users.*

This document is the **complete and honest** account of what Mneme touches, where data goes, and what we deliberately do **not** do. If you are evaluating Mneme for an environment with compliance requirements (SOX, PCI-DSS, HIPAA, ISO 27001, SOC 2), this is your starting point.

---

## TL;DR for security reviewers

| Question | Answer |
|---|---|
| Does Mneme phone home? | **No.** No telemetry. No analytics. No auto-update check. |
| Does it require an internet connection? | **No** — with the default `Ollama` or `hash` embedder, fully air-gapped. |
| Does it send source code anywhere? | **Never** — even with the optional OpenAI embedder, only commit messages + PR/issue text are sent. Source code never leaves the machine. |
| Where is data stored? | `.mneme/` inside the repo (`.mneme/mneme.db` SQLite, WAL). Never outside the repo. |
| Where are tokens stored? | `.mneme/secrets/` — gitignored, file-mode `0600` on POSIX. |
| Does it modify git history? | **Never.** Originals are never touched. Synthesized notes are stored separately and clearly labeled. |
| Is the audit trail tamper-evident? | **Yes** — see `mneme ledger` (hash-chained, append-only). |
| License + supply chain | MIT, npm with provenance, CI on GitHub Actions, signed tags. |
| Deterministic mode (no LLM)? | **Yes** — `--no-llm` flag disables every LLM-touching code path. |

---

## Data flow — what touches what

```
   ┌─────────────────────┐
   │  your git repo      │  (read-only access via `git log`, `git blame`)
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────┐
   │  Mneme indexer      │  (in-process, local, single-binary)
   └──────────┬──────────┘
              │
       splits into:
              │
   ┌──────────┼──────────┬──────────────────────┐
   ▼          ▼          ▼                      ▼
SQLite    Embedder    PR/Issue              Incident
(local)   adapter     hydration             adapter
.mneme/   ↓           (host API)            (vendor API)
          either:     ↓                     ↓
          • Ollama    GitHub / GitLab /     Sentry / Datadog /
            (local)   Bitbucket             GitHub Actions /
          • OpenAI    (commit msg +         manual JSON
            (network) PR text only)         (incident metadata only,
          • hash                            never source code)
            (none)
```

### What goes where, by backend

| Embedder | What's sent | Where | Network? |
|---|---|---|---|
| `ollama` (default) | commit text, PR text | `localhost:11434` (your machine) | ❌ |
| `hash` | nothing — local FNV hash | nowhere | ❌ |
| `openai` (opt-in) | commit text + PR text | `api.openai.com` | ✅ |

> **Source code is never embedded.** Phase 2 entity embeddings use *function/class signatures* (name, kind, layer-classification), not source bodies, when sent to a remote embedder.

---

## Threat model

### In scope

| Threat | Mitigation |
|---|---|
| Accidental upload of secrets via embedder | Redaction layer (regex PII/secret scrubber) runs before any text leaves the machine. Opt-in but ON by default. |
| Repo containing accidentally-committed secrets in old commits | `mneme heal --redact` strips known patterns before synthesis. |
| Tampering with the local memory store | `mneme ledger --verify` walks the hash chain; any modification breaks the chain. |
| Supply-chain attack on `mneme-ai` npm package | npm provenance attestation (link npm artifact → CI run → git commit). Verify with `npm audit signatures`. |
| Compromised dependency | Locked `package-lock.json`; CI fails on `npm audit --audit-level=high`. SBOM (CycloneDX) shipped with each release. |
| API token leak (GitHub / OpenAI / Sentry / etc.) | Tokens stored in `.mneme/secrets/` with `0600`, gitignored by default, never logged. |
| Malicious commit messages with prompt-injection | LLM paths run in `synthesizer-only` mode — output is stored as `kind='synthesized'`, never executed, never trusted as instructions. |

### Out of scope (be honest)

- We do not defend against an attacker with **shell access on your machine** — same as any local tool.
- We do not defend against a **compromised LLM provider** — if you set `OPENAI_API_KEY`, OpenAI sees what you send.
- We do not defend against an **adversary modifying your git remote** — Mneme indexes whatever git tells us is true.

---

## Tokens & secrets

| File | Purpose | Mode | Gitignored? |
|---|---|---|---|
| `.mneme/secrets/openai.txt` | OPENAI_API_KEY (if used) | `0600` | ✅ |
| `.mneme/secrets/sentry.txt` | Sentry auth token | `0600` | ✅ |
| `.mneme/secrets/datadog.txt` | DD_API_KEY + DD_APP_KEY | `0600` | ✅ |
| `.mneme/secrets/github.txt` | GitHub PAT (for private repo PR hydration) | `0600` | ✅ |

**Tokens are never logged.** Errors involving auth show only the *last 4 characters* of the token. Verify with `MNEME_DEBUG=1` — the full debug trace redacts tokens too.

The whole `.mneme/secrets/` directory is in [gitignore.template](../packages/cli/templates/gitignore.template) and verified at `mneme init` time.

---

## Deterministic mode (`--no-llm`)

For environments that cannot tolerate **any** LLM call (regulated, air-gapped, or just risk-averse):

```bash
mneme index --no-llm                   # only hash embedder, no Ollama, no OpenAI
mneme ask "..." --no-llm               # answer is BM25 + cosine only, no synthesis
mneme heal --no-llm                    # refuses to run (heal needs LLM by design)
mneme genius --no-llm                  # falls back to deterministic plan, no LLM
```

In `--no-llm` mode:
- `mneme heal` exits with code 2 and a clear message — it cannot synthesize without an LLM, and refusing is more honest than degrading.
- `mneme genius` runs a fixed deterministic plan: `adapt → ask → why → blast`.
- `mneme teach` falls back to layer-classification only, no prose.

The mode is sticky per repo: set `mneme.deterministic = true` in `.mneme/config.json` to enforce it for every command.

---

## Supply chain

| Layer | What we do |
|---|---|
| Source | All code under [github.com/patsa2561-art/mneme-ai](https://github.com/patsa2561-art/mneme-ai), MIT-licensed, signed git tags. |
| Build | GitHub Actions (`release.yml`), reproducible from any commit. Build inputs locked via `package-lock.json`. |
| Publish | npm provenance enabled — every published artifact is cryptographically linked to the source commit and CI run. |
| SBOM | CycloneDX SBOM generated per release, attached to GitHub release. |
| Verify | `npm audit signatures mneme-ai` (verifies provenance) + `npx @cyclonedx/cdxgen . | diff sbom.json -` (verifies SBOM). |

---

## What we deliberately do NOT do

- ❌ **No telemetry.** Mneme does not send a "phone home" packet of any kind, ever. There is no usage tracking, no version-check ping, no error reporting service.
- ❌ **No auto-update.** New versions are pulled only when you run `npm install -g mneme-ai@latest` or `npx -y mneme-ai`.
- ❌ **No remote control.** There is no MCP tool or CLI flag that lets a remote actor instruct your local Mneme to do anything. The MCP server is local-stdio-only.
- ❌ **No source-code embedding by default.** Phase 1 (commits + PRs) embeds *text*, never code bodies. Phase 2 entity embeddings embed *signatures*, not bodies.
- ❌ **No "cloud sync" mode.** There is no team/cloud feature in the MIT version. If one ships, it will be a separate, opt-in product.

---

## Reporting a vulnerability

If you find a security issue, please **do not** open a public GitHub issue. Instead:

1. Open a **private** [security advisory](https://github.com/patsa2561-art/mneme-ai/security/advisories/new) on GitHub.
2. Or email the maintainer directly (address in `package.json` `author` field).

Include: a minimal reproduction, the version of Mneme affected, and the impact you observed.

We commit to:
- Acknowledging within **48 hours**.
- Triaging and confirming within **7 days**.
- Shipping a fix or detailed mitigation guidance within **30 days** for high-severity issues.

---

## For regulated industries

If your organization needs:

- **SSO / SAML / OIDC** — not in the MIT version. Available in the planned **Enterprise tier** when there is a paying customer requesting it. Open a discussion thread.
- **On-prem deployment guide** — Mneme is already on-prem by design (local CLI, no SaaS). For multi-user shared cache, the Enterprise tier ships a Helm chart.
- **Compliance certifications (SOC 2, ISO 27001)** — the MIT project is not certified. Use `mneme ledger`, `--no-llm` mode, and the SBOM as evidence in your own audit. Enterprise tier targets SOC 2 Type II.
- **Audit-grade exports** — `mneme ledger --format sox` produces a hash-chained, tamper-evident log. Verify with `mneme ledger --verify`.
- **Data residency guarantees** — Mneme runs in your VPC / air-gapped network. There is no cloud component to assert residency over. If you use the OpenAI embedder, that data crosses to OpenAI; otherwise it does not leave.

---

## See also

- [PRIVACY.md](./PRIVACY.md) — user-facing privacy summary.
- [PUBLISH.md](./PUBLISH.md) — release process and token rotation.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — full system diagram and data model.

> *Security is not a feature. It is the absence of unwanted features.*

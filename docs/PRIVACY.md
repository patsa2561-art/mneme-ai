# Mneme — Privacy

*A short, plain-language summary. For the full threat model, see [SECURITY.md](./SECURITY.md).*

---

## What Mneme collects from you

**Nothing.** No telemetry. No analytics. No accounts. No usage tracking. We do not know you exist.

---

## What Mneme reads from your repo

- Commit messages, authors, dates, file lists.
- PR / MR / issue bodies (only if you set `GITHUB_TOKEN` / `GITLAB_TOKEN`).
- Blame info from `git blame` (locally computed, never sent anywhere).
- Optionally: incident metadata from your observability platform (only if you configure it).

**Source code is read locally to compute file paths and entity signatures, but the *bodies* of your functions are never sent to a remote embedder.**

---

## Where data is stored

Everything Mneme produces lives in `.mneme/` inside your repo:

```
.mneme/
├── mneme.db          SQLite — commits, chunks, embeddings, incidents
├── config.json       Mneme settings for this repo
├── secrets/          API tokens (gitignored, mode 0600)
└── ledger.jsonl      Hash-chained audit log
```

The directory is **gitignored by default** — `mneme init` adds it. You can commit it if you want a shared team cache, but the default is local-only.

---

## What goes over the network (and what doesn't)

| Embedder | Network calls | What's sent |
|---|---|---|
| `ollama` (default) | `localhost:11434` only | commit text + PR text, to your own machine |
| `hash` (zero-dep fallback) | none | nothing |
| `openai` (optional) | `api.openai.com` | commit text + PR text — **never source code** |

PR/issue hydration:
- GitHub: `api.github.com` (only if `GITHUB_TOKEN` is set)
- GitLab: `gitlab.com` or your self-hosted host (only if `GITLAB_TOKEN` is set)

**Without any of these tokens, Mneme works on commit text alone — and tells you so honestly instead of pretending.**

---

## How to verify it yourself

Mneme is local-first by design. Trust, but verify:

```bash
# What is Mneme actually about to send?
mneme index --dry-run --verbose

# Watch network traffic during indexing (Linux)
sudo tcpdump -i any -n -A 'host not localhost' &
mneme index
# (you should see no traffic to anywhere except the embedder host you chose)

# Or run with no network at all
unshare -rn -- mneme index --embedder hash
```

---

## How to opt out of LLM features entirely

Some commands (`heal`, `genius`, `teach`) call an LLM. To disable every LLM-touching path:

```bash
# Per-command
mneme heal --no-llm        # exits cleanly — heal needs an LLM, refuses politely

# Per-repo (sticky)
echo '{ "deterministic": true }' > .mneme/config.json

# Per-machine
export MNEME_NO_LLM=1
```

In deterministic mode:
- `ask`, `why`, `correlate`, `blast`, `palimpsest`, `clones`, `entities`, `runaway`, `mirror`, `rumor`, `fossil`, `ledger`, `wisdom`, `manifesto`, `adapt`, `status`, `mcp` — all work normally (no LLM was ever needed).
- `heal`, `genius`, `teach` — refuse to run with a clear message.
- `index --embedder ollama|openai` — falls back to `hash`.

---

## How to redact secrets from your repo's history before indexing

If your repo has accidentally-committed secrets (`AWS_SECRET_ACCESS_KEY`, JWT tokens, etc.) in old commits and you do not want them embedded:

```bash
mneme index --redact                # built-in regex scrubber: AWS, GCP, Azure, JWT, GitHub PAT, Stripe, Slack
mneme index --redact-rules custom.json   # your own patterns
```

The redactor strips matches from the *text Mneme indexes* — your actual git history is never touched. Run `mneme index --redact --dry-run` first to see what would be redacted.

---

## Removing Mneme

```bash
rm -rf .mneme/                      # purge all Mneme data
npm uninstall -g mneme-ai           # if installed globally
```

There is nothing else. No cloud account to delete, no profile to delete, no email to unsubscribe from.

---

## Children & special categories

Mneme is a developer tool. It is not designed for, nor marketed to, anyone under 18, and it does not collect any data about anyone. The only "personal data" it touches is git commit author names and email addresses — which were already in your repo before Mneme was installed.

---

## Changes to this policy

This file lives in git. Every change is in the commit history. There is no separate "we updated our privacy policy" notification because there is no list of users to notify.

---

## See also

- [SECURITY.md](./SECURITY.md) — full threat model.
- [LICENSE](../LICENSE) — MIT.

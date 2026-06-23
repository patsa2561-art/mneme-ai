# 🚀 Launch kit — ready to paste (honest, VERICERT-passed, no hype)

> Every claim below passed `mneme launch` (VERICERT) — defensible, no overclaim, no
> fabricated number. Lead with the one thing a reader can try in 10 seconds.
> **Replace `https://github.com/marketplace/actions/mneme-pr-context-checks`** with the exact URL on your listing page
> 

---

## ① Hacker News — Show HN  (news.ycombinator.com/submit)

**Title** (≤80 chars):
```
Show HN: Mneme – git-native context and checks on every PR, no LLM in the analysis
```
**URL:** `https://github.com/patsa2561-art/mneme-ai`

**Text:**
```
I kept watching reviewers approve PRs they didn't fully understand — and AI agents
edit code with no idea *why* a file is the way it is. So I built Mneme.

On every pull request it posts one comment, all derived deterministically from git
(no LLM in the analysis path, nothing leaves your CI runner):

• why each changed file is the way it is — its last decision + how often it changes,
  cited to real commits
• a check of the PR *description* for overconfident / self-contradicting / fabricated
  claims (a rule engine, not a model)
• the author's "commit persona" from measured signals — explicitly commit *hygiene*,
  not skill

Try the web tools free, no install — paste any public repo:
• https://xray.mneme-ai.space/brief    (the repo's shared-context capsule)
• https://xray.mneme-ai.space/seance   (why is a file / commit the way it is)
• https://xray.mneme-ai.space/persona  (each contributor's commit style)

Add the PR bot to a repo in one line: uses: patsa2561-art/mneme-ai@v3
(GitHub Marketplace: https://github.com/marketplace/actions/mneme-pr-context-checks)

It's MIT, local-first, vendor-neutral (an MCP server + a CLI). Honest about limits:
it surfaces context and checks known issues — it does NOT judge skill, and "no known
fault" is not a proof of correctness. Source is cloned, scanned, and deleted; private
repos run locally.

Feedback very welcome — especially on the PR-comment format and what context you wish
your tools surfaced.
```

---

## ② X / Twitter — thread

```
1/ Reviewers approve PRs they don't fully understand — and AI agents edit code with no
idea *why* a file is the way it is. I built Mneme to fix both, deterministically from
git. No LLM in the analysis. Nothing leaves your CI. 🧵

2/ On every PR, one comment:
🧭 why each changed file is the way it is (cited to real commits)
🎗️ a fact-check of the PR description (overconfident/contradicting/fabricated)
🎭 the author's commit persona (hygiene, not skill)

3/ Try it free, no install — paste any public repo:
• /brief — the repo's shared-context capsule
• /seance — "why is this file the way it is?"
• /persona — each dev's commit style
→ https://xray.mneme-ai.space

4/ Add the PR bot in one line: uses: patsa2561-art/mneme-ai@v3
GitHub Marketplace → https://github.com/marketplace/actions/mneme-pr-context-checks

5/ MIT · local-first · vendor-neutral (MCP + CLI). Honest: it surfaces context + checks
known issues — not skill, not a proof of correctness. Code never leaves your runner.
Feedback very welcome.
```

---

## ③ Reddit — r/programming or r/devtools

**Title:**
```
I built a deterministic PR bot: git-native context + a check on the PR description (MIT, no LLM in the analysis)
```
**Body:**
```
Two things bug me about how we (and our AI agents) work: we edit files without knowing
why they're the way they are, and PR descriptions quietly overclaim.

Mneme posts one comment per PR, all from git, deterministically (no model in the
analysis path, nothing leaves CI):
- why each changed file is the way it is — last decision + churn, cited to real commits
- a check of the PR *description* for overconfident / contradicting / fabricated claims
- the author's "commit persona" (commit size / tests / conventional rate / fix-rate) —
  hygiene, not skill

No install to try — paste a public repo at https://xray.mneme-ai.space (/brief,
/seance, /persona). Add the bot in one line: uses: patsa2561-art/mneme-ai@v3
(Marketplace: https://github.com/marketplace/actions/mneme-pr-context-checks).

MIT, local-first, MCP + CLI. Honest about limits (hygiene ≠ skill; "no known fault" ≠
proof). Curious what context you'd want surfaced on a PR.
```

---

## What I (the author) do — the manual steps
1. Confirm the exact Marketplace URL on the listing page; paste it where `https://github.com/marketplace/actions/mneme-pr-context-checks` is.
2. Post the HN "Show HN" (best Tue–Thu morning US time), then the X thread, then Reddit.
3. Reply to early comments fast — that's what moves a Show HN.
4. (Optional) move the `v3` tag on each future release so `@v3` users get the latest.

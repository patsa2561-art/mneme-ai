# Launch copy — honest, no hype (review before posting)

> Ground rule: lead with the one verifiable thing a reader can try in 10s. State the
> caveats. No "world-first", no fabricated numbers. Let the demo speak.

---

## Hacker News — Show HN

**Title:**
`Show HN: Mneme – git-native context + checks on every PR (deterministic, local, no LLM in the analysis)`

**Body:**
```
I kept watching AI agents (and humans) edit code with zero context about *why* a file
is the way it is, and ship PR descriptions that quietly overclaim. So I built Mneme.

On every PR it posts one comment, all derived deterministically from git — no LLM in
the analysis path, nothing leaves your CI runner:

• a check of the PR *description* for overconfident / self-contradicting / fabricated
  claims (a small rule engine, not a model)
• for each changed file: its last decision + how often it changes, cited to real commits
  ("why is this file the way it is?")
• the author's "commit persona" from measured signals (commit size, tests, conventional
  rate, fix-rate) — explicitly commit *hygiene*, not skill

Try it with no install — paste any public repo:
• https://xray.mneme-ai.space/brief   (the repo's shared-context capsule)
• https://xray.mneme-ai.space/seance  (why is a file / commit the way it is)
• https://xray.mneme-ai.space/persona (each contributor's commit style)

It's MIT, local-first, vendor-neutral (MCP + a CLI). Honest about limits: it measures
git hygiene and surfaces context — it does NOT judge skill, and "no known fault" is not
a proof of correctness. Source is cloned, scanned, and deleted; private repos run locally.

I'd love feedback on the PR-comment format and what context you wish your tools surfaced.
```

---

## X / Twitter — thread

1/ Every AI agent edits your code with no idea *why* the file is the way it is — and
happily ships a PR description that overclaims. I built Mneme to fix both, deterministically
from git. No LLM in the analysis. Nothing leaves your CI. 🧵

2/ On every PR, one comment:
🧭 VERICERT the description (catch overconfident/contradicting/fabricated claims)
📂 each changed file's last decision + churn, *cited to real commits*
🎭 the author's commit persona (hygiene, not skill)

3/ Try it free, no install — paste any public repo:
• /brief — the repo's shared-context capsule
• /seance — "why is this file the way it is?"
• /persona — each dev's commit style as a card
→ xray.mneme-ai.space

4/ It's MIT · local-first · vendor-neutral (MCP + CLI). Honest: it measures git *hygiene*
+ surfaces context — not skill, not a proof of correctness. Code never leaves your runner.

5/ Add it to a repo in one file → `uses: patsa2561-art/mneme-ai@v3`. Feedback very welcome.

---

## Reddit — r/programming or r/devtools

**Title:** `I built a deterministic PR bot: git-native context + a check on the PR description (MIT, no LLM in the analysis)`

**Body:**
```
Two things bug me about how we (and our AI agents) work: we edit files without knowing
why they're the way they are, and PR descriptions quietly overclaim.

Mneme posts one comment per PR, all from git, deterministically (no model in the analysis
path, nothing leaves CI):
- checks the PR *description* for overconfident / self-contradicting / fabricated claims
- per changed file: last decision + churn, cited to real commits
- the author's "commit persona" (commit size / tests / conventional rate / fix-rate) —
  hygiene, not skill

No install to try — paste a public repo at xray.mneme-ai.space (/brief, /seance, /persona).
MIT, local-first, MCP + CLI. Honest about limits (hygiene ≠ skill; "no known fault" ≠ proof).
Curious what context you'd want surfaced on a PR.
```

---

## Publishing the Marketplace action (you do this on GitHub)

1. `action.yml` is at the repo root (composite action) with `branding`.
2. GitHub → the repo → **Releases → Draft a new release** → pick the tag (e.g. `v3.133.0`).
3. Tick **"Publish this Action to the GitHub Marketplace"**, pick a category (Continuous
   Integration / Code review), accept the agreement, **Publish**.
4. Users then add `uses: patsa2561-art/mneme-ai@v3` to their workflow.

(Marketplace publish is a one-time UI step only the repo owner can do.)

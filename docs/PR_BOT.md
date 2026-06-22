# 🧭 Mneme PR bot — context & checks on every pull request

One grounded comment on every PR — no setup beyond one workflow file:

- **VERICERT** the PR description (catches an overconfident / hallucinated / self-contradicting claim).
- **Context for every changed file** — *why is this file the way it is?* (its last decision + how often it changes), **cited to real commits**.
- **The author's commit persona** (tier · archetype — measured commit hygiene, not skill).

Deterministic, runs on **your** runner — **your code never leaves CI**.

## Install (one file)

Add `.github/workflows/mneme-pr.yml` to your repo:

```yaml
name: Mneme PR
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
permissions:
  contents: read
  pull-requests: write
jobs:
  mneme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history — context & personas need it
      - uses: patsa2561-art/mneme-ai@v3   # the Marketplace action
        # with:
        #   fail-on-reject: "true"        # optional: block merge if the PR description is REJECTED
```

That's it. Open a PR and Mneme posts (and keeps updating) one comment.

## What it looks like

```
### 🧭 Mneme — PR context & checks

**⚠️ PR description: CONDITIONAL** (67% of claims clean)
> ⚠️ overconfidence — "this always works and never fails"

**📂 Why these files are the way they are** (cited to real commits):
| file | changes | last decision |
|---|---|---|
| `src/auth.ts` | 14× | `a1b2c3d4` fix(auth): tighten token expiry window |

**🎭 Author** `alice` — GOLD · The Surgeon (212 commits). commit hygiene, not skill.

🧷 cited · deterministic · git-native · local-first · powered by Mneme
```

## Honest

Every line is a deterministic projection of git + Mneme's verification engines, fully
cited — never an opinion, never invented. The whole analysis runs in your CI runner;
nothing is uploaded. Free on any repo. Local CLI: `npm i -g mneme-ai` then
`mneme pr-comment --base origin/main`.

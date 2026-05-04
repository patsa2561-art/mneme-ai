# Dependabot PRs — review checklist

Dependabot opens a PR for every dependency upgrade it sees. Most are safe. Some are not. This file is the playbook.

## The default decision tree

For each Dependabot PR:

1. **Read the changelog** — Dependabot's PR body links to the release notes.
2. **Is it a major bump?**
   - Patch / minor: `npm test && npm run eval -- --variant baseline` then merge.
   - Major: read carefully — major bumps mean breaking changes by definition.
3. **Does CI pass?** No CI green = no merge, period.
4. **Does the eval drift?** Compare the eval comparison table from the PR run against `main`. Any negative drift on recall@3 / MRR / nDCG = block.

## Current open PRs (as of v0.1.0)

| PR | Decision | Why |
|---|---|---|
| `better-sqlite3 → 12.9.0` | ✅ likely merge | Patch line, our store layer is small surface |
| `commander → 14.0.3` | ✅ likely merge | Stable CLI parser, used minimally |
| `@types/* group` | ✅ likely merge | Types only, no runtime impact |
| `vitest → ?` | ✅ likely merge | Dev-only |
| **`typescript → 6.0.3`** | ❌ **HOLD** | TypeScript 6 is an alpha series. Stay on 5.6 until 6.x is stable. |

## How to merge a Dependabot PR safely

```bash
gh pr checkout <number>          # or git fetch + checkout the dependabot/* branch
npm install
npm run build
npm test
npm run eval -- --variant baseline
# eyeball: did metrics move?
gh pr merge --squash --delete-branch
```

If you don't have `gh` CLI:

```bash
git fetch origin pull/<N>/head:tmp-dep-<N>
git checkout tmp-dep-<N>
npm install && npm run build && npm test
# OK? → merge via web UI (squash + delete branch)
git checkout main && git branch -D tmp-dep-<N>
```

## What to do with the TypeScript 6 PR

Close it. Add a comment: *"Holding on TS 6 until the 6.x line is stable. Will revisit when minor version 6.1+ ships."* Dependabot will not re-open it for the same version.

## Configuring Dependabot's noise level

`.github/dependabot.yml` already groups types and limits open PRs. If review fatigue grows:

- Bump `open-pull-requests-limit` down to 3
- Add `ignore` rules for known-bad upgrade lines
- Switch to monthly cadence

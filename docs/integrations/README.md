# Mneme — drop-in CI templates

Mneme works on every CI you already use.  Pick your platform, copy the snippet, you're done.  Each template installs `mneme-ai` from npm, captures a baseline, and posts a single Markdown comment on every pull/merge request via `mneme bot`.

| Platform              | Template                                        | Token / secret                                             |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| GitHub Actions        | [`github-actions.yml`](./github-actions.yml)    | `GITHUB_TOKEN` (built-in)                                  |
| GitLab CI             | [`gitlab-ci.yml`](./gitlab-ci.yml)              | `GITLAB_TOKEN` (project-access token, `api` scope)         |
| Bitbucket Pipelines   | [`bitbucket-pipelines.yml`](./bitbucket-pipelines.yml) | `BITBUCKET_TOKEN`, or `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` |
| CircleCI              | [`circleci.yml`](./circleci.yml)                | `MNEME_GITHUB_TOKEN` context (GitHub PAT)                  |
| Jenkins               | [`jenkinsfile`](./jenkinsfile)                  | Jenkins credential `github-pat`                            |

## What you get

A PR comment that looks like:

```
Mneme audit · mneme audit --certify
Verdict: pass · 9/9 axes green · 0 contradictions

Knowledge atrophy — files at risk in this PR
- src/auth/jwt.ts — top knower 41% fresh (last touched 6mo ago)
- src/billing/invoice.ts — top knower 38% fresh
```

The 5-axis breakdown is collapsible (`<details>`); the comment is GitHub-Flavored Markdown that renders cleanly in GitLab and Bitbucket too.

## How it works

1. `npm install -g mneme-ai` (~ 10 seconds, no native deps in the default install).
2. `mneme index --quiet` populates the local memory from `git log`.
3. `mneme audit --baseline` snapshots the repo's behavior + API + tests + perf.
4. `mneme bot --include audit,atrophy` runs each analyzer, assembles a Markdown comment, and posts it via the platform's REST API.

All data is computed locally inside the runner — Mneme never calls an external service.

## Tuning

- Pick analyzers with `--include`: any subset of `audit,atrophy,ghost,promise`.
- Test the comment locally before wiring CI: `mneme bot --dry-run --include audit,atrophy`.
- Override the PR number explicitly: `mneme bot --pr 42 --platform github`.
- Force a specific platform regardless of env: `mneme bot --platform gitlab`.

## See also

- The native [GitHub Action](../../.github/actions/mneme-audit) — same outcome with one less step.
- The full [Integrations wiki page](../wiki/Integrations.md) for design notes and screenshots.

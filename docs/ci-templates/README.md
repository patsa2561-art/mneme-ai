# Mneme — CI/CD templates

Drop-in templates that run Mneme's AI session audit on every PR + main
push for the three biggest git platforms.

| Platform | File | Where it goes in your repo |
|---|---|---|
| **GitHub Actions** | [`github-actions.yml`](./github-actions.yml) | `.github/workflows/mneme.yml` |
| **GitLab CI** | [`gitlab-ci.yml`](./gitlab-ci.yml) | `.gitlab-ci.yml` (or `include:` from existing pipeline) |
| **Bitbucket Pipelines** | [`bitbucket-pipelines.yml`](./bitbucket-pipelines.yml) | `bitbucket-pipelines.yml` |

## What each template does

1. **Indexes the repo** with Mneme on the CI runner (`mneme index --cap 5000`)
2. **Snapshots baseline behavior** by checking out the PR's target branch
3. **Runs `mneme audit --certify`** — 5-axis trust certificate
4. **Runs `mneme forensics vulns`** — Bayesian-filtered security scan
5. **Runs `mneme deps audit`** — OSV.dev cross-check for known CVEs
6. **Posts the verdict** as a PR/MR comment with PASS/WARN/FAIL emoji
7. **Fails the build** if the audit returned FAIL

Cost per run: ~30-60 seconds on a typical repo. Zero external API calls
(Mneme uses the bundled WASM embedder by default).

## Required secrets

| Secret | What it's for | Required? |
|---|---|---|
| `GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN` | Posting PR/MR comments | yes |
| `MNEME_HMAC_SECRET` | Tamper-evident ledger signatures | optional (for compliance use cases) |

## Customizing

- **Override on FAIL** — add the `mneme-override` label to the PR (GitHub) or set `MNEME_AUDIT_DISABLE=1` (GitLab/Bitbucket vars) to bypass the gate.
- **Strict mode** — set `MNEME_AUDIT_STRICT=1` to treat WARN as FAIL.
- **Limit history scan** — adjust `--cap 5000` to scan fewer commits on huge repos.
- **Custom rubric** — edit `mneme audit --certify` to use `--rubric <path>` once you've authored a project-specific rubric file.

## Troubleshooting

- **Workflow fails with "no commits indexed"** — your CI runner cloned with shallow depth. Add `fetch-depth: 0` (GitHub) / `GIT_DEPTH: "0"` (GitLab) / `git fetch --unshallow` (Bitbucket).
- **Workflow times out on large repos** — reduce `--cap` to 1000-2000 OR use the `htc-build` cache (cache the `.mneme/` directory between runs).
- **Comment doesn't appear on PR** — check the token has `pull-requests: write` scope.

## See also

- [§ For AI agents in main README](../../README.md#-for-ai-agents--installation-contract) — how AI tools install Mneme locally
- [QSAC wiki](https://github.com/patsa2561-art/mneme-ai/wiki/QSAC) — the audit certificate engine deep-dive
- [AI-Session-Audit wiki](https://github.com/patsa2561-art/mneme-ai/wiki/AI-Session-Audit) — full audit positioning + use cases

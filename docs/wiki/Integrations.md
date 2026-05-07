# Integrations — Mneme works on every CI you already use

Mneme is a 30-second install away from being part of every team's daily workflow.  No new platform to adopt, no new dashboard to log into, no new account to provision: you get a single PR comment with the audit + atrophy results, every time, on the platform your team is already on.

> **What you get on every PR:** a 5-axis trust certificate (behavioral parity, API contract drift, test pass rate, perf regression, AI narrative) plus a knowledge-atrophy heads-up listing files whose top knower has decayed.  Collapsible.  GitHub-Flavored Markdown.  Posted by the same `mneme bot` command on every platform.

## Quick chooser

| You use…                                       | Copy this                                          | What's needed                                            |
| ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| **GitHub Actions** _(recommended starting point)_ | [GitHub Action](#github-actions)                | Just `permissions: pull-requests: write`. No PAT.        |
| **GitLab CI**                                  | [`mneme-bot` job](#gitlab-ci)                      | `GITLAB_TOKEN` CI/CD variable.                           |
| **Bitbucket Pipelines**                        | [pipeline step](#bitbucket-pipelines)              | `BITBUCKET_TOKEN`, or username + app password.           |
| **CircleCI**                                   | [job snippet](#circleci)                           | A GitHub PAT in the `MNEME_GITHUB_TOKEN` context.        |
| **Jenkins**                                    | [Declarative pipeline](#jenkins)                   | A GitHub PAT credential.                                 |

## GitHub Actions

The easiest path uses the bundled composite action:

```yaml
# .github/workflows/pr-audit.yml
name: PR audit
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  mneme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 50
      - uses: patsa2561-art/mneme-ai/.github/actions/mneme-audit@main
        with:
          fail-on: fail
          comment: true
```

That's it.  No tokens to wire — the action reads `GITHUB_TOKEN` from the runner.

If you'd rather drive everything yourself, copy [`docs/integrations/github-actions.yml`](../integrations/github-actions.yml) — it does the same thing using just `mneme bot`.

## GitLab CI

```yaml
# .gitlab-ci.yml
mneme-bot:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - npm install -g mneme-ai
    - mneme index --quiet || mneme index || true
    - mneme audit --baseline || true
    - mneme bot --include audit,atrophy
```

Set a `GITLAB_TOKEN` CI/CD variable (project-access token with `api` scope; `CI_JOB_TOKEN` cannot post MR comments on most setups).  Mneme reads `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`, and `GITLAB_TOKEN` automatically.

Full template: [`docs/integrations/gitlab-ci.yml`](../integrations/gitlab-ci.yml).

## Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
image: node:20
pipelines:
  pull-requests:
    "**":
      - step:
          name: "mneme · audit + atrophy"
          script:
            - npm install -g mneme-ai
            - mneme index --quiet || mneme index || true
            - mneme audit --baseline || true
            - mneme bot --include audit,atrophy
```

Provide a `BITBUCKET_TOKEN` repository variable (OAuth bearer token), or a `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` pair (basic auth).

Full template: [`docs/integrations/bitbucket-pipelines.yml`](../integrations/bitbucket-pipelines.yml).

## CircleCI

```yaml
# .circleci/config.yml — partial
- run:
    name: Mneme bot
    environment:
      GITHUB_REPOSITORY: ${CIRCLE_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}
    command: |
      export GITHUB_TOKEN="$MNEME_GITHUB_TOKEN"
      PR_NUM=$(echo "$CIRCLE_PULL_REQUEST" | sed -E 's,.*/pull/([0-9]+).*,\1,')
      mneme bot --platform github --pr "$PR_NUM" --include audit,atrophy
```

CircleCI doesn't host PRs itself, so we drive the GitHub API.  Set `MNEME_GITHUB_TOKEN` in a CircleCI context (it should be a PAT with `pull-requests: write`).

Full template: [`docs/integrations/circleci.yml`](../integrations/circleci.yml).

## Jenkins

```groovy
stage('Mneme bot') {
    when { expression { return env.CHANGE_ID != null } }
    steps {
        sh "mneme bot --platform github --pr ${env.CHANGE_ID} --include audit,atrophy"
    }
}
```

Provide a Jenkins credential called `github-pat` and use the GitHub Branch Source plugin (it sets `env.CHANGE_ID`).

Full template: [`docs/integrations/jenkinsfile`](../integrations/jenkinsfile).

## Local dry-run

You can render the comment locally without posting:

```sh
mneme bot --dry-run --include audit,atrophy
```

This is useful for tuning what shows up before you wire CI.

## See also

- [Drop-in CI templates index](../integrations/README.md)
- [GitHub Action README](../../.github/actions/mneme-audit/README.md)

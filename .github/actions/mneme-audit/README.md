# Mneme — AI Session Audit (GitHub Action)

> Audit AI-driven commits with a 5-axis trust certificate.
> Vendor-neutral. Works with Claude Code, Cursor, Codex, Sweep, Aider, and any other AI tool that produces git commits.

When an AI tool ships code into your branch, Mneme answers:

1. **Behavioral parity** — does the same `--help`, `--version`, sample commands still emit the same output?
2. **API contract drift** — were any public exports renamed or removed?
3. **Test pass rate** — did any new test failures appear?
4. **Perf regression** — is anything ≥10% slower?
5. **AI narrative** — does the commit message actually match the diff?

The action posts a single, scannable comment on every PR.

<!-- screenshot: a typical Mneme PR comment showing all five axes green and a verdict badge -->

```
+----------------------------------------+
|  Mneme audit · mneme audit --certify   |
|                                        |
|  Verdict: pass · 5/5 axes green        |
|  session  a1b2c3d                      |
|                                        |
|  Axis                  Verdict  Detail |
|  Behavioral parity     pass     match  |
|  API contract drift    pass     same   |
|  Test pass rate        pass     1645/0 |
|  Perf regression       pass     +2%    |
|  AI narrative          pass     1.00   |
+----------------------------------------+
```

## Quickstart

Drop this into `.github/workflows/pr-audit.yml`:

```yaml
name: PR audit
on:
  pull_request:

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
          mode: certify
          fail-on: fail
          comment: true
```

That is the entire integration. No tokens to wire, no secrets to rotate, no additional services to authorize.

## Inputs

| Name          | Default            | Description                                                                  |
| ------------- | ------------------ | ---------------------------------------------------------------------------- |
| `mode`        | `certify`          | One of `certify`, `verify`, `trace`, `report`, `watch`.                      |
| `baseline`    | `true`             | Build a fresh baseline before running the audit.                             |
| `fail-on`     | `fail`             | `fail` blocks merges on FAIL, `warn` blocks on WARN+, `never` only reports.  |
| `comment`     | `true`             | Auto-post a Markdown comment on the PR with the verdict and 5-axis details. |
| `pr-number`   | (auto-detected)    | Override the PR number. By default the action reads it from the event.       |
| `include`     | `audit,atrophy`    | Reserved for the upcoming `mneme bot` follow-on (multi-analyzer comments).   |
| `node-version`| `20`               | Node version for installing `mneme-ai`.                                       |

## Outputs

| Name                | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `verdict`           | `pass`, `warn`, or `fail` — overall verdict.                              |
| `exit-code`         | `0` if the audit passed/warned, `1` if it failed.                          |
| `certificate-path`  | Filesystem path to the JSON certificate (useful for `actions/upload-artifact`). |

## Recipes

### Block merges only on FAIL, but always comment

```yaml
- uses: patsa2561-art/mneme-ai/.github/actions/mneme-audit@main
  with:
    fail-on: fail
    comment: true
```

### Don't block merges (observe-only roll-out)

```yaml
- uses: patsa2561-art/mneme-ai/.github/actions/mneme-audit@main
  with:
    fail-on: never
    comment: true
```

### Upload the certificate as an artifact for compliance

```yaml
- id: mneme
  uses: patsa2561-art/mneme-ai/.github/actions/mneme-audit@main
  with:
    mode: certify
- uses: actions/upload-artifact@v4
  with:
    name: mneme-audit-certificate
    path: ${{ steps.mneme.outputs.certificate-path }}
```

## How it works

1. Installs `mneme-ai` from npm.
2. Runs `mneme index` to populate the local memory.
3. Captures a baseline (`mneme audit --baseline`).
4. Runs `mneme audit --<mode> --json` and writes the certificate JSON to `RUNNER_TEMP`.
5. If the event is a `pull_request` and `comment: true`, posts a single Markdown comment with the verdict and a collapsible 5-axis breakdown.
6. Honors `fail-on` to decide whether the workflow step exits non-zero.

All data is computed locally inside the runner — Mneme does not call any external service.

## Permissions

The auto-comment step requires:

```yaml
permissions:
  contents: read
  pull-requests: write
```

If you skip the comment (`comment: false`), only `contents: read` is needed.

## See also

- The [`mneme bot`](https://github.com/patsa2561-art/mneme-ai/blob/main/docs/wiki/Integrations.md) command — generic CI integration for GitLab, Bitbucket, CircleCI, Jenkins.
- [Drop-in CI templates](https://github.com/patsa2561-art/mneme-ai/tree/main/docs/integrations) for every major platform.
- [Mneme on the wiki](https://github.com/patsa2561-art/mneme-ai/wiki) — full command tour and design notes.

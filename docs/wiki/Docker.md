# 🐳 Mneme on Docker

> *The memory layer for your codebase, in a 90 MB image. No Node toolchain required.*

═══════════════════════════════════════════════════════════════════════════════

## Why Docker?

The npm package `mneme-ai` is the canonical install path. Docker is for the cases where npm isn't:

- **CI pipelines** that don't already have a Node toolchain (smaller, hermetic).
- **Air-gapped enterprise** environments where the runner can't reach npm.
- **One-line demos** in talks / blog posts: `docker run … mneme audit --certify`.
- **Reproducible builds** — the image is locked to a specific Mneme version + Node 22 + Alpine packages.

═══════════════════════════════════════════════════════════════════════════════

## Pull

```bash
# Latest stable
docker pull ghcr.io/patsa2561-art/mneme-ai:latest

# Specific version (recommended for reproducibility)
docker pull ghcr.io/patsa2561-art/mneme-ai:0.32.0

# Edge (main branch HEAD)
docker pull ghcr.io/patsa2561-art/mneme-ai:edge
```

Multi-arch image — works on `linux/amd64` and `linux/arm64` (Apple Silicon, Graviton).

═══════════════════════════════════════════════════════════════════════════════

## Run on your repo

The image's `WORKDIR` is `/repo`. Mount your local repo there:

```bash
docker run --rm -v "$PWD:/repo" ghcr.io/patsa2561-art/mneme-ai mneme index
docker run --rm -v "$PWD:/repo" ghcr.io/patsa2561-art/mneme-ai mneme audit --certify
docker run --rm -v "$PWD:/repo" ghcr.io/patsa2561-art/mneme-ai mneme nervous-system --json > report.json
```

Common gotchas:
- The image runs as root by default. If your host repo is owned by a non-root UID, add `--user "$(id -u):$(id -g)"`.
- `.mneme/` is written into the mounted `/repo`. After `docker run` finishes, the cache lives on your host and the next run reuses it.

═══════════════════════════════════════════════════════════════════════════════

## CI integration — pure-Docker workflows

GitHub Actions example without setting up Node:

```yaml
- name: Audit AI session
  run: |
    docker run --rm \
      -v "${{ github.workspace }}:/repo" \
      ghcr.io/patsa2561-art/mneme-ai:latest \
      mneme audit --certify
```

GitLab CI:

```yaml
mneme-audit:
  image: ghcr.io/patsa2561-art/mneme-ai:latest
  script: mneme audit --certify
```

Bitbucket Pipelines:

```yaml
- step:
    name: Mneme audit
    image: ghcr.io/patsa2561-art/mneme-ai:latest
    script:
      - mneme audit --certify
```

═══════════════════════════════════════════════════════════════════════════════

## Image layout

| Layer | Size | What's inside |
|---|---|---|
| `node:22-alpine` base | ~50 MB | Node runtime + Alpine userland |
| `apk add git ca-certificates` | ~20 MB | git (Mneme reads `.git/`) + HTTPS roots |
| `mneme-ai` install | ~20 MB | The CLI + bundled WASM embedder |
| **Total** | **~90 MB** | |

The build is multi-stage so dev dependencies (vitest, esbuild, etc.) never reach the final image.

═══════════════════════════════════════════════════════════════════════════════

## Image tags + cadence

The `docker-publish.yml` workflow pushes on every release tag and on every push to `main`:

| Tag | When |
|---|---|
| `latest` | Newest released stable version |
| `0.32.0` (full) · `0.32` (minor) · `0` (major) | Pinned to a release |
| `edge` | `main` HEAD; rebuilt on every push |

The version-tagged builds wait ~2 minutes after the `release.yml` workflow publishes to npm before running the install step (so the Docker build resolves to the just-published version).

═══════════════════════════════════════════════════════════════════════════════

## Privacy posture

- **Same as the CLI.** All indexing + retrieval is local to the container. The only outbound network requests are the optional free-LLM calls if you've configured them via `mneme setup-free`.
- **No telemetry.** No analytics. No phoning home.
- **The image is rebuilt from source on GitHub Actions** — auditable; you can verify via `docker inspect` against the workflow run.

═══════════════════════════════════════════════════════════════════════════════

## Troubleshooting

**"permission denied" on mounted /repo** — add `--user "$(id -u):$(id -g)"` (or fix the `.mneme/` directory ownership after the first run).

**"Cannot find git repo" on Windows** — Docker Desktop on Windows mounts via WSL2; sometimes `/repo` is mounted but doesn't see `.git/` because of file mode mapping. Use Git Bash or WSL2 directly.

**Image pull is slow first time** — ~90 MB compressed. Subsequent runs reuse the layer cache.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🏠 [npm install path → Installation](Installation)
- 🔌 [CI integrations → Integrations](Integrations)
- 📦 [GitHub Packages page](https://github.com/patsa2561-art/mneme-ai/pkgs/container/mneme-ai)

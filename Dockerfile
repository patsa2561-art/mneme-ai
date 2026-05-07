# ───────────────────────────────────────────────────────────────────────
# Mneme — the memory layer for your codebase, in a 90 MB image.
#
# Targets:
#   • CI runners without a Node toolchain (audit / atrophy in pipelines)
#   • Air-gapped enterprise environments
#   • One-line demos: docker run ghcr.io/patsa2561-art/mneme-ai mneme --help
#
# Multi-stage so the final image only ships the production install +
# git + the bundled WASM model — no source, no dev deps, no caches.
# ───────────────────────────────────────────────────────────────────────

# ─── Stage 1: install ──────────────────────────────────────────────────
FROM node:22-alpine AS installer

# git is a runtime dependency (Mneme indexes git history). Pinned to alpine's
# stable channel; we don't need a specific version.
RUN apk add --no-cache git

WORKDIR /opt/mneme

# Use --omit=dev to skip vitest, esbuild, etc. The bundled mneme-ai
# package is the only thing that needs to be reachable at runtime.
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-fund --no-audit mneme-ai \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

# ─── Stage 2: runtime ──────────────────────────────────────────────────
FROM node:22-alpine

LABEL org.opencontainers.image.title="Mneme"
LABEL org.opencontainers.image.description="The memory layer for your codebase. AI session audit, nervous-system analytics, knowledge atrophy — all local."
LABEL org.opencontainers.image.source="https://github.com/patsa2561-art/mneme-ai"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.documentation="https://github.com/patsa2561-art/mneme-ai/wiki"

# Same git + a minimal cert bundle so HTTPS works for free-LLM providers.
RUN apk add --no-cache git ca-certificates

# Copy the production install from the installer stage.
COPY --from=installer /opt/mneme /opt/mneme

# Symlink the bin so `mneme` is on PATH globally.
RUN ln -s /opt/mneme/node_modules/.bin/mneme /usr/local/bin/mneme

# Default working dir = /repo so users can mount their git repo there.
WORKDIR /repo

# Sensible default — show help so a bare `docker run` is informative.
ENTRYPOINT ["mneme"]
CMD ["--help"]

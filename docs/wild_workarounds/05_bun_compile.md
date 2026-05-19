# #5 — Bun-compile portable binary

**Status:** 📐 Spec + sketch
**User command:** `winget install Mneme.Mneme` (Windows) / `brew install mneme-ai` (macOS) / `curl -L .../mneme | sh` (Linux)

## The technique

Compile Mneme to a SINGLE self-contained native binary per platform.
No `node_modules`, no npm dependencies, no DLL handles to lock, no
`--omit=optional` to worry about. The Bun runtime supports this out of
the box:

```bash
bun build packages/cli/bin/mneme.js --compile --target=bun-windows-x64 --outfile mneme.exe
bun build packages/cli/bin/mneme.js --compile --target=bun-darwin-arm64 --outfile mneme-mac-arm64
bun build packages/cli/bin/mneme.js --compile --target=bun-linux-x64 --outfile mneme-linux-x64
```

Each output is ~80-100MB (Bun runtime + Mneme code + bundled deps).
The user downloads ONE file and puts it on PATH. Done.

## Why this is the long-term ideal

- **Zero npm interaction** for the install path
- **Zero native DLL locks** (no separate `.dll` files; everything is
  bundled into the .exe / Mach-O / ELF)
- **Zero `--omit=optional` complexity** (no optional deps to omit)
- **One-file distribution** (curl + chmod + run)
- **OS package manager integration** (winget, brew, scoop, apt, snap)
- **Predictable size + reproducible builds** (Bun build output is
  byte-deterministic for the same source + Bun version)

This is what Deno does. What Bun does. What esbuild does. What Tauri
does. What Cypress does for its test runner binary. The npm-as-CLI-
distribution model is the legacy approach; single-binary is the modern
one for substantial tools.

## Mechanics (the sketch)

Add a CI workflow `compile-portable.yml`:

```yaml
name: Compile portable binaries
on:
  push:
    tags: ['v*']

jobs:
  compile:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
        target:
          - { runner: windows-latest, bun: bun-windows-x64, ext: .exe }
          - { runner: macos-latest, bun: bun-darwin-arm64, ext: '' }
          - { runner: macos-latest, bun: bun-darwin-x64, ext: '' }
          - { runner: ubuntu-latest, bun: bun-linux-x64, ext: '' }
          - { runner: ubuntu-latest, bun: bun-linux-arm64, ext: '' }
    runs-on: ${{ matrix.target.runner }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: npm ci
      - run: npm run build
      - name: Bun compile
        run: |
          bun build packages/cli/bin/mneme.js \
            --compile \
            --target=${{ matrix.target.bun }} \
            --outfile mneme-${{ matrix.target.bun }}${{ matrix.target.ext }}
      - uses: softprops/action-gh-release@v2
        with:
          files: mneme-${{ matrix.target.bun }}*
```

## The hard parts

Three known challenges Bun-compile of Mneme would face:

1. **`@huggingface/transformers` uses `onnxruntime-node` (native .node
   bindings).** Bun's `--compile` can't bundle native bindings into
   the executable. Workaround: omit transformers from the compiled
   binary entirely (the lite flavor naturally). For users who want
   bundled WASM embeddings, fall back to either Ollama (recommended)
   or post-install fetch of an onnxruntime-web sidecar.

2. **`node:sqlite` is Mneme's hot path** (the memory store). Bun's
   support for `node:sqlite` is recent + experimental. We'd need to
   either switch to better-sqlite3 (Bun-friendly), bun:sqlite (same
   API but Bun-native), or ship the binary with sqlite linked in.

3. **Filesystem layout assumptions.** Some Mneme code assumes
   `node_modules/<pkg>/...` paths to locate its own dist (e.g. the
   Phoenix DLL extraction walk-up). The bun-compiled binary has no
   `node_modules` — these paths would be `null`. The Phoenix extraction
   has a graceful "libDir not found" path (verified in
   `bin_phoenix_bootstrap.test.ts`), so this is mostly already handled,
   but every similar walk-up across the codebase needs an audit.

## Math/system trick: SEA (Single Executable Application)

Node 21+ also supports SEA — Node's native single-binary mode — via
`node --experimental-sea-config`. If Bun has issues with Mneme's deps,
the fallback path is Node SEA. Same UX (one file), different builder.
Node SEA is more conservative (no native deps bundled at all; ships as
a Node binary + a script payload) but matures fast in 22.x.

## Distribution channels (per-platform)

| OS | Channel | Tool |
|---|---|---|
| Windows | winget | `winget install Mneme.Mneme` |
| Windows | scoop | `scoop install mneme` |
| Windows | chocolatey | `choco install mneme-ai` |
| macOS | brew | `brew install mneme-ai` |
| Linux | apt (deb) | `apt install mneme-ai` |
| Linux | dnf (rpm) | `dnf install mneme-ai` |
| Linux/Mac | curl shellscript | `curl -L install.mneme.ai \| sh` |
| Any | GitHub Releases | direct .exe / .tar.gz |

Each channel needs a maintainer + auto-publish pipeline. Start with
winget + brew + GitHub Releases; the others are best-effort community
contributions.

## Tradeoffs

- ✅ Install is one file — no npm, no DLL, no EBUSY, no postinstall
- ✅ Predictable update flow (`mneme upgrade` writes new file + chmod)
- ✅ Multi-platform via CI matrix (no per-OS install scripting)
- ❌ Lose the `npm install` muscle memory (must teach winget/brew)
- ❌ ~80MB per platform per version (storage on GitHub Releases adds up)
- ❌ Native deps (sqlite, transformers if needed) require careful handling
- ❌ Bun runtime ABI changes between versions; pin Bun version in CI

## Roadmap to ship

| Sprint | Deliverable |
|---|---|
| 1 (1wk) | Prove Bun-compile works on a minimal Mneme subset (welcome + verify) |
| 2 (1wk) | Handle node:sqlite / @img / @huggingface incompatibilities |
| 3 (1wk) | CI matrix for 5 platforms + GitHub Releases upload |
| 4 (1wk) | winget manifest (Windows store) |
| 5 (1wk) | Homebrew tap (macOS + Linux) |
| 6 (1wk) | curl shellscript + apt repo |

Total: ~6 weeks for a solo dev. Stretch goal: same release pipeline
publishes npm AND OS packages, so users have full choice.

## Why this isn't shipped today

This is THE most ambitious workaround. It replaces npm as the install
path entirely, which means:

1. New audience to teach (people who'd `winget install` are different
   from people who'd `npm install -g`)
2. New CI surface (matrix of 5 builds; each can break independently)
3. New attack surface (OS package signing, GitHub Releases compromise)
4. Coordination with package-manager maintainers (winget + brew have
   per-package owners who must accept the manifest)

Best to attempt only after the npm install path is stable for 30+ days
in production AND there's a clear user request for "Mneme without npm".

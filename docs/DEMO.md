# Recording the Mneme demo GIF

The README and every social post points at one demo GIF. This page is the recipe.

## Tooling

[VHS](https://github.com/charmbracelet/vhs) by Charm. Renders a `.tape` script to a GIF deterministically. No screen recorder. No editing.

```bash
# Mac
brew install vhs ttyd ffmpeg

# Windows (with scoop)
scoop install vhs ttyd ffmpeg

# Linux
# follow https://github.com/charmbracelet/vhs#installation
```

Verify:

```bash
vhs --version
```

## Pick a target repo

You need a repo with **decent commit messages and at least 50 commits** so `mneme ask` returns interesting answers. Some good options:

1. The Mneme repo itself — meta but works (`cd D:\lib_ai_git`)
2. A small open-source project you contributed to
3. A clone of any repo you've seen Mneme pull good answers from

**Avoid** repos with `wip` / `update` / `fix` commit messages — the GIF will look unimpressive.

## Step by step

```bash
# 1. install + build Mneme once
cd D:\lib_ai_git
npm install
npm run build
cd packages\cli && npm link        # so `mneme` is on PATH

# 2. point it at the demo target repo
cd /path/to/demo-target-repo
mneme init
mneme index                        # need Ollama for best demo, or `--embedder hash`

# 3. eyeball the answers first — the GIF should show GOOD ones
mneme ask "your-real-question-1"
mneme ask "your-real-question-2"
# tweak demo.tape to use the questions that produced the best answers

# 4. record
cd D:\lib_ai_git
vhs demo.tape
# output: assets/demo.gif (about 1-3 MB)

# 5. inspect
# open assets/demo.gif in any image viewer
# if it's too long, edit Sleep values in demo.tape
# if text is unreadable, increase FontSize
```

## Pre-flight check

Before committing the GIF:

- [ ] Total length is **20-45 seconds** (HN/Twitter sweet spot)
- [ ] First frame is meaningful — viewers stop scrolling on Twitter in <0.5 s
- [ ] Final command is the most quotable result
- [ ] No real customer/user data in the output
- [ ] No paths that reveal `.claude/` or other private folders
- [ ] File size <5 MB (Twitter cuts off at 5 MB; X allows 15)

## Embedding

In `README.md`, replace the placeholder demo section with:

```markdown
<div align="center">
  <img src="./assets/demo.gif" alt="Mneme demo — asking why a function uses try/catch" width="900">
</div>
```

For social posts: upload `assets/demo.gif` directly to the platform — do **not** link to GitHub raw, the host caches kill autoplay.

## Re-record cadence

Re-record the demo every time:
- A major CLI command changes its output format
- A new headline feature ships (e.g. `mneme correlate` working end-to-end)
- The benchmark numbers improve significantly

The GIF on the README should always reflect the *current* product. A stale demo is worse than no demo.

## Common problems

**`vhs: Shell "bash" not found`** on Windows
→ Install Git Bash (it ships bash.exe) and ensure it's on PATH, or change `Set Shell "bash"` to `"powershell"` in `demo.tape`.

**Output GIF is huge (>10 MB)**
→ Reduce `Set Width` / `Set Height` (e.g. 1000×600 instead of 1100×700). Reduce `PlaybackSpeed` to 1.5x in social posts (vhs supports it).

**Color theme looks washed out**
→ Try a darker theme: `Set Theme "Tokyo Night"` or `"Dracula"` — both ship with vhs.

**Mneme command output overflows the recording width**
→ Use `--top-k 3` instead of the default 8 for the demo questions.

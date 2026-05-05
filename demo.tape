# Mneme demo recording — VHS script (v0.9.0)
#
# Render to GIF:
#   1. Install vhs:    https://github.com/charmbracelet/vhs
#      Windows: winget install charmbracelet.vhs && scoop install ttyd && winget install Gyan.FFmpeg
#      macOS:   brew install vhs
#      Linux:   see vhs releases page
#
#   2. Build the project once:
#        npm install && npm run build
#
#   3. Pre-prep this repo (already done if you've run mneme here):
#        node packages/cli/bin/mneme.js init
#        node packages/cli/bin/mneme.js index    (auto-detects hash/Ollama/OpenAI)
#        node packages/cli/bin/mneme.js entities (so `clones` has data to show)
#
#   4. Render the tape from the repo root:
#        cd /path/to/lib_ai_git
#        vhs demo.tape
#
#   5. Output appears at ./assets/demo.gif (~2-5 MB).
#
# Note for Windows: tape uses `Set Shell "bash"`. If you don't have Git Bash on
# PATH, change to `Set Shell "pwsh"` and adjust the `node packages/...` commands
# (PowerShell handles slashes fine, but verify before recording).

Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1100
Set Height 740
Set Theme "Catppuccin Macchiato"
Set TypingSpeed 28ms
Set PlaybackSpeed 1.0

# ── Hidden setup — alias `mneme` so the demo reads naturally ─────────────
Hide
Type 'alias mneme="node packages/cli/bin/mneme.js"'
Enter
Sleep 200ms
Type "clear"
Enter
Sleep 200ms
Show

# ── Opening ──────────────────────────────────────────────────────────────
Type "# μνήμη — the memory layer of your codebase"
Sleep 700ms
Enter
Type "# Code knows WHAT. Git knows WHY. Mneme connects them."
Sleep 800ms
Enter
Type "clear"
Enter
Sleep 250ms

# ── 1. DOCTOR — smart environment probe (NEW in v0.9.0) ──────────────────
Type "mneme doctor"
Sleep 400ms
Enter
Sleep 4000ms
Type "clear"
Enter
Sleep 200ms

# ── 2. ASK — flagship: why does this code exist? ─────────────────────────
Type `mneme ask "why does mneme refuse low-confidence answers?"`
Sleep 500ms
Enter
Sleep 5000ms
Type "clear"
Enter
Sleep 200ms

# ── 3. WHY — git archaeology on a real Mneme file ────────────────────────
Type "mneme why packages/core/src/retrieve/search.ts:21-50"
Sleep 400ms
Enter
Sleep 4500ms
Type "clear"
Enter
Sleep 200ms

# ── 4. CLONES — Phase 2 semantic similarity ──────────────────────────────
Type "mneme clones --threshold 0.85 --top 3"
Sleep 400ms
Enter
Sleep 4500ms
Type "clear"
Enter
Sleep 200ms

# ── 5. ADAPT — the "mutant" detector ─────────────────────────────────────
Type "mneme adapt"
Sleep 400ms
Enter
Sleep 4500ms
Type "clear"
Enter
Sleep 200ms

# ── 6. HEAL — turn garbage commits into memory ───────────────────────────
Type "mneme heal --dry-run"
Sleep 400ms
Enter
Sleep 4000ms
Type "clear"
Enter
Sleep 200ms

# ── 7. CALIBRATE — Wisdom Mutant Engine (NEW in v0.9.0) ──────────────────
Type "mneme calibrate"
Sleep 400ms
Enter
Sleep 4000ms
Type "clear"
Enter
Sleep 200ms

# ── 8. WISDOM — daily meditation, the brand touch ────────────────────────
Type "mneme wisdom"
Sleep 400ms
Enter
Sleep 5500ms
Type "clear"
Enter
Sleep 200ms

# ── Closing ──────────────────────────────────────────────────────────────
Type "# install:  npm i -g mneme-ai"
Enter
Sleep 500ms
Type "# repo:     github.com/patsa2561-art/mneme-ai"
Enter
Sleep 500ms
Type "# 11 of 17 wild ideas shipped. 24/7 self-improving. Local-first. MIT."
Enter
Sleep 1800ms

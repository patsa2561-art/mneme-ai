# Mneme demo recording — VHS script (v0.5.0)
#
# Render to GIF:
#   1. Install vhs:  https://github.com/charmbracelet/vhs
#   2. Build the project once:  npm install && npm run build
#   3. Link the CLI globally:    cd packages/cli && npm link
#   4. cd into ANY git repo (the bigger the history, the better the demo):
#        cd /path/to/your/repo
#        mneme init
#        mneme index               (or `mneme index --embedder hash` for fastest)
#   5. From that repo, render the tape:
#        vhs /path/to/lib_ai_git/demo.tape
#   6. Output appears at ./assets/demo.gif

Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1100
Set Height 740
Set Theme "Catppuccin Macchiato"
Set TypingSpeed 28ms
Set PlaybackSpeed 1.0

# ── Opening ─────────────────────────────────────────────
Type "# μνήμη — the memory layer of your codebase"
Sleep 700ms
Enter
Type "# Code knows WHAT. Git knows WHY. Mneme connects them."
Sleep 800ms
Enter
Type "clear"
Enter
Sleep 250ms

# ── 1. ASK — the "why" question ─────────────────────────
Type `mneme ask "why does the webhook handler retry?"`
Sleep 500ms
Enter
Sleep 4500ms

# ── 2. WHY on a specific file ───────────────────────────
Type "clear"
Enter
Sleep 200ms
Type "mneme why src/payment.ts:42-58"
Sleep 400ms
Enter
Sleep 4000ms

# ── 3. PHASE 2 — semantic clones ────────────────────────
Type "clear"
Enter
Sleep 200ms
Type "mneme clones --threshold 0.85 --top 3"
Sleep 400ms
Enter
Sleep 4500ms

# ── 4. WILD #14 RUNAWAY — silent complexity growth ──────
Type "clear"
Enter
Sleep 200ms
Type "mneme runaway --top 5"
Sleep 400ms
Enter
Sleep 4000ms

# ── 5. WILD #13 MIRROR — onboarding dossier ─────────────
Type "clear"
Enter
Sleep 200ms
Type "mneme mirror"
Sleep 400ms
Enter
Sleep 5000ms

# ── 6. WILD #1 HEAL — synthesize WHY from bad commits ───
Type "clear"
Enter
Sleep 200ms
Type "mneme heal --dry-run"
Sleep 400ms
Enter
Sleep 4500ms

# ── 7. WILD #5 PALIMPSEST — causal chain ────────────────
Type "clear"
Enter
Sleep 200ms
Type "mneme palimpsest src/payment.ts:42"
Sleep 400ms
Enter
Sleep 4500ms

# ── 8. WISDOM — the unique brand touch ──────────────────
Type "clear"
Enter
Sleep 200ms
Type "mneme wisdom"
Sleep 400ms
Enter
Sleep 6000ms

# ── Closing ─────────────────────────────────────────────
Type "clear"
Enter
Sleep 200ms
Type "# install:  npm i -g mneme-ai"
Enter
Sleep 500ms
Type "# repo:     github.com/patsa2561-art/mneme-ai"
Enter
Sleep 500ms
Type "# 15 wild ideas. 8 shipped. local-first. MIT."
Enter
Sleep 1500ms

# Mneme demo recording — VHS script
#
# Render to GIF:
#   1. Install vhs:  https://github.com/charmbracelet/vhs
#   2. Build the project once:  npm install && npm run build
#   3. From a fixture repo (or any indexed repo) run:
#        vhs demo.tape
#   4. The output appears at ./assets/demo.gif
#
# This script assumes:
#   - `mneme` is on PATH (`cd packages/cli && npm link` once, or use absolute path)
#   - The current working directory at recording time is a git repo with at
#     least a few commits indexed by Mneme (e.g. `mneme init && mneme index`).

Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1100
Set Height 700
Set Theme "Catppuccin Macchiato"
Set TypingSpeed 35ms
Set PlaybackSpeed 1.0

# --- Opening ----------------------------------------------------------------
Type "# μνήμη — the memory layer of your codebase"
Sleep 800ms
Enter
Sleep 400ms
Type "# Code knows WHAT. Git knows WHY. Mneme connects them."
Sleep 1s
Enter
Type "clear"
Enter
Sleep 300ms

# --- Demo 1: ask ------------------------------------------------------------
Type `mneme ask "why does parseAmount use try/catch around toString?"`
Sleep 600ms
Enter
Sleep 5s

# --- Demo 2: why ------------------------------------------------------------
Type "clear"
Enter
Sleep 300ms
Type "mneme why src/payment.ts:42-58"
Sleep 500ms
Enter
Sleep 4s

# --- Demo 3: status ---------------------------------------------------------
Type "clear"
Enter
Sleep 300ms
Type "mneme status"
Sleep 400ms
Enter
Sleep 3s

# --- Demo 4: wisdom (the unique touch) --------------------------------------
Type "clear"
Enter
Sleep 300ms
Type "mneme wisdom"
Sleep 400ms
Enter
Sleep 6s

# --- Closing ----------------------------------------------------------------
Type "clear"
Enter
Sleep 200ms
Type "# install:  npm i -g mneme-ai"
Enter
Sleep 600ms
Type "# repo:     github.com/patsa2561-art/mneme-ai"
Enter
Sleep 1500ms

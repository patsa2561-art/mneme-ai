/**
 * v1.80.0 -- CONDUIT: per-vendor uninstall recipe.
 *
 * "How do I uninstall Mneme from <X>?" answered for every surface:
 *
 *   editor AI (Cursor / Continue / Cline / Aider / Zed / Codex /
 *              Windsurf / Claude Code / JetBrains AI):
 *     -> `mneme uninstall` on local removes everything:
 *        - daemon + service
 *        - .mneme/ in repo (with --purge)
 *        - parasite-bridge blocks in CLAUDE.md / AGENTS.md / GEMINI.md
 *          / .cursor/rules / .windsurfrules / .cursorrules
 *        - global CLI binary
 *
 *   web AI (chatgpt.com / gemini.google.com / claude.ai-web /
 *           copilot.microsoft.com / deepseek.com):
 *     -> Nothing to uninstall. Mneme was NEVER installed there.
 *        The soul prompt is just text. Close the chat tab; gone.
 *
 *   browser userscript / bookmarklet:
 *     -> Open Tampermonkey -> disable / delete the script.
 *     -> Or just remove the bookmark from the bar.
 */

export type UninstallSurface =
  | "editor-ai"
  | "web-ai"
  | "browser-userscript"
  | "browser-bookmarklet"
  | "all";

export interface UninstallStep {
  step: number;
  what: string;
  command?: string;
  explanation: string;
}

export interface UninstallPlan {
  surface: UninstallSurface;
  steps: UninstallStep[];
  estimateMinutes: number;
  postCheck: string;
}

export function uninstallPlan(surface: UninstallSurface): UninstallPlan {
  switch (surface) {
    case "editor-ai":
      return {
        surface,
        steps: [
          { step: 1, what: "Run uninstall on the local machine", command: "mneme uninstall --purge", explanation: "Removes daemon, OS service, .mneme/ dir, npm binary, parasite-bridge blocks from CLAUDE.md / AGENTS.md / GEMINI.md / .cursor / .windsurfrules / .cursorrules." },
          { step: 2, what: "Restart your editor", explanation: "MCP server connections refresh; Mneme tools disappear from the tool list." },
          { step: 3, what: "Verify", command: "which mneme", explanation: "Should return nothing. If still present, run npm uninstall -g mneme-ai." },
        ],
        estimateMinutes: 2,
        postCheck: "`which mneme` empty + no `.mneme/` directory in your repo + no sentinel blocks in agent files.",
      };
    case "web-ai":
      return {
        surface,
        steps: [
          { step: 1, what: "Close the chat tab", explanation: "Web AIs never had Mneme installed; the soul prompt was just pasted text. Closing the tab clears the context." },
          { step: 2, what: "Stop pasting new soul prompts", explanation: "No persistent state on the web AI side -- once you stop pasting, no further Mneme context reaches it." },
        ],
        estimateMinutes: 0,
        postCheck: "Open a fresh chat tab; nothing Mneme-related survives.",
      };
    case "browser-userscript":
      return {
        surface,
        steps: [
          { step: 1, what: "Open your userscript manager", explanation: "Tampermonkey / Greasemonkey / Violentmonkey extension icon in the browser toolbar." },
          { step: 2, what: "Find the Mneme Soul Injector entry", explanation: "Usually named `mneme-soul-injector.user.js`." },
          { step: 3, what: "Click Delete (or toggle Disabled)", explanation: "Removes the 💉 button from chat pages on next reload." },
        ],
        estimateMinutes: 1,
        postCheck: "Reload chatgpt.com (or any chat surface) -- the 💉 button is gone.",
      };
    case "browser-bookmarklet":
      return {
        surface,
        steps: [
          { step: 1, what: "Open browser bookmarks", explanation: "Bookmark bar or bookmark manager." },
          { step: 2, what: "Right-click the 💉 Mneme Soul bookmark", explanation: "Delete it." },
        ],
        estimateMinutes: 1,
        postCheck: "Bookmark gone from the bar; no `javascript:` URI remains.",
      };
    case "all":
      return {
        surface: "all",
        steps: [
          { step: 1, what: "Editor: run `mneme uninstall --purge`", command: "mneme uninstall --purge", explanation: "Covers all editor AIs in one shot via parasite disinfect." },
          { step: 2, what: "Web AIs: close chat tabs", explanation: "Nothing persistent; clean." },
          { step: 3, what: "Browser: disable userscript / remove bookmarklet", explanation: "Surface-specific UI; takes ~1 minute each." },
          { step: 4, what: "Optional: clear archived souls", command: "rm -rf .mneme/abyss/souls", explanation: "If you want to wipe the REVENANT archive too." },
        ],
        estimateMinutes: 4,
        postCheck: "No `mneme` binary, no `.mneme/` dir, no sentinel blocks, no userscripts, no bookmarklets.",
      };
  }
}

/** Render an uninstall plan as a plain-English markdown block. */
export function renderUninstallPlan(plan: UninstallPlan): string {
  const lines: string[] = [];
  lines.push(`## Uninstall Mneme from \`${plan.surface}\``);
  lines.push(``);
  lines.push(`Estimated time: **${plan.estimateMinutes} minute(s)**.`);
  lines.push(``);
  for (const s of plan.steps) {
    lines.push(`${s.step}. **${s.what}**`);
    if (s.command) lines.push(`   - Command: \`${s.command}\``);
    lines.push(`   - Why: ${s.explanation}`);
  }
  lines.push(``);
  lines.push(`### Post-check`);
  lines.push(plan.postCheck);
  return lines.join("\n");
}

/**
 * v2.77.0 — `mneme ui` : full-screen, arrow-key interactive TUI.
 *
 * Zero-dependency (raw-mode stdin + ANSI), on-brand with Mneme's local-first
 * ethos. Type plain language → the right capability surfaces; ↑↓ to navigate;
 * Enter runs a parameterless command live (or shows how to run a parameterized
 * one); Esc clears the query then quits. New tools appear automatically because
 * the list IS the live MNEME_COMMAND_CATALOG. All UI LOGIC is pure + tested in
 * src/ui/tui_core.ts; this file is just the terminal driver.
 */

import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { initState, reduce, isParameterless, shellArgsFor, loadCatalog, type CapItem, type UiState, type KeyEvent } from "../ui/tui_core.js";
import { renderFrame, stripAnsi } from "../ui/tui_render.js";

export interface UiOptions { cwd: string; version?: string; }

const ALT_ON = "\x1b[?1049h\x1b[?25l"; // enter alt-screen + hide cursor
const ALT_OFF = "\x1b[?25h\x1b[?1049l"; // show cursor + leave alt-screen
const HOME_CLEAR = "\x1b[H\x1b[2J";

async function loadItems(): Promise<CapItem[]> {
  try {
    const core = await import("@mneme-ai/core") as { agentManifest?: { MNEME_COMMAND_CATALOG?: unknown[] } };
    return loadCatalog(core.agentManifest?.MNEME_COMMAND_CATALOG ?? []);
  } catch { return []; }
}

export async function uiCommand(opts: UiOptions): Promise<void> {
  const items = await loadItems();
  // Non-interactive fallback — a TUI needs a real TTY. Print a useful pointer
  // instead of corrupting a pipe / CI log.
  if (!process.stdout.isTTY || !process.stdin.isTTY || items.length === 0) {
    process.stdout.write(
      items.length === 0
        ? "mneme ui: capability catalog unavailable.\n"
        : "mneme ui needs an interactive terminal (TTY).\n  • Run it in a real shell, or\n  • use `mneme atlas` (static capability map) / `mneme <command> --help`.\n",
    );
    return;
  }

  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  // Reserve ~9 rows for title/search/separators/detail/footer; rest is the list.
  let state: UiState = initState(items, Math.max(3, rows - 12));

  const paint = () => {
    const r = process.stdout.rows || 24;
    const c = process.stdout.columns || 80;
    if (state.mode === "browse") state = { ...state, listRows: Math.max(3, r - 12) };
    const frame = renderFrame(state, c, r, opts.version ?? "?");
    process.stdout.write(HOME_CLEAR + frame.join("\n"));
  };

  const cleanup = () => {
    try { process.stdin.setRawMode?.(false); } catch { /* */ }
    process.stdin.pause();
    process.stdout.write(ALT_OFF);
  };

  // Run a parameterless `mneme <verb>` live; capture output into the pane.
  const runItem = (item: CapItem) => {
    if (!isParameterless(item)) {
      state = { ...state, mode: "output", outputTitle: `${item.command}  (needs arguments)`, output:
        `This capability takes arguments, so it can't be run blind from the menu.\n\n` +
        `Run it yourself:\n   ${item.command}\n\n` +
        (item.when ? `When to use:\n   ${item.when}\n` : ""),
      };
      paint();
      return;
    }
    const args = shellArgsFor(item);
    process.stdout.write(HOME_CLEAR + `\x1b[1m▶ running:\x1b[0m mneme ${args.join(" ")}\n\n(please wait…)`);
    const r = spawnSync(process.execPath, [process.argv[1]!, ...args], {
      cwd: opts.cwd,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, MNEME_WARMCALL: "0", NO_COLOR: "1" }, // fresh + clean text in the pane
    });
    const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
    state = { ...state, mode: "output", outputTitle: `mneme ${args.join(" ")}  ${r.status === 0 ? "✓" : `(exit ${r.status ?? "?"})`}`,
      output: stripAnsi(out || "(no output)") };
    paint();
  };

  return new Promise<void>((resolve) => {
    process.stdout.write(ALT_ON);
    readline.emitKeypressEvents(process.stdin);
    try { process.stdin.setRawMode?.(true); } catch { /* some terminals */ }
    process.stdin.resume();
    paint();

    const onResize = () => paint();
    process.stdout.on("resize", onResize);

    const finish = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdout.removeListener("resize", onResize);
      cleanup();
      resolve();
    };

    const onKey = (_str: string, key: readline.Key | undefined) => {
      const k: KeyEvent = { name: key?.name, ctrl: !!key?.ctrl, sequence: key?.sequence };
      const { state: next, action } = reduce(state, k);
      state = next;
      if (action.type === "quit") { finish(); return; }
      if (action.type === "run") { runItem(action.item); return; }
      paint();
    };

    process.stdin.on("keypress", onKey);
  });
}

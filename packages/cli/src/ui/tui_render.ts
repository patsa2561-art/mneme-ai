/**
 * v2.77.0 — INTERACTIVE TUI renderer (pure: state → lines). No terminal needed
 * to test layout; the driver just joins these lines + paints the screen.
 */

import type { UiState, CapItem } from "./tui_core.js";
import { isParameterless } from "./tui_core.js";

const ESC = "\x1b[";
const INV = `${ESC}7m`;     // inverse (selected row)
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const CYAN = `${ESC}36m`;
const RST = `${ESC}0m`;

/** Visible width ignoring ANSI (good enough for our ASCII + a few emoji). */
export function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

export function truncate(s: string, width: number): string {
  const plain = stripAnsi(s);
  if (plain.length <= width) return s + " ".repeat(Math.max(0, width - plain.length));
  return plain.slice(0, Math.max(0, width - 1)) + "…";
}

function wrap(s: string, width: number, maxLines: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length > width) { if (cur) lines.push(cur); cur = w; }
    else cur += (cur ? " " : "") + w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Render the whole frame as an array of lines (each padded to `cols`). */
export function renderFrame(state: UiState, cols: number, rows: number, version = "?"): string[] {
  const W = Math.max(40, cols);
  if (state.mode === "output") return renderOutput(state, W, rows);

  const lines: string[] = [];
  // 0 — title
  lines.push(truncate(`${BOLD}${CYAN}⏳ Mneme${RST}${DIM} — interactive · type to search · ↑↓ move · Enter run · Esc clear/quit${RST}  ${DIM}v${version}${RST}`, W));
  // 1 — search box
  const count = `${DIM}(${state.filtered.length}/${state.all.length})${RST}`;
  lines.push(truncate(`${BOLD}🔎 ${RST}${state.query}${BOLD}▏${RST} ${count}`, W));
  lines.push(truncate(`${DIM}${"─".repeat(W)}${RST}`, W));

  // list window
  const win = state.filtered.slice(state.scrollTop, state.scrollTop + state.listRows);
  if (win.length === 0) {
    lines.push(truncate(`${DIM}  no capability matches “${state.query}” — try fewer / different words${RST}`, W));
    for (let i = 1; i < state.listRows; i++) lines.push(" ".repeat(W));
  } else {
    for (let i = 0; i < state.listRows; i++) {
      const item = win[i];
      if (!item) { lines.push(" ".repeat(W)); continue; }
      const isSel = state.scrollTop + i === state.selected;
      const tag = `${DIM}[${item.group}]${RST}`;
      const body = `${isSel ? "▶ " : "  "}${item.command}`;
      const row = truncate(`${body}  ${tag}`, W);
      lines.push(isSel ? `${INV}${truncate(body + "  [" + item.group + "]", W)}${RST}` : row);
    }
  }

  // detail pane for the selected item
  lines.push(truncate(`${DIM}${"─".repeat(W)}${RST}`, W));
  const sel = state.filtered[state.selected];
  if (sel) {
    lines.push(truncate(`${BOLD}${sel.command}${RST} ${DIM}· ${sel.group} · since ${sel.since}${RST}`, W));
    for (const l of wrap(sel.what, W - 2, 3)) lines.push(truncate("  " + l, W));
    if (sel.when) for (const l of wrap(`when: ${sel.when}`, W - 2, 2)) lines.push(truncate(`  ${DIM}${l}${RST}`, W));
    lines.push(truncate(runHint(sel), W));
  }

  // footer
  lines.push(truncate(`${DIM}${"─".repeat(W)}${RST}`, W));
  lines.push(truncate(`${DIM}↑↓ navigate · PgUp/PgDn · type to search · Enter ${isParameterless(sel ?? ({} as CapItem)) ? "run" : "show usage"} · Esc clear/quit${RST}`, W));
  return lines;
}

function runHint(item: CapItem): string {
  if (isParameterless(item)) return `  ${CYAN}↵ Enter${RST}${DIM} runs this now${RST}`;
  if (/^[a-z_]+\.[a-z_]/i.test(item.command.split(" ")[0] ?? "")) return `  ${DIM}MCP tool — call from your AI agent: ${item.command}${RST}`;
  return `  ${DIM}needs arguments — run: ${item.command}${RST}`;
}

function renderOutput(state: UiState, W: number, rows: number): string[] {
  const lines: string[] = [];
  lines.push(truncate(`${BOLD}${CYAN}▶ ${state.outputTitle ?? "output"}${RST}`, W));
  lines.push(truncate(`${DIM}${"─".repeat(W)}${RST}`, W));
  const body = (state.output ?? "").split(/\r?\n/);
  const max = Math.max(3, rows - 4);
  for (let i = 0; i < max; i++) lines.push(truncate(body[i] ?? "", W));
  lines.push(truncate(`${DIM}— press any key to return to the menu —${RST}`, W));
  return lines;
}

/**
 * v2.77.0 — INTERACTIVE TUI core (pure, dependency-free, fully testable).
 *
 * The driver (commands/ui.ts) owns raw-mode stdin + the alt-screen; everything
 * here is pure: load the capability catalog, fuzzy-filter/rank it, fold a
 * keypress into new state, and render state → lines. Pure functions = the TUI
 * logic is unit-tested without a terminal.
 *
 * Design goal: the user types plain language ("how do I check if a claim is
 * true") and the right capability surfaces — zero command memorization. New
 * tools appear automatically because the list is the live MNEME_COMMAND_CATALOG.
 */

export interface CapItem {
  command: string;
  alias?: string;
  since: string;
  what: string;
  when: string;
  group: string;
}

export interface UiState {
  query: string;
  all: CapItem[];
  filtered: CapItem[];
  selected: number;   // index into filtered (clamped)
  scrollTop: number;  // first visible filtered row
  listRows: number;   // visible rows in the list pane
  mode: "browse" | "output";
  output?: string;    // captured command output (mode === "output")
  outputTitle?: string;
}

export type UiAction =
  | { type: "none" }
  | { type: "quit" }
  | { type: "run"; item: CapItem };

export interface KeyEvent {
  name?: string;       // "up","down","return","backspace","escape","pageup","pagedown","home","end","c", ...
  ctrl?: boolean;
  sequence?: string;   // raw char for printable input
}

/* ── catalog ─────────────────────────────────────────────────────────── */

/** Normalize a raw manifest entry into a CapItem (defensive). */
export function toCapItem(raw: unknown): CapItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.command !== "string" || r.command.length === 0) return null;
  return {
    command: r.command,
    alias: typeof r.alias === "string" ? r.alias : undefined,
    since: typeof r.since === "string" ? r.since : "?",
    what: typeof r.what === "string" ? r.what : "",
    when: typeof r.when === "string" ? r.when : "",
    group: typeof r.group === "string" ? r.group : "core",
  };
}

export function loadCatalog(rawList: unknown[]): CapItem[] {
  const out: CapItem[] = [];
  for (const r of rawList ?? []) { const c = toCapItem(r); if (c) out.push(c); }
  // De-dup by command; stable.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.command) ? false : (seen.add(c.command), true)));
}

/* ── fuzzy filter + ranking ──────────────────────────────────────────── */

/** Score one item against one lowercased term. Higher = better; 0 = no match.
 *  Weights: command-name >> alias > group > what > when. */
function scoreTerm(item: CapItem, term: string): number {
  const cmd = item.command.toLowerCase();
  const alias = (item.alias ?? "").toLowerCase();
  const what = item.what.toLowerCase();
  const when = item.when.toLowerCase();
  const group = item.group.toLowerCase();
  let s = 0;
  if (cmd.includes(term)) s = Math.max(s, cmd.startsWith(term) || cmd.includes(" " + term) ? 100 : 70);
  if (alias && alias.includes(term)) s = Math.max(s, 60);
  if (group.includes(term)) s = Math.max(s, 40);
  if (what.includes(term)) s = Math.max(s, 25);
  if (when.includes(term)) s = Math.max(s, 12);
  return s;
}

/** Filter + rank. Empty query → all (stable). Multi-term = AND (every term
 *  must match somewhere); score = sum of per-term best scores. */
export function filterItems(all: CapItem[], query: string): CapItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return all.slice();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: CapItem; score: number }> = [];
  for (const item of all) {
    let total = 0; let ok = true;
    for (const t of terms) { const s = scoreTerm(item, t); if (s === 0) { ok = false; break; } total += s; }
    if (ok) scored.push({ item, score: total });
  }
  scored.sort((a, b) => (b.score - a.score) || a.item.command.localeCompare(b.item.command));
  return scored.map((s) => s.item);
}

/* ── state ───────────────────────────────────────────────────────────── */

export function initState(all: CapItem[], listRows: number): UiState {
  return { query: "", all, filtered: all.slice(), selected: 0, scrollTop: 0, listRows: Math.max(1, listRows), mode: "browse" };
}

function clampScroll(s: UiState): UiState {
  // Keep selected within the visible window.
  let scrollTop = s.scrollTop;
  if (s.selected < scrollTop) scrollTop = s.selected;
  else if (s.selected >= scrollTop + s.listRows) scrollTop = s.selected - s.listRows + 1;
  scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, s.filtered.length - s.listRows)));
  return { ...s, scrollTop };
}

function refilter(s: UiState): UiState {
  const filtered = filterItems(s.all, s.query);
  return clampScroll({ ...s, filtered, selected: filtered.length === 0 ? 0 : Math.min(s.selected, filtered.length - 1) });
}

/** True for a single printable character we should append to the query. */
function isPrintable(k: KeyEvent): boolean {
  return !k.ctrl && typeof k.sequence === "string" && k.sequence.length === 1 && k.sequence >= " " && k.sequence !== "\x7f";
}

/** Fold a keypress into new state + an action for the driver to perform.
 *  Pure: same (state, key) → same (state, action). */
export function reduce(state: UiState, key: KeyEvent): { state: UiState; action: UiAction } {
  // Output pane: any key returns to browse.
  if (state.mode === "output") {
    return { state: { ...state, mode: "browse", output: undefined, outputTitle: undefined }, action: { type: "none" } };
  }
  const name = key.name ?? "";
  if (key.ctrl && (name === "c")) return { state, action: { type: "quit" } };
  switch (name) {
    case "escape":
      // Esc clears the query first; a second Esc (empty query) quits.
      if (state.query.length > 0) return { state: refilter({ ...state, query: "" }), action: { type: "none" } };
      return { state, action: { type: "quit" } };
    case "return": {
      const item = state.filtered[state.selected];
      return item ? { state, action: { type: "run", item } } : { state, action: { type: "none" } };
    }
    case "up": return { state: clampScroll({ ...state, selected: Math.max(0, state.selected - 1) }), action: { type: "none" } };
    case "down": return { state: clampScroll({ ...state, selected: Math.min(Math.max(0, state.filtered.length - 1), state.selected + 1) }), action: { type: "none" } };
    case "pageup": return { state: clampScroll({ ...state, selected: Math.max(0, state.selected - state.listRows) }), action: { type: "none" } };
    case "pagedown": return { state: clampScroll({ ...state, selected: Math.min(Math.max(0, state.filtered.length - 1), state.selected + state.listRows) }), action: { type: "none" } };
    case "home": return { state: clampScroll({ ...state, selected: 0 }), action: { type: "none" } };
    case "end": return { state: clampScroll({ ...state, selected: Math.max(0, state.filtered.length - 1) }), action: { type: "none" } };
    case "backspace": return { state: state.query.length > 0 ? refilter({ ...state, query: state.query.slice(0, -1) }) : state, action: { type: "none" } };
    default:
      if (isPrintable(key)) return { state: refilter({ ...state, query: state.query + key.sequence }), action: { type: "none" } };
      return { state, action: { type: "none" } };
  }
}

/* ── run classification ──────────────────────────────────────────────── */

/** Does this catalog command take arguments (placeholders) or is it MCP-only?
 *  Such commands can't be run blind from the TUI — we show the template. */
export function isParameterless(item: CapItem): boolean {
  const c = item.command;
  if (/[.]/.test(c.split(" ")[0] ?? "")) return false;     // mneme.x.y MCP tool, not a shell verb
  if (/[<\[]/.test(c)) return false;                        // has <arg> / [opt]
  return /^mneme\s+\S/.test(c);                             // a real `mneme <verb...>` shell command
}

/** The shell argv (after "mneme") for a parameterless command. */
export function shellArgsFor(item: CapItem): string[] {
  return item.command.replace(/^mneme\s+/, "").trim().split(/\s+/).filter(Boolean);
}

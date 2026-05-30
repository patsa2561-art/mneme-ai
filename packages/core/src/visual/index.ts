/**
 * v2.116.0 — THE VISUAL KNOWLEDGE MAP (a gorgeous, deterministic, dependency-
 * free terminal renderer for Mneme's signed state).
 *
 * The honest, world-class core of the "turn the terminal into a Visual
 * Knowledge Map" pitch. Every time Mneme has something to show — a verify
 * verdict, the token-savings treasury, a loop-guard state — it can render a
 * compact, beautiful CONSTELLATION frame instead of raw text.
 *
 * WHY IT WORKS EVERYWHERE WITH ZERO CONFIG (the "no conditions" requirement):
 * it is a PURE function (state + terminal-capabilities → string) that GRACEFULLY
 * DEGRADES. It capability-detects the surface and renders the richest form that
 * surface supports:
 *   - truecolor terminal → per-character RGB GRADIENTS + Unicode box-art + glyphs
 *   - 256-color terminal → nearest-palette colors
 *   - NO_COLOR / non-TTY / CI / a pipe → clean Unicode (or pure ASCII) — NO escapes
 * So it is beautiful where it can be and never garbles where it can't. One
 * renderer, every platform, every AI-agent terminal.
 *
 * DIAKRISIS (what this deliberately is NOT — the pitch's fantasy, refused):
 *   - ❌ NO 60fps 3D ASCII ray-tracing / Doom-fly-through — non-portable, breaks
 *        on non-TTY/CI, and a heavyweight default is the opposite of "no config".
 *   - ❌ NO spatial-audio soundscape (node-speaker) — not portable, intrusive as
 *        a default, and silent surfaces (CI, pipes) can't use it.
 *   - ❌ NO kinetic-physics falling letters at 60fps — same reasons.
 *   - ❌ It cannot inject visuals into a hosted web chat UI (claude.ai/chatgpt) —
 *        that is the browser-polygraph's lane. It renders where Mneme runs: the
 *        terminal, the CLI, and MCP tool results an agent can echo.
 * What remains is REAL: a signed-state visual that is measurably correct,
 * deterministic, and portable — frame, not fireworks.
 *
 * COMPLEXITY: render = O(W·H) for a W×H frame (here O(W) — a few fixed rows);
 * gradient = O(len) per string. Pure + total (108-error rule): no I/O, no deps,
 * never throws. The CLI/MCP gather the live state + pick the caps.
 */

export interface TermCaps {
  /** 24-bit color (\x1b[38;2;r;g;bm). */
  truecolor: boolean;
  /** 256-color palette. */
  color256: boolean;
  /** any color at all (false → emit ZERO escape codes). */
  color: boolean;
  /** box-drawing + block glyphs are safe (false → pure ASCII). */
  unicode: boolean;
  /** render width in columns (clamped 24..120). */
  width: number;
}

/** Detect terminal capabilities from an env snapshot + tty flags. Pure: same
 *  inputs → same caps (so it's testable + reproducible). Honors NO_COLOR,
 *  FORCE_COLOR, COLORTERM, TERM, CI, and non-TTY. */
export function detectCaps(env: Record<string, string | undefined>, isTTY: boolean, columns?: number): TermCaps {
  const e = env ?? {};
  const force = e["FORCE_COLOR"];
  const noColor = typeof e["NO_COLOR"] === "string" || e["MNEME_NO_COLOR"] === "1";
  const isCI = typeof e["CI"] === "string" && e["CI"] !== "false";
  // color is on when: forced, OR (a TTY and not explicitly disabled).
  const color = !noColor && (force === "1" || force === "2" || force === "3" || force === "true" || (isTTY && !isCI));
  const colorterm = (e["COLORTERM"] ?? "").toLowerCase();
  const term = (e["TERM"] ?? "").toLowerCase();
  const truecolor = color && (force === "3" || colorterm === "truecolor" || colorterm === "24bit" || /-truecolor|kitty|wezterm|iterm/.test(term));
  const color256 = color && (truecolor || force === "2" || /256/.test(term) || colorterm !== "");
  // unicode: assume yes on a TTY / modern term; off when explicitly ASCII or a
  // dumb terminal. (A pipe still gets unicode unless asked otherwise — most log
  // viewers handle UTF-8; flip MNEME_ASCII=1 to force ASCII.)
  const unicode = e["MNEME_ASCII"] !== "1" && term !== "dumb";
  const w = Number.isFinite(columns as number) && (columns as number) > 0 ? (columns as number) : (parseInt(e["COLUMNS"] ?? "", 10) || 80);
  const width = Math.max(24, Math.min(120, w));
  return { truecolor, color256, color, unicode, width };
}

type RGB = readonly [number, number, number];
const RESET = "\x1b[0m";

function clamp255(n: number): number { return n < 0 ? 0 : n > 255 ? 255 : Math.round(n); }

/** 24-bit → nearest xterm-256 cube index (deterministic). */
function to256(r: number, g: number, b: number): number {
  const ci = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.round((v - 35) / 40));
  const idx = 16 + 36 * ci(r) + 6 * ci(g) + ci(b);
  return idx < 16 ? 16 : idx > 255 ? 255 : idx;
}

/** Foreground color escape for an RGB, honoring caps. "" when color is off. */
function fg(rgb: RGB, caps: TermCaps): string {
  if (!caps?.color) return "";
  const [r, g, b] = [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2])];
  if (caps.truecolor) return `\x1b[38;2;${r};${g};${b}m`;
  if (caps.color256) return `\x1b[38;5;${to256(r, g, b)}m`;
  return "";
}

function endColor(caps: TermCaps): string { return caps?.color ? RESET : ""; }

/** Per-character RGB gradient across `text`. Degrades to flat (one color) on
 *  256-color and to plain text in mono. Deterministic. Total. */
export function gradientText(text: string, from: RGB, to: RGB, caps: TermCaps): string {
  try {
    const s = typeof text === "string" ? text : "";
    if (!s) return "";
    if (!caps?.color) return s;
    if (!caps.truecolor) {
      // a single mid color keeps 256-color terminals from per-char churn
      const mid: RGB = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      return fg(mid, caps) + s + endColor(caps);
    }
    const n = s.length;
    let out = "";
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const rgb: RGB = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      out += fg(rgb, caps) + s[i];
    }
    return out + endColor(caps);
  } catch { return typeof text === "string" ? text : ""; }
}

const BLOCKS_U = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const BLOCKS_A = [".", ".", ":", ":", "-", "=", "+", "#"] as const;

/** A sparkline from a numeric series. Unicode block-ladder (or ASCII ramp).
 *  Deterministic + total: empty/garbage → "". */
export function sparkline(values: ReadonlyArray<number>, caps: TermCaps): string {
  try {
    const vs = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
    if (vs.length === 0) return "";
    const ramp = caps?.unicode ? BLOCKS_U : BLOCKS_A;
    const min = Math.min(...vs), max = Math.max(...vs);
    const span = max - min || 1;
    return vs.map((v) => ramp[Math.min(ramp.length - 1, Math.max(0, Math.floor(((v - min) / span) * (ramp.length - 1))))]).join("");
  } catch { return ""; }
}

export type NodeStatus = "ok" | "warn" | "bad" | "idle";

export interface MapNode { label: string; status: NodeStatus; detail?: string }

export interface MapState {
  version?: string;
  nodes?: MapNode[];
  /** token-savings series for the sparkline (e.g. recent per-call savings). */
  savingsSpark?: number[];
  /** headline figure under the map (e.g. "12,403 tokens saved"). */
  headline?: string;
  /** signed ✓ footer line. */
  signed?: boolean;
}

// status → (glyph unicode, glyph ascii, color)
const STATUS_STYLE: Record<NodeStatus, { u: string; a: string; rgb: RGB }> = {
  ok:   { u: "●", a: "o", rgb: [80, 250, 160] },
  warn: { u: "◆", a: "*", rgb: [250, 204, 90] },
  bad:  { u: "✖", a: "x", rgb: [250, 90, 110] },
  idle: { u: "○", a: ".", rgb: [120, 130, 150] },
};

/** Fold caller-supplied text to pure ASCII (used when caps.unicode is false, so
 *  the renderer's ASCII guarantee holds even if the CALLER passed Unicode).
 *  Common punctuation maps to its ASCII analogue; anything else ≥128 → '?'. */
function asciiFold(s: string): string {
  let out = "";
  for (const ch of String(s)) {
    const code = ch.codePointAt(0) ?? 63;
    if (code < 128) { out += ch; continue; }
    out += ch === "−" || ch === "—" || ch === "–" ? "-"
      : ch === "·" || ch === "•" ? "-"
      : ch === "✦" || ch === "★" ? "*"
      : ch === "✓" || ch === "✔" ? "v"
      : "?";
  }
  return out;
}
/** caps-aware text: ASCII-folded when the surface is ASCII-only. */
function txt(s: string, caps: TermCaps): string { return caps?.unicode ? String(s) : asciiFold(String(s)); }

function strip(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function visLen(s: string): number { return strip(s).length; }
function padEndVis(s: string, n: number): string { const pad = n - visLen(s); return pad > 0 ? s + " ".repeat(pad) : s; }
/** Fit a (possibly ANSI-colored) string to EXACTLY n visible columns: pad if
 *  short, ANSI-aware truncate (with an ellipsis) if long — so a narrow terminal
 *  never overflows the frame. Total. */
function fitVis(s: string, n: number, caps: TermCaps): string {
  if (n <= 0) return "";
  if (visLen(s) <= n) return padEndVis(s, n);
  const ell = caps?.unicode ? "…" : ".";
  let out = "", vis = 0, i = 0;
  while (i < s.length && vis < n - 1) {
    if (s[i] === "\x1b") { const mm = /^\x1b\[[0-9;]*m/.exec(s.slice(i)); if (mm) { out += mm[0]; i += mm[0].length; continue; } }
    out += s[i]; vis++; i++;
  }
  return out + ell + (caps?.color ? RESET : "");
}

/**
 * Render the Visual Knowledge Map frame. A rounded, gradient-bordered box with
 * a gradient title, a constellation row of status nodes connected by edges, a
 * savings sparkline, and a signed footer. Returns a multi-line string ready to
 * print. Pure + total + deterministic.
 */
export function renderKnowledgeMap(state: MapState, caps: TermCaps): string {
  try {
    const c = caps ?? detectCaps({}, false);
    const inner = Math.max(20, Math.min(c.width, 76) - 2);
    const U = c.unicode;
    const box = U
      ? { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", dot: "·", link: "─" }
      : { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", dot: ".", link: "-" };
    const VIOLET: RGB = [167, 139, 250];
    const CYAN: RGB = [56, 230, 220];
    const DIM: RGB = [110, 120, 140];

    const border = (s: string) => gradientText(s, VIOLET, CYAN, c);
    const lines: string[] = [];

    // ── top border ──
    lines.push(border(box.tl + box.h.repeat(inner) + box.tr));

    // ── title row: μνήμη · MNEME (gradient) ──
    const titleRaw = U ? "μνήμη · MNEME — knowledge map" : "mneme - knowledge map";
    const title = gradientText(titleRaw, VIOLET, CYAN, c);
    lines.push(border(box.v) + " " + fitVis(title, inner - 2, c) + " " + border(box.v));

    // ── constellation row: nodes joined by edges ──
    const nodes = (Array.isArray(state?.nodes) ? state!.nodes! : []).slice(0, 5);
    if (nodes.length > 0) {
      const parts: string[] = [];
      for (const n of nodes) {
        const st = STATUS_STYLE[n.status] ?? STATUS_STYLE.idle;
        const glyph = U ? st.u : st.a;
        const lbl = txt(String(n.label ?? "").slice(0, 12), c);
        parts.push((c.color ? fg(st.rgb, c) + glyph + endColor(c) : glyph) + " " + lbl);
      }
      const edge = c.color ? fg(DIM, c) + ` ${box.link}${box.link} ` + endColor(c) : ` ${box.link}${box.link} `;
      const constellation = parts.join(edge);
      // wrap is unlikely (≤5 short nodes) but clamp defensively
      lines.push(border(box.v) + " " + fitVis(constellation, inner - 2, c) + " " + border(box.v));
    }

    // ── savings sparkline ──
    const spark = sparkline(state?.savingsSpark ?? [], c);
    if (spark) {
      const sparkColored = gradientText(spark, [80, 250, 160], CYAN, c);
      const label = (c.color ? fg(DIM, c) : "") + "saved " + endColor(c);
      lines.push(border(box.v) + " " + fitVis(label + sparkColored, inner - 2, c) + " " + border(box.v));
    }

    // ── headline ──
    if (state?.headline) {
      const hl = gradientText(txt(String(state.headline), c).slice(0, inner - 4), CYAN, VIOLET, c);
      lines.push(border(box.v) + " " + fitVis(hl, inner - 2, c) + " " + border(box.v));
    }

    // ── signed footer ──
    const sig = state?.signed
      ? (U ? "✦ signed · verifiable offline" : "* signed - verifiable offline")
      : (U ? "· mneme" : "- mneme");
    const ver = state?.version ? ` v${state.version}` : "";
    const footer = (c.color ? fg(DIM, c) : "") + sig + ver + endColor(c);
    lines.push(border(box.v) + " " + fitVis(footer, inner - 2, c) + " " + border(box.v));

    // ── bottom border ──
    lines.push(border(box.bl + box.h.repeat(inner) + box.br));

    return lines.join("\n");
  } catch {
    return "mneme - knowledge map";
  }
}

export interface VisualGauntlet {
  /** deterministic: same (state,caps) → identical frame. */
  deterministic: boolean;
  /** mono caps → output contains ZERO ANSI escape bytes (pipe/CI-safe). */
  monoNoEscapes: boolean;
  /** ascii caps → output is pure ASCII (no codepoint ≥ 128). */
  asciiPure: boolean;
  /** truecolor caps → output DOES contain RGB escapes (it actually colors). */
  truecolorPaints: boolean;
  /** every rendered line ≤ caps.width (no overflow / wrap garble). */
  boundedWidth: boolean;
  /** sparkline maps a monotonic series to a non-decreasing block ladder. */
  sparklineMonotonic: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

/** Prove the renderer's portability + correctness invariants. Total. */
export function visualGauntlet(): VisualGauntlet {
  try {
    const state: MapState = {
      version: "2.116.0",
      nodes: [
        { label: "TRUTH", status: "ok" },
        { label: "SAVINGS", status: "ok" },
        { label: "LOOP", status: "warn" },
        { label: "CORTEX", status: "idle" },
      ],
      savingsSpark: [1, 3, 2, 6, 5, 8, 7, 9],
      headline: "12,403 input tokens saved (−88.1%)",
      signed: true,
    };
    const trueCaps: TermCaps = { truecolor: true, color256: true, color: true, unicode: true, width: 80 };
    const monoCaps: TermCaps = { truecolor: false, color256: false, color: false, unicode: true, width: 80 };
    const asciiCaps: TermCaps = { truecolor: false, color256: false, color: false, unicode: false, width: 80 };

    const deterministic = renderKnowledgeMap(state, trueCaps) === renderKnowledgeMap(state, trueCaps);

    const mono = renderKnowledgeMap(state, monoCaps);
    const monoNoEscapes = !mono.includes("\x1b");

    const ascii = renderKnowledgeMap(state, asciiCaps);
    let asciiPure = true;
    for (let i = 0; i < ascii.length; i++) if (ascii.charCodeAt(i) > 127) { asciiPure = false; break; }

    const tru = renderKnowledgeMap(state, trueCaps);
    const truecolorPaints = tru.includes("\x1b[38;2;");

    const boundedWidth = mono.split("\n").every((l) => l.length <= monoCaps.width)
      && tru.split("\n").every((l) => strip(l).length <= trueCaps.width);

    const sp = sparkline([0, 1, 2, 3, 4, 5, 6, 7], { ...asciiCaps, unicode: true });
    // a strictly-increasing input must produce a non-decreasing block ladder
    let sparklineMonotonic = sp.length === 8;
    for (let i = 1; i < sp.length && sparklineMonotonic; i++) {
      if (BLOCKS_U.indexOf(sp[i] as typeof BLOCKS_U[number]) < BLOCKS_U.indexOf(sp[i - 1] as typeof BLOCKS_U[number])) sparklineMonotonic = false;
    }

    let stable = true;
    try {
      renderKnowledgeMap(null as never, null as never);
      gradientText(null as never, [0, 0, 0], [1, 1, 1], monoCaps);
      sparkline(null as never, monoCaps);
      detectCaps(null as never, false);
    } catch { stable = false; }

    const perfect = deterministic && monoNoEscapes && asciiPure && truecolorPaints && boundedWidth && sparklineMonotonic && stable;
    return { deterministic, monoNoEscapes, asciiPure, truecolorPaints, boundedWidth, sparklineMonotonic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { deterministic: false, monoNoEscapes: false, asciiPure: false, truecolorPaints: false, boundedWidth: false, sparklineMonotonic: false, stable: false, score: 0 };
  }
}

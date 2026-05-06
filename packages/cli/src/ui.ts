/**
 * Unified UI primitives — the design system for every Mneme command.
 *
 * Goal: every command renders with the same visual vocabulary so users
 * see one coherent product, not a grab-bag of formatters.
 *
 * Pure functions (no I/O) below the `ui` object — easy to unit test.
 */

import kleur from "kleur";

// ─── Levels / palette ─────────────────────────────────────────────────

export type Level = "critical" | "high" | "medium" | "low" | "info" | "ok" | "warn";

const PAINT: Record<Level, (s: string) => string> = {
  critical: (s) => kleur.red().bold(s),
  high: (s) => kleur.red(s),
  medium: (s) => kleur.yellow(s),
  low: (s) => kleur.cyan(s),
  info: (s) => kleur.gray(s),
  ok: (s) => kleur.green(s),
  warn: (s) => kleur.yellow(s),
};

// ─── Existing simple printers ─────────────────────────────────────────

export const ui = {
  banner: () => {
    const lines = [
      "",
      kleur.magenta("  ╭──────────────────────────────────╮"),
      kleur.magenta("  │") + kleur.bold().white("  μνήμη  ") + kleur.gray("·") + kleur.italic().cyan("  Mneme  ") + kleur.magenta("              │"),
      kleur.magenta("  │") + kleur.gray("  the memory layer of your code   ") + kleur.magenta("│"),
      kleur.magenta("  ╰──────────────────────────────────╯"),
      "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
  },
  info: (msg: string) => process.stdout.write(`${kleur.cyan("ℹ")} ${msg}\n`),
  success: (msg: string) => process.stdout.write(`${kleur.green("✓")} ${msg}\n`),
  warn: (msg: string) => process.stdout.write(`${kleur.yellow("!")} ${msg}\n`),
  error: (msg: string) => process.stderr.write(`${kleur.red("✗")} ${msg}\n`),
  dim: (msg: string) => process.stdout.write(kleur.gray(msg) + "\n"),
  step: (label: string, msg: string) =>
    process.stdout.write(`${kleur.gray("›")} ${kleur.bold(label)}  ${msg}\n`),
  raw: (msg: string) => process.stdout.write(msg),
};

// ─── Layout primitives ────────────────────────────────────────────────

const RULE = "═".repeat(64);

/** Page-level header: leading icon + title + double-rule.
 *  `useCase` (green) explains in plain English when/why to run the command —
 *  rendered ABOVE the technical subtitle so users see the value first. */
export function header(
  icon: string,
  title: string,
  subtitle?: string,
  useCase?: string,
): string {
  const out: string[] = [];
  out.push("");
  out.push(`  ${kleur.bold().cyan(`${icon}  ${title}`)}`);
  if (useCase) out.push(`  ${kleur.green(`✓ ${useCase}`)}`);
  if (subtitle) out.push(`  ${kleur.gray(subtitle)}`);
  out.push(`  ${kleur.gray(RULE)}`);
  return out.join("\n");
}

/** Section heading — lighter than header. Use inside a command's output. */
export function section(title: string, hint?: string): string {
  const h = hint ? `  ${kleur.gray(hint)}` : "";
  return `  ${kleur.bold().magenta(title)}${h}`;
}

/** Plain horizontal divider, optionally with an inline label. */
export function divider(label?: string): string {
  if (!label) return `  ${kleur.gray(RULE)}`;
  const left = "─── ";
  const middle = ` ${label} `;
  const fill = "─".repeat(Math.max(0, 64 - left.length - middle.length));
  return `  ${kleur.gray(left + middle + fill)}`;
}

// ─── Status badges ────────────────────────────────────────────────────

/** Severity badge with a fixed width — keeps columns aligned. */
export function severityBadge(level: Level): string {
  const labels: Record<Level, string> = {
    critical: "CRIT  ",
    high: "HIGH  ",
    medium: "MEDIUM",
    low: "LOW   ",
    info: "INFO  ",
    ok: "OK    ",
    warn: "WARN  ",
  };
  return PAINT[level](labels[level]);
}

/** Free-form pill (status chip). Pass label + level. */
export function pill(label: string, level: Level): string {
  return PAINT[level](`[ ${label} ]`);
}

// ─── Meters ────────────────────────────────────────────────────────────

/**
 * Linear meter — value clamped to [0,1].
 *   level=ok: green / level=warn: yellow / level=critical: red / default: cyan→green ramp by value.
 */
export function meter(value: number, opts?: { width?: number; level?: Level }): string {
  const width = opts?.width ?? 10;
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * width);
  const empty = width - filled;
  const bar = "█".repeat(filled);
  const rest = kleur.gray("░".repeat(empty));
  if (opts?.level) return PAINT[opts.level](bar) + rest;
  // Auto-color by value
  let paint: (s: string) => string;
  if (v >= 0.8) paint = (s) => kleur.green().bold(s);
  else if (v >= 0.5) paint = (s) => kleur.cyan(s);
  else if (v >= 0.25) paint = (s) => kleur.yellow(s);
  else paint = (s) => kleur.red(s);
  return paint(bar) + rest;
}

/**
 * Log-likelihood meter — designed for LR / log-scale data.
 *   pivot=1 (LR=1, neutral). Values < pivot push left (red).
 *   Used by forensics to map LR ∈ (1e-6, 1e6) onto a 10-cell meter.
 */
export function logMeter(lr: number, opts?: { width?: number; pivot?: number }): string {
  const width = opts?.width ?? 10;
  const pivot = opts?.pivot ?? 1;
  // Map log10(lr / pivot) ∈ [-3, +3] → [0, width]
  const log = Math.log10(Math.max(lr, 1e-9) / pivot);
  const norm = Math.max(0, Math.min(1, (log + 3) / 6));
  const filled = Math.round(norm * width);
  const empty = width - filled;
  const bar = "█".repeat(filled);
  const rest = kleur.gray("░".repeat(empty));
  if (lr >= 50) return kleur.green().bold(bar) + rest;
  if (lr >= 5) return kleur.green(bar) + rest;
  if (lr >= 1) return kleur.cyan(bar) + rest;
  if (lr >= 0.2) return kleur.yellow(bar) + rest;
  return kleur.red(bar) + rest;
}

/**
 * Sparkline from numeric values — compresses a timeseries into 8 levels.
 * Typical use: drift signal over weeks, anomaly score over months.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return kleur.gray("(no data)");
  const blocks = "▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  let out = "";
  for (const v of values) {
    const idx = Math.min(7, Math.max(0, Math.round(((v - min) / range) * 7)));
    out += blocks[idx];
  }
  return kleur.cyan(out);
}

// ─── Citations / commit references ────────────────────────────────────

export interface CitationOpts {
  shortHash: string;
  date?: string;
  author?: string;
  subject?: string;
  url?: string;
  emphasized?: boolean;
  trailing?: string;
}

/** Render a single commit citation row consistently across commands. */
export function citation(c: CitationOpts): string {
  const dot = c.emphasized ? kleur.green("●") : kleur.gray("●");
  const hash = osc8(c.url, kleur.bold(c.shortHash));
  const meta: string[] = [];
  if (c.date) meta.push(c.date);
  if (c.author) meta.push(c.author);
  if (c.trailing) meta.push(c.trailing);
  const metaStr = meta.length > 0 ? kleur.gray(`[${meta.join(" · ")}]`) : "";
  const head = `  ${dot} ${hash}  ${metaStr}`.trimEnd();
  if (!c.subject) return head;
  return `${head}\n    ${kleur.white(c.subject)}`;
}

// ─── OSC 8 hyperlinks ─────────────────────────────────────────────────

/** OSC 8 hyperlink — clickable in iTerm2/Wezterm/Windows Terminal/VSCode terminal. */
export function osc8(url: string | undefined, text: string): string {
  if (!url) return text;
  if (!process.stdout.isTTY) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ─── Key-value rows + empty state + next steps ────────────────────────

/** Aligned key-value row. */
export function kv(label: string, value: string, labelWidth = 18): string {
  return `  ${kleur.gray(label.padEnd(labelWidth))}  ${value}`;
}

/** Empty-state block with helpful hints. */
export function emptyState(headline: string, hints: string[]): string {
  const out: string[] = [];
  out.push("");
  out.push(`  ${kleur.gray("○")} ${kleur.bold(headline)}`);
  for (const h of hints) {
    out.push(`     ${kleur.gray("›")} ${kleur.gray(h)}`);
  }
  out.push("");
  return out.join("\n");
}

/** Call-to-action: "what to run next". Each action shows command + why. */
export function nextSteps(actions: Array<{ cmd: string; why: string }>): string {
  if (actions.length === 0) return "";
  const out: string[] = [];
  out.push(`  ${kleur.bold().magenta("→ Try next")}`);
  for (const a of actions) {
    out.push(`    ${kleur.cyan("$")} ${kleur.bold(a.cmd)}`);
    out.push(`      ${kleur.gray(a.why)}`);
  }
  return out.join("\n");
}

// ─── Progress bar (kept for backward compatibility) ───────────────────

export function formatProgress(current: number, total: number, width = 24): string {
  if (total <= 0) return "";
  const ratio = Math.min(1, current / total);
  const filled = Math.round(ratio * width);
  const bar = kleur.cyan("█".repeat(filled)) + kleur.gray("░".repeat(width - filled));
  return `${bar} ${kleur.bold(`${Math.round(ratio * 100)}%`)} ${kleur.gray(`(${current}/${total})`)}`;
}

// ─── Domain badges ─────────────────────────────────────────────────────

/** ENFSI verbal-scale verdict → colored badge. */
export function verdictBadge(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v.includes("extremely strong support against") || v.includes("very strong support against")) {
    return kleur.red().bold(verdict.toUpperCase());
  }
  if (v.includes("against")) return kleur.yellow().bold(verdict.toUpperCase());
  if (v === "uninformative") return kleur.gray().bold(verdict.toUpperCase());
  if (v.includes("extremely strong support") || v.includes("very strong support")) {
    return kleur.green().bold(verdict.toUpperCase());
  }
  if (v.includes("strong support")) return kleur.cyan().bold(verdict.toUpperCase());
  return kleur.bold(verdict.toUpperCase());
}

/** Tag ([ feat ] / [ fix ] / [ chore ]) inferred from a conventional-commit subject. */
export function commitTypePill(subject: string): string | undefined {
  const m = subject.match(/^(feat|fix|chore|docs|refactor|test|perf|ci|build|style)(?:\([^)]+\))?:/i);
  if (!m) return undefined;
  const t = m[1]!.toLowerCase();
  const map: Record<string, Level> = {
    feat: "ok",
    fix: "warn",
    perf: "ok",
    refactor: "low",
    docs: "info",
    test: "low",
    chore: "info",
    ci: "info",
    build: "info",
    style: "info",
  };
  return pill(t, map[t] ?? "info");
}

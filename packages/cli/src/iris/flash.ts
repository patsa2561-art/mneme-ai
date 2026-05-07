/**
 * Iris — 3-line flash summary.
 *
 * Used as a footer on long command outputs and in tests as a smoke-test
 * verification ("did the renderer produce a coherent summary?").
 *
 * Hard contract: returns EXACTLY 3 lines, every time, for every type.
 */

import kleur from "kleur";

export type FlashType = "list" | "table" | "verdict" | "metric" | "narrative";

export interface FlashInput {
  type: FlashType;
  data: unknown;
}

const PADDING_LINE = "";

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return [];
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Render a `list` flash. */
function flashList(data: unknown): string[] {
  const obj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const items = asArray(obj.items ?? data);
  const top = obj.top != null ? asString(obj.top) : asString(items[0] ?? "—");
  const otherCount = Math.max(0, items.length - 1);
  return [
    `${kleur.bold("Found")} ${kleur.cyan(String(items.length))} ${kleur.gray("items")}`,
    `${kleur.gray("top:")} ${kleur.bold(top || "—")}`,
    `${kleur.gray("others:")} ${kleur.cyan(String(otherCount))}`,
  ];
}

/** Render a `table` flash. */
function flashTable(data: unknown): string[] {
  const obj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const rows = asNumber(obj.rows) ?? asArray(obj.data).length;
  const cols = asNumber(obj.cols) ?? 0;
  const top = asString(obj.topRow ?? "—");
  return [
    `${kleur.bold("Table")} ${kleur.cyan(`${rows}×${cols}`)}`,
    `${kleur.gray("top row:")} ${kleur.bold(top || "—")}`,
    `${kleur.gray("scroll:")} ${kleur.cyan("see full output above")}`,
  ];
}

/** Render a `verdict` flash. */
function flashVerdict(data: unknown): string[] {
  const obj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const headline = asString(obj.headline ?? "Verdict");
  const severity = asString(obj.severity ?? "info");
  const next = asString(obj.next ?? obj.nextStep ?? "review");
  return [
    `${kleur.bold(headline)}`,
    `${kleur.gray("severity:")} ${kleur.bold(severity)}`,
    `${kleur.gray("next step:")} ${kleur.cyan(next)}`,
  ];
}

/** Render a `metric` flash. */
function flashMetric(data: unknown): string[] {
  const obj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const value = asString(obj.value ?? obj.val ?? "—");
  const trend = asString(obj.trend ?? "flat");
  const delta = asString(obj.delta ?? obj.vsBaseline ?? "—");
  return [
    `${kleur.bold("Value")} ${kleur.cyan(value)}`,
    `${kleur.gray("trend")} ${kleur.bold(trend)}`,
    `${kleur.gray("vs baseline")} ${kleur.cyan(delta)}`,
  ];
}

/** Render a `narrative` flash — splits the text into ≤3 short lines. */
function flashNarrative(data: unknown): string[] {
  const text = asString(data && typeof data === "object" ? ((data as Record<string, unknown>).text ?? "") : data);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < 3; i++) {
    lines.push(sentences[i] ?? PADDING_LINE);
  }
  return lines.map((l, i) => (i === 0 ? kleur.bold(l) : kleur.gray(l)));
}

/**
 * Produce a 3-line fast-readable summary of any structured data.
 *
 * Always returns an array of length 3.  Lines may be empty strings if the
 * input is sparse, but the array length is invariant.
 */
export function flash(opts: FlashInput): string[] {
  let lines: string[];
  switch (opts.type) {
    case "list":
      lines = flashList(opts.data);
      break;
    case "table":
      lines = flashTable(opts.data);
      break;
    case "verdict":
      lines = flashVerdict(opts.data);
      break;
    case "metric":
      lines = flashMetric(opts.data);
      break;
    case "narrative":
      lines = flashNarrative(opts.data);
      break;
    default:
      lines = ["", "", ""];
  }
  // Defensive: always emit exactly 3.
  if (lines.length < 3) {
    while (lines.length < 3) lines.push("");
  } else if (lines.length > 3) {
    lines = lines.slice(0, 3);
  }
  return lines;
}

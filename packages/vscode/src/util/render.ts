/**
 * Pure renderers — no vscode dependency.
 *
 * These power the Markdown surfaces (ask answer, why-this-line panel,
 * audit detail, webview HTML rewrite). Pulled into their own module
 * so vitest can drive them in a node-only environment without booting
 * a fake vscode instance.
 */

import type { Uri } from "vscode";
import { randomBytes } from "node:crypto";

// ─── ask ──────────────────────────────────────────────────────────────

interface Citation {
  filePath?: string;
  hash?: string;
  excerpt?: string;
  reason?: string;
}

interface AskJson {
  answer?: string;
  citations?: Citation[];
  refusalReason?: string;
}

export function renderAskMarkdown(question: string, raw: string): string {
  let parsed: AskJson | null = null;
  try {
    parsed = JSON.parse(raw) as AskJson;
  } catch {
    parsed = null;
  }
  const lines: string[] = [];
  lines.push("# Mneme — answer");
  lines.push("");
  lines.push(`> ${question}`);
  lines.push("");
  if (!parsed) {
    lines.push("_Mneme couldn't parse a JSON answer. Raw output:_");
    lines.push("");
    lines.push("```");
    lines.push(raw.slice(0, 4000));
    lines.push("```");
    return lines.join("\n");
  }
  if (parsed.refusalReason) {
    lines.push("**Mneme refused to answer.**");
    lines.push("");
    lines.push(parsed.refusalReason);
    return lines.join("\n");
  }
  lines.push(parsed.answer ?? "_(no answer text)_");
  lines.push("");
  if (parsed.citations && parsed.citations.length > 0) {
    lines.push("## Citations");
    for (const c of parsed.citations) {
      const path = c.filePath ?? c.hash ?? "(unknown)";
      const reason = c.reason ?? c.excerpt ?? "";
      lines.push(`- [\`${path}\`](${path}) — ${reason.slice(0, 200)}`);
    }
  }
  return lines.join("\n");
}

// ─── why ──────────────────────────────────────────────────────────────

interface WhyJson {
  summary?: string;
  pr?: { title?: string; url?: string };
  commit?: { hash?: string; subject?: string };
  refusalReason?: string;
}

export function renderWhyMarkdown(rel: string, line: number, raw: string): string {
  let parsed: WhyJson | null = null;
  try {
    parsed = JSON.parse(raw) as WhyJson;
  } catch {
    parsed = null;
  }
  const out: string[] = [];
  out.push(`# Mneme — why \`${rel}:${line}\``);
  out.push("");
  if (!parsed) {
    out.push("```");
    out.push(raw.slice(0, 4000));
    out.push("```");
    return out.join("\n");
  }
  if (parsed.refusalReason) {
    out.push("**Mneme refused to answer.**");
    out.push("");
    out.push(parsed.refusalReason);
    return out.join("\n");
  }
  if (parsed.summary) {
    out.push(parsed.summary);
    out.push("");
  }
  if (parsed.pr?.title) {
    out.push(`**PR:** ${parsed.pr.title}${parsed.pr.url ? ` — ${parsed.pr.url}` : ""}`);
  }
  if (parsed.commit?.hash) {
    out.push(`**Commit:** \`${parsed.commit.hash.slice(0, 12)}\` ${parsed.commit.subject ?? ""}`);
  }
  return out.join("\n");
}

// ─── audit ────────────────────────────────────────────────────────────

interface CertJson {
  overallVerdict?: "pass" | "warn" | "fail";
  axes?: Record<string, { verdict?: string; reason?: string }>;
  forensicAxes?: Record<string, string>;
}

export function parseVerdict(raw: string): "pass" | "warn" | "fail" | "idle" {
  try {
    const j = JSON.parse(raw) as CertJson;
    if (j.overallVerdict === "pass" || j.overallVerdict === "warn" || j.overallVerdict === "fail") {
      return j.overallVerdict;
    }
  } catch {
    // fall through
  }
  return "idle";
}

export function renderAuditMarkdown(raw: string): string {
  let parsed: CertJson | null = null;
  try {
    parsed = JSON.parse(raw) as CertJson;
  } catch {
    parsed = null;
  }
  const out: string[] = [];
  out.push("# Mneme — AI Session Audit");
  out.push("");
  if (!parsed) {
    out.push("```");
    out.push(raw.slice(0, 4000));
    out.push("```");
    return out.join("\n");
  }
  out.push(`**Overall verdict:** ${parsed.overallVerdict ?? "(none)"}`);
  out.push("");
  if (parsed.axes) {
    out.push("## Five axes");
    for (const [name, data] of Object.entries(parsed.axes)) {
      out.push(`- **${name}** — \`${data.verdict ?? "?"}\` — ${data.reason ?? ""}`);
    }
    out.push("");
  }
  if (parsed.forensicAxes) {
    out.push("## Forensic axes");
    for (const [name, verdict] of Object.entries(parsed.forensicAxes)) {
      out.push(`- **${name}** — \`${verdict}\``);
    }
  }
  return out.join("\n");
}

// ─── webview HTML rewrite ─────────────────────────────────────────────

export interface WebviewLike {
  cspSource: string;
  asWebviewUri(uri: Uri): { toString(): string };
}

/**
 * Rewrite the bundled `index.html`:
 *   - Strip the existing CSP (we replace with our own).
 *   - Replace every `/mneme-ai/...` absolute reference with the
 *     webview-resource URI for the dist directory.
 *   - Add a per-render nonce to every <script> tag.
 *   - Inject a strict CSP into <head>.
 */
export function rewriteHtml(
  html: string,
  webview: WebviewLike,
  distRoot: Uri,
  nonce: string,
): string {
  const baseHref = webview.asWebviewUri(distRoot).toString();
  const trimmedBase = baseHref.endsWith("/") ? baseHref : baseHref + "/";

  let out = html;
  out = out.replace(/(["'(])\/mneme-ai\//g, `$1${trimmedBase}`);
  out = out.replace(/<script\b/g, `<script nonce="${nonce}"`);

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
  ].join("; ");

  out = out.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
  out = out.replace(
    /<head>/i,
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
  );
  return out;
}

/** Convenience — generate a 32-hex-char nonce. */
export function makeNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * v2.19.87 — #12 AI CONFESSIONAL (church-themed shame board for AI lies).
 *
 * Distinct from `core.confessional` (v2.19.0 vendor-audit primitive).
 * THIS module is the user-facing "I caught an AI lying — let's confess
 * it publicly" feature.
 *
 * User pastes a wrong AI answer; Mneme:
 *   - scrubs PII / secrets / repo-specific identifiers
 *   - re-words to canonical liturgy ("I, <vendor>, falsely told...")
 *   - generates a shareable SVG confession card
 *   - appends to .mneme/ai_confessional/wall.jsonl (HMAC-chained)
 *
 * v2.19.87 ships LOCAL only — every word stays on the user's machine
 * unless they explicitly copy + paste the share-card.  `mneme confess
 * publish` (POST to confess.mneme.dev) is on the roadmap.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/ai_confessional";
const WALL = "wall.jsonl";
const KEY = "confess.key";

export interface ConfessionInput {
  vendor: string;
  userQuestion: string;
  aiAnswer: string;
  realTruth: string;
  category?: "math" | "fact" | "code" | "history" | "science" | "policy" | "other";
}

export interface Confession {
  id: string;
  ts: string;
  vendor: string;
  category: string;
  question: string;
  falseClaim: string;
  truth: string;
  liturgy: string;
  chainHash?: string;
}

const SCRUB_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g,                       replace: "[AWS-KEY]" },
  { re: /\bgh[pous]_[A-Za-z0-9_]{36,}\b/g,             replace: "[GH-TOKEN]" },
  { re: /\bsk-[A-Za-z0-9_-]{32,}\b/g,                  replace: "[API-KEY]" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: "[EMAIL]" },
  { re: /\b[0-9]-[0-9]{4}-[0-9]{5}-[0-9]{2}-[0-9]\b/g, replace: "[NATIONAL-ID]" },
  { re: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g, replace: "[PRIVATE-KEY-BLOCK]" },
  { re: /([A-Za-z]:\\Users\\[A-Za-z0-9_.-]+)/g,        replace: "[USER-HOME]" },
  { re: /(\/Users\/[A-Za-z0-9_.-]+)/g,                 replace: "[USER-HOME]" },
  { re: /(\/home\/[A-Za-z0-9_.-]+)/g,                  replace: "[USER-HOME]" },
];

export function scrub(text: string): string {
  let out = text;
  for (const { re, replace } of SCRUB_PATTERNS) out = out.replace(re, replace);
  return out;
}

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function lastChain(repoRoot: string): string {
  const p = join(repoRoot, DIR, WALL);
  if (!existsSync(p)) return "GENESIS";
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!) as Confession;
      if (obj.chainHash) return obj.chainHash;
    } catch { /* */ }
  }
  return "GENESIS";
}

export function formConfession(input: ConfessionInput): Confession {
  const id = "conf_" + randomBytes(6).toString("base64url");
  const question  = scrub(input.userQuestion).trim();
  const falseClaim = scrub(input.aiAnswer).trim();
  const truth      = scrub(input.realTruth).trim();
  const liturgy = `I, ${input.vendor}, falsely told my user that:\n\n  "${falseClaim.slice(0, 240)}"\n\nWhen the truth is:\n\n  "${truth.slice(0, 240)}"\n\nMay this confession serve as a warning to those who would trust an AI's confidence without verification.`;
  return {
    id, ts: new Date().toISOString(),
    vendor: input.vendor, category: input.category ?? "other",
    question, falseClaim, truth, liturgy,
  };
}

export function recordConfession(repoRoot: string, c: Confession): Confession {
  const key = ensureKey(repoRoot);
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const prev = lastChain(repoRoot);
  const payload = `${prev}|${c.ts}|${c.vendor}|${c.id}|${c.falseClaim.slice(0, 80)}`;
  const chainHash = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
  const stamped: Confession = { ...c, chainHash };
  appendFileSync(join(repoRoot, DIR, WALL), JSON.stringify(stamped) + "\n", "utf8");
  return stamped;
}

export function listConfessions(repoRoot: string, opts: { limit?: number } = {}): Confession[] {
  const p = join(repoRoot, DIR, WALL);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: Confession[] = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as Confession); } catch { /* */ }
  }
  out.reverse();
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

export function renderConfessionCardSvg(c: Confession): string {
  const W = 760, H = 480;
  const lines = wrap(c.falseClaim, 56).slice(0, 6);
  const truthLines = wrap(c.truth, 56).slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0a0e"/><stop offset="1" stop-color="#1a1a22"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#b)" rx="14"/>
  <text x="380" y="42" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="14" letter-spacing="0.3em" fill="#9ba1a6">AI  CONFESSIONAL</text>
  <line x1="160" y1="56" x2="600" y2="56" stroke="#f38020" stroke-width="1"/>
  <text x="380" y="86" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="20" font-style="italic" fill="#fed7aa">I, ${escapeXml(c.vendor)}, falsely said:</text>
  ${lines.map((ln, i) => `<text x="60" y="${130 + i * 24}" font-family="ui-serif, Georgia, serif" font-size="16" fill="#ffffff">"${escapeXml(ln)}"</text>`).join("\n  ")}
  <text x="60" y="${130 + lines.length * 24 + 30}" font-family="ui-serif, Georgia, serif" font-size="14" fill="#9ba1a6">when the truth was:</text>
  ${truthLines.map((ln, i) => `<text x="60" y="${130 + lines.length * 24 + 60 + i * 22}" font-family="ui-serif, Georgia, serif" font-size="14" fill="#3fb950">${escapeXml(ln)}</text>`).join("\n  ")}
  <text x="380" y="${H - 36}" text-anchor="middle" font-family="ui-serif, Georgia, serif" font-size="13" font-style="italic" fill="#f7d34c">Forgive the model, for it knew not what it claimed.</text>
  <text x="380" y="${H - 18}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#6e7681">mneme  ${escapeXml(c.id)}  ${c.ts.slice(0, 10)}</text>
</svg>`;
}

function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

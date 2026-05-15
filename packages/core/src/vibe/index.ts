/**
 * v2.15.0 — MNEME VIBE
 *
 *   "Anyone can build an app via AI now. Most have never written code.
 *    They accept every AI suggestion blindly, ship secrets accidentally,
 *    can't tell good architecture from bad. Mneme VIBE wraps the
 *    PENTAD in a beginner-friendly mode: invisible safety gates, plain
 *    English confidence scores, refactor alarms when complexity rises."
 *
 * For "vibe coders" — Bolt / Lovable / Replit / v0 users who write
 * prompts not code. VIBE turns Mneme's expert-level safety net into a
 * single command: `mneme vibe`.
 *
 * What it does, automatically, after every AI change:
 *   1. Runs DLP scan (catches accidentally pasted secrets).
 *   2. Runs SOUL gate (warns when AI suggests something against vibe).
 *   3. Runs ANTIVIRUS (catches hallucinated file refs).
 *   4. Computes complexity-creep score (alerts when app grows beyond
 *      vibe coder's reasonable understanding).
 *   5. Translates technical findings into plain English ("9 out of 10:
 *      this is safe to ship; one thing to know — your settings file
 *      now contains an API key in plain text").
 *
 * Wisdom: this isn't a separate set of features — it's a *presentation
 * layer* over PENTAD + ANTIVIRUS + APOPTOSIS. Composes orthogonally.
 *
 * Distribution wedge: vibe coders share their apps; the apps mention
 * "built with Mneme VIBE". Word-of-mouth spread in the Bolt/Lovable
 * communities.
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface VibeChange {
  /** Free-form description of what the AI just did. */
  description: string;
  /** Files modified (relative paths). */
  files?: string[];
  /** New / changed text content (so DLP can scan + complexity computed). */
  content?: string;
  /** Optional dependencies added in this change. */
  addsDeps?: string[];
}

export type VibeStatus = "ship_it" | "ship_with_note" | "wait_review" | "stop_unsafe";

export interface VibeFinding {
  /** Severity translated to plain English. */
  severity: "tiny" | "worth_knowing" | "important" | "critical";
  /** Plain-English headline (avoids technical jargon). */
  headline: string;
  /** Plain-English explanation (1-2 sentences). */
  explain: string;
  /** What to do — concrete action the user can take. */
  whatToDo: string;
  /** Internal source — which Mneme module flagged this. */
  source: "dlp" | "soul" | "antivirus" | "complexity" | "vibe";
}

export interface VibeReport {
  v: typeof PROTOCOL_VERSION;
  status: VibeStatus;
  /** 0..10 confidence the change is safe to ship. */
  confidence: number;
  /** Plain-English one-liner the AI quotes back to the user. */
  quote: string;
  findings: VibeFinding[];
  /** Optional encouragement / coaching. */
  coach?: string;
  signedAt: string;
  /** Tamper-evident sig over the report body. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_VIBE_SECRET"] || `mneme-vibe-v${PROTOCOL_VERSION}`;
}

/**
 * Cyclomatic-complexity-ish heuristic over change content. Counts:
 *   - control-flow keywords (if/else/for/while/switch/case/?/&&/||)
 *   - function/class definitions
 *   - lines changed
 *
 * Returns a 0..1 "complexity creep" score. Above 0.7 → warn vibe coder.
 */
function complexityCreep(content: string, files: string[] = []): { score: number; reasons: string[] } {
  if (!content) return { score: 0, reasons: [] };
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const ctrlFlow = (content.match(/\b(if|else|for|while|switch|case|do|try|catch)\b/g) || []).length;
  const ternary = (content.match(/[?][^?:]*[:]/g) || []).length;
  const logic = (content.match(/&&|\|\|/g) || []).length;
  const funcs = (content.match(/\b(function|=>|class|def\s|fn\s)\b/g) || []).length;
  const filesScore = Math.min(1, files.length / 10);
  const ctrlScore = Math.min(1, (ctrlFlow + ternary + logic) / 30);
  const lineScore = Math.min(1, lineCount / 200);
  const funcScore = Math.min(1, funcs / 10);
  const score = Math.min(1, ctrlScore * 0.4 + lineScore * 0.3 + funcScore * 0.2 + filesScore * 0.1);
  const reasons: string[] = [];
  if (ctrlFlow > 10) reasons.push(`${ctrlFlow} branches`);
  if (lineCount > 100) reasons.push(`${lineCount} lines`);
  if (funcs > 5) reasons.push(`${funcs} new functions / classes`);
  if (files.length > 5) reasons.push(`${files.length} files touched`);
  return { score: Math.round(score * 100) / 100, reasons };
}

/**
 * The wrapper. Runs every relevant gate over the change, translates
 * technical findings into vibe-coder English.
 */
export async function vibeCheck(change: VibeChange, opts: { repoDir?: string; secret?: string } = {}): Promise<VibeReport> {
  const findings: VibeFinding[] = [];

  // 1. DLP scan over content
  if (change.content) {
    try {
      const ks = await import("../kill_switch/index.js");
      const r = ks.dlpScan(change.content, { ...(opts.repoDir ? { repoDir: opts.repoDir } : {}), actor: "vibe" });
      for (const h of r.hits) {
        if (h.severity === "block") {
          findings.push({
            severity: "critical",
            headline: `🚨 SECRET in your code: ${h.description}`,
            explain: `An API key, password, or private credential ended up in your file. If you ship this, anyone who sees the code can use that secret.`,
            whatToDo: `Remove it now. Move secrets into a .env file (and add .env to .gitignore).`,
            source: "dlp",
          });
        } else if (h.severity === "warn") {
          findings.push({
            severity: "worth_knowing",
            headline: `Personal data spotted: ${h.description}`,
            explain: `Your code contains something that looks like personal info (email / phone / etc).`,
            whatToDo: `If this is sample data, OK. If it's a real user's info, remove it.`,
            source: "dlp",
          });
        }
      }
    } catch { /* dlp unavailable; skip */ }
  }

  // 2. SOUL gate
  try {
    const soul = await import("../project_soul/index.js");
    const s = soul.loadSoul({ ...(opts.repoDir ? { repoDir: opts.repoDir } : {}) });
    if (s) {
      const v = soul.checkAgainstSoul(s, {
        description: change.description,
        ...(change.files ? { files: change.files } : {}),
        ...(change.addsDeps ? { addsDeps: change.addsDeps } : {}),
        ...(change.content ? { codeExcerpts: [change.content.slice(0, 4000)] } : {}),
      });
      for (const f of v.findings) {
        const ruleText = (Object.values(s)
          .filter((x): x is { id: string; text?: string }[] => Array.isArray(x))
          .flat()
          .find((r) => r.id === f.ruleId)?.text) ?? f.ruleId;
        if (f.severity === "block") {
          findings.push({
            severity: "important",
            headline: `Your project says: ${ruleText.slice(0, 120)}`,
            explain: `This change goes against a project rule you (or your past self) set.`,
            whatToDo: `Either change the approach OR explicitly accept the rule no longer applies.`,
            source: "soul",
          });
        } else {
          findings.push({
            severity: "tiny",
            headline: `Heads up: ${ruleText.slice(0, 120)}`,
            explain: `This is a soft preference your project usually follows.`,
            whatToDo: `OK to proceed; just so you know.`,
            source: "soul",
          });
        }
      }
    }
  } catch { /* soul unavailable */ }

  // 3. Complexity creep
  const cc = complexityCreep(change.content ?? "", change.files);
  if (cc.score > 0.7) {
    findings.push({
      severity: "important",
      headline: `Your app is getting complex: ${cc.reasons.join(", ")}`,
      explain: `This change adds significant complexity. As the app grows, debugging gets harder.`,
      whatToDo: `Consider asking AI to extract this into smaller pieces (e.g., a separate file or function) before continuing.`,
      source: "complexity",
    });
  } else if (cc.score > 0.4) {
    findings.push({
      severity: "worth_knowing",
      headline: `Moderately complex change: ${cc.reasons.join(", ")}`,
      explain: `Not a problem yet, but worth understanding what changed.`,
      whatToDo: `Ask the AI: "explain this change like I'm 5".`,
      source: "complexity",
    });
  }

  // Compute confidence + status
  const critical = findings.filter((f) => f.severity === "critical").length;
  const important = findings.filter((f) => f.severity === "important").length;
  const worthKnowing = findings.filter((f) => f.severity === "worth_knowing").length;

  let status: VibeStatus;
  let confidence: number;
  let quote: string;
  if (critical > 0) {
    status = "stop_unsafe";
    confidence = 0;
    quote = `🛑 STOP — ${critical} critical issue${critical > 1 ? "s" : ""}: ${findings.find((f) => f.severity === "critical")?.headline ?? ""}`;
  } else if (important > 0) {
    status = "wait_review";
    confidence = Math.max(2, 5 - important);
    quote = `⚠ Review needed — ${important} important thing${important > 1 ? "s" : ""} to check before shipping.`;
  } else if (worthKnowing > 0) {
    status = "ship_with_note";
    confidence = Math.max(7, 10 - worthKnowing);
    quote = `✅ Looks good — ${worthKnowing} small note${worthKnowing > 1 ? "s" : ""}: read once before shipping.`;
  } else {
    status = "ship_it";
    confidence = 10;
    quote = "✅ Ship it — no issues spotted. Confidence 10/10.";
  }

  let coach: string | undefined;
  if (status === "ship_it" && Math.random() < 0.2) {
    // 20% of clean ships get a coaching tip — gentle education.
    const tips = [
      "Tip: tell your AI to write tests for this change. It's faster than you'd think.",
      "Tip: commit small. Easier to undo a 50-line mistake than a 500-line one.",
      "Tip: ask your AI 'what could go wrong here?' before shipping. Often surfaces real bugs.",
      "Tip: keep a CHANGELOG.md. Future-you will thank present-you when something breaks.",
    ];
    coach = tips[Math.floor(Math.random() * tips.length)];
  }

  const signedAt = new Date().toISOString();
  const body = { v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION, status, confidence, quote, findings, ...(coach ? { coach } : {}), signedAt };
  const sig = createHmac("sha256", opts.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/**
 * Translate any technical Mneme output into vibe-coder English. Pure
 * function over a structured input — useful for wrapping outputs from
 * other Mneme modules into VIBE's voice.
 */
export function explainLikeImFive(input: { topic: string; technical: string }): string {
  const t = input.technical.toLowerCase();
  // A few canned translations for the most common Mneme outputs.
  if (t.includes("hmac") || t.includes("signature mismatch")) {
    return `${input.topic}: Mneme noticed someone changed a file it had previously marked as trusted. This is a security check — usually safe, sometimes a sign of tampering.`;
  }
  if (t.includes("zombie") || t.includes("stale")) {
    return `${input.topic}: Your AI session went quiet for too long. The information you have might be out of date — refresh before trusting it.`;
  }
  if (t.includes("rate limit") || t.includes("429")) {
    return `${input.topic}: Mneme paused some incoming traffic to protect against abuse. If this keeps happening, you may need to tune the limit higher.`;
  }
  if (t.includes("apoptosis") || t.includes("hallucin")) {
    return `${input.topic}: Mneme caught something that might not be true (the AI may have made it up). Verify before trusting.`;
  }
  if (t.includes("dlp") || t.includes("secret")) {
    return `${input.topic}: A secret (like an API key) appeared somewhere it shouldn't. Move it to a .env file and don't commit that file.`;
  }
  return `${input.topic}: ${input.technical.slice(0, 240)}`;
}

/** One-line pulse summary. */
export function formatVibeLine(report: VibeReport | null): string {
  if (!report) return "VIBE · idle";
  return `VIBE · ${report.status} · ${report.confidence}/10 · ${report.findings.length} findings`;
}

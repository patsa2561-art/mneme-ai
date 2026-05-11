/**
 * v1.57.0 -- SOVEREIGNTY KERNEL: wisdom-grounded context builder.
 *
 * The job: given a user question + a repo root, assemble a SHORT
 * grounded prompt that Mneme's Ollama model can actually use. The
 * answer comes back; the ACGV verifier then grounds it against the
 * actual repo before letting Mneme speak it to the user.
 *
 * Context shape (token-budgeted to fit small local models):
 *
 *   [SYSTEM]   Mneme identity + grounding rules (every answer must
 *              cite a file path / commit SHA / package.json / etc).
 *   [REPO]     1-3 most-relevant file paths from a cheap keyword match
 *   [HISTORY]  1-3 most-relevant recent commits (subject + date + sha)
 *   [WISDOM]   1-3 most-recent growth-event lessons from nucleus.json
 *   [USER]     the actual question
 *
 * The keyword match is intentionally simple (no embeddings dependency
 * for v1.57 -- embeddings layer lands in v1.58+). Token-cheap, fast,
 * good-enough for 90% of dev-flow questions ("what does X do?", "where
 * does Y live?", "when was Z introduced?").
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ContextSlice {
  /** Section label printed in the prompt. */
  label: "REPO" | "HISTORY" | "WISDOM";
  /** Each evidence line, ready to inline. */
  lines: string[];
}

export interface BuiltContext {
  /** The full prompt ready to send to Ollama. */
  prompt: string;
  /** Slices used in the prompt, exposed for the answer verifier so it
   *  can check that the model cited at least one of them. */
  slices: ContextSlice[];
  /** Total approximate token count (chars / 4 heuristic). */
  approxTokens: number;
}

const SYSTEM_PROMPT = [
  "You are Mneme -- the memory layer of a codebase. You answer questions",
  "about THIS repository using ONLY the evidence sections provided below.",
  "GROUNDING RULES:",
  "  1. Every claim MUST cite a specific file path, commit SHA, or",
  "     package.json entry from the evidence. No general advice.",
  "  2. If the evidence does NOT support a confident answer, say so",
  "     plainly: 'I do not see this in the evidence; the next step",
  "     would be X.' Refusing to fake confidence is correct behavior.",
  "  3. Keep replies under 4 short paragraphs. Plain English. No",
  "     marketing language, no superlatives, no emoji.",
].join("\n");

function tokenize(text: string): string[] {
  return Array.from(new Set(
    (text.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((w) => w.length >= 4),
  ));
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".mneme",
  "coverage", "out", ".next", ".turbo", ".cache",
]);

const TEXT_EXTS = new Set([
  ".md", ".ts", ".tsx", ".js", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
]);

/** Walk repo + score files by token overlap with the question. Top-3
 *  files surface as REPO evidence. Capped at 2000 visited entries
 *  / 4 levels deep so big monorepos stay snappy. */
function topRelevantFiles(repoRoot: string, tokens: string[], cap = 3): { path: string; score: number; snippet: string }[] {
  if (tokens.length === 0) return [];
  const scored: { path: string; score: number; snippet: string }[] = [];
  const stack: { path: string; depth: number }[] = [{ path: repoRoot, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && visited < 2000) {
    const { path, depth } = stack.pop()!;
    if (depth > 4) continue;
    let entries: string[];
    try { entries = readdirSync(path); } catch { continue; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(path, name);
      visited++;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) { stack.push({ path: full, depth: depth + 1 }); continue; }
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (!TEXT_EXTS.has(ext)) continue;
      if (s.size > 200_000) continue;
      try {
        const body = readFileSync(full, "utf8").toLowerCase();
        let score = 0;
        let firstHit = -1;
        for (const t of tokens) {
          const idx = body.indexOf(t);
          if (idx >= 0) {
            score++;
            if (firstHit < 0 || idx < firstHit) firstHit = idx;
          }
        }
        if (score === 0) continue;
        const rel = full.slice(repoRoot.length + 1).replace(/\\/g, "/");
        // Snippet = the 120 chars around the first hit, cleaned up.
        const start = Math.max(0, firstHit - 40);
        const snippet = body.slice(start, start + 120).replace(/\s+/g, " ").trim();
        scored.push({ path: rel, score, snippet });
      } catch { /* */ }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap);
}

/** Top-N recent commits whose subject overlaps the question. Uses
 *  spawnSync + arg array (not execSync string) so cmd.exe on Windows
 *  doesn't interpret the pipe-character separator. Separator MNEMESEP
 *  is unlikely to appear in commit subjects. */
function topRecentCommits(repoRoot: string, tokens: string[], cap = 3): { sha: string; date: string; subject: string }[] {
  try {
    const r = spawnSync("git", [
      "-C", repoRoot,
      "log",
      "--max-count=300",
      "--pretty=format:%H@@MNEMESEP@@%cI@@MNEMESEP@@%s",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return [];
    const out: { sha: string; date: string; subject: string }[] = [];
    for (const line of r.stdout.split("\n")) {
      const parts = line.split("@@MNEMESEP@@");
      if (parts.length < 3) continue;
      const subject = (parts.slice(2).join("@@MNEMESEP@@") ?? "").toLowerCase();
      const matches = tokens.some((t) => subject.includes(t));
      if (matches) {
        out.push({ sha: parts[0]!.slice(0, 7), date: parts[1]!.slice(0, 10), subject: parts.slice(2).join("@@MNEMESEP@@") });
        if (out.length >= cap) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Recent growth-event lessons from nucleus.json (kind === "growth-event"). */
function topGrowthLessons(repoRoot: string, cap = 3): { tick: number; text: string }[] {
  const path = join(repoRoot, ".mneme", "nucleus.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { lessons?: Array<{ tick: number; text: string; kind?: string }> };
    const lessons = parsed.lessons ?? [];
    const growth = lessons.filter((l) => l.kind === "growth-event");
    return growth.slice(-cap).reverse().map((l) => ({ tick: l.tick, text: l.text }));
  } catch {
    return [];
  }
}

/** Assemble the full prompt + return slices for the verifier. */
export function buildContext(repoRoot: string, question: string): BuiltContext {
  const tokens = tokenize(question);
  const files = topRelevantFiles(repoRoot, tokens);
  const commits = topRecentCommits(repoRoot, tokens);
  const lessons = topGrowthLessons(repoRoot);

  const slices: ContextSlice[] = [];
  if (files.length > 0) {
    slices.push({
      label: "REPO",
      lines: files.map((f) => `${f.path}  -- ${f.snippet.slice(0, 100)}`),
    });
  }
  if (commits.length > 0) {
    slices.push({
      label: "HISTORY",
      lines: commits.map((c) => `${c.sha} (${c.date}) -- ${c.subject}`),
    });
  }
  if (lessons.length > 0) {
    slices.push({
      label: "WISDOM",
      lines: lessons.map((l) => `[tick ${l.tick}] ${l.text}`),
    });
  }

  const sliceBlock = slices.map((s) => {
    return `[${s.label}]\n` + s.lines.map((l) => `  - ${l}`).join("\n");
  }).join("\n\n");
  const evidence = sliceBlock.length > 0 ? sliceBlock : "[NO EVIDENCE FOUND -- be honest about that]";

  const prompt = [
    `[SYSTEM]`,
    SYSTEM_PROMPT,
    ``,
    evidence,
    ``,
    `[USER QUESTION]`,
    question,
    ``,
    `[YOUR ANSWER -- cite the evidence above]`,
  ].join("\n");

  return { prompt, slices, approxTokens: Math.ceil(prompt.length / 4) };
}

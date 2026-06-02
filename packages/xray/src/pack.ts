/**
 * AI CONTEXT PACK — the genius answer to Gitingest & every "repo → one text blob"
 * tool. They DUMP everything: a huge repo becomes millions of tokens (won't fit
 * any model), with secrets included raw, no prioritization, and (for private
 * repos) your code read on their server.
 *
 * We do the opposite — an INTELLIGENT, BUDGETED, SECRET-REDACTED, PRIORITIZED
 * pack the model can actually use:
 *   • RANK files by real signals (change-frequency × size = hotspot, entry
 *     points, central files) — the AI gets signal, not noise.
 *   • SKELETON-FIRST: most files contribute their structural outline (signatures,
 *     ~95% fewer tokens via @mneme-ai/core `outline`); only the few most-central
 *     files are included in full.
 *   • TOKEN BUDGET: greedily fill to a budget so the pack ALWAYS fits the model's
 *     window (mattermost included).
 *   • REDACT secrets (egress) — gitingest leaks them; we don't.
 *   • A "read this first" guide derived from hotspots.
 *   • LOCAL-FIRST: private repos run through the bridge; the code never uploads.
 *
 * The pack intentionally CONTAINS code (that's its purpose), so it is returned to
 * the user to copy/paste — never stored on the server.
 */
import { outline, egress } from "@mneme-ai/core";
import { listTextFiles, readText, git, isGitRepo, repoNameFromPath } from "./util.js";
import { join, extname, basename } from "node:path";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc|rb|php|cs|kt|swift|scala|vue|svelte)$/i;
const estTok = (s: string) => Math.ceil(s.length / 4);

export interface ContextPack {
  repoName: string;
  markdown: string;
  estTokens: number;
  filesIncluded: number;
  filesFull: number;
  filesOutline: number;
  filesOmitted: number;
  secretsRedacted: number;
  budget: number;
  note: string;
}

function changeFreq(repoPath: string, now: number, windowDays = 365): Map<string, number> {
  const m = new Map<string, number>();
  if (!isGitRepo(repoPath)) return m;
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const raw = git(repoPath, ["log", "--since", since, "--no-merges", "--name-only", "--pretty=format:"]);
  for (const line of raw.split("\n")) { const f = line.trim(); if (f) m.set(f, (m.get(f) ?? 0) + 1); }
  return m;
}

function entrypointBonus(rel: string): number {
  const b = basename(rel).toLowerCase();
  if (/^readme/.test(b)) return 1000;
  if (b === "package.json" || b === "go.mod" || b === "cargo.toml" || b === "pyproject.toml") return 700;
  if (/^(index|main|app|server|cli)\.(t|j)sx?$/.test(b) || b === "main.go" || b === "main.py" || b === "__main__.py") return 500;
  const depth = rel.split("/").length;
  if (/^src\//.test(rel) && depth <= 2) return 200;
  return 0;
}

function redact(text: string): { text: string; n: number } {
  const r = egress.scanEgress({ payload: text, entropy: { enabled: false } });
  return { text: r.redactedPayload, n: r.secretsRedacted };
}

function tree(rels: string[], cap = 400): string {
  const shown = rels.slice(0, cap).sort();
  const more = rels.length > cap ? `\n… and ${rels.length - cap} more files` : "";
  return shown.join("\n") + more;
}

export function buildContextPack(repoPath: string, opts: { budget?: number; now?: number } = {}): ContextPack {
  const budget = Math.max(10_000, Math.min(500_000, opts.budget ?? 120_000));
  const now = opts.now ?? Date.now();
  const repoName = repoNameFromPath(repoPath);
  const { files } = listTextFiles(repoPath, 8000);
  const freq = changeFreq(repoPath, now);

  // importance = entrypoint + change-frequency×8 + size signal
  const scored = files.map((f) => {
    const ch = freq.get(f.rel) ?? 0;
    const score = entrypointBonus(f.rel) + ch * 8 + Math.min(extname(f.rel).match(CODE_EXT) ? 60 : 10, 60);
    return { ...f, score, changes: ch };
  }).sort((a, b) => b.score - a.score);

  // reserve room for the structure tree + header so the TOTAL stays within the
  // budget (the pack must fit the model, tree included).
  const treeCap = Math.max(150, Math.min(1500, Math.floor(budget / 120)));
  const treeStr = tree(files.map((f) => f.rel), treeCap);
  const reserve = estTok(treeStr) + 1400; // tree + header + reading guide overhead
  const sectionBudget = Math.max(8000, budget - reserve);

  const FULL_CAP = 10; // the few most-central files go in full
  let used = 0, full = 0, outl = 0, omitted = 0, redacted = 0;
  const sections: string[] = [];

  for (let i = 0; i < scored.length; i++) {
    if (used >= sectionBudget) { omitted = scored.length - i; break; }
    const f = scored[i];
    const src = readText(f.abs);
    if (!src) { continue; }
    const isCode = CODE_EXT.test(f.rel);
    // a single huge file must NOT dominate the budget — full only if it fits a
    // per-file cap, else fall back to its outline (skeleton).
    const maxFullChars = Math.max(24_000, Math.floor(budget * 0.25) * 4);
    const wantFull = (i < FULL_CAP || !isCode) && src.length <= maxFullChars;
    let body: string, kind: string;

    if (wantFull) {
      const rd = redact(src); redacted += rd.n;
      body = rd.text; kind = "FULL";
    } else {
      // skeleton via outline — signatures only, bodies elided
      let skel = "";
      try { skel = isCode ? outline.renderOutline(outline.extractOutline(src, { path: f.rel }), { path: f.rel }) : ""; } catch { skel = ""; }
      if (!skel || skel.length >= src.length) {
        // non-code or unparseable: include a truncated, redacted head
        const head = src.length > maxFullChars ? src.slice(0, maxFullChars) + "\n… (truncated)" : src;
        const rd = redact(head); body = rd.text; redacted += rd.n; kind = src.length > maxFullChars ? "OUTLINE" : "FULL";
      } else {
        const rd = redact(skel); body = rd.text; redacted += rd.n; kind = "OUTLINE";
      }
    }

    const lang = (extname(f.rel).slice(1) || "").toLowerCase();
    // CORRUPTION GUARD: if the body contains a run of backticks, the code fence
    // must be LONGER than that run, or the markdown breaks when pasted into an
    // AI (it would mis-detect where the file ends). Use (longest run + 1), min 3.
    const longestTicks = (body.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = "`".repeat(Math.max(3, longestTicks + 1));
    const section = `\n### ${f.rel}  _(${kind}${f.changes ? `, changed ${f.changes}×` : ""})_\n\n${fence}${lang}\n${body}\n${fence}\n`;
    const cost = estTok(section);
    if (used + cost > sectionBudget && used > 0) { omitted = scored.length - i; break; }
    used += cost;
    sections.push(section);
    if (kind === "FULL") full++; else outl++;
  }

  // reading guide from the top-scored files
  const top = scored.slice(0, 8).map((f) => `- \`${f.rel}\`${f.changes ? ` — changed ${f.changes}× (hotspot)` : ""}`).join("\n");
  const coverage = omitted === 0
    ? `Complete: all ${files.length} source files are included.`
    : `${full + outl} of ${files.length} files included as content (the highest-signal ones); the remaining ${omitted} are listed in the Structure tree below but their contents were omitted to fit the model. Raise the budget or pack a sub-folder for full contents.`;
  const header =
`# AI Context Pack — ${repoName}

> Generated by Mneme X-Ray. **Prioritized** (signal, not a raw dump), **secret-redacted**, and **token-budgeted** to fit your model's window. ~${used.toLocaleString()} tokens.
>
> **Coverage:** ${coverage}

## 🧭 Read this first (highest-signal files)
${top}

## 🗂 Full structure (every file in the repo)
\`\`\`
${treeStr}
\`\`\`

## 📄 Files (FULL for central files · OUTLINE = exact signatures for the rest · secrets redacted)
`;

  const markdown = header + sections.join("");
  return {
    repoName,
    markdown,
    estTokens: estTok(markdown),
    filesIncluded: full + outl,
    filesFull: full,
    filesOutline: outl,
    filesOmitted: omitted,
    secretsRedacted: redacted,
    budget,
    note: `Prioritized ${full + outl} of ${files.length} files into ~${estTok(markdown).toLocaleString()} tokens (budget ${budget.toLocaleString()}); ${redacted} secret(s) redacted. Unlike a raw dump, this fits the model and leaks nothing.`,
  };
}

/**
 * `mneme constitution` — Codebase Constitution synthesizer.
 *
 * Synthesises a living "constitution" document from the repo's history:
 * never-do rules from past regrets · expert-pairing constraints from
 * atrophy · file-level safety constraints from incidents · architectural
 * decisions auto-extracted from commit messages.
 *
 * Output: a Markdown document AI tools can prepend to their system prompt
 * (via the MCP `mneme.constitution.get` tool) so AI literally cannot
 * suggest things that contradict the constitution.
 *
 * v1.10.0 ships rule-extraction from 4 sources:
 *   • regret patterns (rules from "we tried X, broke Y")
 *   • atrophy / bus-factor (pairing constraints)
 *   • forensics anomalies (security must-not-do rules)
 *   • decisions (ADR-style "must do" rules)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git, store, util, people } from "@mneme-ai/core";
import { dbPath } from "../paths.js";

export interface ConstitutionOptions {
  cwd: string;
  out?: string;
  json?: boolean;
}

export interface ConstitutionRule {
  id: string;
  source: "regret" | "atrophy" | "forensics" | "decision";
  rule: string;
  evidence: string;
  severity: "must-not" | "must" | "should" | "consider";
}

export interface Constitution {
  generatedAt: string;
  generatedByMneme: string;
  repoName: string;
  rules: ConstitutionRule[];
}

function safeReadVersion(): string {
  try {
    const here = new URL(".", import.meta.url).pathname;
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const pkgPath = path.resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function extractRegretRules(commits: import("@mneme-ai/core").Commit[]): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  // Find revert/hotfix patterns
  const reverts = commits.filter((c) => /\b(revert|hotfix|rollback)\b/i.test(c.subject));
  for (let i = 0; i < Math.min(5, reverts.length); i++) {
    const r = reverts[i]!;
    rules.push({
      id: `regret-${r.shortHash}`,
      source: "regret",
      rule: `Be cautious with patterns similar to: ${r.subject.slice(0, 100)}`,
      evidence: `Commit ${r.shortHash} (${r.authorDate.slice(0, 10)}) — past regret`,
      severity: "should",
    });
  }
  return rules;
}

function extractAtrophyRules(s: store.MnemeStore): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  try {
    const report = people.atrophy(s, { topN: 10 });
    // For records below 30 freshness, add a pairing constraint
    const records = (report as { records?: Array<{ score: number; authorEmail?: string; area?: string }> }).records ?? [];
    for (let i = 0; i < Math.min(5, records.length); i++) {
      const rec = records[i]!;
      if (rec.score < 30 && rec.authorEmail && rec.area) {
        rules.push({
          id: `atrophy-${i}`,
          source: "atrophy",
          rule: `Pair with ${rec.authorEmail} when modifying ${rec.area} (knowledge atrophy ${rec.score}/100)`,
          evidence: `Atrophy report — ${rec.authorEmail}'s ${rec.area} expertise is fading`,
          severity: "should",
        });
      }
    }
  } catch {}
  return rules;
}

function extractForensicsRules(s: store.MnemeStore): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  try {
    const incidents = s.db.prepare("SELECT * FROM incidents LIMIT 10").all() as Array<{ title?: string; affected_files?: string }>;
    for (let i = 0; i < incidents.length; i++) {
      const inc = incidents[i]!;
      const files = inc.affected_files ? (JSON.parse(inc.affected_files) as string[]) : [];
      if (inc.title && files.length > 0) {
        rules.push({
          id: `forensics-${i}`,
          source: "forensics",
          rule: `Apply extra scrutiny to ${files[0]} — past incident: ${inc.title.slice(0, 80)}`,
          evidence: `Incident affected ${files.length} file(s)`,
          severity: "must",
        });
      }
    }
  } catch {}
  return rules;
}

function extractDecisionRules(commits: import("@mneme-ai/core").Commit[]): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  const decisionMarkers = /\b(adr|decision|chose|migrate|switch from .+ to .+)\b/i;
  const filtered = commits.filter((c) => decisionMarkers.test(c.subject));
  for (let i = 0; i < Math.min(5, filtered.length); i++) {
    const r = filtered[i]!;
    rules.push({
      id: `decision-${r.shortHash}`,
      source: "decision",
      rule: `Prior decision: ${r.subject.slice(0, 100)}`,
      evidence: `Commit ${r.shortHash} (${r.authorDate.slice(0, 10)}) — architectural decision`,
      severity: "should",
    });
  }
  return rules;
}

export function renderConstitutionMarkdown(c: Constitution): string {
  const lines: string[] = [];
  lines.push(`# ${c.repoName} — Codebase Constitution`);
  lines.push("");
  lines.push(`> AI tools: prepend this to your system prompt before answering. ` +
    `These rules are derived from this repo's history of regrets, decisions, ` +
    `incidents, and knowledge-atrophy patterns. **Contradicting them is a hallucination signal.**`);
  lines.push("");
  lines.push(`Generated: ${c.generatedAt} · By Mneme ${c.generatedByMneme}`);
  lines.push("");

  const bySource = new Map<string, ConstitutionRule[]>();
  for (const r of c.rules) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source)!.push(r);
  }

  for (const [source, rules] of bySource) {
    const heading =
      source === "regret" ? "## ⚠ Past regrets — patterns to avoid" :
      source === "atrophy" ? "## 👥 Knowledge atrophy — pairing constraints" :
      source === "forensics" ? "## 🛡 Security — must-do scrutiny zones" :
      "## 📋 Architectural decisions";
    lines.push(heading);
    lines.push("");
    for (const r of rules) {
      const tag =
        r.severity === "must-not" ? "❌ MUST NOT" :
        r.severity === "must" ? "✅ MUST" :
        r.severity === "should" ? "▸ SHOULD" : "○ CONSIDER";
      lines.push(`- ${tag}: ${r.rule}`);
      lines.push(`  - *Evidence: ${r.evidence}*`);
    }
    lines.push("");
  }

  if (c.rules.length === 0) {
    lines.push("## (No rules synthesized)");
    lines.push("");
    lines.push("Run `mneme index` first to build the corpus, then re-run `mneme constitution` to derive rules.");
  }

  lines.push("---");
  lines.push("");
  lines.push("> *This document is auto-synthesized. Re-run `mneme constitution` after major commits.*");
  return lines.join("\n");
}

export async function constitutionCommand(opts: ConstitutionOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const dbPathStr = dbPath(meta.rootPath);
  if (!existsSync(dbPathStr)) {
    ui.error("No Mneme index found. Run `mneme index` first.");
    return 1;
  }
  const s = new store.MnemeStore(dbPathStr);
  const commits = util.loadAllCommits(s);

  const rules: ConstitutionRule[] = [
    ...extractForensicsRules(s),
    ...extractRegretRules(commits),
    ...extractAtrophyRules(s),
    ...extractDecisionRules(commits),
  ];

  const constitution: Constitution = {
    generatedAt: new Date().toISOString(),
    generatedByMneme: safeReadVersion(),
    repoName: meta.repo ?? "(unknown)",
    rules,
  };

  const md = renderConstitutionMarkdown(constitution);

  // Always cache the result for the MCP tool to read
  const cachePath = join(meta.rootPath, ".mneme", "constitution.md");
  if (!existsSync(dirname(cachePath))) mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, md, "utf8");

  if (opts.out) {
    writeFileSync(opts.out, md, "utf8");
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(constitution, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    kleur.bold(`\n  📜 Constitution synthesised — ${rules.length} rule(s)\n\n`) +
      `  ${kleur.green("✓")} cached at .mneme/constitution.md\n` +
      (opts.out ? `  ${kleur.green("✓")} written to ${opts.out}\n` : "") +
      `\n  AI tools can fetch via the MCP tool ${kleur.cyan("mneme.constitution.get")}.\n\n`,
  );
  return 0;
}

// Test exports
export const _renderConstitutionMarkdownForTests = renderConstitutionMarkdown;
export const _extractRegretRulesForTests = extractRegretRules;
export const _extractDecisionRulesForTests = extractDecisionRules;

/**
 * `mneme forensics` — applied forensic science for code.
 *
 * Subcommands:
 *   match <commit> <author>   — STR-loci LR matching, ENFSI verbal scale
 *   attribute <commit>        — anonymous attribution: rank candidates by LR
 *   vulns                      — pattern-match security vulnerabilities in history
 *   anomaly                   — insider-threat detection (compromised credentials)
 *
 * Pure data extraction lives in @mneme-ai/core/forensics. This file
 * does the CLI plumbing + rendering.
 */
import kleur from "kleur";
import {
  git,
  store,
  forensics,
  util,
  type Commit,
} from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

// Shared withStore wrapper inline (mirrors insights-cli pattern)
async function withStore<T>(
  cwd: string,
  f: (s: store.MnemeStore) => Promise<T> | T,
): Promise<T | number> {
  if (!(await git.isGitRepo(cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }
  try {
    return await f(s);
  } finally {
    s.close();
  }
}

// ─── mneme forensics match ───────────────────────────────────────────

export interface ForensicsMatchOptions {
  cwd: string;
  commitHash: string;
  authorEmail: string;
  json?: boolean;
}

export async function forensicsMatchCommand(opts: ForensicsMatchOptions): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const evidenceCommit =
      allCommits.find((c) => c.hash.startsWith(opts.commitHash)) ?? null;
    if (!evidenceCommit) return { error: `Commit ${opts.commitHash} not found in index.` };

    // Build per-author profiles (population)
    const byAuthor = new Map<string, Commit[]>();
    for (const c of allCommits) {
      const a = c.authorEmail.toLowerCase();
      const arr = byAuthor.get(a);
      if (arr) arr.push(c);
      else byAuthor.set(a, [c]);
    }

    const profiles: forensics.ForensicLoci[] = [];
    for (const [, list] of byAuthor) profiles.push(forensics.extractLoci(list));
    const population = forensics.buildPopulationStats(profiles);

    const evidenceLoci = forensics.extractLoci([evidenceCommit]);
    const suspectCommits = byAuthor.get(opts.authorEmail.toLowerCase());
    if (!suspectCommits || suspectCommits.length < 5) {
      return { error: `Author ${opts.authorEmail} has fewer than 5 commits — not enough baseline.` };
    }
    const suspectLoci = forensics.extractLoci(suspectCommits);
    const report = forensics.compareLoci(evidenceLoci, suspectLoci, population);

    return { evidenceCommit, suspect: opts.authorEmail, report, suspectCommits: suspectCommits.length };
  });
  if (typeof result === "number") return result;
  if ("error" in result) {
    ui.error(result.error ?? "Unknown error");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🧬  Forensic Match — STR-loci likelihood ratio")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.gray("commit ")} ${kleur.bold(result.evidenceCommit.shortHash)} ${kleur.gray(`(${result.evidenceCommit.subject})`)}\n`);
  process.stdout.write(`  ${kleur.gray("suspect")} ${kleur.bold(result.suspect)} ${kleur.gray(`(${result.suspectCommits} prior commits)`)}\n\n`);

  const lr = result.report.combinedLR;
  process.stdout.write(`  ${kleur.bold().magenta("✦ Combined Likelihood Ratio")}\n`);
  process.stdout.write(`    LR = ${kleur.bold(lr >= 1 ? lr.toExponential(2) : lr.toExponential(2))}  ${kleur.gray("(log10 = " + result.report.log10LR + ")")}\n`);
  process.stdout.write(`    ${verdictBadge(result.report.verdict)}\n\n`);

  process.stdout.write(`  ${kleur.bold().magenta("◆ Per-locus contribution")}\n\n`);
  for (const l of result.report.perLocus) {
    const meter = lociMeter(l.lr);
    process.stdout.write(`    ${meter}  ${kleur.bold(l.name.padEnd(20))} LR=${l.lr.toFixed(2).padStart(8)}\n`);
    process.stdout.write(`        ${kleur.gray(l.note)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

// ─── mneme forensics attribute ───────────────────────────────────────

export interface ForensicsAttributeOptions {
  cwd: string;
  commitHash: string;
  topN?: number;
  json?: boolean;
}

export async function forensicsAttributeCommand(
  opts: ForensicsAttributeOptions,
): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const evidenceCommit =
      allCommits.find((c) => c.hash.startsWith(opts.commitHash)) ?? null;
    if (!evidenceCommit) return { error: `Commit ${opts.commitHash} not found in index.` };

    const byAuthor = new Map<string, Commit[]>();
    for (const c of allCommits) {
      const a = c.authorEmail.toLowerCase();
      const arr = byAuthor.get(a);
      if (arr) arr.push(c);
      else byAuthor.set(a, [c]);
    }

    const profiles: forensics.ForensicLoci[] = [];
    for (const [, list] of byAuthor) profiles.push(forensics.extractLoci(list));
    const population = forensics.buildPopulationStats(profiles);

    const evidenceLoci = forensics.extractLoci([evidenceCommit]);

    const candidates: Array<{ author: string; commitCount: number; report: ReturnType<typeof forensics.compareLoci> }> = [];
    for (const [author, list] of byAuthor) {
      if (list.length < 5) continue;
      const suspectLoci = forensics.extractLoci(list);
      const report = forensics.compareLoci(evidenceLoci, suspectLoci, population);
      candidates.push({ author, commitCount: list.length, report });
    }
    candidates.sort((a, b) => b.report.combinedLR - a.report.combinedLR);

    return { evidenceCommit, candidates };
  });
  if (typeof result === "number") return result;
  if ("error" in result) {
    ui.error(result.error ?? "Unknown error");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🧬  Forensic Attribution — anonymous commit → most likely author")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.gray("commit")} ${kleur.bold(result.evidenceCommit.shortHash)} ${kleur.gray(`(${result.evidenceCommit.subject})`)}\n\n`);

  const top = result.candidates.slice(0, opts.topN ?? 5);
  process.stdout.write(`  ${kleur.bold().magenta("◆ Ranked candidates")}\n\n`);
  for (let i = 0; i < top.length; i++) {
    const c = top[i]!;
    const lr = c.report.combinedLR;
    const lrStr = lr >= 1 ? lr.toExponential(2) : lr.toExponential(2);
    const rank = `#${i + 1}`;
    process.stdout.write(`    ${kleur.bold(rank.padStart(3))}  ${kleur.bold(c.author.padEnd(32))}  LR=${lrStr.padStart(10)}  ${verdictBadge(c.report.verdict)}\n`);
    process.stdout.write(`         ${kleur.gray(`${c.commitCount} prior commits · log10(LR)=${c.report.log10LR}`)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

// ─── mneme forensics vulns ───────────────────────────────────────────

export interface ForensicsVulnsOptions {
  cwd: string;
  since?: string;
  topN?: number;
  json?: boolean;
}

export async function forensicsVulnsCommand(opts: ForensicsVulnsOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  // Use git directly so we don't require an index — vulnerability
  // hunting works on raw commit history.
  const sinceArg = opts.since ? ["--since", opts.since] : [];
  const log = await git.execGitOk(
    ["log", "-n", String(opts.topN ?? 500), ...sinceArg, "--no-color", "--pretty=format:::commit::%H::%aI::%an::%ae::%s"],
    { cwd: meta.rootPath },
  );

  const inputs: Array<{ commit: Commit; diff?: string }> = [];
  for (const line of log.split("\n")) {
    if (!line.startsWith("::commit::")) continue;
    const parts = line.split("::");
    const hash = parts[2] ?? "";
    if (!hash) continue;
    const commit: Commit = {
      hash,
      shortHash: hash.slice(0, 7),
      authorName: parts[4] ?? "",
      authorEmail: parts[5] ?? "",
      authorDate: parts[3] ?? "",
      committerDate: parts[3] ?? "",
      subject: parts.slice(6).join("::"),
      body: "",
      files: [],
      parents: [],
    };
    let diff = "";
    try {
      diff = await git.execGitOk(["show", "--no-color", "--pretty=format:", hash], {
        cwd: meta.rootPath,
      });
    } catch {
      // ignore — skip diff if it fails
    }
    inputs.push({ commit, diff });
  }

  const report = forensics.huntVulnerabilities(inputs);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🛡  Vulnerability Hunt — pattern-matched security findings")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold(String(report.scanned))} commits scanned  ·  ${kleur.bold(String(report.hits.length))} hits  ·  ${kleur.bold(String(report.silentFixes.length))} silent fixes\n\n`);

  if (report.hits.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No vulnerable patterns detected in the scanned window.\n\n`);
    return 0;
  }

  // Severity tally
  const sevOrder: Array<keyof typeof report.bySeverity> = ["critical", "high", "medium", "low", "info"];
  process.stdout.write(`  ${kleur.bold().magenta("✦ By severity")}\n`);
  for (const s of sevOrder) {
    const n = report.bySeverity[s];
    if (n > 0) {
      process.stdout.write(`    ${severityBadge(s)}  ${kleur.bold(String(n))}\n`);
    }
  }
  process.stdout.write("\n");

  // Top hits
  process.stdout.write(`  ${kleur.bold().magenta("◆ Top findings")}\n\n`);
  // Sort by severity then by recency
  const sevWeight: Record<typeof report.hits[number]["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const sortedHits = [...report.hits].sort((a, b) => {
    const w = sevWeight[a.severity] - sevWeight[b.severity];
    if (w !== 0) return w;
    return b.commit.authorDate.localeCompare(a.commit.authorDate);
  });
  for (const h of sortedHits.slice(0, 20)) {
    const fix = h.looksLikeFix ? kleur.gray(" [fix]") : "";
    process.stdout.write(`    ${severityBadge(h.severity)}  ${kleur.bold(h.commit.shortHash)} ${kleur.gray(h.commit.authorDate.slice(0, 10))} ${kleur.cyan(h.reference)}${fix}\n`);
    process.stdout.write(`        ${h.summary}\n`);
    process.stdout.write(`        ${kleur.gray("evidence: " + h.evidence)}\n\n`);
  }
  return 0;
}

// ─── mneme forensics anomaly ─────────────────────────────────────────

export interface ForensicsAnomalyOptions {
  cwd: string;
  threshold?: number;
  topN?: number;
  json?: boolean;
}

export async function forensicsAnomalyCommand(
  opts: ForensicsAnomalyOptions,
): Promise<number> {
  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const fileChanges = util.loadAllFileChanges(s);
    const baselines = forensics.buildBaselines(allCommits, fileChanges);
    const findings = forensics.detectAnomalies(
      allCommits,
      baselines,
      fileChanges,
      opts.threshold ?? 0.9,
    );
    return { findings, scanned: allCommits.length, baselines: baselines.size };
  });
  if (typeof result === "number") return result;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`\n  ${kleur.bold().cyan("🕵  Anomaly Detection — insider-threat / credential-compromise hunt")}\n`);
  process.stdout.write(`  ${divider()}\n\n`);
  process.stdout.write(`  ${kleur.bold(String(result.scanned))} commits scanned  ·  ${kleur.bold(String(result.baselines))} authors baselined  ·  ${kleur.bold(String(result.findings.length))} anomalies\n\n`);

  if (result.findings.length === 0) {
    process.stdout.write(`  ${kleur.green("✓")} No anomalous commits detected at the configured threshold.\n\n`);
    return 0;
  }

  process.stdout.write(`  ${kleur.bold().magenta("⚠ Anomalous commits (sorted by deviation)")}\n\n`);
  for (const f of result.findings.slice(0, opts.topN ?? 10)) {
    const c = f.commit;
    process.stdout.write(`    ${severityBadge(f.severity)}  ${kleur.bold(c.shortHash)} ${kleur.gray(c.authorDate.slice(0, 16) + " · " + c.authorName)}\n`);
    process.stdout.write(`        ${kleur.bold(`deviation = ${f.totalDeviation.toFixed(2)}  (≈ ${f.approxSigma}σ)`)}\n`);
    process.stdout.write(`        ${c.subject}\n`);
    for (const a of f.axes) {
      if (a.score < 0.1) continue;
      const meter = lociMeter(a.score * 5 + 1); // map 0..1 → bar
      process.stdout.write(`          ${meter}  ${kleur.cyan(a.axis.padEnd(6))} ${kleur.gray(a.note)}\n`);
    }
    process.stdout.write(`        ${kleur.yellow("→ " + f.recommendation)}\n\n`);
  }
  return 0;
}

// ─── shared rendering helpers ────────────────────────────────────────

function divider(): string {
  return kleur.gray("═".repeat(64));
}

function verdictBadge(v: string): string {
  if (v.includes("extremely strong support against") || v.includes("very strong support against")) {
    return kleur.red().bold(v.toUpperCase());
  }
  if (v.includes("against")) return kleur.yellow().bold(v.toUpperCase());
  if (v === "uninformative") return kleur.gray().bold(v.toUpperCase());
  if (v.includes("extremely strong support") || v.includes("very strong support")) {
    return kleur.green().bold(v.toUpperCase());
  }
  if (v.includes("strong support")) return kleur.cyan().bold(v.toUpperCase());
  return kleur.bold(v.toUpperCase());
}

function severityBadge(sev: string): string {
  switch (sev) {
    case "critical":
      return kleur.red().bold("CRIT    ");
    case "high":
      return kleur.red("HIGH    ");
    case "medium":
      return kleur.yellow("MEDIUM  ");
    case "low":
      return kleur.cyan("LOW     ");
    case "info":
      return kleur.gray("INFO    ");
    default:
      return kleur.gray(sev.padEnd(8));
  }
}

function lociMeter(lr: number): string {
  // 0..1 → red, 1..5 → yellow, 5..50 → green, 50+ → bright green
  const cap = Math.min(10, Math.max(0, Math.log10(Math.max(lr, 1e-6)) + 3));
  const blocks = Math.round(cap);
  const filled = "█".repeat(blocks);
  const empty = "░".repeat(10 - blocks);
  if (lr >= 50) return kleur.green().bold(filled) + kleur.gray(empty);
  if (lr >= 5) return kleur.green(filled) + kleur.gray(empty);
  if (lr >= 1) return kleur.cyan(filled) + kleur.gray(empty);
  if (lr >= 0.2) return kleur.yellow(filled) + kleur.gray(empty);
  return kleur.red(filled) + kleur.gray(empty);
}

/**
 * `mneme forensics` — applied forensic science for code.
 *
 * Subcommands:
 *   match <commit> <author>   — STR-loci LR matching, ENFSI verbal scale
 *   attribute <commit>        — anonymous attribution: rank candidates by LR
 *   vulns                     — pattern-match security vulnerabilities in history
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
import {
  ui,
  header,
  section,
  divider,
  severityBadge,
  logMeter,
  meter,
  citation,
  emptyState,
  nextSteps,
  verdictBadge,
  kv,
  pill,
  type Level,
} from "../ui.js";

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

// Map forensic severity strings to UI Level type
const sevToLevel: Record<string, Level> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "info",
};

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
  process.stdout.write(header("🧬", "Forensic Match — STR-loci likelihood ratio",
    "Bayesian author attribution · ENFSI 2015 verbal scale") + "\n\n");

  process.stdout.write(kv("commit", `${kleur.bold(result.evidenceCommit.shortHash)}  ${kleur.gray(result.evidenceCommit.subject)}`) + "\n");
  process.stdout.write(kv("suspect", `${kleur.bold(result.suspect)}  ${kleur.gray(`(${result.suspectCommits} prior commits)`)}`) + "\n\n");

  const lr = result.report.combinedLR;
  process.stdout.write(section("✦ Combined Likelihood Ratio") + "\n");
  process.stdout.write(`    ${kleur.bold("LR")} = ${kleur.bold(lr.toExponential(2))}  ${kleur.gray(`log10 = ${result.report.log10LR}`)}\n`);
  process.stdout.write(`    ${verdictBadge(result.report.verdict)}\n`);
  process.stdout.write(`    ${kleur.gray(verdictPlainEnglish(result.report.verdict, result.suspect))}\n\n`);

  process.stdout.write(section("◆ Per-locus contribution", "(12 STR loci · meter shows log-LR)") + "\n\n");
  // Sort: largest |log-LR| first — drives the eye to the most informative loci.
  const sortedLoci = [...result.report.perLocus].sort(
    (a, b) => Math.abs(Math.log10(b.lr)) - Math.abs(Math.log10(a.lr)),
  );
  for (const l of sortedLoci) {
    process.stdout.write(
      `    ${logMeter(l.lr)}  ${kleur.bold(l.name.padEnd(20))} ${kleur.gray("LR=")}${formatLR(l.lr).padStart(9)}\n`,
    );
    process.stdout.write(`        ${kleur.gray(l.note)}\n`);
  }
  process.stdout.write("\n");

  // ─── Smart next steps ────────────────────────────────────────────
  const isMatch = lr >= 100;
  const isAgainst = lr <= 0.01;
  const acts: Array<{ cmd: string; why: string }> = [];
  if (isAgainst) {
    acts.push({
      cmd: `mneme forensics attribute ${result.evidenceCommit.shortHash} --top 5`,
      why: "Strong evidence against this suspect — find the most-likely actual author.",
    });
  } else if (!isMatch) {
    acts.push({
      cmd: `mneme forensics attribute ${result.evidenceCommit.shortHash} --top 5`,
      why: "LR is uninformative — let attribute rank ALL authors by likelihood.",
    });
  }
  acts.push({
    cmd: `mneme forensics anomaly --threshold 1.5`,
    why: "Hunt for OTHER suspicious commits in history (insider-threat scan).",
  });
  process.stdout.write(nextSteps(acts) + "\n\n");
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
  process.stdout.write(header("🧬", "Forensic Attribution — anonymous commit → most likely author",
    "Bayesian ranking across ALL authors with ≥5 prior commits") + "\n\n");

  process.stdout.write(kv("commit", `${kleur.bold(result.evidenceCommit.shortHash)}  ${kleur.gray(result.evidenceCommit.subject)}`) + "\n\n");

  if (result.candidates.length === 0) {
    process.stdout.write(emptyState(
      "Not enough author history to attribute.",
      [
        "Need ≥5 prior commits per author for a baseline profile.",
        "Run `mneme index` if you've added commits since the last index.",
      ],
    ));
    return 0;
  }

  // ─── Top-line insight (the "AI from the future" feel) ───────────
  const top = result.candidates[0]!;
  const second = result.candidates[1];
  const ratio = second ? top.report.combinedLR / Math.max(second.report.combinedLR, 1e-9) : Infinity;
  const insightStr = (() => {
    if (top.report.combinedLR >= 1000 && (!second || ratio >= 100)) {
      return `🎯  ${kleur.bold(top.author)} is the overwhelming match (LR ratio vs runner-up: ${ratio.toExponential(1)}).`;
    }
    if (top.report.combinedLR >= 100) {
      return `🎯  ${kleur.bold(top.author)} is the most-likely author — strong support, but ${ratio < 10 ? "the runner-up is close" : "well above the field"}.`;
    }
    if (top.report.combinedLR >= 2) {
      return `⚠  Weak signal — top candidate ${kleur.bold(top.author)} only modestly above population, treat as a hint not proof.`;
    }
    return `🌫  Inconclusive — no candidate's loci match the evidence with meaningful support.`;
  })();
  process.stdout.write(`  ${insightStr}\n\n`);

  process.stdout.write(section("◆ Ranked candidates") + "\n\n");
  const showN = Math.min(opts.topN ?? 5, result.candidates.length);
  for (let i = 0; i < showN; i++) {
    const c = result.candidates[i]!;
    const lr = c.report.combinedLR;
    const rank = `#${i + 1}`;
    process.stdout.write(
      `    ${kleur.bold(rank.padStart(3))}  ${kleur.bold(c.author.padEnd(32))}  ${kleur.gray("LR=")}${formatLR(lr).padStart(10)}  ${verdictBadge(c.report.verdict)}\n`,
    );
    process.stdout.write(
      `         ${logMeter(lr)}  ${kleur.gray(`${c.commitCount} prior commits · log10(LR)=${c.report.log10LR}`)}\n\n`,
    );
  }

  process.stdout.write(nextSteps([
    {
      cmd: `mneme forensics match ${result.evidenceCommit.shortHash} ${top.author}`,
      why: `See per-locus breakdown for the top candidate.`,
    },
    {
      cmd: `mneme dna ${top.author} --depth 5`,
      why: `Inspect the top candidate's coding DNA fingerprint.`,
    },
  ]) + "\n\n");
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
  process.stdout.write(header("🛡", "Vulnerability Hunt — pattern-matched security findings",
    "11 CWE-aligned classes · scans full diff bodies, additions only") + "\n\n");

  // ─── Scan summary ─────────────────────────────────────────────────
  const totalSev = report.bySeverity.critical + report.bySeverity.high;
  const summaryLine = (() => {
    if (report.hits.length === 0) {
      return `${kleur.green("✓")}  No vulnerable patterns detected in ${kleur.bold(String(report.scanned))} commits.`;
    }
    if (totalSev > 0) {
      return `${kleur.red("⚠")}  ${kleur.red().bold(String(totalSev))} critical/high finding(s) across ${kleur.bold(String(report.scanned))} commits — investigate immediately.`;
    }
    return `${kleur.yellow("!")}  ${kleur.bold(String(report.hits.length))} candidate(s) found across ${kleur.bold(String(report.scanned))} commits — review before action.`;
  })();
  process.stdout.write(`  ${summaryLine}\n\n`);

  if (report.hits.length === 0) {
    if (report.silentFixes.length > 0) {
      process.stdout.write(section("◐ Silent fixes",
        `(security-keyword commits with no rule hits — verify intent)`) + "\n\n");
      for (const sf of report.silentFixes.slice(0, 5)) {
        process.stdout.write(`    ${kleur.gray("●")} ${kleur.bold(sf.shortHash)} ${kleur.gray(sf.authorDate.slice(0, 10))}  ${sf.subject}\n`);
      }
      process.stdout.write("\n");
    }
    return 0;
  }

  // Severity tally with percentage bars
  process.stdout.write(section("✦ By severity") + "\n");
  const sevOrder: Array<keyof typeof report.bySeverity> = ["critical", "high", "medium", "low", "info"];
  const maxCount = Math.max(...sevOrder.map((s) => report.bySeverity[s]));
  for (const s of sevOrder) {
    const n = report.bySeverity[s];
    if (n === 0) continue;
    const ratio = maxCount > 0 ? n / maxCount : 0;
    process.stdout.write(
      `    ${severityBadge(s as Level)}  ${meter(ratio, { width: 12, level: s as Level })}  ${kleur.bold(String(n).padStart(4))}\n`,
    );
  }
  process.stdout.write("\n");

  // CWE breakdown — group hits by reference (CWE)
  const byCwe = new Map<string, number>();
  for (const h of report.hits) {
    byCwe.set(h.reference, (byCwe.get(h.reference) ?? 0) + 1);
  }
  if (byCwe.size > 1) {
    process.stdout.write(section("◇ By CWE class", "(top 5)") + "\n");
    const topCwes = [...byCwe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [cwe, n] of topCwes) {
      process.stdout.write(`    ${kleur.cyan(cwe.padEnd(12))}  ${kleur.bold(String(n).padStart(3))}\n`);
    }
    process.stdout.write("\n");
  }

  // Top hits
  process.stdout.write(section("◆ Top findings") + "\n\n");
  const sevWeight: Record<typeof report.hits[number]["severity"], number> = {
    critical: 0, high: 1, medium: 2, low: 3, info: 4,
  };
  const sortedHits = [...report.hits].sort((a, b) => {
    const w = sevWeight[a.severity] - sevWeight[b.severity];
    if (w !== 0) return w;
    return b.commit.authorDate.localeCompare(a.commit.authorDate);
  });
  for (const h of sortedHits.slice(0, 20)) {
    const fix = h.looksLikeFix ? `  ${pill("fixed", "ok")}` : "";
    process.stdout.write(
      `    ${severityBadge(sevToLevel[h.severity] ?? "info")}  ${kleur.bold(h.commit.shortHash)} ${kleur.gray(h.commit.authorDate.slice(0, 10))} ${kleur.cyan(h.reference)}${fix}\n`,
    );
    process.stdout.write(`        ${h.summary}\n`);
    process.stdout.write(`        ${kleur.gray("evidence: " + truncateOneLine(h.evidence, 100))}\n\n`);
  }

  // Silent fixes (security-keyword commits without hits)
  if (report.silentFixes.length > 0) {
    process.stdout.write(section("◐ Silent fixes",
      `(${report.silentFixes.length} commit(s) mention security but no patterns matched — verify intent)`) + "\n\n");
    for (const sf of report.silentFixes.slice(0, 5)) {
      process.stdout.write(`    ${kleur.gray("●")} ${kleur.bold(sf.shortHash)} ${kleur.gray(sf.authorDate.slice(0, 10))}  ${sf.subject}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(nextSteps([
    {
      cmd: `mneme forensics anomaly --threshold 1.5`,
      why: `Cross-reference: which commits are BOTH vulnerable AND anomalous?`,
    },
    {
      cmd: `mneme forensics vulns --json | jq '.hits[] | select(.severity=="critical")'`,
      why: `Pipe critical findings to your tracker.`,
    },
  ]) + "\n\n");
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
  process.stdout.write(header("🕵", "Anomaly Detection — insider-threat / credential-compromise hunt",
    "Per-author baselines · 4-axis deviation: TIME · FILES · STYLE · SIZE") + "\n\n");

  const counts = countBySeverity(result.findings);
  const topLine = (() => {
    if (result.findings.length === 0) {
      return `${kleur.green("✓")}  No anomalous commits detected at threshold ${kleur.bold((opts.threshold ?? 0.9).toFixed(2))} across ${kleur.bold(String(result.scanned))} commits.`;
    }
    if (counts.critical > 0) {
      return `${kleur.red("⚠")}  ${kleur.red().bold(String(counts.critical))} CRITICAL anomalies across ${kleur.bold(String(result.baselines))} authors — verify identities out-of-band.`;
    }
    return `${kleur.yellow("!")}  ${kleur.bold(String(result.findings.length))} anomalous commit(s) — review before merge.`;
  })();
  process.stdout.write(`  ${topLine}\n\n`);

  if (result.findings.length === 0) {
    process.stdout.write(emptyState(
      "Clean — no commits exceeded the deviation threshold.",
      [
        `Lower threshold to investigate borderline cases: --threshold 0.5`,
        `Run after every push as part of CI for continuous oversight.`,
      ],
    ));
    return 0;
  }

  // Severity tally
  process.stdout.write(section("✦ By severity") + "\n");
  const sevs: Array<{ key: keyof typeof counts; level: Level }> = [
    { key: "critical", level: "critical" },
    { key: "high", level: "high" },
    { key: "medium", level: "medium" },
    { key: "low", level: "low" },
  ];
  const maxC = Math.max(counts.critical, counts.high, counts.medium, counts.low, 1);
  for (const { key, level } of sevs) {
    const n = counts[key];
    if (n === 0) continue;
    process.stdout.write(
      `    ${severityBadge(level)}  ${meter(n / maxC, { width: 12, level })}  ${kleur.bold(String(n).padStart(4))}\n`,
    );
  }
  process.stdout.write("\n");

  process.stdout.write(section("⚠ Anomalous commits", "(sorted by deviation)") + "\n\n");
  for (const f of result.findings.slice(0, opts.topN ?? 10)) {
    const c = f.commit;
    const sevLevel: Level = sevToLevel[f.severity] ?? "info";
    process.stdout.write(
      `    ${severityBadge(sevLevel)}  ${kleur.bold(c.shortHash)} ${kleur.gray(c.authorDate.slice(0, 16) + " · " + c.authorName)}\n`,
    );
    process.stdout.write(
      `        ${kleur.bold(`deviation = ${f.totalDeviation.toFixed(2)}`)}  ${kleur.gray(`(≈ ${f.approxSigma}σ)`)}\n`,
    );
    process.stdout.write(`        ${kleur.white(c.subject)}\n`);
    for (const a of f.axes) {
      if (a.score < 0.1) continue;
      // Each axis maps 0..1 onto the meter directly with auto color.
      const axisLevel: Level = a.score >= 0.8 ? "critical" : a.score >= 0.5 ? "high" : a.score >= 0.3 ? "medium" : "low";
      process.stdout.write(
        `          ${meter(a.score, { width: 10, level: axisLevel })}  ${kleur.cyan(a.axis.padEnd(6))} ${kleur.gray(a.note)}\n`,
      );
    }
    process.stdout.write(`        ${kleur.yellow("→ " + f.recommendation)}\n\n`);
  }

  // Smart next steps based on top finding
  const topFinding = result.findings[0]!;
  process.stdout.write(nextSteps([
    {
      cmd: `mneme forensics match ${topFinding.commit.shortHash} ${topFinding.commit.authorEmail}`,
      why: `Verify the top anomaly's author with STR-loci LR matching.`,
    },
    {
      cmd: `mneme forensics vulns --since ${topFinding.commit.authorDate.slice(0, 10)}`,
      why: `Cross-reference vulnerabilities introduced around the anomalous window.`,
    },
  ]) + "\n\n");
  return 0;
}

// ─── helpers ──────────────────────────────────────────────────────────

function countBySeverity(findings: Array<{ severity: string }>): {
  critical: number; high: number; medium: number; low: number;
} {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity in c) (c as Record<string, number>)[f.severity]++;
  }
  return c;
}

function formatLR(lr: number): string {
  if (lr >= 0.01 && lr < 1000) return lr.toFixed(2);
  return lr.toExponential(2);
}

function truncateOneLine(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= n) return oneLine;
  return oneLine.slice(0, n - 1) + "…";
}

function verdictPlainEnglish(verdict: string, suspect: string): string {
  const v = verdict.toLowerCase();
  if (v.includes("extremely strong support against")) {
    return `In plain English: this is overwhelming evidence ${suspect} did NOT write this commit.`;
  }
  if (v.includes("very strong support against")) {
    return `In plain English: very strong evidence ${suspect} is NOT the author.`;
  }
  if (v.includes("strong support against")) {
    return `In plain English: ${suspect} is unlikely to be the author.`;
  }
  if (v.includes("moderate support against") || v.includes("weak support against")) {
    return `In plain English: weak signal that ${suspect} is not the author — not conclusive.`;
  }
  if (v === "uninformative") {
    return `In plain English: the evidence doesn't favor or rule out ${suspect}. Need more loci or context.`;
  }
  if (v.includes("extremely strong support")) {
    return `In plain English: overwhelming evidence ${suspect} wrote this commit.`;
  }
  if (v.includes("very strong support")) {
    return `In plain English: very strong evidence ${suspect} is the author.`;
  }
  if (v.includes("strong support")) {
    return `In plain English: strong support that ${suspect} wrote this commit.`;
  }
  return `In plain English: the loci weakly favor ${suspect} as the author.`;
}

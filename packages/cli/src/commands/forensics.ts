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
import { resolveAllEnrichers, ResilientEnricher } from "@mneme-ai/embeddings";
import { dbPath } from "../paths.js";
import { resolveCommitRef, commitNotFoundMessage } from "../utils/args.js";
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
import {
  iris,
  generateHeadline,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  type PyramidSection,
} from "../iris/index.js";

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
  // Resolve HEAD / HEAD~3 / branch / short-hash to a full hash via git rev-parse.
  // Without this, opts.commitHash="HEAD" never matches because no real hash starts with "HEAD".
  const fullHash = resolveCommitRef(opts.cwd, opts.commitHash);
  if (!fullHash) {
    ui.error(commitNotFoundMessage(opts.commitHash));
    return 1;
  }

  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const evidenceCommit =
      allCommits.find((c) => c.hash === fullHash || c.hash.startsWith(opts.commitHash)) ?? null;
    if (!evidenceCommit) return { error: `Commit ${opts.commitHash} resolved to ${fullHash.slice(0, 8)} but is not in the index. Run 'mneme index' to refresh.` };

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
    "Bayesian author attribution · ENFSI 2015 verbal scale",
    "Verify if a specific person wrote a commit. Use when credentials may be compromised or an insider planted a change.") + "\n\n");

  process.stdout.write(kv("commit", `${kleur.bold(result.evidenceCommit.shortHash)}  ${kleur.gray(result.evidenceCommit.subject)}`) + "\n");
  process.stdout.write(kv("suspect", `${kleur.bold(result.suspect)}  ${kleur.gray(`(${result.suspectCommits} prior commits)`)}`) + "\n\n");

  const lr = result.report.combinedLR;
  process.stdout.write(section("✦ Combined Likelihood Ratio") + "\n");
  process.stdout.write(`    ${kleur.bold("LR")} = ${kleur.bold(lr.toExponential(2))}  ${kleur.gray(`(${humanizeLR(lr)})`)}\n`);
  process.stdout.write(`    ${kleur.gray(`log10(LR) = ${result.report.log10LR}  — bigger absolute value = stronger evidence either way`)}\n`);
  process.stdout.write(`    ${verdictBadge(result.report.verdict)}\n`);
  process.stdout.write(`    ${kleur.gray(verdictPlainEnglish(result.report.verdict, result.suspect))}\n\n`);

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Mneme compares")} ${kleur.bold("12 STR loci")} ${kleur.gray("— think of them as 12 distinct fingerprint traits")}\n`);
  process.stdout.write(`        ${kleur.gray("(commit hour, file affinity, message style, weekend ratio, verb diversity, etc.).")}\n`);
  process.stdout.write(`    ${kleur.gray("• For each locus we compute an")} ${kleur.bold("LR (likelihood ratio)")}${kleur.gray(":")}\n`);
  process.stdout.write(`        ${kleur.green("LR > 1")}  ${kleur.gray("→ evidence FAVORS the suspect being the author.")}\n`);
  process.stdout.write(`        ${kleur.red("LR < 1")}  ${kleur.gray("→ evidence AGAINST.")}\n`);
  process.stdout.write(`        ${kleur.gray("LR = 1")}  ${kleur.gray("→ neutral — locus tells us nothing either way.")}\n`);
  process.stdout.write(`    ${kleur.gray("• The 12 LRs are multiplied together to get the")} ${kleur.bold("combined LR")} ${kleur.gray("above.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Verdict uses the")} ${kleur.bold("ENFSI 2015 verbal scale")} ${kleur.gray("(forensic-science standard for")}\n`);
  process.stdout.write(`        ${kleur.gray("translating LR magnitudes into plain-English support levels).")}\n\n`);

  // ─── Baseline-reliability warning ───────────────────────────────
  if (result.suspectCommits < 30) {
    process.stdout.write(`  ${pill("HEADS UP", "warn")} ${kleur.yellow(`Suspect baseline is small (${result.suspectCommits} commits)`)} ${kleur.gray("— LR loses calibration below ~30 commits. Treat extreme values as directional, not definitive.")}\n\n`);
  }

  process.stdout.write(section("◆ Per-locus contribution", "(12 STR loci · meter shows log-LR · most-informative first)") + "\n\n");
  // Sort: largest |log-LR| first — drives the eye to the most informative loci.
  const sortedLoci = [...result.report.perLocus].sort(
    (a, b) => Math.abs(Math.log10(b.lr)) - Math.abs(Math.log10(a.lr)),
  );
  for (const l of sortedLoci) {
    process.stdout.write(
      `    ${logMeter(l.lr)}  ${kleur.bold(l.name.padEnd(20))} ${kleur.gray("LR=")}${formatLR(l.lr).padStart(9)}\n`,
    );
    process.stdout.write(`        ${kleur.gray(l.note)}\n`);
    const friendly = humanizeLocusNote(l.name, l.note, l.lr);
    if (friendly) {
      process.stdout.write(`        ${kleur.cyan("→ ")}${kleur.gray(friendly)}\n`);
    }
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
  // Resolve HEAD / HEAD~3 / branch / short-hash to a full hash via git rev-parse.
  const fullHash = resolveCommitRef(opts.cwd, opts.commitHash);
  if (!fullHash) {
    ui.error(commitNotFoundMessage(opts.commitHash));
    return 1;
  }

  const result = await withStore(opts.cwd, (s) => {
    const allCommits = util.loadAllCommits(s);
    const evidenceCommit =
      allCommits.find((c) => c.hash === fullHash || c.hash.startsWith(opts.commitHash)) ?? null;
    if (!evidenceCommit) return { error: `Commit ${opts.commitHash} resolved to ${fullHash.slice(0, 8)} but is not in the index. Run 'mneme index' to refresh.` };

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
    "Bayesian ranking across ALL authors with ≥5 prior commits",
    "Find out who most-likely wrote a mystery commit. Use when authorship is disputed or an account was hijacked.") + "\n\n");

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

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Each candidate is an author with ≥5 prior commits, ranked by")} ${kleur.bold("likelihood ratio")} ${kleur.gray("(LR).")}\n`);
  process.stdout.write(`    ${kleur.gray("• The")} ${kleur.bold("top candidate")} ${kleur.gray("is the one whose past coding fingerprint best matches this commit.")}\n`);
  process.stdout.write(`    ${kleur.green("LR > 1")}  ${kleur.gray("→ evidence FOR this person being the author.")}\n`);
  process.stdout.write(`    ${kleur.red("LR < 1")}  ${kleur.gray("→ evidence AGAINST.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Big gap between #1 and #2 = confident attribution. Small gap = treat as a shortlist.")}\n\n`);

  // ─── Baseline-reliability warning ───────────────────────────────
  if (result.candidates.length < 3) {
    process.stdout.write(`  ${pill("HEADS UP", "warn")} ${kleur.yellow("Single-author or tiny-team repo")} ${kleur.gray(`— attribution needs ≥3 authors with ≥5 commits each to be meaningful. Found ${result.candidates.length}.`)}\n\n`);
  }

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
      `         ${logMeter(lr)}  ${kleur.gray(`${c.commitCount} prior commits · log10(LR)=${c.report.log10LR}`)}\n`,
    );
    process.stdout.write(
      `         ${kleur.cyan("→ ")}${kleur.gray(humanizeLR(lr))}\n\n`,
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
    "Scans for 11 known security-bug patterns (SQL injection, hardcoded secrets, weak crypto, etc.) — additions-only, full diff bodies.",
    "Find security holes hidden in years of git history before an attacker does.") + "\n\n");

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

  // ─── Plain-English reading guide ────────────────────────────────
  process.stdout.write(section("📘 How to read this report") + "\n");
  process.stdout.write(`    ${kleur.gray("• Mneme grepped through git history looking for")} ${kleur.bold("11 known security-bug patterns")}${kleur.gray(":")}\n`);
  process.stdout.write(`        ${kleur.gray("SQL injection, hardcoded secrets, weak crypto (MD5/SHA1), command injection,")}\n`);
  process.stdout.write(`        ${kleur.gray("path traversal, unsafe deserialization, eval, regex DoS, XSS, weak random, leaked tokens.")}\n`);
  process.stdout.write(`    ${kleur.gray("• Each finding shows the")} ${kleur.bold("commit + the exact code line")} ${kleur.gray("that matched the pattern.")}\n`);
  process.stdout.write(`    ${kleur.gray("• The")} ${kleur.green("✓ already-fixed")} ${kleur.gray("tag means a later commit appears to have removed/replaced this pattern —")}\n`);
  process.stdout.write(`        ${kleur.gray("still worth eyeballing, but not necessarily live in HEAD.")}\n`);
  process.stdout.write(`    ${kleur.gray("• ")}${kleur.cyan("CWE-XX")}${kleur.gray(" is the public catalog ID for the bug class — Google it for full details.")}\n`);
  process.stdout.write(`    ${kleur.yellow("• Heads-up: pattern matching has false positives. Always verify before filing a CVE.")}\n\n`);

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
    const fix = h.looksLikeFix ? `  ${kleur.green("✓ already-fixed")}` : "";
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
  verbose?: boolean;
}

export async function forensicsAnomalyCommand(
  opts: ForensicsAnomalyOptions,
): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd).catch(() => null);

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
    // JSON byte-stable contract — must not change.
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  const counts = countBySeverity(result.findings);
  const threshold = opts.threshold ?? 0.9;

  // ─── Headline: try LLM (800ms timeout), fall back to extractive ───────
  const topFinding = result.findings[0];
  const topAuthor = topFinding?.commit.authorName ?? topFinding?.commit.authorEmail ?? "";
  const headlineData: Record<string, unknown> = {
    criticalCount: counts.critical,
    highCount: counts.high,
    totalCount: result.findings.length,
    threshold,
    topSubject: topAuthor ? `verify ${topAuthor} identity` : undefined,
  };

  // Try to resolve an LLM enricher for the headline (best-effort, never blocks).
  let enricher: ResilientEnricher | undefined;
  try {
    const chain = await resolveAllEnrichers({});
    if (chain.length > 0) enricher = new ResilientEnricher(chain);
  } catch {
    // No LLM available — extractive fallback below is fine.
  }

  let headlineText: string;
  if (result.findings.length === 0) {
    headlineText = `🕵 Clean — no commits look unusual at threshold ${threshold}`;
  } else {
    const hl = await generateHeadline({
      commandType: "forensics",
      data: headlineData,
      enricher,
      timeoutMs: 800,
      repoRoot: meta?.rootPath,
    });
    // Iris headlines come back without our icon — prepend it.
    headlineText = `🕵 ${hl}`;
  }

  // ─── Lede: top 3 anomalies (one line each) ────────────────────────────
  const ledeLines: string[] = [];
  if (result.findings.length === 0) {
    ledeLines.push(
      `${kleur.green("✓")}  ${kleur.bold(String(result.scanned))} ${kleur.gray("commits scanned across")} ${kleur.bold(String(result.baselines))} ${kleur.gray("author profile" + (result.baselines === 1 ? "" : "s") + " — nothing flagged.")}`,
    );
    ledeLines.push(
      `   ${kleur.gray("Lower the threshold to see borderline cases: --threshold 0.5")}`,
    );
  } else {
    if (counts.critical > 0) {
      ledeLines.push(
        `${kleur.red("⚠")}  ${kleur.red().bold(String(counts.critical))} ${kleur.gray("commit" + (counts.critical === 1 ? "" : "s") + " look VERY different from how that author normally commits — verify out-of-band.")}`,
      );
    } else {
      ledeLines.push(
        `${kleur.yellow("!")}  ${kleur.bold(String(result.findings.length))} ${kleur.gray("commit" + (result.findings.length === 1 ? "" : "s") + " look unusual for their author — review before merging.")}`,
      );
    }
    for (const f of result.findings.slice(0, 3)) {
      const sevLevel: Level = sevToLevel[f.severity] ?? "info";
      ledeLines.push(
        `   ${severityBadge(sevLevel)}  ${kleur.bold(f.commit.shortHash)} ${kleur.gray(f.commit.authorDate.slice(0, 10) + " · " + f.commit.authorName)} — ${kleur.white(truncateOneLine(f.commit.subject, 60))}`,
      );
    }
  }

  // ─── Key facts: severity tally with meters + warnings ─────────────────
  const keyFactLines: string[] = [];
  if (result.findings.length > 0) {
    const sevs: Array<{ key: keyof typeof counts; level: Level; label: string }> = [
      {
        key: "critical",
        level: "critical",
        label: "CRITICAL — verify author identity out-of-band",
      },
      { key: "high", level: "high", label: "HIGH     — needs a second-engineer approval" },
      { key: "medium", level: "medium", label: "MEDIUM   — flag during normal review" },
      { key: "low", level: "low", label: "LOW      — informational" },
    ];
    const maxC = Math.max(counts.critical, counts.high, counts.medium, counts.low, 1);
    for (const { key, level, label } of sevs) {
      const n = counts[key];
      if (n === 0) continue;
      keyFactLines.push(
        `${meter(n / maxC, { width: 10, level })}  ${kleur.bold(String(n).padStart(3))}  ${kleur.gray(label)}`,
      );
    }
  }
  if (result.baselines === 1) {
    keyFactLines.push(
      `${pill("HEADS UP", "warn")} ${kleur.yellow("Single-author repo")} ${kleur.gray("— findings just mean 'unusual vs your own past commits'.")}`,
    );
  }

  // ─── Body: per-finding axis breakdown (preserve humanized notes) ──────
  const bodyLines: string[] = [];
  const detailLines: string[] = [];
  const showN = opts.topN ?? 10;
  // Bucket: top showN go in "body"; the rest (lower severity) go to "details".
  const findingsToShow = result.findings.slice(0, showN);
  const findingsHidden = result.findings.slice(showN);

  for (const f of findingsToShow) {
    const c = f.commit;
    const sevLevel: Level = sevToLevel[f.severity] ?? "info";
    bodyLines.push(
      `${severityBadge(sevLevel)}  ${kleur.bold(c.shortHash)} ${kleur.gray(c.authorDate.slice(0, 16) + " UTC · " + c.authorName)}`,
    );
    bodyLines.push(
      `   ${kleur.bold(`risk score: ${f.totalDeviation.toFixed(2)}`)} ${kleur.gray("/ 4.0 max")}`,
    );
    bodyLines.push(`   ${kleur.white(c.subject)}`);
    for (const a of f.axes) {
      if (a.score < 0.1) continue;
      const axisLevel: Level =
        a.score >= 0.8 ? "critical" : a.score >= 0.5 ? "high" : a.score >= 0.3 ? "medium" : "low";
      const friendly = humanizeAxisNote(a.axis, a.note, c.authorDate);
      bodyLines.push(
        `     ${meter(a.score, { width: 10, level: axisLevel })}  ${kleur.cyan(a.axis.padEnd(6))} ${kleur.gray(friendly)}`,
      );
    }
    bodyLines.push(`   ${kleur.yellow("→ " + f.recommendation)}`);
    bodyLines.push("");
  }

  for (const f of findingsHidden) {
    const c = f.commit;
    const sevLevel: Level = sevToLevel[f.severity] ?? "info";
    detailLines.push(
      `${severityBadge(sevLevel)}  ${kleur.bold(c.shortHash)} ${kleur.gray(c.authorDate.slice(0, 10) + " · " + c.authorName)} — ${kleur.gray(truncateOneLine(c.subject, 60))} ${kleur.gray(`(risk ${f.totalDeviation.toFixed(2)})`)}`,
    );
  }

  // ─── Sources (try-next + adaptive how-to-read) ────────────────────────
  const sourceLines: string[] = [];
  if (topFinding) {
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme forensics match ${topFinding.commit.shortHash} ${topFinding.commit.authorEmail}`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Verify the top anomaly's author with STR-loci LR matching.")}`,
    );
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme forensics vulns --since ${topFinding.commit.authorDate.slice(0, 10)}`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Cross-reference vulnerabilities introduced around the anomalous window.")}`,
    );
  } else {
    sourceLines.push(`${kleur.cyan("$")} ${kleur.bold("mneme forensics anomaly --threshold 0.5")}`);
    sourceLines.push(`   ${kleur.gray("Lower the threshold to see borderline cases.")}`);
  }

  // Adaptive how-to-read: only show on first ~5 runs.
  const irisState = (() => {
    try {
      return meta?.rootPath ? readIrisState(meta.rootPath) : null;
    } catch {
      return null;
    }
  })();
  const showGuide = irisState ? shouldShowVerboseGuide(irisState, "forensics-anomaly") : true;
  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(`${kleur.gray("📘 How to read:")} ${kleur.bold("risk score")} ${kleur.gray("(0–4) combines 4 signals:")} ${kleur.cyan("time")} ${kleur.gray("/")} ${kleur.cyan("files")} ${kleur.gray("/")} ${kleur.cyan("style")} ${kleur.gray("/")} ${kleur.cyan("size")}${kleur.gray(".")}`);
    sourceLines.push(
      `   ${kleur.gray("Severity: ≥2.5 critical · ≥1.7 high · ≥0.9 medium · else ignored.")}`,
    );
  }

  // ─── Compose pyramid ──────────────────────────────────────────────────
  const sections: PyramidSection[] = [{ tier: "lede", lines: ledeLines }];
  if (keyFactLines.length > 0) {
    sections.push({
      tier: "key-facts",
      title: "✦ By risk level",
      lines: keyFactLines,
    });
  }
  if (bodyLines.length > 0) {
    sections.push({
      tier: "body",
      title: `⚠ Unusual commits (top ${findingsToShow.length} by risk score)`,
      lines: bodyLines,
    });
  }
  if (detailLines.length > 0) {
    sections.push({
      tier: "details",
      title: `◇ Lower-severity findings (${detailLines.length})`,
      lines: detailLines,
    });
  }
  if (sourceLines.length > 0) {
    sections.push({
      tier: "sources",
      title: "→ Try next",
      lines: sourceLines,
    });
  }

  ui.banner();
  process.stdout.write(
    iris.render({
      headline: headlineText,
      sections,
      verbose: opts.verbose,
    }) + "\n",
  );

  if (meta?.rootPath) {
    try {
      recordCommandRun(meta.rootPath, "forensics-anomaly");
    } catch {
      // best-effort
    }
  }
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

/** Translate a technical axis note into plain English the user can verify.
 *  Removes "robust z", "peak window", "MAD", and other jargon. */
function humanizeAxisNote(axis: string, note: string, commitDate: string): string {
  if (axis === "time") {
    // Original example:
    //   "commit hour 04:00 UTC is 11h from author's peak window 15:00–19:00"
    const m = note.match(/commit hour (\d{2}):00 UTC is (\d+)h from author's peak window (\d{2}):00.(\d{2}):00/);
    if (m) {
      const utcHour = m[1];
      const gap = m[2];
      const peakStart = m[3];
      const peakEnd = m[4];
      // Add user's local time for verification
      const local = (() => {
        try {
          const d = new Date(commitDate);
          return d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
        } catch {
          return null;
        }
      })();
      const localHint = local ? ` (your local time: ${local})` : "";
      return `committed at ${utcHour}:00 UTC${localHint}. This author normally commits between ${peakStart}:00–${peakEnd}:00 UTC — ${gap}h gap.`;
    }
    return note;
  }
  if (axis === "files") {
    // Original: "3/3 files are new for this author (e.g. src/auth.ts, src/db.ts)"
    return note.replace(/are new for this author/, "have never been touched by this author");
  }
  if (axis === "style") {
    // Original: "verb \"exfiltrate\" not in author's vocabulary (47 verbs across 1247 commits)"
    const m = note.match(/verb "(\w+)" not in author's vocabulary \((\d+) verbs across (\d+) commits\)/);
    if (m) {
      return `commit message starts with "${m[1]}" — a word this author has never used in ${m[3]} prior commits.`;
    }
    return note;
  }
  if (axis === "size") {
    // Original: "+465 lines vs author's median 50 (robust z = 9.9)"
    const m = note.match(/\+(\d+) lines vs author's median (\d+) \(robust z = ([\d.]+)\)/);
    if (m) {
      const churn = Number(m[1]);
      const median = Number(m[2]);
      const z = Number(m[3]);
      const ratio = median > 0 ? (churn / median).toFixed(1) : "much";
      const direction = churn > median ? "larger" : "smaller";
      return `this commit is ${churn} lines — about ${ratio}× ${direction} than this author's typical commit (~${median} lines).`;
    }
    return note;
  }
  return note;
}

/** Translate a likelihood ratio into a "1 in N" sentence non-statisticians can grok.
 *  LR = P(evidence | suspect-is-author) / P(evidence | random-author).
 *  LR = 100 means "100x more likely if suspect wrote it"; LR = 1e-12 means
 *  "1 trillion times more likely random author wrote it". */
function humanizeLR(lr: number): string {
  if (!Number.isFinite(lr) || lr <= 0) return "no signal";
  if (lr >= 1) {
    const factor = formatBigNumber(lr);
    return `evidence is ~${factor} more likely if this person wrote it — supports authorship`;
  }
  // LR < 1: invert for the "1 in N" reading.
  const inv = 1 / lr;
  const factor = formatBigNumber(inv);
  return `~1 in ${factor} chance of seeing this if they wrote it — overwhelming evidence AGAINST authorship`;
}

function formatBigNumber(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n < 10) return n.toFixed(2);
  if (n < 1000) return Math.round(n).toLocaleString("en-US");
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} thousand`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} million`;
  if (n < 1e12) return `${(n / 1e9).toFixed(1)} billion`;
  if (n < 1e15) return `${(n / 1e12).toFixed(1)} trillion`;
  if (n < 1e18) return `${(n / 1e15).toFixed(1)} quadrillion`;
  // Beyond quadrillion — fall back to scientific.
  const exp = Math.floor(Math.log10(n));
  const mant = n / Math.pow(10, exp);
  return `${mant.toFixed(1)} × 10^${exp}`;
}

/** Translate a per-locus note into plain English. The raw note format is:
 *    "evidence=13 · suspect=2 · pop μ=2 σ=0.001 · |Δ|=11"
 *  We turn that into:
 *    "evidence has 13×, this author normally has 2 (others avg 2). Difference: 11."
 */
function humanizeLocusNote(name: string, note: string, lr: number): string {
  const m = note.match(/evidence=([-\d.]+) · suspect=([-\d.]+) · pop μ=([-\d.]+) σ=([-\d.]+) · \|Δ\|=([-\d.]+)/);
  if (!m) {
    // Other notes (e.g. timezone, weekday) — pass through with a small hint.
    if (lr >= 5) return `strong agreement with this author's pattern`;
    if (lr <= 0.2) return `clear mismatch with this author's pattern`;
    return "";
  }
  const evidence = Number(m[1]);
  const suspect = Number(m[2]);
  const popMean = Number(m[3]);
  const delta = Number(m[5]);
  const direction = lr >= 1 ? "matches" : "disagrees with";
  return `evidence shows ${fmtNum(evidence)}, this author typically does ${fmtNum(suspect)} (others average ${fmtNum(popMean)}). Gap: ${fmtNum(delta)} — ${direction} the suspect's profile.`;
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3);
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

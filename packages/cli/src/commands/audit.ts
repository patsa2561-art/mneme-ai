/**
 * `mneme audit` — AI Session Audit.
 *
 * Six modes:
 *   --baseline    snapshot current behavior + types + perf
 *   --trace       diff capture + AI session detection
 *   --verify      Leviathan-style narrative vs diff check
 *   --certify     5-axis trust certificate (CI-friendly exit code)
 *   --watch       long-running CI gate mode
 *   --report      produce markdown report
 *
 * The pitch: every AI-driven commit gets a trust certificate.
 *
 * This module is the CLI plumbing.  All data extraction lives in
 * `@mneme-ai/core/audit`.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import kleur from "kleur";
import { audit, git } from "@mneme-ai/core";
import { ui, header, section, kv, pill, nextSteps } from "../ui.js";
import { iris, type PyramidSection } from "../iris/index.js";
import { explain, type ExplainRequest } from "../utils/explain.js";

export interface AuditOptions {
  cwd: string;
  mode: "baseline" | "trace" | "verify" | "certify" | "watch" | "report";
  json?: boolean;
  /** For --report: file path to write markdown to. */
  out?: string;
  /** For --watch: poll interval in seconds. */
  interval?: number;
  /** When set on --certify: prepend a plain-English narrative summary. */
  explain?: boolean;
  /** Test seam: inject an enricher factory so unit tests don't hit the network. */
  explainEnricherFactory?: ExplainRequest["enricherFactory"];
  /**
   * --strict: treat `skipped` axes as `fail`.  For compliance environments
   * where missing data IS a failure (e.g. no test command defined =
   * cannot ship).
   */
  strict?: boolean;
}

/** Top-level dispatcher. */
export async function auditCommand(opts: AuditOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repository. Run `git init`, then `mneme init`.");
    return 1;
  }
  switch (opts.mode) {
    case "baseline":
      return runBaseline(opts);
    case "trace":
      return runTrace(opts);
    case "verify":
      return runVerify(opts);
    case "certify":
      return runCertify(opts);
    case "watch":
      return runWatch(opts);
    case "report":
      return runReport(opts);
  }
}

// ─── --baseline ──────────────────────────────────────────────────────

async function runBaseline(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const baseline = await audit.captureBaseline(meta.rootPath);
  audit.persistBaseline(meta.rootPath, baseline);

  if (opts.json) {
    process.stdout.write(JSON.stringify(baseline, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(
    header(
      "📸",
      "AI Audit — baseline captured",
      "snapshot of current behavior + types + perf",
      "Run this BEFORE letting an AI tool work on your repo. Mneme will compare against this snapshot when you run `--certify`.",
    ) + "\n\n",
  );

  process.stdout.write(kv("HEAD", kleur.bold(baseline.headHash.slice(0, 12))) + "\n");
  process.stdout.write(kv("captured", baseline.capturedAt) + "\n");
  process.stdout.write(
    kv(
      "tests",
      `${kleur.bold(String(baseline.testPassRate.passed))} passed · ${kleur.bold(String(baseline.testPassRate.failed))} failed`,
    ) + "\n",
  );
  process.stdout.write(
    kv(
      "API surface",
      `${Object.keys(baseline.apiSurface).length} packages · ${Object.values(baseline.apiSurface).reduce(
        (s, l) => s + l.length,
        0,
      )} exports`,
    ) + "\n\n",
  );

  process.stdout.write(section("◆ Sample commands") + "\n");
  for (const [name, sample] of Object.entries(baseline.outputs)) {
    process.stdout.write(
      `    ${kleur.gray(name.padEnd(16))} ${
        sample.exitCode === 0 ? kleur.green("ok") : kleur.red(`exit ${sample.exitCode}`)
      }  ${kleur.gray(`${sample.stdoutLines} lines · sha ${sample.stdoutHash.slice(0, 8)}`)}\n`,
    );
  }
  process.stdout.write("\n");

  process.stdout.write(
    nextSteps([
      { cmd: "<let your AI tool work>", why: "Mneme is vendor-neutral; works with any AI tool whose commits end up in `git log`." },
      { cmd: "mneme audit --certify", why: "Compare reality to this baseline; emit a trust certificate." },
    ]) + "\n",
  );
  return 0;
}

// ─── --trace ─────────────────────────────────────────────────────────

async function runTrace(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const baseline = audit.loadBaseline(meta.rootPath);
  if (!baseline) {
    ui.error("No baseline.  Run `mneme audit --baseline` first.");
    return 1;
  }
  const trace = await audit.traceSession(meta.rootPath, baseline.headHash);

  if (opts.json) {
    process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    return 0;
  }

  return renderTrace(trace, baseline.headHash);
}

function renderTrace(trace: audit.SessionTrace, baselineHash: string): number {
  const aiCount = audit.aiCommitCount(trace);
  const breakdown = audit.aiVendorBreakdown(trace);
  const breakdownStr =
    breakdown.length > 0 ? breakdown.map((b) => `${b.vendor}×${b.count}`).join(", ") : "(none detected)";

  const headline =
    trace.commits.length === 0
      ? "🔍 AI Audit · trace · no commits since baseline"
      : `🔍 AI Audit · trace · ${trace.commits.length} commit${trace.commits.length === 1 ? "" : "s"} (${aiCount} AI-attributed)`;

  const ledeLines: string[] = [
    `  ${kleur.gray("baseline:")} ${kleur.bold(baselineHash.slice(0, 12))}`,
    `  ${kleur.gray("HEAD now:")} ${kleur.bold(trace.toHash.slice(0, 12))}`,
    `  ${kleur.gray("AI:")}        ${aiCount} of ${trace.commits.length} commits — ${kleur.cyan(breakdownStr)}`,
  ];
  const factLines: string[] = [
    `  ${kleur.gray("files changed:")} ${kleur.bold(String(trace.filesChanged.length))}`,
    `  ${kleur.gray("insertions:   ")} ${kleur.green(`+${trace.insertions}`)}`,
    `  ${kleur.gray("deletions:    ")} ${kleur.red(`-${trace.deletions}`)}`,
  ];

  const commitLines: string[] = trace.commits.slice(0, 10).map((c) => {
    const tag = c.likelyAI
      ? kleur.cyan(`[${c.likelyAI.vendor}]`.padEnd(12))
      : kleur.gray("[human]".padEnd(12));
    const subject = c.message.split("\n")[0]?.slice(0, 72) ?? "";
    return `    ${tag} ${kleur.bold(c.shortHash)} ${kleur.gray(subject)}`;
  });
  if (trace.commits.length > 10) {
    commitLines.push(`    ${kleur.gray(`… and ${trace.commits.length - 10} more`)}`);
  }

  const fileLines: string[] = trace.filesChanged
    .slice(0, 8)
    .map((f) => `    ${kleur.gray("·")} ${f}`);
  if (trace.filesChanged.length > 8) {
    fileLines.push(`    ${kleur.gray(`… and ${trace.filesChanged.length - 8} more`)}`);
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Session frame", lines: ledeLines },
    { tier: "key-facts", title: "◆ Diff totals", lines: factLines },
    { tier: "body", title: "◆ Commits", lines: commitLines.length ? commitLines : ["    (no commits)"] },
    { tier: "body", title: "◆ Files touched", lines: fileLines.length ? fileLines : ["    (none)"] },
    {
      tier: "sources",
      title: "→ Try next",
      lines: [
        `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --verify")} ${kleur.gray("(check commit-message claims vs actual diff)")}`,
        `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --certify")} ${kleur.gray("(5-axis trust certificate)")}`,
      ],
    },
  ];

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
  return 0;
}

// ─── --verify ────────────────────────────────────────────────────────

async function runVerify(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const baseline = audit.loadBaseline(meta.rootPath);
  if (!baseline) {
    ui.error("No baseline.  Run `mneme audit --baseline` first.");
    return 1;
  }
  const trace = await audit.traceSession(meta.rootPath, baseline.headHash);
  const checks: audit.NarrativeCheck[] = [];
  for (const c of trace.commits) {
    const { diff, filesTouched } = collectDiffForCommit(meta.rootPath, c.hash);
    checks.push(audit.verifyNarrative(c.message, diff, filesTouched, c.hash));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ trace, checks }, null, 2) + "\n");
    return 0;
  }

  return renderVerify(trace, checks);
}

function renderVerify(trace: audit.SessionTrace, checks: audit.NarrativeCheck[]): number {
  const trust = audit.aggregateNarrativeTrust(checks);
  const contradicted = checks.reduce(
    (s, c) => s + c.verifications.filter((v) => v.verdict === "contradicted").length,
    0,
  );
  const verified = checks.reduce(
    (s, c) => s + c.verifications.filter((v) => v.verdict === "verified").length,
    0,
  );

  const headline = contradicted > 0
    ? `🔍 AI Audit · verify · ${contradicted} contradicted claim${contradicted === 1 ? "" : "s"}`
    : `🔍 AI Audit · verify · narrative trust ${trust.toFixed(2)} (${verified} verified)`;

  const ledeLines: string[] = [
    `  ${kleur.gray("commits checked:  ")} ${kleur.bold(String(checks.length))}`,
    `  ${kleur.gray("verified claims:  ")} ${kleur.green(String(verified))}`,
    `  ${kleur.gray("contradicted:     ")} ${contradicted > 0 ? kleur.red(String(contradicted)) : kleur.gray("0")}`,
    `  ${kleur.gray("aggregate trust:  ")} ${kleur.bold(trust.toFixed(2))} ${trust >= 0.8 ? pill("HIGH", "ok") : trust >= 0.6 ? pill("MED", "warn") : pill("LOW", "warn")}`,
  ];

  const detailLines: string[] = [];
  for (const check of checks) {
    if (check.verifications.length === 0) continue;
    detailLines.push(`    ${kleur.bold(check.commitHash.slice(0, 7))} ${kleur.gray(`(trust ${check.narrativeTrustScore.toFixed(2)})`)}`);
    for (const v of check.verifications) {
      const mark =
        v.verdict === "verified" ? kleur.green("✓") : v.verdict === "contradicted" ? kleur.red("✗") : kleur.gray("?");
      detailLines.push(`        ${mark} ${kleur.gray(v.claim.slice(0, 80))}`);
      detailLines.push(`           ${kleur.gray("→ " + v.reason.slice(0, 80))}`);
    }
  }

  const sections: PyramidSection[] = [
    { tier: "lede", title: "✦ Narrative trust", lines: ledeLines },
    {
      tier: "body",
      title: "◆ Per-claim verifications",
      lines: detailLines.length ? detailLines : ["    (no verifiable claims)"],
    },
    {
      tier: "sources",
      title: "→ Try next",
      lines: [
        `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --certify")} ${kleur.gray("(roll narrative + behavior + tests + perf into one verdict)")}`,
      ],
    },
  ];

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
  return contradicted > 0 ? 1 : 0;
}

// ─── --certify ───────────────────────────────────────────────────────

async function runCertify(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const cert = await runFullCertifyPipeline(meta.rootPath, { strict: opts.strict });
  if (!cert) {
    ui.error("No baseline.  Run `mneme audit --baseline` first.");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(cert, null, 2) + "\n");
    return cert.exitCode;
  }

  // Optional --explain: ask the user's free LLM for a plain-English summary
  // of the certificate. Falls back to a HEADS UP line if no provider works,
  // so the command's data path is never blocked on the LLM.
  let explainSection: PyramidSection | null = null;
  let explainHeadsUp: string | null = null;
  if (opts.explain) {
    const result = await explain({
      enabled: true,
      enricherFactory: opts.explainEnricherFactory,
      system:
        "You are a senior reviewer briefing a release manager. " +
        "Given a JSON AI-audit certificate (5 axes plus 4 forensic axes), " +
        "write 3-4 sentences in plain English: " +
        "(1) the verdict and why, " +
        "(2) which axis was the closest call (best or worst margin), " +
        "(3) one concrete next step. " +
        "Be honest, no hype, no emoji.",
      user: certificateToExplainPrompt(cert),
      maxTokens: 220,
    });
    explainSection = result.section;
    explainHeadsUp = result.headsUp;
  }

  renderCertificate(cert, explainSection, explainHeadsUp);
  return cert.exitCode;
}

/** Compact JSON-ish summary of the certificate, kept short to control prompt cost. */
function certificateToExplainPrompt(cert: audit.AuditCertificate): string {
  const compact = {
    overallVerdict: cert.overallVerdict,
    sessionId: cert.sessionId,
    axes: {
      behavioralParity: { verdict: cert.axes.behavioralParity.verdict, reason: cert.axes.behavioralParity.reason },
      apiContractDrift: { verdict: cert.axes.apiContractDrift.verdict, reason: cert.axes.apiContractDrift.reason },
      testPassRate: {
        verdict: cert.axes.testPassRate.verdict,
        reason: cert.axes.testPassRate.reason,
        before: cert.axes.testPassRate.before,
        after: cert.axes.testPassRate.after,
      },
      perfRegression: {
        verdict: cert.axes.perfRegression.verdict,
        reason: cert.axes.perfRegression.reason,
        deltaPercent: cert.axes.perfRegression.deltaPercent,
      },
      aiNarrative: { verdict: cert.axes.aiNarrative.verdict, reason: cert.axes.aiNarrative.reason },
    },
    forensicAxes: cert.forensicAxes,
  };
  return JSON.stringify(compact, null, 2);
}

async function runFullCertifyPipeline(
  repoRoot: string,
  opts: { strict?: boolean } = {},
) {
  const baseline = audit.loadBaseline(repoRoot);
  if (!baseline) return null;
  const trace = await audit.traceSession(repoRoot, baseline.headHash);
  const after = await audit.captureBaseline(repoRoot);
  const diffs: Record<string, { diff: string; filesTouched: string[] }> = {};
  for (const c of trace.commits) {
    diffs[c.hash] = collectDiffForCommit(repoRoot, c.hash);
  }
  return audit.buildCertificate({
    sessionId: trace.toHash.slice(0, 7) || "unknown",
    beforeBaseline: baseline,
    afterBaseline: after,
    trace,
    diffs,
    strict: opts.strict,
  });
}

function renderCertificate(
  cert: audit.AuditCertificate,
  explainSection: PyramidSection | null = null,
  explainHeadsUp: string | null = null,
): void {
  const verdictBadge = cert.overallVerdict === "fail"
    ? pill("FAIL", "high")
    : cert.overallVerdict === "warn"
      ? pill("WARN", "warn")
      : pill("PASS", "ok");

  // Confidence pill — high (4+ axes verified) / medium (3) / low (≤2).
  const confBadge = (() => {
    switch (cert.coverage.confidence) {
      case "high": return kleur.green("high confidence");
      case "medium": return kleur.yellow("medium confidence");
      case "low": return kleur.red("low confidence");
    }
  })();

  // Headline carries the coverage summary so the user sees verified/skipped
  // up front — never just "PASS · exit 0".
  const headline = (() => {
    if (cert.insufficientData) {
      return `🔍 AI Audit · INSUFFICIENT DATA · refusing to certify`;
    }
    const cov = `${cert.coverage.verified}/${cert.coverage.total} axes verified`;
    const skip = cert.coverage.skipped > 0
      ? ` · ${cert.coverage.skipped} skipped (insufficient data)`
      : "";
    if (cert.overallVerdict === "fail") {
      return `🔍 AI Audit · FAIL · ${cov}${skip} · review evidence below`;
    }
    if (cert.overallVerdict === "warn") {
      return `🔍 AI Audit · WARN · ${cov}${skip} · review evidence below`;
    }
    return `🔍 AI Audit · PASS · ${cov}${skip} · ${cert.coverage.confidence} confidence`;
  })();

  const ledeLines: string[] = [
    `  ${kleur.gray("session:")}    ${kleur.bold(cert.sessionId)}`,
    `  ${kleur.gray("captured:")}   ${cert.capturedAt}`,
    `  ${kleur.gray("verdict:")}    ${verdictBadge}`,
    `  ${kleur.gray("coverage:")}   ${kleur.bold(`${cert.coverage.verified}/${cert.coverage.total}`)} axes verified · ${confBadge}`,
  ];
  if (cert.insufficientData) {
    ledeLines.push(
      `  ${kleur.gray("reason:")}     ${kleur.yellow(cert.insufficientData.reason)}`,
      `  ${kleur.gray("hint:")}       ${kleur.cyan(cert.insufficientData.hint)}`,
    );
  }

  const mark = (v: string): string =>
    v === "pass" ? kleur.green("✓")
    : v === "warn" ? kleur.yellow("!")
    : v === "skipped" ? kleur.gray("⊘")
    : kleur.red("✗");

  const axisLines = (
    name: string,
    a: { verdict: string; reason: string; evidence: audit.Evidence[]; caveat?: string; confidence: string },
  ): string[] => {
    const out: string[] = [];
    out.push(
      `    ${mark(a.verdict)} ${kleur.bold(name.padEnd(22))} ${kleur.gray(a.reason)} ${kleur.gray(`[${a.confidence} conf.]`)}`,
    );
    for (const e of a.evidence) {
      const m = e.ok === true ? kleur.green("✓")
        : e.ok === false ? kleur.red("✗")
        : kleur.gray("·");
      out.push(`        ${m} ${kleur.gray(e.label.padEnd(22))} ${e.value}`);
    }
    if (a.caveat) {
      out.push(`        ${kleur.gray("ⓘ " + a.caveat)}`);
    }
    return out;
  };

  const evidenceLines: string[] = [];
  evidenceLines.push(...axisLines("behavioral parity", cert.axes.behavioralParity));
  evidenceLines.push(...axisLines("API contract drift", cert.axes.apiContractDrift));
  evidenceLines.push(...axisLines("test pass rate", cert.axes.testPassRate));
  evidenceLines.push(...axisLines("perf regression", cert.axes.perfRegression));
  evidenceLines.push(...axisLines("AI narrative", cert.axes.aiNarrative));

  const forensicAxisLines = (name: string, a: audit.ForensicAxisResult): string[] => {
    const out: string[] = [];
    out.push(
      `    ${mark(a.verdict)} ${kleur.bold(name.padEnd(8))} ${kleur.gray(a.reason)}`,
    );
    for (const e of a.evidence) {
      out.push(`        ${kleur.gray("·")} ${kleur.gray(e.label.padEnd(8))} ${e.value}`);
    }
    return out;
  };

  const forensicLines: string[] = [];
  forensicLines.push(...forensicAxisLines("size", cert.forensicAxes.size));
  forensicLines.push(...forensicAxisLines("files", cert.forensicAxes.files));
  forensicLines.push(...forensicAxisLines("style", cert.forensicAxes.style));
  forensicLines.push(...forensicAxisLines("time", cert.forensicAxes.time));
  if (cert.forensicAxes.size.caveat) {
    forensicLines.push(`        ${kleur.gray("ⓘ " + cert.forensicAxes.size.caveat)}`);
  }

  const sections: PyramidSection[] = [];
  // --explain narrative goes ABOVE the certificate so a release manager
  // reads the plain-English summary first, then drills into the axes.
  if (explainSection) sections.push(explainSection);
  if (explainHeadsUp) {
    sections.push({ tier: "lede", lines: [`  ${explainHeadsUp}`] });
  }
  sections.push({ tier: "lede", title: "✦ Certificate", lines: ledeLines });
  sections.push({ tier: "key-facts", title: "◆ 5-axis verdict (with evidence)", lines: evidenceLines });
  sections.push({ tier: "body", title: "◆ Forensic axes (insider-threat reuse)", lines: forensicLines });
  sections.push({
    tier: "sources",
    title: "→ Try next",
    lines: [
      `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --report --out audit.md")} ${kleur.gray("(markdown for compliance)")}`,
      `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --certify --strict")} ${kleur.gray("(treat skipped axes as fail)")}`,
      `    ${kleur.cyan("$")} ${kleur.bold("mneme audit --watch")} ${kleur.gray("(CI gate — re-run automatically)")}`,
    ],
  });

  ui.banner();
  process.stdout.write(iris.render({ headline, sections }));
  process.stdout.write("\n");
}

// ─── --watch ─────────────────────────────────────────────────────────

async function runWatch(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const intervalSec = Math.max(5, opts.interval ?? 60);
  process.stdout.write(
    `${kleur.cyan("◉")} ${kleur.bold("mneme audit --watch")} ${kleur.gray(`(polling every ${intervalSec}s; Ctrl-C to stop)`)}\n`,
  );

  let lastHead: string | undefined;
  // Loop forever — exit only via signal.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: meta.rootPath, encoding: "utf8" }).trim();
      if (head !== lastHead) {
        const cert = await runFullCertifyPipeline(meta.rootPath);
        if (cert) {
          const ts = new Date().toISOString();
          process.stdout.write(
            `${kleur.gray(ts)} · ${kleur.bold(head.slice(0, 7))} → ${cert.overallVerdict.toUpperCase()}\n`,
          );
          if (cert.overallVerdict === "fail") {
            // Surface details so a CI log shows the reason.
            for (const [axis, info] of Object.entries(cert.axes)) {
              const v = (info as { verdict: string; reason: string }).verdict;
              if (v === "fail") {
                process.stdout.write(
                  `    ${kleur.red("✗")} ${axis}: ${(info as { reason: string }).reason}\n`,
                );
              }
            }
          }
        }
        lastHead = head;
      }
    } catch (err) {
      process.stderr.write(`${kleur.red("watch error:")} ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

// ─── --report ────────────────────────────────────────────────────────

async function runReport(opts: AuditOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const cert = await runFullCertifyPipeline(meta.rootPath, { strict: opts.strict });
  if (!cert) {
    ui.error("No baseline.  Run `mneme audit --baseline` first.");
    return 1;
  }
  const md = renderMarkdownReport(cert);
  if (opts.out) {
    writeFileSync(opts.out, md, "utf8");
    process.stdout.write(`${kleur.green("✓")} report written to ${kleur.bold(opts.out)}\n`);
  } else {
    process.stdout.write(md);
  }
  return cert.exitCode;
}

/**
 * Render a forensic-grade markdown report.
 *
 * Every axis surfaces:
 *   • verdict (pass / warn / fail / skipped)
 *   • reason (one-liner)
 *   • confidence rating
 *   • structured evidence bullets (the FACTS — counts, hashes, paths,
 *     deltas — that back the verdict)
 *   • caveat (the "ⓘ" line declaring what this axis does NOT check)
 *
 * The headline carries coverage (X/5 axes verified) so the user
 * immediately sees how trustworthy the verdict is.  Sniper-accuracy:
 * a "PASS · 2/5 verified · low confidence" report is a yellow flag,
 * not a green light.
 */
export function renderMarkdownReport(cert: audit.AuditCertificate): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────
  lines.push(`# AI Audit Trust Certificate`);
  lines.push(``);
  lines.push(`- **Session**: \`${cert.sessionId}\``);
  lines.push(`- **Captured**: ${cert.capturedAt}`);
  lines.push(
    `- **Overall verdict**: **${cert.overallVerdict.toUpperCase()}** ` +
    `· ${cert.coverage.verified}/${cert.coverage.total} axes verified` +
    (cert.coverage.skipped > 0 ? ` · ${cert.coverage.skipped} skipped` : "") +
    ` · ${cert.coverage.confidence} confidence (exit ${cert.exitCode})`,
  );
  if (cert.insufficientData) {
    lines.push(``);
    lines.push(`> **INSUFFICIENT DATA** — ${cert.insufficientData.reason}`);
    lines.push(`>`);
    lines.push(`> ${cert.insufficientData.hint}`);
  }
  lines.push(``);

  // ── 5-axis verdict (with evidence) ────────────────────────────────
  lines.push(`## 5-Axis Verdict`);
  lines.push(``);
  lines.push(`| Axis | Verdict | Confidence | Reason |`);
  lines.push(`| ---- | ------- | ---------- | ------ |`);
  const tableRow = (
    name: string,
    a: { verdict: string; reason: string; confidence: string },
  ) => `| ${name} | ${a.verdict} | ${a.confidence} | ${a.reason} |`;
  lines.push(tableRow("Behavioral parity", cert.axes.behavioralParity));
  lines.push(tableRow("API contract drift", cert.axes.apiContractDrift));
  lines.push(tableRow("Test pass rate", cert.axes.testPassRate));
  lines.push(tableRow("Perf regression", cert.axes.perfRegression));
  lines.push(tableRow("AI narrative", cert.axes.aiNarrative));
  lines.push(``);

  // ── Per-axis evidence ─────────────────────────────────────────────
  lines.push(`## Per-Axis Evidence`);
  lines.push(``);
  const renderAxis = (
    name: string,
    a: {
      verdict: string;
      reason: string;
      evidence: audit.Evidence[];
      caveat?: string;
      confidence: string;
    },
  ) => {
    const icon =
      a.verdict === "pass" ? "✓"
      : a.verdict === "warn" ? "!"
      : a.verdict === "skipped" ? "⊘"
      : "✗";
    lines.push(`### ${icon} ${name} — \`${a.verdict}\` (${a.confidence} confidence)`);
    lines.push(``);
    lines.push(`> ${a.reason}`);
    lines.push(``);
    if (a.evidence.length > 0) {
      for (const e of a.evidence) {
        const m = e.ok === true ? "✓" : e.ok === false ? "✗" : "·";
        lines.push(`- ${m} **${e.label}** — ${e.value}`);
      }
      lines.push(``);
    }
    if (a.caveat) {
      lines.push(`*ⓘ ${a.caveat}*`);
      lines.push(``);
    }
  };
  renderAxis("Behavioral parity", cert.axes.behavioralParity);
  renderAxis("API contract drift", cert.axes.apiContractDrift);
  renderAxis("Test pass rate", cert.axes.testPassRate);
  renderAxis("Perf regression", cert.axes.perfRegression);
  renderAxis("AI narrative", cert.axes.aiNarrative);

  // ── Forensic axes ─────────────────────────────────────────────────
  lines.push(`## Forensic Axes`);
  lines.push(``);
  const renderForensic = (name: string, a: audit.ForensicAxisResult) => {
    const icon =
      a.verdict === "pass" ? "✓"
      : a.verdict === "warn" ? "!"
      : a.verdict === "skipped" ? "⊘"
      : "✗";
    lines.push(`- ${icon} **${name}** (\`${a.verdict}\`) — ${a.reason}`);
    for (const e of a.evidence) {
      lines.push(`  - ${e.label}: ${e.value}`);
    }
  };
  renderForensic("size", cert.forensicAxes.size);
  renderForensic("files", cert.forensicAxes.files);
  renderForensic("style", cert.forensicAxes.style);
  renderForensic("time", cert.forensicAxes.time);
  if (cert.forensicAxes.size.caveat) {
    lines.push(``);
    lines.push(`*ⓘ ${cert.forensicAxes.size.caveat}*`);
  }
  lines.push(``);

  // ── Per-commit narrative checks (full detail when available) ─────
  if (cert.axes.aiNarrative.checks.length > 0) {
    lines.push(`## Per-Commit Narrative Checks`);
    lines.push(``);
    for (const check of cert.axes.aiNarrative.checks) {
      lines.push(`### ${check.commitHash.slice(0, 7)} (trust ${check.narrativeTrustScore.toFixed(2)})`);
      lines.push(``);
      for (const v of check.verifications) {
        const icon = v.verdict === "verified" ? "✓" : v.verdict === "contradicted" ? "✗" : "?";
        lines.push(`- ${icon} **${v.verdict}** — ${v.claim}`);
        lines.push(`  - ${v.reason}`);
      }
      lines.push(``);
    }
  }
  return lines.join("\n") + "\n";
}

// ─── shared helpers ─────────────────────────────────────────────────

/** Run `git show` for one commit; return unified diff + files touched. */
export function collectDiffForCommit(
  repoRoot: string,
  hash: string,
): { diff: string; filesTouched: string[] } {
  let diff = "";
  let filesTouched: string[] = [];
  try {
    diff = execFileSync(
      "git",
      ["show", "--unified=0", "--format=", hash],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    diff = "";
  }
  try {
    const namesOut = execFileSync(
      "git",
      ["show", "--name-only", "--format=", hash],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    );
    filesTouched = namesOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    filesTouched = [];
  }
  return { diff, filesTouched };
}

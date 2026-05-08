/**
 * `mneme deps audit` — vulnerability scanning for installed dependencies
 * via OSV.dev (Google-maintained public vulnerability database).
 *
 * Customer feedback (v0.36): "ไม่ Integrate กับ Vulnerability DB."
 * Returns the same severity scale + finding shape as `mneme forensics
 * vulns` so a SARIF export can fold both code-level and dep-level risks
 * into one GitHub Code Scanning report.
 */

import kleur from "kleur";
import { git, forensics } from "@mneme-ai/core";
import { ui, header, section, kv, severityBadge, divider, nextSteps, type Level } from "../ui.js";

export interface DepsAuditOptions {
  cwd: string;
  json?: boolean;
  /** Cap inventory queried (default 5000). */
  maxPackages?: number;
  /** Skip the network call (offline mode for tests/airgapped envs). */
  offline?: boolean;
  quiet?: boolean;
}

export async function depsAuditCommand(opts: DepsAuditOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  if (!opts.quiet && !opts.json) ui.banner();

  const report = await forensics.auditDependencies({
    cwd: meta.rootPath,
    offline: opts.offline,
    maxPackages: opts.maxPackages,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report.findings.length === 0 ? 0 : 1;
  }

  process.stdout.write(
    header(
      "📦",
      "Dependency Audit",
      "Cross-references your package-lock.json against OSV.dev (CVE / GHSA / npm advisories).",
      "Catch known vulnerabilities in installed packages — including transitive deps.",
    ) + "\n\n",
  );

  process.stdout.write(
    kv("source", report.source) +
      "\n" +
      kv("packages scanned", String(report.packagesScanned)) +
      "\n" +
      kv("findings", String(report.findings.length)) +
      "\n",
  );

  for (const note of report.notes) {
    process.stdout.write(`  ${kleur.yellow("!")} ${kleur.gray(note)}\n`);
  }
  process.stdout.write("\n");

  if (report.findings.length === 0) {
    process.stdout.write(
      `  ${kleur.green("✓")} No known vulnerabilities found in ${report.packagesScanned} installed packages.\n\n`,
    );
    return 0;
  }

  // Severity tally
  process.stdout.write(section("By severity") + "\n");
  for (const sev of ["critical", "high", "medium", "low", "unknown"] as const) {
    const n = report.bySeverity[sev];
    if (n === 0) continue;
    const level = sevToLevel(sev);
    process.stdout.write(`    ${severityBadge(level)}  ${kleur.bold(String(n).padStart(4))}\n`);
  }
  process.stdout.write("\n");

  // Findings
  process.stdout.write(section("Findings") + "\n\n");
  for (const f of report.findings.slice(0, 30)) {
    process.stdout.write(
      `  ${severityBadge(sevToLevel(f.severity))}  ${kleur.bold(f.id)}  ${kleur.cyan(f.package)}@${kleur.bold(f.installedVersion)}\n`,
    );
    process.stdout.write(`        ${kleur.white(f.summary)}\n`);
    if (f.aliases.length > 0) {
      process.stdout.write(`        ${kleur.gray("aliases:")} ${kleur.gray(f.aliases.slice(0, 3).join(", "))}\n`);
    }
    if (f.fixedIn) {
      process.stdout.write(`        ${kleur.gray("fixed in:")} ${kleur.green(f.fixedIn)}\n`);
    } else {
      process.stdout.write(`        ${kleur.gray("fixed in:")} ${kleur.red("(no fix released)")}\n`);
    }
    process.stdout.write(`        ${kleur.gray("more:")} ${kleur.gray(f.url)}\n\n`);
  }
  if (report.findings.length > 30) {
    process.stdout.write(`  ${kleur.gray(`(${report.findings.length - 30} more — use --json for full list)`)}\n\n`);
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Findings are sourced from OSV.dev — the public vulnerability database that aggregates\n" +
          "  GitHub Security Advisories, CVE/NVD, and ecosystem-specific feeds. Severity is the\n" +
          "  database's own rating (or the CVSS-3 base score mapped: ≥9 critical, ≥7 high,\n" +
          "  ≥4 medium, otherwise low).\n" +
          "  Bump deps via your package manager (npm update / yarn upgrade) — verify the bump\n" +
          "  doesn't break tests, then re-run this command to confirm the finding is gone.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme deps audit --json`, why: "machine-readable output" },
      { cmd: `mneme forensics vulns`, why: "code-level vulnerabilities (paired with this dep-level scan)" },
      { cmd: `npm update <package>`, why: "bump a single dep then re-run" },
    ]) + "\n",
  );

  return 1;
}

function sevToLevel(s: string): Level {
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  return "info";
}

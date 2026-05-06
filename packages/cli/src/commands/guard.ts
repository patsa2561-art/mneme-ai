/**
 * `mneme guard` — pre-commit hook. Always-on security infrastructure.
 *
 *   mneme guard --install     installs .git/hooks/pre-commit
 *   mneme guard --uninstall   removes it
 *   mneme guard --check       runs against staged changes (called by the hook)
 *
 * The hook runs in <300ms on staged changes and blocks commits that contain:
 *   1. Hardcoded secrets (AWS keys, JWTs, passwords, etc.) — uses redact rules
 *   2. Known-vulnerable patterns (Math.random as RNG, MD5 for security, etc.)
 *   3. (Future) Anomalous size/style for the author
 *
 * The killer property: install once → catches the next leaked AWS key
 * BEFORE it touches the remote, instead of asking the user to remember to
 * run `mneme forensics`. "tool you must remember" → "infrastructure that
 * just works."
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import kleur from "kleur";
import {
  ui,
  header,
  section,
  pill,
  emptyState,
  nextSteps,
  severityBadge,
  type Level,
} from "../ui.js";
import { git, forensics, util, type Commit } from "@mneme-ai/core";

export interface GuardOptions {
  cwd: string;
  install?: boolean;
  uninstall?: boolean;
  check?: boolean;
  strict?: boolean;
}

const HOOK_MARKER = "# mneme-guard-hook v1";
const HOOK_BODY = `#!/bin/sh
${HOOK_MARKER}
# Pre-commit guard. Blocks commits with leaked secrets or known-vulnerable
# patterns. Bypass with: git commit --no-verify
# Uninstall with: mneme guard --uninstall

mneme guard --check
exit $?
`;

export async function guardCommand(opts: GuardOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  if (opts.install) return installHook(opts.cwd);
  if (opts.uninstall) return uninstallHook(opts.cwd);
  if (opts.check) return runCheck(opts.cwd, !!opts.strict);

  // Default: show status + how to install
  return showStatus(opts.cwd);
}

// ─── install / uninstall ────────────────────────────────────────────────

function hookPath(cwd: string): string {
  // Honor core.hooksPath if set
  let hooksDir = ".git/hooks";
  try {
    const out = execSync("git config --get core.hooksPath", { cwd, encoding: "utf8" }).trim();
    if (out) hooksDir = out;
  } catch {
    // not set — use default
  }
  return join(cwd, hooksDir, "pre-commit");
}

function installHook(cwd: string): number {
  const path = hookPath(cwd);
  // dirname() handles BOTH Unix (/) and Windows (\) separators.
  // The previous lastIndexOf("/") returned -1 on Windows (where join() uses \),
  // so substring(0, -1) became "" → ENOENT mkdir "".
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Check if a hook already exists
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing.includes(HOOK_MARKER)) {
      ui.success(`Mneme guard already installed at ${path}`);
      return 0;
    }
    // Other hook present — append to it instead of overwriting
    const merged = existing.trimEnd() + "\n\n" + HOOK_BODY.split("\n").slice(1).join("\n");
    writeFileSync(path, merged);
    chmodSync(path, 0o755);
    ui.banner();
    process.stdout.write(header("🛡", "Guard installed (appended to existing hook)",
      `${path}`,
      "Pre-commit hook now runs your existing checks AND Mneme guard.") + "\n\n");
    return 0;
  }

  writeFileSync(path, HOOK_BODY);
  chmodSync(path, 0o755);

  ui.banner();
  process.stdout.write(header("🛡", "Guard installed",
    `pre-commit hook → ${path}`,
    "Mneme will now scan every commit for leaked secrets + known-vulnerable patterns BEFORE the commit lands.") + "\n\n");

  process.stdout.write(section("✦ What happens next") + "\n\n");
  process.stdout.write(`  ${kleur.green("●")} Every \`git commit\` now triggers \`mneme guard --check\`\n`);
  process.stdout.write(`  ${kleur.green("●")} Runs in <300ms against staged changes only\n`);
  process.stdout.write(`  ${kleur.green("●")} Blocks the commit if HIGH/CRITICAL findings (configurable with --strict)\n`);
  process.stdout.write(`  ${kleur.green("●")} Bypass when you really need to:  ${kleur.cyan("git commit --no-verify")}\n\n`);

  process.stdout.write(nextSteps([
    {
      cmd: `git commit -am "test"`,
      why: `The next commit will be guard-checked. Try it.`,
    },
    {
      cmd: `mneme guard --uninstall`,
      why: `Remove the hook anytime.`,
    },
  ]) + "\n\n");
  return 0;
}

function uninstallHook(cwd: string): number {
  const path = hookPath(cwd);
  if (!existsSync(path)) {
    ui.info(`No pre-commit hook at ${path}`);
    return 0;
  }
  const content = readFileSync(path, "utf8");
  if (!content.includes(HOOK_MARKER)) {
    ui.warn(`Hook at ${path} is not Mneme's — refusing to delete`);
    ui.dim(`  Edit ${path} manually if you want to remove specific lines.`);
    return 1;
  }
  // If we appended to an existing hook, surgically remove our block
  if (content.split("\n").length > HOOK_BODY.split("\n").length + 1) {
    const lines = content.split("\n");
    const start = lines.findIndex((l) => l.includes(HOOK_MARKER));
    const filtered = lines.slice(0, start - 1); // strip blank line + marker block
    writeFileSync(path, filtered.join("\n"));
    ui.success(`Removed Mneme guard block from ${path}`);
    return 0;
  }
  unlinkSync(path);
  ui.success(`Uninstalled pre-commit hook at ${path}`);
  return 0;
}

function showStatus(cwd: string): number {
  const path = hookPath(cwd);
  ui.banner();
  process.stdout.write(header("🛡", "Mneme Guard",
    "pre-commit hook for always-on security",
    "Install once → every git commit auto-scans for leaked secrets + known-vulnerable patterns.") + "\n\n");

  const installed = existsSync(path) && readFileSync(path, "utf8").includes(HOOK_MARKER);
  if (installed) {
    process.stdout.write(`  ${pill("INSTALLED", "ok")}  ${kleur.gray(path)}\n\n`);
    process.stdout.write(nextSteps([
      { cmd: `mneme guard --check`, why: `Run a manual scan against currently-staged changes.` },
      { cmd: `mneme guard --uninstall`, why: `Remove the hook.` },
    ]) + "\n\n");
  } else {
    process.stdout.write(`  ${pill("NOT INSTALLED", "warn")}\n\n`);
    process.stdout.write(section("✦ Why install?") + "\n\n");
    process.stdout.write(`  ${kleur.green("●")} Catches AWS keys, JWTs, passwords ${kleur.bold("before")} they reach GitHub\n`);
    process.stdout.write(`  ${kleur.green("●")} Blocks Math.random in security-sensitive code, MD5/SHA1 for crypto\n`);
    process.stdout.write(`  ${kleur.green("●")} Runs in <300ms on staged changes only — invisible until something's wrong\n`);
    process.stdout.write(`  ${kleur.green("●")} Bypass for legitimate cases:  git commit --no-verify\n\n`);
    process.stdout.write(nextSteps([
      { cmd: `mneme guard --install`, why: `Install the pre-commit hook (one-time setup, then forget it exists).` },
    ]) + "\n\n");
  }
  return 0;
}

// ─── --check: the actual hook logic ─────────────────────────────────────

function runCheck(cwd: string, strict: boolean): number {
  // Get staged diff (only added lines — ignore deletions, they can't introduce secrets/vulns)
  let stagedDiff = "";
  let stagedFiles: string[] = [];
  try {
    stagedDiff = execSync("git diff --cached --no-color", { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const namesOnly = execSync("git diff --cached --name-only", { cwd, encoding: "utf8" });
    stagedFiles = namesOnly.split("\n").filter(Boolean);
  } catch (err) {
    ui.error(`Cannot read staged diff: ${(err as Error).message}`);
    return 1;
  }

  if (!stagedDiff.trim()) {
    // Nothing staged — let the commit through (could be amend or hooks running on empty)
    return 0;
  }

  // Build a synthetic commit so we can reuse the existing forensics.huntVulnerabilities engine.
  const fakeCommit: Commit = {
    hash: "STAGED",
    shortHash: "STAGED",
    authorName: "",
    authorEmail: "",
    authorDate: new Date().toISOString(),
    committerDate: new Date().toISOString(),
    subject: "(staged changes — pre-commit guard check)",
    body: "",
    files: stagedFiles,
    parents: [],
  };

  const vulnReport = forensics.huntVulnerabilities([{ commit: fakeCommit, diff: stagedDiff }]);

  // Run secret detector across the diff body
  const redactReport = util.redact(stagedDiff);
  const secretCount = Object.values(redactReport.hits as Record<string, number>).reduce(
    (a: number, b: number) => a + b,
    0,
  );

  const criticalVulns = vulnReport.hits.filter((h) => h.severity === "critical").length;
  const highVulns = vulnReport.hits.filter((h) => h.severity === "high").length;
  const mediumVulns = vulnReport.hits.filter((h) => h.severity === "medium").length;
  const findingCount = vulnReport.hits.length + secretCount;

  // Decide block-or-pass
  const blockReason: string[] = [];
  if (secretCount > 0) blockReason.push(`${secretCount} secret(s) detected in staged changes`);
  if (criticalVulns > 0) blockReason.push(`${criticalVulns} CRITICAL vulnerability finding(s)`);
  if (highVulns > 0) blockReason.push(`${highVulns} HIGH-severity finding(s)`);
  if (strict && mediumVulns > 0) blockReason.push(`${mediumVulns} MEDIUM-severity finding(s) (--strict mode)`);

  if (findingCount === 0) {
    // Silent pass — never spam the user on clean commits
    return 0;
  }

  // Render findings
  ui.banner();
  process.stdout.write(header("🛡", "Mneme Guard — pre-commit check",
    `${stagedFiles.length} file(s) staged · ${findingCount} finding(s)`,
    blockReason.length > 0
      ? "BLOCKING this commit. Bypass with `git commit --no-verify` if you really mean it."
      : "Findings detected but below block threshold (informational only).") + "\n\n");

  if (secretCount > 0) {
    process.stdout.write(section("⚠ Secrets in staged changes") + "\n\n");
    for (const [rule, n] of Object.entries(redactReport.hits)) {
      process.stdout.write(`    ${severityBadge("critical")}  ${kleur.bold(rule.padEnd(32))}  ${kleur.gray(`${n} hit(s)`)}\n`);
    }
    process.stdout.write("\n");
  }

  if (vulnReport.hits.length > 0) {
    process.stdout.write(section("⚠ Vulnerability patterns in staged changes") + "\n\n");
    for (const h of vulnReport.hits.slice(0, 10)) {
      const lvl: Level = (h.severity in { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
        ? h.severity
        : "info") as Level;
      process.stdout.write(`    ${severityBadge(lvl)}  ${kleur.cyan(h.reference)}  ${h.summary}\n`);
      process.stdout.write(`        ${kleur.gray("evidence: " + truncate(h.evidence, 100))}\n\n`);
    }
  }

  if (blockReason.length > 0) {
    process.stdout.write(`  ${kleur.red("✗ BLOCKED:")} ${blockReason.join("; ")}\n\n`);
    process.stdout.write(`  ${kleur.yellow("👉 To proceed anyway:")} ${kleur.bold().white("git commit --no-verify")}\n`);
    process.stdout.write(`  ${kleur.gray("To rotate the leaked secret first:  ")}${kleur.bold("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html#Using_RotateAccessKey")}\n\n`);
    return 1;
  }

  process.stdout.write(emptyState(`Findings below block threshold — commit allowed.`, [
    `Run \`mneme guard --strict\` to also block on MEDIUM-severity findings.`,
  ]));
  return 0;
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= n) return oneLine;
  return oneLine.slice(0, n - 1) + "…";
}

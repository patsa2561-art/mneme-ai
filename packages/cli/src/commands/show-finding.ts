/**
 * `mneme show <finding-id>` — print the full context of a single
 * vulnerability finding by its stable id.
 *
 * Customer feedback: short evidence snippet + no commit URL means every
 * triage step requires `git show <hash>` manually. This command produces
 * the full hunk + commit metadata + posterior breakdown + suggested
 * suppression command line in one place.
 */
import kleur from "kleur";
import { git, forensics, type Commit } from "@mneme-ai/core";
import { ui } from "../ui.js";

export interface ShowFindingOptions {
  cwd: string;
  id: string;
  /** How many commits to scan looking for the id. Defaults to 500 (matches vulns command default). */
  topN?: number;
  json?: boolean;
}

export async function showFindingCommand(opts: ShowFindingOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  const stack = await forensics.detectStackProfile(meta.rootPath);
  // Don't filter by suppressions — we want to find the id even if it's
  // already suppressed (so `mneme show <id>` keeps working as a triage tool).
  const log = await git.execGitOk(
    ["log", "-n", String(opts.topN ?? 500), "--no-color", "--pretty=format:::commit::%H::%aI::%an::%ae::%s"],
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
      // ignore
    }
    inputs.push({ commit, diff });
  }
  const report = forensics.huntVulnerabilities(inputs, { stack, minPosterior: 0 });

  const hit = report.hits.find((h) => h.id === opts.id);
  if (!hit) {
    ui.error(`No finding with id ${opts.id} found in the last ${inputs.length} commits.`);
    ui.dim("Tip: run `mneme forensics vulns` first to surface ids, then pass the 8-char hex string.");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(hit, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(`  ${kleur.bold().cyan("🔬  Finding")}  ${kleur.bold(hit.id)}  ${kleur.gray(`(${hit.rule})`)}\n\n`);

  // Posterior breakdown
  process.stdout.write(`  ${kleur.bold().magenta("Posterior breakdown")}\n`);
  process.stdout.write(`    ${kleur.gray("posterior:    ")} ${kleur.bold(hit.posterior.toFixed(2))} ${kleur.gray("=")} ${kleur.bold(hit.prior.toFixed(2))} ${kleur.gray("(stack prior)")} ${kleur.gray("×")} ${kleur.bold(hit.evidenceScore.toFixed(2))} ${kleur.gray("(AST evidence)")}\n`);
  process.stdout.write(`    ${kleur.gray("evidence ctx: ")} ${kleur.cyan(hit.evidenceContext)}\n`);
  process.stdout.write(`    ${kleur.gray("why:          ")} ${kleur.gray(hit.evidenceReason)}\n\n`);

  // Commit metadata
  process.stdout.write(`  ${kleur.bold().magenta("Commit")}\n`);
  process.stdout.write(`    ${kleur.gray("hash:    ")} ${kleur.bold(hit.commit.hash)}\n`);
  process.stdout.write(`    ${kleur.gray("subject: ")} ${kleur.white(hit.commit.subject)}\n`);
  process.stdout.write(`    ${kleur.gray("author:  ")} ${hit.commit.authorName} ${kleur.gray(`<${hit.commit.authorEmail}>`)}\n`);
  process.stdout.write(`    ${kleur.gray("date:    ")} ${hit.commit.authorDate.slice(0, 10)}\n\n`);

  // Location
  if (hit.filePath) {
    process.stdout.write(`  ${kleur.bold().magenta("Location")}\n`);
    process.stdout.write(`    ${kleur.cyan(hit.filePath)}${hit.line ? kleur.gray(`:${hit.line}`) : ""}\n\n`);
  }

  // Evidence
  process.stdout.write(`  ${kleur.bold().magenta("Evidence")}\n`);
  process.stdout.write(`    ${kleur.red(hit.evidence)}\n\n`);

  // CWE link
  if (hit.reference.startsWith("CWE-")) {
    const num = hit.reference.replace("CWE-", "");
    process.stdout.write(`  ${kleur.bold().magenta("Reference")}\n`);
    process.stdout.write(`    ${kleur.cyan(hit.reference)}  ${kleur.gray(`https://cwe.mitre.org/data/definitions/${num}.html`)}\n\n`);
  }

  // ── v0.38: auto-fix suggestion ─────────────────────────────────────
  const fix = forensics.autoFixFor(hit.rule);
  if (fix) {
    const conf = fix.confidence === "high" ? kleur.green("HIGH") : fix.confidence === "medium" ? kleur.yellow("MEDIUM") : kleur.gray("LOW");
    process.stdout.write(`  ${kleur.bold().magenta("✱ Suggested fix")}  ${kleur.gray(`(template, confidence ${conf}${kleur.gray(")")}`)}\n`);
    process.stdout.write(`    ${kleur.bold(fix.title)}\n`);
    process.stdout.write(`    ${kleur.gray("patch sketch:")}\n`);
    for (const line of fix.patchHint.split("\n")) {
      process.stdout.write(`      ${kleur.green(line)}\n`);
    }
    if (fix.recommendedApi) {
      process.stdout.write(`    ${kleur.gray("recommended:")} ${kleur.cyan(fix.recommendedApi)}\n`);
    }
    process.stdout.write(`    ${kleur.gray("rationale:")}\n`);
    for (const line of wrapText(fix.rationale, 78)) {
      process.stdout.write(`      ${kleur.gray(line)}\n`);
    }
    process.stdout.write("\n");
  }

  // Suggested action
  process.stdout.write(`  ${kleur.bold().magenta("If false positive — suppress")}\n`);
  process.stdout.write(`    ${kleur.cyan("$")} ${kleur.bold(`mneme suppress ${hit.id} --reason "<one-line justification>"`)}\n\n`);

  // Suggested action — investigate
  process.stdout.write(`  ${kleur.bold().magenta("If real — investigate the commit")}\n`);
  process.stdout.write(`    ${kleur.cyan("$")} ${kleur.bold(`git show ${hit.commit.hash}`)}\n`);
  if (hit.filePath) {
    process.stdout.write(`    ${kleur.cyan("$")} ${kleur.bold(`mneme palimpsest ${hit.filePath}${hit.line ? `:${hit.line}` : ""}`)}  ${kleur.gray("# walk the causal chain")}\n`);
  }
  process.stdout.write("\n");

  return 0;
}

function wrapText(s: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    if ((line + " " + word).trim().length > width && line) {
      out.push(line);
      line = word;
    } else {
      line += (line ? " " : "") + word;
    }
  }
  if (line.trim()) out.push(line);
  return out;
}

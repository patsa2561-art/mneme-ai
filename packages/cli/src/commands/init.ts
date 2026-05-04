import { mkdirSync } from "node:fs";
import kleur from "kleur";
import { git } from "@mneme-ai/core";
import { mnemeDir } from "../paths.js";
import { writeConfig, DEFAULT_CONFIG, readConfig } from "../config.js";
import { ui } from "../ui.js";
import { runFullProbe, type ProbeReport } from "../probe.js";

export interface InitOptions {
  cwd: string;
  force?: boolean;
  /** Skip the environment probe (useful in scripts / CI). */
  skipProbe?: boolean;
}

export async function initCommand(opts: InitOptions): Promise<number> {
  ui.banner();
  ui.step("init", `checking ${opts.cwd}`);

  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not inside a git repository.");
    ui.dim("Run `git init` first, or cd into a repo, then re-run mneme init.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  ui.success(`Repo detected: ${meta.rootPath}`);
  ui.dim(`  default branch: ${meta.defaultBranch}`);
  if (meta.host) ui.dim(`  remote: ${meta.host}:${meta.owner}/${meta.repo}`);

  mkdirSync(mnemeDir(meta.rootPath), { recursive: true });

  // Smart probe — answers "do I need to install Ollama?" by checking what's
  // already on this machine. Runs in parallel, ≤ 2s, never blocks init.
  if (!opts.skipProbe) {
    const probe = await runFullProbe();
    renderProbeReport(probe);

    // Persist the recommended provider so subsequent `mneme index` doesn't
    // have to re-detect (and "auto" still works as an override).
    const config = { ...DEFAULT_CONFIG };
    config.embeddings = {
      ...config.embeddings,
      provider: probe.recommendation.pick === "ollama" ? "auto" : probe.recommendation.pick,
    };

    if (!opts.force && Object.keys(readConfig(meta.rootPath)).length > 0 && readConfig(meta.rootPath).schemaVersion === DEFAULT_CONFIG.schemaVersion && readConfig(meta.rootPath) !== DEFAULT_CONFIG) {
      ui.info("Config already present (use --force to overwrite).");
    } else {
      writeConfig(meta.rootPath, config);
      ui.success("Wrote .mneme/config.json");
    }
  } else {
    const existing = readConfig(meta.rootPath);
    if (!opts.force && existing !== DEFAULT_CONFIG && existing.schemaVersion === DEFAULT_CONFIG.schemaVersion) {
      ui.info("Config already present (use --force to overwrite).");
    } else {
      writeConfig(meta.rootPath, DEFAULT_CONFIG);
      ui.success("Wrote .mneme/config.json");
    }
  }

  ui.dim("");
  ui.dim("Next:  mneme index            (build the memory)");
  ui.dim("       mneme ask \"...\"        (query the memory)");
  ui.dim("       mneme mcp              (serve to Claude/Cursor/etc.)");
  return 0;
}

function renderProbeReport(probe: ProbeReport): void {
  ui.dim("");
  process.stdout.write(`  ${kleur.bold().cyan("Environment probe")}\n`);
  process.stdout.write(`    ${kleur.gray("hardware ")}  ${probe.hardware.ramGB}GB RAM · ${probe.hardware.cpuCount} cpus · ${probe.hardware.platform}/${probe.hardware.arch} (${probe.hardware.tier})\n`);
  process.stdout.write(`    ${kleur.gray("ollama   ")}  ${probe.ollama.reachable ? kleur.green("reachable") : kleur.gray("not running")}${probe.ollama.hasEmbedModel ? kleur.green(" · embed model pulled") : probe.ollama.reachable ? kleur.yellow(" · embed model NOT pulled") : ""}\n`);
  process.stdout.write(`    ${kleur.gray("openai   ")}  ${probe.openai.hasKey ? kleur.green(`key set …${probe.openai.keyTail}`) : kleur.gray("no key")}\n`);
  ui.dim("");

  const stars = "★".repeat(probe.recommendation.qualityStars) + "☆".repeat(5 - probe.recommendation.qualityStars);
  process.stdout.write(`  ${kleur.bold().magenta("Recommendation")} ${kleur.bold(probe.recommendation.pick)} ${kleur.gray(stars)}\n`);
  process.stdout.write(`    ${probe.recommendation.reason}\n`);
  if (probe.recommendation.action) {
    process.stdout.write(`    ${kleur.cyan("→")} ${kleur.bold(probe.recommendation.action)}\n`);
  }
  ui.dim("");
}

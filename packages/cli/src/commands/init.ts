import { mkdirSync } from "node:fs";
import { git } from "@mneme-ai/core";
import { mnemeDir } from "../paths.js";
import { writeConfig, DEFAULT_CONFIG, readConfig } from "../config.js";
import { ui } from "../ui.js";

export interface InitOptions {
  cwd: string;
  force?: boolean;
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

  const existing = readConfig(meta.rootPath);
  if (!opts.force && existing !== DEFAULT_CONFIG && existing.schemaVersion === DEFAULT_CONFIG.schemaVersion) {
    ui.info("Config already present (use --force to overwrite).");
  } else {
    writeConfig(meta.rootPath, DEFAULT_CONFIG);
    ui.success("Wrote .mneme/config.json");
  }

  ui.dim("");
  ui.dim("Next:  mneme index            (build the memory)");
  ui.dim("       mneme ask \"...\"        (query the memory)");
  ui.dim("       mneme mcp              (serve to Claude/Cursor/etc.)");
  return 0;
}

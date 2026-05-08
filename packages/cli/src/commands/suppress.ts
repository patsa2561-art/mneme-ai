/**
 * `mneme suppress` — manage .mneme/suppressions.json.
 *
 * Customer feedback: every scan re-surfaces the same false positives.
 * Suppressions let the user mark a finding as "ignore" with a reason +
 * optional expiry. The vulnhunt scanner consults the file before reporting.
 *
 * Subcommands (covered by --add / --remove flags on a single command for
 * simplicity, no Commander subcommand boilerplate):
 *   mneme suppress <id> --reason "<why>"          — add
 *   mneme suppress <id> --remove                  — remove
 *   mneme suppress --list                         — list active
 */
import kleur from "kleur";
import { git, forensics } from "@mneme-ai/core";
import { ui } from "../ui.js";

export interface SuppressOptions {
  cwd: string;
  id?: string;
  reason?: string;
  expiresAt?: string;
  remove?: boolean;
  list?: boolean;
  json?: boolean;
}

export async function suppressCommand(opts: SuppressOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  // ── --list ─────────────────────────────────────────────────────────
  if (opts.list) {
    const entries = await forensics.loadSuppressions(meta.rootPath);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ entries }, null, 2) + "\n");
      return 0;
    }
    if (entries.length === 0) {
      ui.info("No active suppressions.");
      return 0;
    }
    process.stdout.write(`${kleur.bold().magenta("Active suppressions")}\n\n`);
    for (const e of entries) {
      const expires = e.expiresAt ? `  ${kleur.gray(`expires ${e.expiresAt.slice(0, 10)}`)}` : "";
      process.stdout.write(
        `  ${kleur.cyan(e.id)}  ${kleur.gray(`[${e.rule ?? "any"}]`)}${expires}\n` +
          `      ${kleur.white(e.reason)}\n` +
          (e.addedBy ? `      ${kleur.gray(`added by ${e.addedBy} on ${e.addedAt?.slice(0, 10) ?? ""}`)}\n` : "") +
          "\n",
      );
    }
    return 0;
  }

  // ── --remove ───────────────────────────────────────────────────────
  if (opts.remove) {
    if (!opts.id) {
      ui.error("Pass the finding id to remove.");
      return 1;
    }
    const ok = await forensics.removeSuppression(meta.rootPath, opts.id);
    if (ok) ui.success(`Suppression ${opts.id} removed.`);
    else ui.warn(`No suppression found with id ${opts.id}.`);
    return ok ? 0 : 1;
  }

  // ── default: add ───────────────────────────────────────────────────
  if (!opts.id) {
    ui.error("Pass the finding id to suppress (e.g. `mneme suppress a1b2c3d4 --reason \"...\"`).");
    return 1;
  }
  if (!opts.reason || opts.reason.trim().length < 3) {
    ui.error("Pass --reason \"<why this is a false positive>\" — at least 3 chars.");
    return 1;
  }
  await forensics.addSuppression(meta.rootPath, {
    id: opts.id,
    reason: opts.reason,
    expiresAt: opts.expiresAt,
  });
  ui.success(`Suppression added for ${opts.id}.`);
  ui.dim(`File: ${meta.rootPath}/.mneme/suppressions.json`);
  return 0;
}

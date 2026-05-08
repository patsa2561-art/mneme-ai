/**
 * `mneme library` — manage the per-repo molecule library
 * (.mneme/library.json). The v0.42 Second-Brain surface.
 *
 * Subcommands (selected via flags so we don't add Commander overhead):
 *   mneme library                       — list all entries
 *   mneme library --promote <id>        — promote an entry to a named alias
 *   mneme library --eligible            — show entries that meet promotion criteria
 *   mneme library --archived            — show entries unused for 30+ days
 *   mneme library --annotate <id> --note "<text>"  — add a free-form note
 *   mneme library --forget <id>         — remove an entry
 */

import kleur from "kleur";
import { git, periodic } from "@mneme-ai/core";
import { ui, header, section, kv, divider, nextSteps } from "../ui.js";

export interface LibraryOptions {
  cwd: string;
  promote?: string;
  alias?: string;
  eligible?: boolean;
  archived?: boolean;
  annotate?: string;
  note?: string;
  forget?: string;
  json?: boolean;
  quiet?: boolean;
}

export async function libraryCommand(opts: LibraryOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  if (opts.promote) {
    const e = await periodic.promote(meta.rootPath, opts.promote, opts.alias);
    if (!e) {
      ui.error(`No library entry with id ${opts.promote}.`);
      return 1;
    }
    ui.success(`Promoted ${e.id} → alias "${e.alias}". Run with: mneme run ${e.alias}`);
    return 0;
  }

  if (opts.annotate) {
    if (!opts.note) {
      ui.error("Pass --note \"<text>\" with --annotate.");
      return 1;
    }
    const e = await periodic.annotate(meta.rootPath, opts.annotate, opts.note);
    if (!e) {
      ui.error(`No library entry with id ${opts.annotate}.`);
      return 1;
    }
    ui.success(`Annotated ${e.id}.`);
    return 0;
  }

  if (opts.forget) {
    const ok = await periodic.forget(meta.rootPath, opts.forget);
    if (ok) ui.success(`Forgot ${opts.forget}.`);
    else ui.warn(`No library entry with id ${opts.forget}.`);
    return ok ? 0 : 1;
  }

  const lib = await periodic.readLibrary(meta.rootPath);
  let view = Object.values(lib.entries);
  if (opts.eligible) view = periodic.eligibleForPromotion(lib);
  if (opts.archived) view = periodic.archived(lib);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ entries: view }, null, 2) + "\n");
    return 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "🧠",
      "Molecule library",
      "the per-repo Second Brain — every plan you've composed",
      "Promote frequent plans into named aliases. List, annotate, prune.",
    ) + "\n\n",
  );

  if (view.length === 0) {
    process.stdout.write(`  ${kleur.gray(opts.eligible ? "(no entries eligible for promotion)" : opts.archived ? "(no archived entries)" : "(empty — run `mneme compose \"<intent>\"` to populate)")}\n\n`);
    return 0;
  }

  process.stdout.write(section(opts.eligible ? "Eligible for promotion" : opts.archived ? "Archived (≥ 30 days unused)" : "Library entries") + "\n\n");
  view.sort((a, b) => b.hits - a.hits);
  for (const e of view) {
    const aliasTag = e.promoted ? kleur.green(`(${e.alias})`) : kleur.gray("(unnamed)");
    process.stdout.write(
      `  ${kleur.cyan(e.id)}  ${kleur.bold(`hits ${e.hits}`)} ${aliasTag}  ${kleur.gray(e.lastSeen.slice(0, 10))}\n` +
        `      ${kleur.white(e.intent)}\n` +
        (e.note ? `      ${kleur.yellow("note:")} ${kleur.gray(e.note)}\n` : "") +
        `      ${kleur.gray("plan:")} ${kleur.gray(e.plan.steps.map((s) => s.id).join(" → "))}\n\n`,
    );
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Each entry is a plan you composed via `mneme compose`. Once an entry has\n" +
          "  ≥ 5 hits (or has been used over 7 days with ≥ 2 hits), it becomes eligible\n" +
          "  for promotion to a named alias — runnable as `mneme run <alias>`.\n" +
          "  Entries unused for 30 days are listed as archived; remove with --forget <id>.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme library --eligible`, why: "see entries ready for promotion" },
      { cmd: `mneme library --promote <id> --alias <name>`, why: "give an entry a named alias" },
      { cmd: `mneme library --archived`, why: "see entries unused for 30+ days" },
    ]) + "\n",
  );
  return 0;
}

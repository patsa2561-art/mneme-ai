/**
 * `mneme key rotate` — atomically re-sign the audit-log HMAC chain
 * with a fresh secret.
 *
 * Banking / SOC2 requirement: secret keys must be rotated periodically.
 * Naive rotation breaks every HMAC; this command re-walks the chain
 * and re-signs each entry under the new secret atomically.
 *
 * Usage:
 *   mneme key rotate            # dry-run summary
 *   mneme key rotate --confirm  # actually rotate
 */

import kleur from "kleur";
import { ui } from "../ui.js";
import { git, security } from "@mneme-ai/core";

export type KeyAction = "rotate";

export interface KeyOptions {
  cwd: string;
  action: KeyAction;
  confirm?: boolean;
  actor?: string;
  json?: boolean;
}

export async function keyCommand(opts: KeyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const root = meta.rootPath;

  if (opts.action !== "rotate") {
    ui.error(`Unknown key action: ${opts.action}`);
    return 1;
  }

  if (!opts.confirm) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ dryRun: true, message: "pass --confirm to actually rotate" }, null, 2) + "\n");
      return 0;
    }
    ui.banner();
    process.stdout.write(
      kleur.bold("\n  🔑 Key rotate (DRY RUN)\n\n") +
        "  This would re-sign every entry in .mneme/audit.log under a fresh\n" +
        "  HMAC-SHA-256 secret. The old log is archived (never destroyed) at\n" +
        "  .mneme/audit.log.pre-rotate-<timestamp>.\n\n" +
        kleur.yellow("  Pass --confirm to actually rotate.\n\n") +
        "  After rotation, if you set MNEME_AUDIT_SECRET in production, update\n" +
        "  it to the new fingerprint shown in the rotate output.\n\n",
    );
    return 0;
  }

  const result = security.keyRotate.rotateSecret(root, opts.actor ?? "cli");
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.rotated ? 0 : 1;
  }
  ui.banner();
  if (!result.rotated) {
    process.stdout.write(
      kleur.bold(`\n  ${kleur.red("✗")} Rotation refused\n\n`) +
        `  Reason: ${result.reason}\n\n`,
    );
    return 1;
  }
  process.stdout.write(
    kleur.bold(`\n  ${kleur.green("✓")} Key rotated\n\n`) +
      `  Re-signed entries:    ${result.reSigned}\n` +
      `  Archived old log:     ${result.archivedPath ?? "(empty log — no archive needed)"}\n` +
      `  New secret fingerprint: ${kleur.cyan(result.newSecretFingerprint ?? "")}…\n\n` +
      kleur.gray("  Update MNEME_AUDIT_SECRET in your environment to match\n  if you set it explicitly. The .mneme/audit-log.secret file is\n  already updated.\n\n"),
  );
  return 0;
}

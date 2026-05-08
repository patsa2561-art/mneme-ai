/**
 * `mneme audit-log` — manage the HMAC-chained tamper-evident audit log.
 *
 * Subcommands:
 *   - enable   — turn on append-only logging of every mutating action
 *   - disable  — turn off (existing log preserved)
 *   - status   — show current state + entry count + last entry
 *   - verify   — re-walk the chain; report tamper, if any
 *   - rotate   — archive current log + start fresh chain
 *   - show     — dump entries (JSON or pretty)
 *
 * Banking / SOC2 / PCI-DSS audit requirement: `mneme audit-log verify`
 * is the compliance checkpoint. CI exit code 0 = chain intact.
 */

import kleur from "kleur";
import { ui } from "../ui.js";
import { git, security } from "@mneme-ai/core";

export type AuditLogAction = "enable" | "disable" | "status" | "verify" | "rotate" | "show";

export interface AuditLogOptions {
  cwd: string;
  action: AuditLogAction;
  actor?: string;
  limit?: number;
  json?: boolean;
}

export async function auditLogCommand(opts: AuditLogOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const root = meta.rootPath;

  switch (opts.action) {
    case "enable": {
      security.auditLog.enable(root);
      security.auditLog.appendEntry(root, {
        actor: opts.actor ?? "cli",
        action: "audit-log-enable",
        details: { enabledAt: new Date().toISOString() },
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify({ enabled: true }, null, 2) + "\n");
      } else {
        ui.banner();
        process.stdout.write(
          kleur.bold("\n  🔒 Audit log: ENABLED\n\n") +
            "  Every mutating action is now appended to .mneme/audit.log\n" +
            "  with an HMAC-SHA-256 chain. Any modification to the log will\n" +
            "  be detected by `mneme audit-log verify`.\n\n" +
            "  Set " + kleur.cyan("MNEME_AUDIT_SECRET") + " (>= 32 chars) for production.\n\n",
        );
      }
      return 0;
    }

    case "disable": {
      security.auditLog.disable(root);
      if (opts.json) process.stdout.write(JSON.stringify({ enabled: false }, null, 2) + "\n");
      else ui.success("Audit log disabled. Existing log preserved.");
      return 0;
    }

    case "status": {
      const enabled = security.auditLog.isEnabled(root);
      const entries = security.auditLog.readAll(root);
      const last = entries[entries.length - 1];
      const data = {
        enabled,
        totalEntries: entries.length,
        lastEntry: last ? { ts: last.ts, actor: last.actor, action: last.action, hmac: last.hmac.slice(0, 12) + "…" } : null,
      };
      if (opts.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      else {
        ui.banner();
        process.stdout.write(
          kleur.bold("\n  🔒 Audit log status\n\n") +
            `  Enabled: ${enabled ? kleur.green("yes") : kleur.gray("no")}\n` +
            `  Entries: ${entries.length}\n` +
            (last ? `  Last:    ${last.ts} · ${last.actor} · ${last.action}\n` : "") +
            "\n",
        );
      }
      return 0;
    }

    case "verify": {
      const result = security.auditLog.verify(root);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return result.ok ? 0 : 1;
      }
      ui.banner();
      if (result.ok) {
        process.stdout.write(
          kleur.bold(`\n  ${kleur.green("✓")} Audit chain INTACT\n\n`) +
            `  ${result.totalEntries} entries verified · HMAC-SHA-256 chain unbroken\n\n`,
        );
        return 0;
      }
      process.stdout.write(
        kleur.bold(`\n  ${kleur.red("✗")} Audit chain BROKEN\n\n`) +
          `  Total entries: ${result.totalEntries}\n` +
          `  Broken at index: ${result.brokenAtIndex}\n` +
          `  Reason: ${result.brokenReason}\n\n` +
          kleur.yellow("  ⚠ Tamper detected. Investigate immediately.\n\n"),
      );
      return 1;
    }

    case "rotate": {
      const r = security.auditLog.rotate(root, opts.actor ?? "cli");
      if (opts.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      else if (r.rotated) ui.success(`Rotated. Archived to ${r.archivedPath}`);
      else ui.success("Fresh log started.");
      return 0;
    }

    case "show": {
      const entries = security.auditLog.readAll(root);
      const limit = opts.limit ?? entries.length;
      const slice = entries.slice(-limit);
      if (opts.json) {
        process.stdout.write(JSON.stringify(slice, null, 2) + "\n");
        return 0;
      }
      if (slice.length === 0) {
        ui.info("No audit entries.");
        return 0;
      }
      ui.banner();
      process.stdout.write(kleur.bold(`\n  🔒 Audit log — last ${slice.length} entr${slice.length === 1 ? "y" : "ies"}\n\n`));
      for (const e of slice) {
        process.stdout.write(
          `  ${kleur.gray(e.ts)} · ${kleur.cyan(e.actor)} · ${kleur.bold(e.action)}` +
            (e.target ? ` → ${e.target}` : "") +
            kleur.gray(`  [${e.hmac.slice(0, 8)}]`) +
            "\n",
        );
      }
      process.stdout.write("\n");
      return 0;
    }
  }
  ui.error(`Unknown audit-log action: ${opts.action}`);
  return 1;
}

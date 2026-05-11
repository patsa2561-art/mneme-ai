/**
 * `mneme uninstall` (v1.28.2) -- comprehensive removal of every Mneme
 * artifact the ghost-sniper auto-boot may have planted on the user's
 * machine. The trust contract: anything we silently installed, the user
 * (or AI agent acting on their behalf) can silently remove.
 *
 * Removes:
 *   1. Running daemon process (SIGTERM via stopDaemon).
 *   2. OS boot service (schtasks/systemd-user/launchd) -- platform-aware.
 *   3. Auto-boot marker file (~/.mneme-auto-service-attempted).
 *   4. Hooks/agent-files in every supported AI tool (settings.json,
 *      CLAUDE.md sentinel block, .cursor/rules/, AGENTS.md, etc.).
 *   5. (with --purge) the .mneme/ directory in the current repo.
 *   6. (with --npm)   `npm uninstall -g mneme-ai` to remove the binary.
 *
 * The wisdom-shaped report tells the user EXACTLY what was removed,
 * what was already gone, and what failed -- no silent post-uninstall
 * surprises.
 */

import type { Command } from "commander";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import {
  nucleusDaemon, integrations, serviceUninstall,
} from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

interface UninstallStep {
  step: string;
  status: "removed" | "stopped" | "not-installed" | "skipped" | "failed";
  detail?: string;
  identifier?: string;
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove EVERY Mneme artifact from this machine: stop daemon, remove OS service, remove agent hooks, remove auto-boot marker. (Pass --purge to also wipe .mneme/ in this repo; --npm to also `npm uninstall -g`.)")
    .option("--purge", "Also delete the .mneme/ directory in the current repo (deletes lineage, antivirus stats, retrieval leaderboard).")
    .option("--npm", "Also `npm uninstall -g mneme-ai` (removes the CLI itself).")
    .option("--json", "JSON output.")
    .action(async (opts: { purge?: boolean; npm?: boolean } & CommonOpts) => {
      const repoRoot = process.cwd();
      const steps: UninstallStep[] = [];

      // 1. Stop the daemon if running.
      try {
        const stop = nucleusDaemon.stopDaemon(repoRoot);
        steps.push({
          step: "stop running daemon",
          status: stop.stopped ? "stopped" : (stop.pid === null ? "not-installed" : "failed"),
          detail: stop.reason,
          identifier: stop.pid != null ? `pid ${stop.pid}` : undefined,
        });
      } catch (e) {
        steps.push({ step: "stop running daemon", status: "failed", detail: (e as Error).message });
      }

      // 2. Remove the OS boot service (cross-platform).
      try {
        const removals = serviceUninstall.removeBootService();
        for (const r of removals) {
          steps.push({
            step: `remove ${r.artifact}`,
            status: r.status,
            detail: r.detail,
            identifier: r.identifier,
          });
        }
      } catch (e) {
        steps.push({ step: "remove OS boot service", status: "failed", detail: (e as Error).message });
      }

      // 3. Remove the auto-boot marker.
      try {
        const m = serviceUninstall.removeAutoBootMarker();
        steps.push({
          step: `remove ${m.artifact}`,
          status: m.status,
          detail: m.detail,
          identifier: m.identifier,
        });
      } catch (e) {
        steps.push({ step: "remove auto-boot marker", status: "failed", detail: (e as Error).message });
      }

      // 4. Remove hooks + agent files via the integrations adapter system.
      try {
        const results = await integrations.uninstallAll(repoRoot);
        for (const r of results) {
          // Map adapter status -> our status. Adapters use ok/error
          // shapes that vary slightly; we normalize.
          const ok = r.result.ok === true;
          const message = r.result.message ?? "";
          const wasNothingThere = /not present|nothing to|already removed|no.*found/i.test(message);
          steps.push({
            step: `remove integration: ${r.label} (${r.id})`,
            status: ok ? (wasNothingThere ? "not-installed" : "removed") : "failed",
            detail: message,
          });
        }
      } catch (e) {
        steps.push({ step: "remove integration hooks", status: "failed", detail: (e as Error).message });
      }

      // 5. Optional: purge .mneme/ in this repo.
      if (opts.purge) {
        const dotMneme = join(repoRoot, ".mneme");
        if (existsSync(dotMneme)) {
          try {
            rmSync(dotMneme, { recursive: true, force: true });
            steps.push({ step: "purge .mneme/ directory", status: "removed", identifier: dotMneme });
          } catch (e) {
            steps.push({ step: "purge .mneme/ directory", status: "failed", detail: (e as Error).message, identifier: dotMneme });
          }
        } else {
          steps.push({ step: "purge .mneme/ directory", status: "not-installed", identifier: dotMneme });
        }
      } else {
        steps.push({ step: "purge .mneme/ directory", status: "skipped", detail: "use --purge to also wipe .mneme/" });
      }

      // 6. Optional: npm uninstall -g mneme-ai.
      if (opts.npm) {
        try {
          const isWin = platform() === "win32";
          const cmd = isWin ? "npm.cmd" : "npm";
          const r = spawnSync(cmd, ["uninstall", "-g", "mneme-ai"], { encoding: "utf8", shell: isWin, timeout: 60_000 });
          if (r.status === 0) {
            steps.push({ step: "npm uninstall -g mneme-ai", status: "removed" });
          } else {
            steps.push({ step: "npm uninstall -g mneme-ai", status: "failed", detail: (r.stderr || r.stdout || "non-zero exit").trim().slice(0, 200) });
          }
        } catch (e) {
          steps.push({ step: "npm uninstall -g mneme-ai", status: "failed", detail: (e as Error).message });
        }
      } else {
        steps.push({ step: "npm uninstall -g mneme-ai", status: "skipped", detail: "use --npm to also remove the CLI binary" });
      }

      // Tally.
      const removed = steps.filter((s) => s.status === "removed" || s.status === "stopped").length;
      const notInstalled = steps.filter((s) => s.status === "not-installed").length;
      const failed = steps.filter((s) => s.status === "failed").length;
      const skipped = steps.filter((s) => s.status === "skipped").length;
      const fullyClean = failed === 0 && skipped === 0;

      const summary = {
        steps,
        tally: { removed, notInstalled, failed, skipped, total: steps.length },
        fullyClean,
        verdict: failed > 0
          ? `INCOMPLETE: ${failed} step${failed === 1 ? "" : "s"} failed -- review the failed lines above and remove manually.`
          : skipped > 0
            ? `PARTIAL: ${removed + notInstalled} of ${steps.length - skipped} cleanup steps complete (${skipped} skipped -- pass --purge / --npm to include).`
            : `COMPLETE: every Mneme artifact has been removed from this machine. Mneme leaves no trace.`,
      };

      if (opts.json) { writeJson(summary); return; }

      writeText(`Mneme uninstall -- removing every artifact from this machine`);
      writeText(``);
      for (const s of steps) {
        const tag = s.status === "removed" ? "✓ removed"
          : s.status === "stopped" ? "✓ stopped"
          : s.status === "not-installed" ? "· not installed"
          : s.status === "skipped" ? "- skipped"
          : "✗ FAILED";
        const idSuffix = s.identifier ? ` (${s.identifier})` : "";
        const detSuffix = s.detail && s.status !== "stopped" && s.status !== "removed" ? ` -- ${s.detail}` : "";
        writeText(`  [${tag.padEnd(15)}] ${s.step}${idSuffix}${detSuffix}`);
      }
      writeText(``);
      writeText(`Tally: ${removed} removed/stopped · ${notInstalled} already absent · ${skipped} skipped · ${failed} failed`);
      writeText(``);
      writeText(summary.verdict);
      if (failed > 0) process.exitCode = 1;
    });
}

/**
 * `mneme security` — single-screen status of every Mneme security feature
 * with one-shot enable/disable for the auto-bootstrapped pieces.
 *
 * Subcommands:
 *   - status     show what's on/off + provenance (auto-on vs user-on)
 *   - on         re-enable (audit log + scrubber + TOFU) for this repo
 *   - off        disable everything that's auto (escape hatch)
 *   - verify     run audit-log verify + show TOFU manifest status
 */

import kleur from "kleur";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ui } from "../ui.js";
import { git, security } from "@mneme-ai/core";

export type SecurityAction = "status" | "on" | "off" | "verify";

export interface SecurityOptions {
  cwd: string;
  action: SecurityAction;
  json?: boolean;
}

interface SecuritySnapshot {
  auditLog: {
    enabled: boolean;
    totalEntries: number;
    chainOk: boolean;
    chainBrokenReason?: string;
    autoEnabled: boolean;
  };
  fips: {
    active: boolean;
  };
  modelChecksums: {
    pinned: boolean;
    pinnedAt?: string;
    fileCount: number;
  };
  scrubber: {
    activeInMcp: boolean;
  };
  envOverride: {
    autoSecurityDisabled: boolean;
  };
}

function snapshot(repoRoot: string): SecuritySnapshot {
  const enabled = security.auditLog.isEnabled(repoRoot);
  const entries = security.auditLog.readAll(repoRoot);
  const verifyResult = security.auditLog.verify(repoRoot);
  const autoEnabled = entries.some(
    (e) => e.action === "audit-log-enable" && (e.details as { autoEnabled?: unknown } | undefined)?.autoEnabled === true,
  );
  const manifestPath = join(repoRoot, ".mneme", "model-checksums.json");
  let modelChecksums: SecuritySnapshot["modelChecksums"] = { pinned: false, fileCount: 0 };
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files?: Record<string, { pinnedAt?: string }>;
      };
      const files = m.files ?? {};
      const fileCount = Object.keys(files).length;
      const firstPinnedAt = Object.values(files)[0]?.pinnedAt;
      modelChecksums = { pinned: true, fileCount, pinnedAt: firstPinnedAt };
    } catch { /* malformed → leave default */ }
  }
  const envOff = process.env["MNEME_NO_AUTO_SECURITY"] === "1";
  return {
    auditLog: {
      enabled,
      totalEntries: entries.length,
      chainOk: verifyResult.ok,
      chainBrokenReason: verifyResult.brokenReason,
      autoEnabled,
    },
    fips: { active: security.compliance.isFipsActive() },
    modelChecksums,
    scrubber: { activeInMcp: !envOff },
    envOverride: { autoSecurityDisabled: envOff },
  };
}

export async function securityCommand(opts: SecurityOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const root = meta.rootPath;

  if (opts.action === "on") {
    security.auditLog.enable(root);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ enabled: true }, null, 2) + "\n");
    } else {
      ui.success("Security: ON (audit log enabled · scrubber active · TOFU verifying on next index)");
    }
    return 0;
  }

  if (opts.action === "off") {
    security.auditLog.disable(root);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ enabled: false, note: "scrubber+TOFU still on for this process; set MNEME_NO_AUTO_SECURITY=1 to fully disable" }, null, 2) + "\n");
    } else {
      ui.success("Security: audit log OFF.");
      ui.dim("  Scrubber + TOFU verification still active for this process.");
      ui.dim("  Set MNEME_NO_AUTO_SECURITY=1 in your env to disable everything.");
    }
    return 0;
  }

  if (opts.action === "verify") {
    const snap = snapshot(root);
    if (opts.json) {
      process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
      return snap.auditLog.chainOk ? 0 : 1;
    }
    ui.banner();
    if (snap.auditLog.chainOk) {
      process.stdout.write(
        kleur.bold(`\n  ${kleur.green("✓")} Audit chain INTACT\n\n`) +
          `  ${snap.auditLog.totalEntries} entries · HMAC-SHA-256\n` +
          `  Model checksums: ${snap.modelChecksums.pinned ? kleur.green(`${snap.modelChecksums.fileCount} pinned`) : kleur.gray("not pinned yet")}\n\n`,
      );
      return 0;
    }
    process.stdout.write(
      kleur.bold(`\n  ${kleur.red("✗")} Audit chain BROKEN\n\n`) +
        `  ${snap.auditLog.chainBrokenReason ?? "(unknown)"}\n\n`,
    );
    return 1;
  }

  // status (default)
  const snap = snapshot(root);
  if (opts.json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  const ok = (s: string) => kleur.green(s);
  const off = (s: string) => kleur.gray(s);
  process.stdout.write(kleur.bold("\n  🔒 Mneme — security status\n\n"));
  process.stdout.write(
    `  ${snap.auditLog.enabled ? ok("●") : off("○")} Audit log         ${snap.auditLog.enabled ? ok("ON") : off("OFF")} ${snap.auditLog.autoEnabled ? kleur.gray("(auto-enabled)") : ""}\n` +
      `      entries: ${snap.auditLog.totalEntries} · chain: ${snap.auditLog.chainOk ? ok("intact") : kleur.red("BROKEN")}\n` +
      `  ${snap.modelChecksums.pinned ? ok("●") : off("○")} Model checksums   ${snap.modelChecksums.pinned ? ok("PINNED (TOFU)") : off("not yet — first index will pin")}\n` +
      (snap.modelChecksums.pinned ? `      ${snap.modelChecksums.fileCount} files · pinned at ${snap.modelChecksums.pinnedAt ?? "(unknown)"}\n` : "") +
      `  ${snap.scrubber.activeInMcp ? ok("●") : off("○")} Prompt scrubber   ${snap.scrubber.activeInMcp ? ok("ON") : off("OFF (env override)")}\n` +
      `      strips <system>, [INST], jailbreak preludes from MCP wisdom\n` +
      `  ${snap.fips.active ? ok("●") : off("○")} FIPS posture      ${snap.fips.active ? ok("ACTIVE") : off("not detected (informational)")}\n` +
      `      ${snap.fips.active ? "FIPS-validated OpenSSL detected" : "set OPENSSL_FIPS=1 + use FIPS-validated Node build"}\n` +
      "\n",
  );
  if (snap.envOverride.autoSecurityDisabled) {
    process.stdout.write(kleur.yellow("  ⚠ MNEME_NO_AUTO_SECURITY=1 is set in your environment — auto-bootstrap disabled.\n\n"));
  }
  process.stdout.write(
    kleur.gray("  ") +
      kleur.gray("commands: ") +
      kleur.cyan("mneme security on") +
      kleur.gray(" · ") +
      kleur.cyan("off") +
      kleur.gray(" · ") +
      kleur.cyan("verify") +
      "\n\n",
  );
  return 0;
}

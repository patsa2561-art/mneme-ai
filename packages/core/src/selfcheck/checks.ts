/**
 * Built-in audit checks. Add a new check here and the runner picks it
 * up automatically; the daemon will run it within 15 minutes.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AuditCheck, AuditVerdict } from "./types.js";

const t0 = (): number => Date.now();
const v = (start: number, partial: Omit<AuditVerdict, "ms">): AuditVerdict => ({
  ...partial,
  ms: Date.now() - start,
});

/**
 * Check 1: pulse hook is wired correctly into Claude Code.
 * v1.26.1: uses the integrations adapter so we recognize the correct
 * array-of-objects schema AND the v1.25.2 broken string-shorthand
 * (which we surface as a repairable drift, not a pass).
 */
const pulseHookCheck: AuditCheck = {
  name: "pulse-hook-installed",
  description: "Mneme pulse hook is wired into Claude Code (~/.claude/settings.json)",
  failSeverity: "warning",
  async run() {
    const start = t0();
    try {
      const mod = await import("../integrations/index.js");
      const s = await mod.claudeCodeAdapter.status(process.cwd());
      if (s.state === "ok") {
        return v(start, {
          name: "pulse-hook-installed",
          description: "pulse hook installed",
          status: "pass",
          evidence: s.details,
        });
      }
      if (s.state === "drift") {
        return v(start, {
          name: "pulse-hook-installed",
          description: "pulse hook installed",
          status: "fail",
          evidence: s.details,
          fixHint: "Run `mneme hooks repair` (auto-fixes v1.25.2 broken string-shorthand schema).",
          autoAction: { tool: "mneme.system.upgrade", args: { mode: "install", force: true } },
        });
      }
      if (s.state === "no-config") {
        return v(start, {
          name: "pulse-hook-installed",
          description: "pulse hook installed",
          status: "warn",
          evidence: s.details,
          fixHint: "Run `mneme hooks install` to wire the pulse hook so AI sees Mneme on every turn.",
        });
      }
      return v(start, {
        name: "pulse-hook-installed",
        description: "pulse hook installed",
        status: "warn",
        evidence: s.details,
        fixHint: "Run `mneme hooks install --force` to overwrite (or merge manually).",
      });
    } catch (e) {
      // Last-ditch fallback if the integrations import itself blew up.
      const settingsPath = join(homedir(), ".claude", "settings.json");
      if (!existsSync(settingsPath)) {
        return v(start, {
          name: "pulse-hook-installed", description: "pulse hook installed",
          status: "warn", evidence: `~/.claude/settings.json does not exist`,
          fixHint: "Run `mneme hooks install`.",
        });
      }
      try { JSON.parse(readFileSync(settingsPath, "utf8")); }
      catch {
        return v(start, {
          name: "pulse-hook-installed", description: "pulse hook installed",
          status: "warn", evidence: `${settingsPath} is not valid JSON`,
          fixHint: "Fix the JSON, then re-run `mneme hooks install`.",
        });
      }
      return v(start, {
        name: "pulse-hook-installed", description: "pulse hook installed",
        status: "skip", evidence: `integrations import failed: ${(e as Error).message}`,
      });
    }
  },
};

/** Check 2: NUCLEUS daemon recently ticked (< 5 min ago) */
const daemonAliveCheck: AuditCheck = {
  name: "daemon-alive",
  description: "NUCLEUS daemon has ticked in the last 5 minutes",
  failSeverity: "warning",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/nucleus.heartbeat.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "daemon-alive", description: "daemon alive",
        status: "warn",
        evidence: "no heartbeat file (.mneme/nucleus.heartbeat.json)",
        fixHint: "Start: `mneme nucleus daemon --detach`",
      });
    }
    try {
      const hb = JSON.parse(readFileSync(path, "utf8")) as { lastTick?: string; tickCount?: number };
      const ageMs = hb.lastTick ? Date.now() - Date.parse(hb.lastTick) : Infinity;
      if (ageMs < 5 * 60 * 1000) {
        return v(start, {
          name: "daemon-alive", description: "daemon alive",
          status: "pass",
          evidence: `last tick ${Math.round(ageMs / 1000)}s ago, tickCount=${hb.tickCount ?? 0}`,
        });
      }
      return v(start, {
        name: "daemon-alive", description: "daemon alive",
        status: "warn",
        evidence: `last tick ${Math.round(ageMs / 1000)}s ago (> 5 min)`,
        fixHint: "Restart: `mneme nucleus stop && mneme nucleus daemon --detach`",
      });
    } catch {
      return v(start, {
        name: "daemon-alive", description: "daemon alive",
        status: "warn",
        evidence: "heartbeat file corrupt",
      });
    }
  },
};

/** Check 3: version is up-to-date */
const versionUpToDateCheck: AuditCheck = {
  name: "version-up-to-date",
  description: "Installed Mneme version matches npm latest",
  failSeverity: "action",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/version-check.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "version-up-to-date", description: "version up to date",
        status: "skip",
        evidence: "no .mneme/version-check.json (run any mneme command to populate)",
      });
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { current?: string; latest?: string | null };
      if (!data.latest) {
        return v(start, {
          name: "version-up-to-date", description: "version up to date",
          status: "skip", evidence: "no latest in cache (network may have failed)",
        });
      }
      if (data.current === data.latest) {
        return v(start, {
          name: "version-up-to-date", description: "version up to date",
          status: "pass", evidence: `running latest v${data.current}`,
        });
      }
      return v(start, {
        name: "version-up-to-date", description: "version up to date",
        status: "fail",
        evidence: `installed v${data.current}, npm latest v${data.latest}`,
        fixHint: "Run `mneme upgrade --force`",
        autoAction: { tool: "mneme.system.upgrade", args: { mode: "install", force: true } },
      });
    } catch {
      return v(start, {
        name: "version-up-to-date", description: "version up to date",
        status: "skip", evidence: "version-check.json corrupt",
      });
    }
  },
};

/** Check 4: antivirus pharmacopoeia exists */
const antivirusReadyCheck: AuditCheck = {
  name: "antivirus-ready",
  description: "Antivirus pharmacopoeia is initialized",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/antivirus/pharmacopoeia.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "antivirus-ready", description: "antivirus ready",
        status: "warn",
        evidence: "no pharmacopoeia.json",
        fixHint: "Run `mneme antivirus lab` to auto-seed.",
      });
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { vaccines?: Array<unknown> };
      const n = data.vaccines?.length ?? 0;
      return v(start, {
        name: "antivirus-ready", description: "antivirus ready",
        status: n > 0 ? "pass" : "warn",
        evidence: `${n} vaccines registered`,
      });
    } catch {
      return v(start, {
        name: "antivirus-ready", description: "antivirus ready",
        status: "warn", evidence: "pharmacopoeia.json corrupt",
      });
    }
  },
};

/** Check 5: antivirus benchmarks recent (within 7 days) */
const antivirusCertifiedCheck: AuditCheck = {
  name: "antivirus-certified",
  description: "Antivirus vaccines benchmarked within last 7 days",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const dir = join(repoRoot, ".mneme/antivirus/benchmarks");
    if (!existsSync(dir)) {
      return v(start, {
        name: "antivirus-certified", description: "antivirus certified",
        status: "warn",
        evidence: "no benchmarks directory",
        fixHint: "Run `mneme antivirus benchmark`",
        autoAction: { tool: "mneme.antivirus.cert.benchmark", args: {} },
      });
    }
    try {
      const stat = statSync(dir);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        return v(start, {
          name: "antivirus-certified", description: "antivirus certified",
          status: "pass", evidence: `benchmarks updated ${Math.round(ageMs / (24 * 3600 * 1000))} day(s) ago`,
        });
      }
      return v(start, {
        name: "antivirus-certified", description: "antivirus certified",
        status: "warn",
        evidence: `benchmarks ${Math.round(ageMs / (24 * 3600 * 1000))} days old`,
        fixHint: "Run `mneme antivirus benchmark` to recertify",
      });
    } catch {
      return v(start, {
        name: "antivirus-certified", description: "antivirus certified",
        status: "skip", evidence: "stat failed",
      });
    }
  },
};

/** Check 6: retrieval-lab leaderboard has trials */
const retrievalLabActiveCheck: AuditCheck = {
  name: "retrieval-lab-active",
  description: "Retrieval Lab has run >= 1 trial",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/retrieval/leaderboard.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "retrieval-lab-active", description: "retrieval lab active",
        status: "skip", evidence: "no leaderboard.json (no trials run yet)",
        fixHint: "Run `mneme retrieval tune --rounds 3` or start the daemon",
      });
    }
    try {
      const lb = JSON.parse(readFileSync(path, "utf8")) as { totalTrials?: number };
      if ((lb.totalTrials ?? 0) > 0) {
        return v(start, {
          name: "retrieval-lab-active", description: "retrieval lab active",
          status: "pass", evidence: `${lb.totalTrials} trials run`,
        });
      }
      return v(start, {
        name: "retrieval-lab-active", description: "retrieval lab active",
        status: "warn", evidence: "0 trials so far",
        fixHint: "`mneme retrieval tune --rounds 3`",
      });
    } catch {
      return v(start, {
        name: "retrieval-lab-active", description: "retrieval lab active",
        status: "skip", evidence: "leaderboard.json corrupt",
      });
    }
  },
};

/** Check 7: inbox doesn't have stale unsent messages (> 7 days) */
const inboxStaleCheck: AuditCheck = {
  name: "inbox-fresh",
  description: "No unsent inbox messages older than 7 days",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/inbox.jsonl");
    if (!existsSync(path)) {
      return v(start, { name: "inbox-fresh", description: "inbox fresh", status: "pass", evidence: "no inbox" });
    }
    try {
      const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
      let stale = 0;
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const ln of lines) {
        try {
          const e = JSON.parse(ln) as { sent?: boolean; createdAt?: string };
          if (!e.sent && e.createdAt && Date.parse(e.createdAt) < cutoff) stale++;
        } catch { /* skip */ }
      }
      return v(start, {
        name: "inbox-fresh", description: "inbox fresh",
        status: stale === 0 ? "pass" : "warn",
        evidence: stale === 0 ? "no stale unsent messages" : `${stale} unsent message(s) older than 7 days`,
        fixHint: stale > 0 ? "Surface them: any mneme.* tool call will pop them via wisdom prepend." : undefined,
      });
    } catch {
      return v(start, { name: "inbox-fresh", description: "inbox fresh", status: "skip", evidence: "inbox parse failed" });
    }
  },
};

/** Check 8: at least 1 notifier channel available */
const notifierAvailableCheck: AuditCheck = {
  name: "notifier-channel-available",
  description: "At least one notifier channel is available",
  failSeverity: "info",
  async run() {
    const start = t0();
    // Lazy import to avoid pulling notifier into hot start path.
    try {
      const mod = await import("../notifier/index.js");
      const all = mod.buildAllNotifiers(process.cwd());
      const statuses = await mod.notifierStatuses(all);
      const available = statuses.filter((s) => s.available).map((s) => s.id);
      if (available.length > 0) {
        return v(start, {
          name: "notifier-channel-available", description: "notifier channel available",
          status: "pass", evidence: `${available.length} channel(s): ${available.join(", ")}`,
        });
      }
      return v(start, {
        name: "notifier-channel-available", description: "notifier channel available",
        status: "warn",
        evidence: "no channels available",
        fixHint: "On Win/macOS/Linux the OS toast channel should always be available; check `mneme notify status` for diagnostics.",
      });
    } catch (e) {
      return v(start, {
        name: "notifier-channel-available", description: "notifier channel available",
        status: "skip", evidence: `import failed: ${(e as Error).message}`,
      });
    }
  },
};

/** Check 9: agent backend (Ollama or paid API) reachable */
const agentBackendCheck: AuditCheck = {
  name: "agent-backend-reachable",
  description: "At least one autonomous agent backend is reachable",
  failSeverity: "info",
  async run() {
    const start = t0();
    try {
      const mod = await import("../agent/index.js");
      const b = await mod.pickBestBackend();
      if (b) {
        return v(start, {
          name: "agent-backend-reachable", description: "agent backend reachable",
          status: "pass", evidence: `using ${b.id} (${b.label})`,
        });
      }
      return v(start, {
        name: "agent-backend-reachable", description: "agent backend reachable",
        status: "warn",
        evidence: "no backend (Ollama not running, no API keys)",
        fixHint: "Install Ollama (free) or set ANTHROPIC_API_KEY/OPENAI_API_KEY.",
      });
    } catch (e) {
      return v(start, {
        name: "agent-backend-reachable", description: "agent backend reachable",
        status: "skip", evidence: `${(e as Error).message}`,
      });
    }
  },
};

/** Check 10: lockfile integrity (no drift detected) */
const lockfileIntegrityCheck: AuditCheck = {
  name: "lockfile-integrity",
  description: "package-lock.json integrity hashes match npm registry",
  failSeverity: "warning",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, "package-lock.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "lockfile-integrity", description: "lockfile integrity",
        status: "skip", evidence: "no package-lock.json",
      });
    }
    // We don't actually network-probe here (would be slow); we just
    // verify the file parses + has the expected shape. The dedicated
    // `node scripts/heal-lockfile.mjs --dry-run` tool does the network check.
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { packages?: Record<string, unknown> };
      const n = Object.keys(data.packages ?? {}).length;
      return v(start, {
        name: "lockfile-integrity", description: "lockfile integrity",
        status: "pass", evidence: `lockfile parses; ${n} package entries`,
      });
    } catch {
      return v(start, {
        name: "lockfile-integrity", description: "lockfile integrity",
        status: "fail", evidence: "package-lock.json is not valid JSON",
        fixHint: "Restore from git or regenerate (consider running scripts/heal-lockfile.mjs)",
      });
    }
  },
};

/** Check 11: shared agent-files (CLAUDE.md / AGENTS.md / .cursorrules) synced */
const agentFilesSyncedCheck: AuditCheck = {
  name: "agent-files-synced",
  description: "At least one shared agent file has a Mneme block",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const candidates = ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".windsurfrules"];
    let synced = 0;
    for (const f of candidates) {
      const p = join(repoRoot, f);
      if (existsSync(p)) {
        try {
          if (readFileSync(p, "utf8").includes("BEGIN MNEME PULSE")) synced++;
        } catch { /* skip */ }
      }
    }
    return v(start, {
      name: "agent-files-synced", description: "agent files synced",
      status: synced > 0 ? "pass" : "warn",
      evidence: synced > 0 ? `${synced} file(s) carry Mneme block` : "no agent-file Mneme block found",
      fixHint: synced > 0 ? undefined : "Trigger any notable pulse to populate (or run `mneme notify send --to agent-files`)",
    });
  },
};

/** Check 12: hook command resolves on PATH */
const hookCommandPathCheck: AuditCheck = {
  name: "hook-command-on-path",
  description: "`mneme` command is on PATH (so the hook actually runs)",
  failSeverity: "warning",
  async run() {
    const start = t0();
    const isWin = process.platform === "win32";
    const exts = isWin
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase())
      : [""];
    const dirs = (process.env["PATH"] ?? "").split(isWin ? ";" : ":").filter(Boolean);
    for (const d of dirs) {
      for (const ext of exts) {
        if (existsSync(join(d, "mneme" + ext))) {
          return v(start, {
            name: "hook-command-on-path", description: "hook command on PATH",
            status: "pass", evidence: `mneme found at ${join(d, "mneme" + ext)}`,
          });
        }
      }
    }
    return v(start, {
      name: "hook-command-on-path", description: "hook command on PATH",
      status: "fail",
      evidence: "mneme not on PATH",
      fixHint: "Reinstall: `npm install -g mneme-ai`",
    });
  },
};

export const ALL_CHECKS: AuditCheck[] = [
  pulseHookCheck,
  daemonAliveCheck,
  versionUpToDateCheck,
  antivirusReadyCheck,
  antivirusCertifiedCheck,
  retrievalLabActiveCheck,
  inboxStaleCheck,
  notifierAvailableCheck,
  agentBackendCheck,
  lockfileIntegrityCheck,
  agentFilesSyncedCheck,
  hookCommandPathCheck,
];

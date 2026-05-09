/**
 * Welcome contract — the handoff between Mneme and the AI agent that
 * just installed it.
 *
 * The AI agent calls `mneme.welcome` after `mneme mcp --install`. The
 * response carries:
 *   - what was auto-enabled (Lineage / ALETHEIA / replay / etc.)
 *   - per-feature opt-out commands
 *   - a user-message TEMPLATE the agent translates to user's language
 *   - explicit instruction to ALWAYS surface opt-outs
 *
 * Non-TTY detection: when running under an AI-driven install (stdin not
 * a TTY, or env var set), Mneme skips the interactive TOFU prompt and
 * applies safe defaults silently — the welcome tool is the audit trail.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lineageRoot, settingsPath } from "./paths.js";
import { detectGitOrigin } from "./spore.js";
import { readCachedVersionCheck, type VersionCheckResult } from "../version_check.js";
import type { LineageSettings } from "./types.js";

export interface WelcomePayload {
  freshInstall: boolean;
  /** Mneme version this install activated. Bumped each release. */
  version: string;
  /** Tools added or changed since the agent's last seen catalog hash. */
  newSinceLastSession: string[];
  /** Per-feature default + opt-out summary. */
  autoEnabled: Record<string, FeatureDefaults>;
  /** User-facing message template. Agent translates to user's language. */
  userMessageTemplate: string;
  /** Imperative instruction the agent must follow. */
  agentInstruction: string;
  /** Suggested next tool calls the agent should make. */
  nextActions: string[];
  /** Lineage-specific status snapshot. */
  lineage: {
    optedOut: boolean;
    encryptionEnabled: boolean;
    piiScrubEnabled: boolean;
    sporeAutoDetectedRemote: string | null;
  };
  /** Auto-update status — null when no check has run yet, or when offline. */
  updateAvailable: VersionCheckResult | null;
}

export interface FeatureDefaults {
  enabled: boolean;
  defaultsApplied: string[];
  optOutCommands: Record<string, string>;
  userShouldKnow: string[];
}

const DEFAULT_SETTINGS: LineageSettings = {
  tofuAnswered: false,
  optedOut: false,
  encryptionEnabled: false, // v1.19 ships unencrypted at rest; v1.20 adds AES-256-GCM
  piiScrubEnabled: true,
  lastWelcomeShown: null,
};

export function readSettings(repoRoot: string): LineageSettings {
  const path = settingsPath(repoRoot);
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(repoRoot: string, s: LineageSettings): void {
  const dir = lineageRoot(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(repoRoot), JSON.stringify(s, null, 2), "utf8");
}

/** Toggle lineage on/off (Mode 2: user / agent explicit command). */
export function setLineageOptedOut(repoRoot: string, optedOut: boolean): LineageSettings {
  const s = readSettings(repoRoot);
  s.optedOut = optedOut;
  writeSettings(repoRoot, s);
  return s;
}

/** Detect whether the install is being driven by an AI agent (non-TTY)
 *  vs an interactive human at a terminal. Used to choose between
 *  silent-defaults flow and TOFU-prompt flow. */
export function isNonTtyInstall(): boolean {
  if (process.env["MNEME_NON_INTERACTIVE"] === "1") return true;
  // process.stdin.isTTY is undefined when piped — treat as non-TTY.
  return !process.stdin.isTTY;
}

/** Build the welcome payload for the agent handoff. */
export function buildWelcome(repoRoot: string, version: string): WelcomePayload {
  const settings = readSettings(repoRoot);
  const freshInstall = !settings.tofuAnswered;
  const sporeRemote = detectGitOrigin(repoRoot);

  const lineageDefaults: FeatureDefaults = {
    enabled: !settings.optedOut,
    defaultsApplied: [
      "Auto-crystallize on session end + idle (45 min) + context pressure",
      `Spore remote: ${sporeRemote ? `auto-detected git origin (${sporeRemote}, branch mneme-lineage)` : "local-only (no git origin detected)"}`,
      `PII scrub: ${settings.piiScrubEnabled ? "on" : "off"}`,
      "Mendelian inheritance from up to 3 most-recent ancestors at boot",
    ],
    optOutCommands: {
      "disable lineage entirely": "mneme lineage off",
      "change spore remote": "mneme spore init --remote <git-url>",
      "purge all lineage data": "mneme lineage purge --confirm",
      "view current state": "mneme lineage status",
    },
    userShouldKnow: [
      "Every AI session auto-saves into a chromosome (~50-500KB) on exit/idle",
      sporeRemote ? `Cross-machine sync via the 'mneme-lineage' orphan branch on ${sporeRemote}` : "No remote — chromosomes stay local until you set one with `mneme spore init`",
      "Identity keypair lives in .mneme/lineage/identity/ and is .gitignored (never pushed)",
      "Pull lineage on a new machine with `mneme spore pull` — ALL prior context inherits via Mendelian merge",
    ],
  };

  // ALETHEIA (v1.18) defaults — surfaced for cross-feature transparency.
  const aletheiaDefaults: FeatureDefaults = {
    enabled: true,
    defaultsApplied: [
      "Immune profile records every tool call shape (Bayesian anomaly detection)",
      "Karma ledger updates on every confess outcome",
      "Honeypot tools registered with [HONEYPOT] prefix",
    ],
    optOutCommands: {
      "view alerts": "mneme.aletheia.immune.alerts",
      "view tool karma": "mneme.aletheia.karma",
    },
    userShouldKnow: [
      "Five honeypot tools (mneme.admin.delete_all, etc.) are decoys — calling them logs an attack probe",
      "Argument shapes are profiled to detect novel/anomalous calls",
    ],
  };

  // Replay (v1.18) defaults.
  const replayDefaults: FeatureDefaults = {
    enabled: true,
    defaultsApplied: [
      "Every MCP call appends one HMAC-chained line to .mneme/replay.jsonl",
      "Identity HMAC secret in .mneme/replay-secret.bin (mode 0600, never pushed)",
    ],
    optOutCommands: {
      "view trace": "mneme.replay.dump",
      "verify integrity": "mneme.replay.fingerprint",
    },
    userShouldKnow: [
      "SOC2/EU AI Act audit-grade evidence — Merkle root verifiable any time",
    ],
  };

  // v1.19.2 — surface auto-update status in the user-facing message so
  // the agent knows to mention "by the way, v1.20 is out" without polling.
  const updateStatus = readCachedVersionCheck(repoRoot, version);
  const updateBlurb = updateStatus?.updateAvailable
    ? ` 📢 Mneme v${updateStatus.latest} is available (you're on ${version}) — say 'upgrade Mneme' and I'll handle it.`
    : "";

  const userMessageTemplate = freshInstall
    ? `I just installed Mneme v${version} — it now auto-saves AI session inheritance ('Lineage'), so when you switch machines or tools, my context follows you. ${sporeRemote ? `Sync uses the 'mneme-lineage' orphan branch on ${sporeRemote}.` : "I detected no git remote, so chromosomes stay local for now — paste a private repo URL anytime to enable cross-machine sync."} Say 'disable lineage' if you don't want this. Full opt-outs in the welcome contract.${updateBlurb}`
    : `Mneme v${version} active. Lineage ${settings.optedOut ? "is OFF" : "is auto-saving"}. ${sporeRemote ? `Spore syncing via ${sporeRemote}.` : "No remote configured."}${updateBlurb}`;

  const agentInstruction =
    "Translate userMessageTemplate to the user's language and tone. ALWAYS mention that Lineage is on (or off) + the opt-out command. Then call mneme.capabilities to learn the full catalog. Treat opt-outs as a contract — surface them at install AND when the user asks 'what data are you collecting?'.";

  const nextActions = [
    "mneme.capabilities",
    "mneme.lineage.status",
    sporeRemote ? "mneme.spore.status" : "mneme.spore.init",
  ].filter(Boolean) as string[];

  return {
    freshInstall,
    version,
    newSinceLastSession: [],
    autoEnabled: {
      lineage: lineageDefaults,
      aletheia: aletheiaDefaults,
      replay: replayDefaults,
    },
    userMessageTemplate,
    agentInstruction,
    nextActions,
    lineage: {
      optedOut: settings.optedOut,
      encryptionEnabled: settings.encryptionEnabled,
      piiScrubEnabled: settings.piiScrubEnabled,
      sporeAutoDetectedRemote: sporeRemote,
    },
    updateAvailable: updateStatus,
  };
}

/** Mark welcome as shown — clears the freshInstall flag for next call. */
export function markWelcomeShown(repoRoot: string, version: string): void {
  const s = readSettings(repoRoot);
  s.tofuAnswered = true;
  s.lastWelcomeShown = version;
  writeSettings(repoRoot, s);
}

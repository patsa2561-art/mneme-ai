/**
 * Claude Code adapter -- the ONLY agent today with a real shell-execute
 * hook surface (UserPromptSubmit + PreToolUse + ...).
 *
 * Schema (per code.claude.com/docs/en/hooks):
 *
 *   {
 *     "hooks": {
 *       "UserPromptSubmit": [
 *         { "hooks": [{ "type": "command", "command": "..." }] }
 *       ]
 *     }
 *   }
 *
 * NOT the string-shorthand `"UserPromptSubmit": "cmd"` we shipped in
 * v1.25.2 -- that form is silently ignored by Claude Code.
 *
 * This adapter:
 *   - writes the correct array-of-objects schema
 *   - auto-detects + repairs the v1.25.2 broken string format
 *   - refuses to clobber a foreign hook command unless --force
 *   - is fully idempotent (re-running the install is a no-op when
 *     already correct)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  IntegrationAdapter, DetectResult, InstallResult, UninstallResult, StatusResult,
} from "./types.js";
import { PULSE_COMMAND } from "./types.js";

const HOOK_KEY = "UserPromptSubmit";

interface HookCommandEntry { type: "command"; command: string; timeout?: number }
interface HookGroup { matcher?: string; hooks: HookCommandEntry[] }
type HookEntry = string | HookCommandEntry | HookGroup;

interface ClaudeSettings {
  hooks?: Record<string, HookEntry | HookEntry[]>;
  [key: string]: unknown;
}

function settingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function readSettings(): { exists: boolean; data: ClaudeSettings; corrupt?: boolean } {
  const path = settingsPath();
  if (!existsSync(path)) return { exists: false, data: {} };
  try {
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) return { exists: true, data: {} };
    const data = JSON.parse(raw) as ClaudeSettings;
    return { exists: true, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { exists: true, data: {}, corrupt: true };
  }
}

function writeSettings(data: ClaudeSettings): void {
  const path = settingsPath();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Walk a hook value (which may be a string, a single object, or an
 * array of groups) and pull out every command string we can find.
 * Returns the list of distinct commands present.
 */
export function extractCommands(entry: HookEntry | HookEntry[] | undefined): string[] {
  if (entry == null) return [];
  const out: string[] = [];
  const visit = (e: HookEntry): void => {
    if (typeof e === "string") {
      out.push(e);
      return;
    }
    if (e && typeof e === "object") {
      const g = e as HookGroup & HookCommandEntry;
      if (typeof g.command === "string") {
        out.push(g.command);
      }
      if (Array.isArray(g.hooks)) {
        for (const h of g.hooks) {
          if (h && typeof h === "object" && typeof h.command === "string") out.push(h.command);
        }
      }
    }
  };
  if (Array.isArray(entry)) for (const e of entry) visit(e);
  else visit(entry);
  return out;
}

/**
 * Build the canonical Claude Code hook group for the Mneme pulse.
 * UserPromptSubmit has no matcher per docs.
 */
function buildPulseGroup(): HookGroup {
  return { hooks: [{ type: "command", command: PULSE_COMMAND }] };
}

/**
 * Inspect existing UserPromptSubmit value and return one of:
 *   - "absent"           -- key not set
 *   - "ok-array"         -- already in correct array form, contains pulse
 *   - "ok-other-array"   -- correct array form but holds a different cmd
 *   - "drift-string"     -- old v1.25.2 string shorthand (broken on CC)
 *   - "drift-object"     -- single object (also rejected by CC schema)
 *   - "mixed"            -- array but contains both pulse and others
 */
function classifyExisting(entry: HookEntry | HookEntry[] | undefined): {
  shape: "absent" | "ok-array" | "ok-other-array" | "drift-string" | "drift-object" | "mixed";
  containsPulse: boolean;
  others: string[];
} {
  if (entry == null) return { shape: "absent", containsPulse: false, others: [] };
  const cmds = extractCommands(entry);
  const containsPulse = cmds.includes(PULSE_COMMAND);
  const others = cmds.filter((c) => c !== PULSE_COMMAND);

  if (typeof entry === "string") return { shape: "drift-string", containsPulse, others };
  if (Array.isArray(entry)) {
    if (containsPulse && others.length === 0) return { shape: "ok-array", containsPulse, others };
    if (containsPulse && others.length > 0) return { shape: "mixed", containsPulse, others };
    return { shape: "ok-other-array", containsPulse, others };
  }
  // single object
  return { shape: "drift-object", containsPulse, others };
}

export const claudeCodeAdapter: IntegrationAdapter = {
  id: "claude-code",
  label: "Claude Code",
  scope: "user",

  async detect(): Promise<DetectResult> {
    const dir = join(homedir(), ".claude");
    if (existsSync(dir)) {
      return { present: true, reason: `~/.claude exists`, configPath: settingsPath() };
    }
    return { present: false, reason: `~/.claude not found`, configPath: settingsPath() };
  },

  async install(_repoRoot: string, opts: { force?: boolean } = {}): Promise<InstallResult> {
    const r = readSettings();
    if (r.corrupt) {
      return {
        ok: false, status: "error", mode: "hook", path: settingsPath(),
        message: `${settingsPath()} is not valid JSON.`,
        fix: "Fix the JSON file by hand (or move it aside), then re-run.",
      };
    }
    const data: ClaudeSettings = r.data;
    data.hooks = data.hooks ?? {};
    const cls = classifyExisting(data.hooks[HOOK_KEY]);

    // Already correct -- no-op.
    if (cls.shape === "ok-array" && cls.containsPulse && cls.others.length === 0) {
      return {
        ok: true, status: "already-installed", mode: "hook", path: settingsPath(),
        message: `Mneme pulse hook already installed (correct array schema).`,
      };
    }

    // v1.25.2 broken string shorthand -- silent auto-repair (this is OUR bug,
    // we don't ask permission to fix our own broken config).
    if (cls.shape === "drift-string" && cls.containsPulse) {
      data.hooks[HOOK_KEY] = [buildPulseGroup()];
      writeSettings(data);
      return {
        ok: true, status: "repaired", mode: "hook", path: settingsPath(),
        message: `Repaired v1.25.2 broken string-shorthand to correct array schema.`,
      };
    }

    // Single object form -- also rejected by CC; treat like drift, repair.
    if (cls.shape === "drift-object" && cls.containsPulse) {
      data.hooks[HOOK_KEY] = [buildPulseGroup()];
      writeSettings(data);
      return {
        ok: true, status: "repaired", mode: "hook", path: settingsPath(),
        message: `Repaired single-object schema to correct array schema.`,
      };
    }

    // Foreign hook present (string OR array of others) -- refuse without --force.
    if ((cls.shape === "drift-string" || cls.shape === "ok-other-array") && !cls.containsPulse) {
      if (!opts.force) {
        return {
          ok: false, status: "refused", mode: "hook", path: settingsPath(),
          message: `${HOOK_KEY} is already wired to: ${cls.others.join(", ") || "(unknown)"}`,
          fix: "Re-run with --force to merge Mneme alongside, or edit by hand.",
        };
      }
      // Force: merge alongside the foreign hook. Convert string to array first.
      const merged: HookGroup[] = [
        ...cls.others.map((c) => ({ hooks: [{ type: "command" as const, command: c }] })),
        buildPulseGroup(),
      ];
      data.hooks[HOOK_KEY] = merged;
      writeSettings(data);
      return {
        ok: true, status: "installed", mode: "hook", path: settingsPath(),
        message: `Installed Mneme pulse alongside existing hook(s) (--force).`,
      };
    }

    // Mixed: pulse + others already in array form -- consider it installed.
    if (cls.shape === "mixed" && cls.containsPulse) {
      return {
        ok: true, status: "already-installed", mode: "hook", path: settingsPath(),
        message: `Mneme pulse already present alongside other hook(s).`,
      };
    }

    // Absent: clean install.
    data.hooks[HOOK_KEY] = [buildPulseGroup()];
    writeSettings(data);
    return {
      ok: true, status: "installed", mode: "hook", path: settingsPath(),
      message: `Installed Mneme pulse hook (correct array schema).`,
    };
  },

  async uninstall(): Promise<UninstallResult> {
    const r = readSettings();
    if (!r.exists) {
      return { ok: true, status: "not-installed", message: `no settings file at ${settingsPath()}` };
    }
    if (r.corrupt) {
      return { ok: false, status: "error", path: settingsPath(), message: `settings.json is corrupt; fix by hand` };
    }
    const data = r.data;
    if (!data.hooks || !data.hooks[HOOK_KEY]) {
      return { ok: true, status: "not-installed", path: settingsPath(), message: `no ${HOOK_KEY} hook present` };
    }
    const cls = classifyExisting(data.hooks[HOOK_KEY]);
    if (!cls.containsPulse) {
      return { ok: true, status: "not-installed", path: settingsPath(), message: `${HOOK_KEY} not wired to Mneme` };
    }
    if (cls.others.length === 0) {
      // Pulse was the only entry -- remove the whole key.
      delete data.hooks[HOOK_KEY];
    } else {
      // Preserve foreign hooks, drop only Mneme's.
      const kept: HookGroup[] = cls.others.map((c) => ({ hooks: [{ type: "command", command: c }] }));
      data.hooks[HOOK_KEY] = kept;
    }
    writeSettings(data);
    return { ok: true, status: "removed", path: settingsPath(), message: `removed Mneme pulse hook` };
  },

  async status(): Promise<StatusResult> {
    const r = readSettings();
    if (!r.exists) {
      return {
        installed: false, state: "no-config", mode: "hook",
        path: settingsPath(),
        details: `~/.claude/settings.json does not exist`,
      };
    }
    if (r.corrupt) {
      return {
        installed: false, state: "drift", mode: "hook",
        path: settingsPath(),
        details: `settings.json is not valid JSON`,
        canRepair: false,
      };
    }
    const cls = classifyExisting(r.data.hooks?.[HOOK_KEY]);
    if (cls.shape === "absent") {
      return {
        installed: false, state: "absent", mode: "hook",
        path: settingsPath(),
        details: `no ${HOOK_KEY} hook configured`,
      };
    }
    if ((cls.shape === "drift-string" || cls.shape === "drift-object") && cls.containsPulse) {
      return {
        installed: true, state: "drift", mode: "hook",
        path: settingsPath(),
        details: `Mneme pulse wired with broken ${cls.shape} schema (v1.25.2 bug); repair pending`,
        canRepair: true,
      };
    }
    if (cls.containsPulse) {
      return {
        installed: true, state: "ok", mode: "hook",
        path: settingsPath(),
        details: cls.others.length > 0
          ? `Mneme pulse + ${cls.others.length} other hook(s)`
          : `Mneme pulse hook installed (array schema)`,
      };
    }
    return {
      installed: false, state: "absent", mode: "hook",
      path: settingsPath(),
      details: `${HOOK_KEY} hook present but not Mneme: ${cls.others.join(", ")}`,
    };
  },
};

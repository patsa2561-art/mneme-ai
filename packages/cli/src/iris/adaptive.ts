/**
 * Iris — adaptive verbosity per user history.
 *
 * Goal: first-time users of `mneme forensics` see the verbose "how to read"
 * guide.  After they've run it 5+ times, we trust they know — collapse the
 * guide to a one-liner.
 *
 * State lives in `<repoRoot>/.mneme/iris-state.json` (sibling to session.json).
 * Atomic writes via temp-file rename.
 *
 * Pure-ish: state is read/written through a small, file-only API.  All policy
 * decisions (`shouldShowVerboseGuide`, etc.) are pure functions of the state.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface IrisState {
  /** Command name → run count. */
  commandsRun: Record<string, number>;
  /** Toggled true after 5+ uses of any one command. */
  preferTerse: boolean;
  /** Command → ISO timestamp of most recent run. */
  lastSeen: Record<string, string>;
}

/** Threshold above which we start showing the terse output. */
export const VERBOSE_GUIDE_THRESHOLD = 5;

function statePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "iris-state.json");
}

function emptyState(): IrisState {
  return { commandsRun: {}, preferTerse: false, lastSeen: {} };
}

/** Read state — returns a clean default if missing or corrupt. */
export function readIrisState(repoRoot: string): IrisState {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return emptyState();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return emptyState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== "object") return emptyState();
  const s = parsed as Partial<IrisState>;

  const commandsRun: Record<string, number> = {};
  if (s.commandsRun && typeof s.commandsRun === "object") {
    for (const [k, v] of Object.entries(s.commandsRun)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) commandsRun[k] = v;
    }
  }
  const lastSeen: Record<string, string> = {};
  if (s.lastSeen && typeof s.lastSeen === "object") {
    for (const [k, v] of Object.entries(s.lastSeen)) {
      if (typeof v === "string") lastSeen[k] = v;
    }
  }
  return {
    commandsRun,
    preferTerse: typeof s.preferTerse === "boolean" ? s.preferTerse : false,
    lastSeen,
  };
}

function atomicWrite(path: string, contents: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Persist state atomically. */
export function writeIrisState(repoRoot: string, state: IrisState): void {
  atomicWrite(statePath(repoRoot), JSON.stringify(state, null, 2));
}

/** Increment the run-count for a command and persist.  Best-effort. */
export function recordCommandRun(repoRoot: string, command: string): void {
  const state = readIrisState(repoRoot);
  state.commandsRun[command] = (state.commandsRun[command] ?? 0) + 1;
  state.lastSeen[command] = new Date().toISOString();
  // Once any command has hit threshold, mark this user as a "power user".
  for (const n of Object.values(state.commandsRun)) {
    if (n >= VERBOSE_GUIDE_THRESHOLD) {
      state.preferTerse = true;
      break;
    }
  }
  writeIrisState(repoRoot, state);
}

/**
 * Should we show the verbose how-to-read guide for this command?
 *
 * True when the user has run the command fewer than 5 times.  We do NOT
 * gate on `preferTerse` for the per-command decision — preferTerse only
 * influences shared chrome (banners, footers).
 */
export function shouldShowVerboseGuide(state: IrisState, command: string): boolean {
  const count = state.commandsRun[command] ?? 0;
  return count < VERBOSE_GUIDE_THRESHOLD;
}

/** Reset state — used by tests and `mneme reset-iris`. */
export function clearIrisState(repoRoot: string): void {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return;
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
}

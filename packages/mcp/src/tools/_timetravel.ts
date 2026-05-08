/**
 * Time-travel MCP (v1.18.0 — black sheep #2)
 *
 * Snap the AI agent's view of the repo to a specific git ref. Every
 * subsequent tool call (within the same MCP server process) operates
 * AS IF today were that ref. State is per-server-process, so two AI
 * sessions connecting to the same repo via separate MCP processes
 * don't collide.
 *
 *   • mneme.timetravel.activate(ref)   — freeze the view at this ref
 *   • mneme.timetravel.status          — query current state
 *   • mneme.timetravel.deactivate      — return to live HEAD
 *
 * v1.18.0 ships the SCAFFOLDING — a per-process state holder + the
 * three tools above. Existing tools that want to honor time-travel
 * read `getTimeTravelState()` from this module and clamp their git
 * commands to `--until <commitDate>` or `<ref>` accordingly. The
 * gradual-rollout pattern: tools opt in over time without a big-bang
 * refactor.
 *
 * Use cases:
 *   • Counterfactual analysis: "If I were on duty Sept 2024, what
 *     would I have seen?" — recreate incident-response state.
 *   • Hindsight-bias audit: "Did the AI's recommendation REALLY hold
 *     up at the time?" — replay decisions against frozen context.
 *   • Onboarding rehearsal: walk a new engineer through the repo at
 *     the moment they would have joined.
 */

import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

interface TimeTravelState {
  active: boolean;
  ref: string | null;
  resolvedHash: string | null;
  resolvedDate: string | null;
  activatedAt: string | null;
}

/** Per-process state. MCP server runs one process per AI client session,
 *  so this naturally scopes to that session. */
let state: TimeTravelState = {
  active: false,
  ref: null,
  resolvedHash: null,
  resolvedDate: null,
  activatedAt: null,
};

/** Read current time-travel state — exported for tools that opt in. */
export function getTimeTravelState(): Readonly<TimeTravelState> {
  return state;
}

/** Reset to live HEAD. Exported for tests. */
export function resetTimeTravel(): void {
  state = { active: false, ref: null, resolvedHash: null, resolvedDate: null, activatedAt: null };
}

interface ResolvedRef {
  hash: string;
  date: string; // ISO date
  subject: string;
}

function resolveRef(repoRoot: string, ref: string): ResolvedRef | { error: string } {
  // Validate against shell metacharacters before spawning.
  if (!/^[a-zA-Z0-9._\-/^~@]+$/.test(ref)) {
    return { error: `invalid ref shape: ${ref}` };
  }
  const r = spawnSync("git", ["log", "-1", "--pretty=format:%H|%cI|%s", ref], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { error: `git could not resolve '${ref}': ${(r.stderr ?? "").trim().slice(0, 200)}` };
  }
  const out = (r.stdout ?? "").trim();
  if (!out) return { error: `ref '${ref}' resolved to empty result` };
  const [hash, date, ...rest] = out.split("|");
  if (!hash || !date) return { error: `unparseable git output for '${ref}'` };
  return { hash, date, subject: rest.join("|") };
}

export const timeTravelActivateTool: MnemeTool = {
  name: "mneme.timetravel.activate",
  category: "meta",
  description:
    "Freeze the AI agent's view of the repo at a specific git ref (commit hash, " +
    "tag, branch, or relative ref like 'HEAD~50'). Every subsequent Mneme tool " +
    "call within this MCP session operates AS IF today were that ref. Use WHEN " +
    "you want to (a) recreate an incident-response state at a past moment, " +
    "(b) audit hindsight bias by replaying decisions against frozen context, " +
    "or (c) walk through the repo as a new engineer would have seen it on day one.",
  whenToUse:
    "You want every subsequent Mneme call to operate AS IF today were a specific past commit — counterfactual / hindsight analysis.",
  triggers: [
    "freeze view at this commit",
    "time travel to ref",
    "what would I see at HEAD~50",
  ],
  inputSchema: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "Git ref to freeze at — commit hash, tag, branch, or relative (e.g. 'HEAD~50', 'v1.5.0', 'a3f9b21').",
      },
    },
    required: ["ref"],
  },
  outputSchema: {
    type: "object",
    properties: {
      active: { type: "boolean" },
      ref: { type: "string" },
      resolvedHash: { type: "string" },
      resolvedDate: { type: "string" },
      subject: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Show me what the repo looked like at v1.5.0",
      args: { ref: "v1.5.0" },
      expectedOutput: "{ active: true, ref: 'v1.5.0', resolvedHash, resolvedDate, subject }. Subsequent tool calls that opt-in operate against this frozen ref.",
    },
    {
      userQuery: "Recreate September 2024 — go back 200 commits",
      args: { ref: "HEAD~200" },
      expectedOutput: "Same shape — the resolvedDate tells you what calendar date HEAD~200 lands on.",
    },
  ],
  pitfalls: [
    "v1.18.0 ships the scaffolding — most tools DON'T yet honor the frozen ref. They'll silently use HEAD until each tool opts in over the v1.18 → v1.19 window.",
    "State is per-MCP-process — restarting the server resets to live HEAD. Don't depend on persistence across server restarts.",
    "Refs that don't resolve (deleted branches, typos, hashes from another repo) return an error and DO NOT activate.",
  ],
  composeWith: ["mneme.timetravel.status", "mneme.timetravel.deactivate"],
  handler: async (rt, args) => {
    const ref = String(args["ref"] ?? "").trim();
    if (!ref) {
      return {
        data: { error: "missing required argument: ref" },
        wisdom: "Pass a git ref — commit hash, tag, branch, or 'HEAD~N'.",
        confidence: { level: "high" },
      };
    }
    const resolved = resolveRef(rt.meta.rootPath, ref);
    if ("error" in resolved) {
      return {
        data: { active: false, error: resolved.error },
        wisdom: `Could not activate time-travel — ${resolved.error}`,
        confidence: { level: "high" },
      };
    }
    state = {
      active: true,
      ref,
      resolvedHash: resolved.hash,
      resolvedDate: resolved.date.slice(0, 10),
      activatedAt: new Date().toISOString(),
    };
    return {
      data: {
        active: true,
        ref,
        resolvedHash: resolved.hash,
        resolvedDate: resolved.date.slice(0, 10),
        subject: resolved.subject,
      },
      wisdom:
        `Time-travel active — view frozen at ${ref} (${resolved.hash.slice(0, 7)}, ${resolved.date.slice(0, 10)}). ` +
        `Subsequent tool calls in this session that have opted in will operate as-of this ref. ` +
        `Call mneme.timetravel.deactivate to return to live HEAD.`,
      followUp: ["mneme.memory.ask", "mneme.timetravel.status", "mneme.timetravel.deactivate"],
      confidence: { level: "high" },
    };
  },
};

export const timeTravelStatusTool: MnemeTool = {
  name: "mneme.timetravel.status",
  category: "meta",
  description:
    "Report whether time-travel is currently active in this MCP session and, if so, " +
    "which ref + commit + date the view is frozen at. Use WHEN you want to verify " +
    "the agent isn't accidentally querying historical state when it expects live HEAD.",
  whenToUse:
    "You want to check whether the current MCP session has time-travel activated and what ref it's frozen at.",
  triggers: ["am I time-traveling", "time travel status", "what ref am I on"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      active: { type: "boolean" },
      ref: { type: "string" },
      resolvedHash: { type: "string" },
      resolvedDate: { type: "string" },
      activatedAt: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Am I currently time-traveling?",
      expectedOutput: "Returns { active: false } when not active, or the full state record when active.",
    },
  ],
  pitfalls: [
    "State is per-MCP-process. If you restart the MCP server, this returns active=false even if a previous session activated time-travel.",
  ],
  composeWith: ["mneme.timetravel.activate", "mneme.timetravel.deactivate"],
  handler: async () => {
    return {
      data: state,
      wisdom: state.active
        ? `Time-travel ACTIVE — frozen at ${state.ref} (${state.resolvedHash?.slice(0, 7)}, ${state.resolvedDate}).`
        : "Time-travel INACTIVE — operating on live HEAD.",
      confidence: { level: "high" },
    };
  },
};

export const timeTravelDeactivateTool: MnemeTool = {
  name: "mneme.timetravel.deactivate",
  category: "meta",
  description:
    "Return the AI agent's view to live HEAD — undoes a previous mneme.timetravel.activate. " +
    "Idempotent (safe to call when not currently active). Use WHEN you've finished " +
    "a counterfactual / hindsight session and want subsequent calls to see today's state.",
  whenToUse: "You finished time-traveling and want subsequent tool calls to see live HEAD again.",
  triggers: ["return to head", "stop time travel", "deactivate time travel"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      previouslyActive: { type: "boolean" },
      previousRef: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "Return to live HEAD",
      expectedOutput: "{ previouslyActive: true|false, previousRef }. Idempotent — safe even when not active.",
    },
  ],
  pitfalls: [
    "Doesn't unwind any side effects from time-traveled tools — only resets the time-travel marker.",
  ],
  composeWith: ["mneme.timetravel.activate", "mneme.timetravel.status"],
  handler: async () => {
    const prev = { previouslyActive: state.active, previousRef: state.ref };
    resetTimeTravel();
    return {
      data: prev,
      wisdom: prev.previouslyActive
        ? `Returned to live HEAD (was at ${prev.previousRef}).`
        : "Was already on live HEAD — no change.",
      confidence: { level: "high" },
    };
  },
};

export const timeTravelTools: MnemeTool[] = [
  timeTravelActivateTool,
  timeTravelStatusTool,
  timeTravelDeactivateTool,
];

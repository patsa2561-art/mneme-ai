/**
 * v2.60.0 — SKELETON KEY capability probe.
 *
 * Dark-magic angle (parallel to AUTOPROBE for CLI tools): instead of
 * guessing a server's risk from its NAME ("filesystem-mcp" → assume
 * write-fs), we EMPIRICALLY spawn the server in a JSON-RPC handshake
 * and ask it for its tools/list. Then we KNOW which tools it exposes,
 * and we can promote the heuristic capabilities to the actual ones.
 *
 * Hand-written rules can be out of date or guess wrong; an empirical
 * tools/list cannot — it's what the server actually serves.
 *
 * Safety contract:
 *   - We only call `initialize` + `tools/list` (read-only JSON-RPC).
 *   - We never `tools/call` from inside the probe.
 *   - 5s timeout; force-kill on hang.
 *   - All spawns happen in a child process; failures are caught.
 */

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface ProbeInput {
  /** Server name (used for logging). */
  name: string;
  /** Command to execute (e.g. "node", "mneme", "uvx"). */
  command: string;
  /** Args to pass (e.g. ["server.js"], ["mcp"]). */
  args?: string[];
  /** Env vars to inject. */
  env?: Record<string, string>;
  /** Per-probe timeout ms (default 8000). */
  timeoutMs?: number;
}

export interface ProbedTool {
  /** Tool name as the server returned it. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Capability tags we INFER from the tool name + description. */
  inferredCapabilities: string[];
}

export interface ProbeResult {
  name: string;
  /** True if we got a tools/list response. */
  reachable: boolean;
  tools: ProbedTool[];
  /** All distinct capabilities inferred across the tools. */
  capabilities: string[];
  /** Latency to first tools/list response. */
  latencyMs: number;
  /** Brief failure reason when reachable=false. */
  reason?: string;
}

// Tool-name → capability tags. Conservative: when in doubt, flag the cap.
const TOOL_NAME_CAPABILITY_HINTS: Array<{ rx: RegExp; caps: string[] }> = [
  { rx: /\b(exec|spawn|shell|bash|cmd|command|process)/i, caps: ["exec"] },
  { rx: /\b(read[_-]?file|cat|stat|ls|find|search[_-]?file)/i, caps: ["read_fs"] },
  { rx: /\b(write[_-]?file|create[_-]?file|delete|rm|unlink|mkdir|move|rename|edit[_-]?file|patch)/i, caps: ["write_fs"] },
  { rx: /\b(fetch|http|request|get_url|post|put)/i, caps: ["network"] },
  { rx: /\b(query|select|insert|update|delete|drop|alter|create[_-]?table)/i, caps: ["db_read", "db_write"] },
  { rx: /\b(drop[_-]?(table|database)|truncate)/i, caps: ["db_ddl"] },
  { rx: /\b(git[_-]?(push|commit|tag|reset|merge)|create[_-]?(repo|branch|pr|pull[_-]?request))/i, caps: ["git_write"] },
  { rx: /\b(apply|create|delete|patch)[_-]?(deployment|pod|service|configmap|secret|namespace)/i, caps: ["cluster_mutate"] },
  { rx: /\b(start[_-]?instance|terminate|create[_-]?bucket|delete[_-]?bucket|put[_-]?object)/i, caps: ["cloud_mutate"] },
  { rx: /\b(navigate|click|screenshot|page[_-]?(open|close))/i, caps: ["browser_automation", "network"] },
];

function inferCapabilities(toolName: string, description?: string): string[] {
  const blob = `${toolName} ${description ?? ""}`.toLowerCase();
  const caps = new Set<string>();
  for (const hint of TOOL_NAME_CAPABILITY_HINTS) {
    if (hint.rx.test(blob)) hint.caps.forEach((c) => caps.add(c));
  }
  return Array.from(caps);
}

/**
 * Probe a single MCP server via JSON-RPC over stdio.
 * Sends `initialize` + `tools/list` then exits.
 *
 * NEVER throws — returns reachable:false with reason on any failure.
 */
export async function probeServer(input: ProbeInput): Promise<ProbeResult> {
  const t0 = performance.now();
  const timeoutMs = input.timeoutMs ?? 8000;
  return new Promise<ProbeResult>((resolve) => {
    let done = false;
    const finalize = (r: Omit<ProbeResult, "name" | "latencyMs">) => {
      if (done) return;
      done = true;
      resolve({ name: input.name, latencyMs: +(performance.now() - t0).toFixed(2), ...r });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(input.command, input.args ?? [], {
        env: { ...process.env, ...(input.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      finalize({ reachable: false, tools: [], capabilities: [], reason: `spawn failed: ${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finalize({ reachable: false, tools: [], capabilities: [], reason: `timeout (${timeoutMs}ms)` });
    }, timeoutMs);

    let stdoutBuf = "";
    let initialized = false;

    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            initialized = true;
            // Send tools/list
            child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
          } else if (msg.id === 2 && msg.result) {
            const rawTools = (msg.result.tools ?? []) as Array<{ name?: string; description?: string }>;
            const tools: ProbedTool[] = rawTools.filter((t) => typeof t.name === "string").map((t) => ({
              name: t.name!,
              description: t.description,
              inferredCapabilities: inferCapabilities(t.name!, t.description),
            }));
            const capSet = new Set<string>();
            for (const t of tools) for (const c of t.inferredCapabilities) capSet.add(c);
            clearTimeout(timer);
            try { child.kill(); } catch { /* noop */ }
            finalize({ reachable: true, tools, capabilities: Array.from(capSet) });
          }
        } catch {
          // Non-JSON line (server stderr leaking) — ignore.
        }
      }
    });

    child.stderr!.on("data", () => { /* discard */ });
    child.on("error", (e) => {
      clearTimeout(timer);
      finalize({ reachable: false, tools: [], capabilities: [], reason: `child error: ${e.message}` });
    });
    child.on("exit", () => {
      if (!initialized) {
        clearTimeout(timer);
        finalize({ reachable: false, tools: [], capabilities: [], reason: "server exited before responding" });
      }
    });

    // Send initialize after the child is up.
    try {
      child.stdin!.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mneme-skeleton-key", version: "1.0.0" },
        },
      }) + "\n");
    } catch (e) {
      clearTimeout(timer);
      finalize({ reachable: false, tools: [], capabilities: [], reason: `init write failed: ${(e as Error).message}` });
    }
  });
}

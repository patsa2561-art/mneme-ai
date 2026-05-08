/**
 * MCP runtime — built once at server start, reused for every tool call.
 *
 * The previous monolithic index.ts opened the store + embedder inline.
 * Extracting it lets every tool file import {ToolRuntime} cleanly without
 * each one re-instantiating the database connection.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { git, store } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";
import type { ToolRuntime } from "./_types.js";

export async function buildRuntime(cwd: string): Promise<ToolRuntime> {
  if (!(await git.isGitRepo(cwd))) {
    throw new Error(`Mneme MCP: not in a git repo (${cwd}).`);
  }
  const meta = await git.getRepoMeta(cwd);
  const dbDir = join(meta.rootPath, ".mneme");
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "mneme.db");

  const s = new store.MnemeStore(dbPath);
  const embedder = await resolveEmbedder({ provider: "auto" });

  return { cwd, meta, store: s, embedder };
}

/** Build a passthrough handler that spawns the CLI command, parses --json, and
 *  wraps the result in a generic wisdom envelope. Use this for tools whose
 *  logic lives entirely in the CLI; the wisdom field is generic but accurate. */
export function passthroughHandler(
  cliCommand: string,
  argMap: (args: Record<string, unknown>) => string[],
  options: { wisdom: (data: unknown) => string; followUp?: string[]; confidence?: "high" | "medium" | "low" } = {
    wisdom: () => "Result returned. AI should summarize key fields for the user.",
  },
) {
  return async (rt: ToolRuntime, args: Record<string, unknown>) => {
    const data = await runCliJson(rt.meta.rootPath, cliCommand, argMap(args));
    return {
      data,
      wisdom: options.wisdom(data),
      followUp: options.followUp ?? [],
      confidence: { level: options.confidence ?? "medium" as const },
    };
  };
}

/** Spawn `mneme <command> [...args]` as a child process and parse its --json
 *  output. Used by category files for tools whose logic lives in the CLI
 *  layer rather than the core API. Returns parsed JSON or throws on
 *  non-zero exit / parse failure. */
export async function runCliJson(
  cwd: string,
  command: string,
  cliArgs: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const { spawn } = await import("node:child_process");
  // Security hardening (v1.11.0): refuse any cliArg or command that looks
  // like shell-metacharacter injection. MCP args come from AI clients —
  // we treat them as untrusted input.
  const SHELL_META = /[;&|`$<>()\\\n\r"']/;
  for (const a of [command, ...cliArgs]) {
    if (typeof a !== "string" || SHELL_META.test(a)) {
      throw new Error(`Refusing to spawn: argument contains shell metacharacters or is non-string: ${JSON.stringify(a).slice(0, 80)}`);
    }
  }
  // Windows: resolve to .cmd explicitly so we don't need shell:true
  const exe = process.platform === "win32" ? "mneme.cmd" : "mneme";
  return await new Promise((resolve, reject) => {
    const child = spawn(exe, [command, ...cliArgs, "--json"], {
      cwd,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => (stdout += String(b)));
    child.stderr?.on("data", (b) => (stderr += String(b)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mneme ${command} timed out after ${opts.timeoutMs ?? 60000}ms`));
    }, opts.timeoutMs ?? 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`mneme ${command} exited ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`mneme ${command} returned non-JSON: ${(err as Error).message}`));
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}


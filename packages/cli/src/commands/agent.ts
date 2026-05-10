/**
 * `mneme agent` -- autonomous background agent CLI.
 *
 *   mneme agent backends      list backends + availability
 *   mneme agent run "<task>"  one-shot autonomous run with no tools
 *   mneme agent test          smoke test the picked backend
 */

import type { Command } from "commander";
import { agent } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }
function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(s: string): void { process.stdout.write(s + "\n"); }

export function registerAgentCommands(program: Command): void {
  const a = program
    .command("agent")
    .description("Mneme autonomous background agent (Ollama local / paid API fallback).");

  a.command("backends")
    .description("List agent backends + availability (Ollama, Anthropic, OpenAI).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const backends = [agent.ollamaBackend(), agent.anthropicBackend(), agent.openaiBackend()];
      const out = await Promise.all(backends.map(async (b) => ({
        id: b.id, label: b.label,
        available: await b.available().catch(() => false),
      })));
      if (opts.json) { writeJson(out); return; }
      for (const b of out) {
        writeText(`  ${b.id.padEnd(20)} ${b.available ? "OK" : "--"}  ${b.label}`);
      }
    });

  a.command("run <task>")
    .description("One-shot autonomous agent run. Picks best available backend.")
    .option("--prefer <backend>", "ollama-local | anthropic-api | openai-api")
    .option("--max-steps <n>", "step budget", (v) => Number(v))
    .option("--json", "JSON output.")
    .action(async (task: string, opts: { prefer?: string; maxSteps?: number } & CommonOpts) => {
      const result = await agent.runAgent({
        repoRoot: process.cwd(),
        task,
        tools: [], // CLI no-tools mode; daemon supplies real tools
        toolExecutor: async () => { throw new Error("no tools wired in CLI mode"); },
        preferBackend: (opts.prefer === "anthropic-api" || opts.prefer === "openai-api" || opts.prefer === "ollama-local") ? opts.prefer : undefined,
        maxSteps: opts.maxSteps,
      });
      if (opts.json) { writeJson(result); return; }
      writeText(`Backend: ${result.backend}  status: ${result.status}  ${result.totalMs}ms`);
      writeText(``);
      writeText(`Final answer:`);
      writeText(`  ${result.finalAnswer}`);
    });

  a.command("test")
    .description("Smoke test: ask the picked backend a trivial prompt.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const b = await agent.pickBestBackend();
      if (!b) {
        const err = "No backend available. Install Ollama (free) at https://ollama.ai/, OR set ANTHROPIC_API_KEY / OPENAI_API_KEY.";
        if (opts.json) { writeJson({ ok: false, error: err }); return; }
        writeText(err);
        process.exit(1);
        return;
      }
      const turn = await b.step({
        systemPrompt: "Reply with just the word OK.",
        userPrompt: "Say OK.",
        tools: [],
      });
      if (opts.json) { writeJson({ backend: b.id, turn }); return; }
      writeText(`Backend: ${b.label}`);
      writeText(`OK: ${turn.ok}  ms: ${turn.ms}`);
      writeText(`Reply: ${turn.finalAnswer ?? turn.thought}`);
      if (turn.error) writeText(`Error: ${turn.error}`);
    });
}

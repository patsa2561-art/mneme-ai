/**
 * `mneme genius <question>` — LLM-orchestrated multi-step agent.
 *
 * Mneme already exposes ~22 single-purpose CLI commands. `genius` is the
 * piece that lets a question span several of them. The LLM doesn't write
 * code — it picks tools and arranges them. Mneme runs the tools. The LLM
 * then synthesizes a final answer from the tool outputs.
 *
 * Why a separate command instead of relying on Claude+MCP? Two reasons:
 *
 *   1. Fewer round-trips. The LLM that drives `genius` is local (Ollama by
 *      default), so a multi-step plan doesn't pay an MCP-per-call latency
 *      hit and doesn't blow a remote LLM's context window.
 *   2. Self-contained. A user who has not configured Claude/Cursor can still
 *      ask a hard question and get a multi-step answer.
 *
 * The agent loop is intentionally simple:
 *
 *   plan: send the catalog of available tools + the question →
 *         LLM returns JSON: [{tool, args, why}, ...]
 *   execute: run each step, capture stdout
 *   synthesize: send the question + tool outputs → LLM writes the answer
 *
 * No infinite loops. No tool-creates-new-tool. No magic.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import kleur from "kleur";
import { resolveEnricher } from "@mneme-ai/embeddings";
import { ui } from "../ui.js";

export interface GeniusCommandOptions {
  cwd: string;
  question: string;
  /** Hard cap on tool steps. */
  maxSteps?: number;
  provider?: "auto" | "ollama" | "openai";
  model?: string;
  /** Print every plan step + raw output (verbose mode). */
  trace?: boolean;
  json?: boolean;
}

interface PlanStep {
  tool: string;
  args: string[];
  why: string;
}

interface StepResult extends PlanStep {
  stdout: string;
  exitCode: number;
}

const PLAN_SYSTEM_PROMPT = `You are an engineering assistant that plans which Mneme CLI commands to run to answer a question.
Output ONLY valid JSON of shape: { "steps": [{ "tool": "<command>", "args": ["..."], "why": "<one-line>" }] }.
Do NOT wrap in markdown. Do NOT add commentary. JSON only.`;

const SYNTH_SYSTEM_PROMPT = `You synthesize a concise answer from the outputs of Mneme CLI commands.
Cite specific commit hashes, PR numbers, or incident ids that appear in the tool output.
If the outputs are empty or contradictory, say so plainly.
4-8 sentences of plain prose. No markdown headings. No bullet lists.`;

const TOOL_CATALOG = [
  { tool: "ask", args: "<question text>", purpose: "natural-language search over commits + PRs" },
  { tool: "why", args: "<file>:<lineStart>-<lineEnd>", purpose: "blame + originating commits for a code range" },
  { tool: "search-commits", args: "<query>", purpose: "hybrid commit search (subset of ask)" },
  { tool: "status", args: "", purpose: "what's indexed, embedder, db stats" },
  { tool: "adapt", args: "", purpose: "repo profile + recommended next commands" },
  { tool: "runaway", args: "--top 5", purpose: "files that grew silently — refactor candidates" },
  { tool: "mirror", args: "", purpose: "onboarding dossier (top PRs, top contributors, top incidents)" },
  { tool: "fossil", args: "--top 5", purpose: "files deleted from HEAD but still in history" },
  { tool: "rumor", args: "", purpose: "tribal phrases mentioned in commits but no doc explains" },
  { tool: "clones", args: "--top 3", purpose: "near-duplicate functions worth refactoring" },
  { tool: "blast", args: "<commit-ref>", purpose: "predict incidents likely to follow shipping a commit" },
  { tool: "palimpsest", args: "<file>:<line>", purpose: "causal chain (commit → incident → cause)" },
  { tool: "conscience", args: "<file1> <file2> ...", purpose: "risk-score a PR against the repo's own history" },
  { tool: "echo", args: "--query <incident text>", purpose: "find past incidents that resemble a current one" },
  { tool: "ledger", args: "--since <iso>", purpose: "tamper-evident audit log of commits in range" },
];

export async function geniusCommand(opts: GeniusCommandOptions): Promise<number> {
  ui.banner();
  process.stdout.write(
    `${kleur.bold().cyan("genius")}  ${kleur.gray("(AI agent — plans, runs, synthesizes)")}\n\n`,
  );
  process.stdout.write(`${kleur.bold("Q")} ${opts.question}\n\n`);

  // 1. Resolve the LLM (same enricher used by `heal` / `teach`).
  let enricher;
  try {
    enricher = await resolveEnricher({
      provider: opts.provider ?? "auto",
      model: opts.model,
    });
  } catch (err) {
    ui.error(`No LLM available: ${(err as Error).message}`);
    ui.dim("Install Ollama: https://ollama.com  →  ollama pull llama3.2:3b");
    return 1;
  }
  ui.step("llm", enricher.name);

  // 2. PLAN
  const plan = await plan_(enricher, opts.question, opts.maxSteps ?? 4);
  if (!plan.length) {
    ui.warn("LLM produced no plan. Falling back to a single `mneme ask` call.");
    plan.push({ tool: "ask", args: [opts.question], why: "fallback: direct ask" });
  }

  ui.step("plan", `${plan.length} step(s)`);
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i]!;
    process.stdout.write(
      `   ${kleur.gray(`${i + 1}.`)} ${kleur.cyan("mneme")} ${kleur.bold(s.tool)} ${kleur.gray(s.args.join(" "))}\n` +
        `      ${kleur.gray("→ " + s.why)}\n`,
    );
  }
  process.stdout.write("\n");

  // 3. EXECUTE
  const results: StepResult[] = [];
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i]!;
    ui.step(`run ${i + 1}/${plan.length}`, `mneme ${s.tool} ${s.args.join(" ")}`);
    const r = runMneme(s.tool, s.args, opts.cwd);
    results.push({ ...s, stdout: r.stdout, exitCode: r.code });
    if (opts.trace) {
      process.stdout.write(kleur.gray("    --- output (truncated) ---\n"));
      for (const line of r.stdout.split("\n").slice(0, 20)) {
        process.stdout.write(kleur.gray(`    ${line}\n`));
      }
    }
  }

  // 4. SYNTHESIZE
  ui.step("synthesize", "asking the LLM to weave the outputs together");
  const synthesis = await synthesize_(enricher, opts.question, results);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ question: opts.question, plan: results, answer: synthesis }, null, 2) + "\n",
    );
    return 0;
  }

  process.stdout.write("\n" + kleur.bold().magenta("Answer") + "\n");
  for (const line of wrap(synthesis, 78).split("\n")) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Each step above ran a real Mneme command — not a hallucination. Pass --trace to see raw outputs.",
      ) +
      "\n",
  );
  return 0;
}

async function plan_(
  enricher: { enrich: (i: { system: string; user: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }> },
  question: string,
  maxSteps: number,
): Promise<PlanStep[]> {
  const catalog = TOOL_CATALOG.map((t) => `- ${t.tool}: ${t.purpose} (args: ${t.args || "(none)"})`).join("\n");
  const user = `Question: ${question}

Available Mneme tools:
${catalog}

Output JSON with at most ${maxSteps} steps. Choose the smallest plan that answers the question.
Each step's "args" must be an array of strings. If a tool needs no args, use [].`;
  const out = await enricher.enrich({
    system: PLAN_SYSTEM_PROMPT,
    user,
    temperature: 0.1,
    maxTokens: 600,
  });
  return parsePlan(out.text, maxSteps);
}

function parsePlan(raw: string, maxSteps: number): PlanStep[] {
  // The model sometimes wraps JSON in code fences. Strip them.
  const stripped = raw.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { steps?: unknown[] }).steps)
  ) {
    return [];
  }
  const steps = (parsed as { steps: unknown[] }).steps.slice(0, maxSteps);
  const allowed = new Set(TOOL_CATALOG.map((t) => t.tool));
  const out: PlanStep[] = [];
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const tool = String((s as { tool?: unknown }).tool ?? "");
    if (!allowed.has(tool)) continue;
    const argsRaw = (s as { args?: unknown }).args;
    const args = Array.isArray(argsRaw) ? argsRaw.map((a) => String(a)) : [];
    const why = String((s as { why?: unknown }).why ?? "");
    out.push({ tool, args, why });
  }
  return out;
}

function runMneme(tool: string, args: string[], cwd: string): { stdout: string; code: number } {
  const here = dirname(fileURLToPath(import.meta.url));
  const binAbs = resolve(here, "..", "..", "bin", "mneme.js");
  const r = spawnSync(process.execPath, [binAbs, tool, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? 1 };
}

async function synthesize_(
  enricher: { enrich: (i: { system: string; user: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }> },
  question: string,
  results: StepResult[],
): Promise<string> {
  const sections = results
    .map((r, i) => {
      const head = `[step ${i + 1}: mneme ${r.tool} ${r.args.join(" ")}] (exit ${r.exitCode})`;
      const body = r.stdout.length > 1500 ? r.stdout.slice(0, 1500) + "\n…(truncated)" : r.stdout;
      return `${head}\n${body}`;
    })
    .join("\n\n---\n\n");
  const user = `Question: ${question}\n\nTool outputs:\n${sections}\n\nWrite the answer.`;
  const out = await enricher.enrich({
    system: SYNTH_SYSTEM_PROMPT,
    user,
    temperature: 0.2,
    maxTokens: 400,
  });
  return out.text;
}

function wrap(s: string, width: number): string {
  const parts: string[] = [];
  for (const para of s.split(/\n\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > width && line) {
        parts.push(line);
        line = word;
      } else {
        line += (line ? " " : "") + word;
      }
    }
    if (line.trim()) parts.push(line);
    parts.push("");
  }
  return parts.join("\n").trim();
}

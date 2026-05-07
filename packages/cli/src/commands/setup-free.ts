/**
 * `mneme setup-free` — 30-second guided setup for users with NO API key.
 *
 * The point: a brand-new user runs `npm install -g mneme-ai`, types
 * `mneme setup-free`, and within 30 seconds knows EXACTLY what to do
 * to get full Q&A synthesis (the LLM step) running for free, with
 * verifiable success at each step.
 *
 * Three free paths offered, in order of friendliness:
 *
 *   1. Local Ollama       (private, free forever, ~3GB one-time download)
 *   2. Groq free tier     (cloud, fastest, signup, no install)
 *   3. OpenRouter free    (cloud, model variety, signup, no install)
 *
 * NEVER requires an API key. NEVER fails silently.
 */
import { execSync, spawnSync } from "node:child_process";
import kleur from "kleur";
import {
  ui,
  header,
  section,
  pill,
  nextSteps,
} from "../ui.js";
import { OLLAMA_FREE_CHAT_MODELS, listProviders } from "@mneme-ai/embeddings";

export interface SetupFreeOptions {
  cwd: string;
  /** Skip interactive picks; just print recipes. */
  print?: boolean;
}

export async function setupFreeCommand(opts: SetupFreeOptions): Promise<number> {
  ui.banner();
  process.stdout.write(header(
    "🆓",
    "Setup Free — get full Q&A synthesis without paying",
    "30-second guided flow · pick the path that fits your machine + connection",
    "Mneme works zero-config for indexing. This wizard sets up the LLM step (mneme ask) for free.",
  ) + "\n\n");

  // Probe what's available so we can recommend the BEST path for this user
  const ollamaInstalled = isCommandOnPath("ollama");
  const ollamaRunning = ollamaInstalled && isOllamaServing();
  const installedChatModels = ollamaInstalled ? listOllamaChatModels() : [];

  // ─── Status overview ───────────────────────────────────────────────
  process.stdout.write(section("✦ Your current setup") + "\n\n");
  process.stdout.write(`    ${ollamaInstalled ? pill("INSTALLED", "ok") : pill("NOT INSTALLED", "info")}  Ollama (local LLM runtime)\n`);
  if (ollamaInstalled) {
    process.stdout.write(`    ${ollamaRunning ? pill("RUNNING", "ok") : pill("STOPPED", "warn")}  ollama serve\n`);
    if (installedChatModels.length > 0) {
      process.stdout.write(`    ${pill(`${installedChatModels.length} CHAT MODEL(S)`, "ok")}  ${installedChatModels.slice(0, 3).join(", ")}${installedChatModels.length > 3 ? "…" : ""}\n`);
    } else if (ollamaRunning) {
      process.stdout.write(`    ${pill("NO CHAT MODEL", "warn")}  pull one below\n`);
    }
  }
  for (const cfg of listProviders()) {
    if (process.env[cfg.envKey]) {
      process.stdout.write(`    ${pill("KEY SET", "ok")}  ${cfg.id} (${cfg.envKey})\n`);
    }
  }
  process.stdout.write("\n");

  // ─── Already-set-up shortcut ──────────────────────────────────────
  if (installedChatModels.length > 0 && ollamaRunning) {
    process.stdout.write(`  ${kleur.green("✓")} ${kleur.green().bold("You're already set up.")} \`mneme ask\` will use ${kleur.bold(installedChatModels[0]!)} via local Ollama.\n\n`);
    process.stdout.write(nextSteps([
      { cmd: `mneme ask "what does this repo do?"`, why: "Try the full synthesis flow now." },
    ]) + "\n\n");
    return 0;
  }
  for (const cfg of listProviders()) {
    if (process.env[cfg.envKey]) {
      process.stdout.write(`  ${kleur.green("✓")} ${kleur.green().bold("You're already set up.")} \`mneme ask\` will use ${kleur.bold(cfg.id)} (${cfg.envKey} is set).\n\n`);
      process.stdout.write(nextSteps([
        { cmd: `mneme ask "what does this repo do?"`, why: "Try the full synthesis flow now." },
      ]) + "\n\n");
      return 0;
    }
  }

  // ─── Path A — Local Ollama (private, free forever) ────────────────
  process.stdout.write(section("🏠 Path A — Local + private (recommended for proprietary code)") + "\n");
  process.stdout.write(`    ${kleur.gray("Free forever · 100% local · no signup · no key. ~3GB one-time download.")}\n\n`);

  const stepA: string[] = [];
  if (!ollamaInstalled) {
    stepA.push(`  ${pill("STEP 1", "low")}  Install Ollama:  ${kleur.cyan().bold(installInstructionForPlatform())}`);
    stepA.push(`             ${kleur.gray("verify with:  ollama --version")}`);
  }
  if (ollamaInstalled && !ollamaRunning) {
    stepA.push(`  ${pill("STEP 1", "low")}  Start Ollama in a new terminal:  ${kleur.cyan().bold("ollama serve")}`);
  }
  stepA.push(`  ${pill(ollamaInstalled ? "STEP 2" : "STEP 2", "low")}  Pull a free chat model (pick one — bigger = smarter, more RAM):`);
  for (const m of OLLAMA_FREE_CHAT_MODELS) {
    stepA.push(`             ${kleur.cyan().bold(`ollama pull ${m.name}`)}  ${kleur.gray(`(${m.size} — ${m.note})`)}`);
  }
  stepA.push(`  ${pill("STEP 3", "low")}  Verify:  ${kleur.cyan().bold(`ollama run qwen2.5:3b "hi"`)}  ${kleur.gray("(should print a reply)")}`);
  stepA.push(`  ${pill("DONE", "ok")}   Now \`mneme ask\` uses your local model. Done.`);
  for (const line of stepA) process.stdout.write(line + "\n");
  process.stdout.write("\n");

  // ─── Path B — Groq free tier (cloud, fastest) ─────────────────────
  process.stdout.write(section("⚡ Path B — Groq free cloud (fastest, ~500 tok/sec — recommended for speed)") + "\n");
  process.stdout.write(`    ${kleur.gray("Free tier with daily quota · cloud (your code does NOT leave when indexing — only when asking) · signup needed.")}\n\n`);
  process.stdout.write(`  ${pill("STEP 1", "low")}  Sign up free:  ${kleur.cyan("https://console.groq.com/keys")}\n`);
  process.stdout.write(`  ${pill("STEP 2", "low")}  Copy your key (starts with ${kleur.bold("gsk_")}) and set it in your terminal:\n`);
  process.stdout.write(`             ${kleur.gray("PowerShell:")} ${kleur.cyan().bold('$env:GROQ_API_KEY="gsk_..."')}\n`);
  process.stdout.write(`             ${kleur.gray("Bash/Zsh:  ")} ${kleur.cyan().bold('export GROQ_API_KEY="gsk_..."')}\n`);
  process.stdout.write(`             ${kleur.gray("Persist:  add to ~/.bashrc / ~/.zshrc / $PROFILE")}\n`);
  process.stdout.write(`  ${pill("STEP 3", "low")}  Verify:  ${kleur.cyan().bold(`mneme ask "what does this repo do?"`)}  ${kleur.gray("→ should answer in ~1 sec")}\n`);
  process.stdout.write(`  ${pill("DONE", "ok")}   Mneme auto-detects Groq when GROQ_API_KEY is set. Free models on Groq:\n`);
  const groq = listProviders().find((p) => p.id === "groq")!;
  for (const m of groq.freeModels) {
    process.stdout.write(`             ${kleur.gray("•")} ${kleur.bold(m)}\n`);
  }
  process.stdout.write("\n");

  // ─── Path C — OpenRouter (cloud, model variety) ──────────────────
  process.stdout.write(section("🌐 Path C — OpenRouter free cloud (most model variety)") + "\n");
  process.stdout.write(`    ${kleur.gray("Free models include Qwen, Gemma, Llama 3.3 — switchable per-request. Signup needed.")}\n\n`);
  process.stdout.write(`  ${pill("STEP 1", "low")}  Sign up free:  ${kleur.cyan("https://openrouter.ai/keys")}\n`);
  process.stdout.write(`  ${pill("STEP 2", "low")}  Set the key:  ${kleur.cyan().bold('export OPENROUTER_API_KEY="sk-or-..."')}\n`);
  process.stdout.write(`  ${pill("STEP 3", "low")}  Verify:  ${kleur.cyan().bold(`mneme ask "what does this repo do?"`)}\n`);
  process.stdout.write(`  ${pill("DONE", "ok")}   Free models OpenRouter exposes:\n`);
  const or = listProviders().find((p) => p.id === "openrouter")!;
  for (const m of or.freeModels) {
    process.stdout.write(`             ${kleur.gray("•")} ${kleur.bold(m)}\n`);
  }
  process.stdout.write("\n");

  // ─── Smart recommendation ─────────────────────────────────────────
  process.stdout.write(section("💡 Recommendation for your machine") + "\n\n");
  if (ollamaInstalled) {
    process.stdout.write(`    ${kleur.green("✓")} You already have Ollama. Take ${kleur.bold("Path A")} — pull ${kleur.bold("qwen2.5:3b")} (1.9GB) and you're set.\n\n`);
  } else {
    process.stdout.write(`    ${kleur.cyan("→")} Easiest right now: ${kleur.bold("Path B (Groq)")} — 30 seconds, no install, fastest. Free tier covers ~14k requests/day.\n`);
    process.stdout.write(`    ${kleur.gray("→ Want privacy or no-internet ops? Pick Path A — bigger one-time setup, free forever.")}\n\n`);
  }

  process.stdout.write(`  ${kleur.gray("Re-run this command anytime:  ")} ${kleur.bold("mneme setup-free")}\n\n`);
  return 0;
}

// ─── helpers ────────────────────────────────────────────────────────

function isCommandOnPath(cmd: string): boolean {
  try {
    const checker = process.platform === "win32" ? "where" : "which";
    execSync(`${checker} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isOllamaServing(): boolean {
  // Use sync HTTP via a 1-sec curl-equivalent. Simplest: spawn `ollama list`
  // — it talks to the daemon and fails fast if not running.
  const r = spawnSync("ollama", ["list"], { stdio: "ignore", timeout: 1500 });
  return r.status === 0;
}

function listOllamaChatModels(): string[] {
  try {
    const out = execSync("ollama list", { encoding: "utf8", timeout: 1500 });
    // Parse `NAME TAG SIZE MODIFIED` rows. Skip embed-only models like nomic-embed-text.
    const lines = out.split("\n").slice(1).filter(Boolean);
    return lines
      .map((l) => l.split(/\s+/)[0] ?? "")
      .filter((n) => n && !n.includes("embed"));
  } catch {
    return [];
  }
}

function installInstructionForPlatform(): string {
  if (process.platform === "darwin") return "brew install ollama";
  if (process.platform === "win32") return "winget install Ollama.Ollama  (or download https://ollama.com/download)";
  return "curl -fsSL https://ollama.com/install.sh | sh";
}

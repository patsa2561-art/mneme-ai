/**
 * `mneme shell` (v2.106.0) — the Shell Autopilot: a phantom recovery
 * suggestion after a failed command, learned from your own terminal history
 * and shared (signed) across every agent via the Cognitive Cortex. Supports
 * Windows (PowerShell), macOS + Linux (zsh / bash).
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreShell {
  shellAutopilot: {
    suggestRecovery: (cmd: string, code: number, stderr?: string, learned?: Record<string, string>) => { recovery: string | null; source: string; confidence: string; reason: string; signature: string };
    failureSignature: (cmd: string, code: number, stderr?: string) => string;
    recoveryKey: (sig: string) => string;
    generateHook: (shell: "powershell" | "bash" | "zsh", binInvoke?: string) => string;
  };
  cortex: {
    contribute: (repo: string, store: unknown, c: unknown, at: number, opts?: unknown) => { store: unknown; result: { verdict: string } };
  };
}
async function core(): Promise<CoreShell | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreShell; if (c.shellAutopilot && c.cortex) return c; } catch { /* */ }
  return null;
}

function cortexStorePath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }
/** Build the learned-recovery map {signature → recovery} from cortex facts. */
function learnedMap(cwd: string): Record<string, string> {
  try {
    const p = cortexStorePath(cwd); if (!existsSync(p)) return {};
    const j = JSON.parse(readFileSync(p, "utf8")); if (!j || !Array.isArray(j.entries)) return {};
    const out: Record<string, string> = {};
    const superseded = new Set<string>();
    for (const e of j.entries) if (e?.supersedes) superseded.add(e.supersedes);
    for (const e of j.entries) {
      if (!e || superseded.has(e.id) || typeof e.key !== "string" || !e.key.startsWith("shell.recovery:")) continue;
      out[e.key.slice("shell.recovery:".length)] = e.value;
    }
    return out;
  } catch { return {}; }
}

function detectShell(): "powershell" | "bash" | "zsh" {
  if (platform() === "win32") return "powershell";
  const sh = process.env["SHELL"] ?? "";
  if (sh.includes("zsh")) return "zsh";
  if (sh.includes("bash")) return "bash";
  return platform() === "darwin" ? "zsh" : "bash";   // macOS default zsh, else bash
}
function profilePath(shell: "powershell" | "bash" | "zsh"): string {
  if (shell === "powershell") {
    const docs = process.env["USERPROFILE"] ? join(process.env["USERPROFILE"], "Documents") : homedir();
    return join(docs, "PowerShell", "Microsoft.PowerShell_profile.ps1");
  }
  return join(homedir(), shell === "zsh" ? ".zshrc" : ".bashrc");
}
const BEGIN = "# >>> mneme shell autopilot >>>";
const END = "# <<< mneme shell autopilot <<<";

export function registerShellCommands(program: Command): void {
  const s = program
    .command("shell")
    .description("🛟 SHELL AUTOPILOT — a phantom recovery suggestion after a failed command, learned from your own terminal history + shared (signed) across every agent. Windows / macOS / Linux. `shell install` once, then just keep working.");

  s.command("suggest")
    .description("Suggest a recovery for a failed command (used by the hook). Learned recoveries from the cortex beat the built-in rules.")
    .requiredOption("--cmd <c>", "the failed command line")
    .option("--code <n>", "exit code", (v) => parseInt(v, 10), 1)
    .option("--stderr <s>", "captured stderr (improves the match)")
    .option("--json", "JSON output.")
    .option("--field <f>", "print only one field (e.g. recovery)")
    .action(async (opts: { cmd: string; code?: number; stderr?: string; json?: boolean; field?: string }) => {
      const m = await core(); if (!m) { if (!opts.field) writeText(""); return; }
      const sug = m.shellAutopilot.suggestRecovery(opts.cmd, opts.code ?? 1, opts.stderr, learnedMap(process.cwd()));
      if (opts.field) { writeText((sug as Record<string, unknown>)[opts.field] != null ? String((sug as Record<string, unknown>)[opts.field]) : ""); return; }
      if (opts.json) { writeJson(sug); return; }
      if (sug.recovery) { writeText(`↻ ${sug.recovery}   (${sug.source}: ${sug.reason})`); } else { writeText("· no known recovery"); }
    });

  s.command("learn")
    .description("Record that a recovery fixed a failure — signs it into the shared cortex so every agent (any vendor) recalls it next time. This is the dark-data flywheel.")
    .requiredOption("--cmd <c>", "the command that FAILED")
    .requiredOption("--recovery <r>", "the command that FIXED it")
    .option("--code <n>", "exit code of the failure", (v) => parseInt(v, 10), 1)
    .option("--stderr <s>", "stderr of the failure")
    .option("--agent <a>", "your agent id", "shell")
    .action(async (opts: { cmd: string; recovery: string; code?: number; stderr?: string; agent?: string }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const sig = m.shellAutopilot.failureSignature(opts.cmd, opts.code ?? 1, opts.stderr);
      const key = m.shellAutopilot.recoveryKey(sig);
      let store: unknown = { v: 1, entries: [] };
      try { if (existsSync(cortexStorePath(cwd))) store = JSON.parse(readFileSync(cortexStorePath(cwd), "utf8")); } catch { /* */ }
      const out = m.cortex.contribute(cwd, store, { agent: opts.agent ?? "shell", key, value: opts.recovery, kind: "fact" }, Date.now(), { update: true });
      const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(cortexStorePath(cwd), JSON.stringify(out.store, null, 2));
      writeText(`✓ learned (${out.result.verdict}) — "${opts.recovery}" now recalled for this failure on every agent`);
    });

  s.command("hook")
    .description("Print the shell hook script (for inspection or manual install).")
    .option("--shell <s>", "powershell | bash | zsh (default: auto-detect)")
    .action(async (opts: { shell?: string }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const sh = (opts.shell as "powershell" | "bash" | "zsh") || detectShell();
      writeText(m.shellAutopilot.generateHook(sh));
    });

  s.command("install")
    .description("Install the autopilot into your shell profile (auto-detects Windows/macOS/Linux + shell). Sentinel-bracketed + non-destructive; re-installs cleanly. Use --uninstall to remove.")
    .option("--shell <s>", "force powershell | bash | zsh")
    .option("--uninstall", "remove the Mneme block from the profile")
    .action(async (opts: { shell?: string; uninstall?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const sh = (opts.shell as "powershell" | "bash" | "zsh") || detectShell();
      const path = profilePath(sh);
      let existing = existsSync(path) ? readFileSync(path, "utf8") : "";
      const bi = existing.indexOf(BEGIN), ei = existing.indexOf(END);
      if (bi >= 0 && ei > bi) existing = (existing.slice(0, bi) + existing.slice(ei + END.length)).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
      try { if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true }); } catch { /* */ }
      if (opts.uninstall) { writeFileSync(path, existing); writeText(`✓ removed the autopilot from ${path}`); return; }
      const block = m.shellAutopilot.generateHook(sh);
      try { appendFileSync(path, (existing.endsWith("\n") || existing === "" ? "" : "\n") + "\n" + block + "\n"); }
      catch (e) { writeText(`✗ could not write ${path}: ${(e as Error).message}`); process.exitCode = 1; return; }
      writeText(`✓ installed the shell autopilot (${sh}) → ${path}`);
      writeText(`  open a NEW terminal (or: ${sh === "powershell" ? ". $PROFILE" : `source ${path}`}). After a failed command you'll see a faint  mneme ↻ <recovery>  — press ${sh === "powershell" ? "Alt+r" : "$MNEME_SUGGESTION"} to use it. Nothing auto-runs.`);
      writeText(`  remove with: mneme shell install --uninstall`);
    });
}

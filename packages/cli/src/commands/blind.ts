/**
 * `mneme blind` (v2.127.0) — Context Blinding. Before code leaves for a hosted
 * model, replace your real secret/identifier names with reversible local
 * placeholders + remove secret literals, so the provider only ever sees
 * structurally-valid but business-meaningless code. `mneme unblind` restores the
 * real names from the local map. The honest, fast core of "code never leaks"
 * (pseudonymization, NOT ZKP/FHE; no kernel hook).
 *
 *   cat src/secret.ts | mneme blind --map /tmp/m.json      # → send the output to the model
 *   echo "<model reply>" | mneme unblind --map /tmp/m.json  # → restore real names
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { blind } from "@mneme-ai/core";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let d = ""; let done = false; const fin = () => { if (!done) { done = true; resolve(d); } };
    process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { d += c; if (d.length > 8_000_000) fin(); });
    process.stdin.on("end", fin); process.stdin.on("error", fin); setTimeout(fin, 4000);
  });
}

export function registerBlindCommands(program: Command): void {
  program
    .command("blind")
    .description("🕶 CONTEXT BLINDING — before code goes to a hosted model, remove secret literals + replace sensitive identifier names with reversible local placeholders (SecretFinancialEngine → MZ1). The model sees valid-but-meaningless code; the map stays on your machine. Pseudonymization (fast), NOT ZKP. Pair with `mneme unblind`.")
    .option("--text <t>", "payload inline (else stdin).")
    .option("--file <p>", "read payload from a file.")
    .option("--mode <m>", "'sensitive' (default: secret/financial/internal names) or 'aggressive' (all user identifiers).", "sensitive")
    .option("--protect <names>", "comma-separated identifier names to ALWAYS blind.")
    .option("--map <path>", "write the LOCAL reverse map here (keep it on your machine; needed for unblind).")
    .option("--json", "JSON output (blinded + map + stats).")
    .action(async (opts: { text?: string; file?: string; mode?: string; protect?: string; map?: string; json?: boolean }) => {
      let payload = typeof opts.text === "string" ? opts.text : "";
      if (!payload && opts.file) { try { if (existsSync(opts.file)) payload = readFileSync(opts.file, "utf8"); } catch { /* */ } }
      if (!payload) payload = await readStdin();
      const r = blind.blindContext(payload, {
        mode: opts.mode === "aggressive" ? "aggressive" : "sensitive",
        protect: opts.protect ? opts.protect.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      if (opts.map) { try { writeFileSync(opts.map, JSON.stringify(r.map, null, 2)); } catch (e) { process.stderr.write(`⚠ could not write map: ${(e as Error).message}\n`); } }
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(r.blinded + "\n");
      process.stderr.write(`🕶 blinded ${r.identifiersBlinded} identifier(s), redacted ${r.secretsRedacted} secret(s)${opts.map ? ` · map → ${opts.map}` : " · pass --map <path> to save the reverse map"}\n`);
      if (!opts.map) process.stderr.write(`   (without the saved map you cannot unblind the model's reply — keep the map LOCAL, never send it)\n`);
    });

  program
    .command("unblind")
    .description("🕶 Restore real names in a model's reply using the LOCAL map written by `mneme blind --map`.")
    .requiredOption("--map <path>", "the reverse map file from `mneme blind --map`.")
    .option("--text <t>", "the model output inline (else stdin).")
    .action(async (opts: { map: string; text?: string }) => {
      let map: Record<string, string> = {};
      try { map = JSON.parse(readFileSync(opts.map, "utf8")); } catch (e) { process.stderr.write(`✗ could not read map: ${(e as Error).message}\n`); process.exitCode = 1; return; }
      let text = typeof opts.text === "string" ? opts.text : "";
      if (!text) text = await readStdin();
      process.stdout.write(blind.unblindOutput(text, map) + "\n");
    });
}

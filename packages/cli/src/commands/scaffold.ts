/**
 * `mneme scaffold` (v2.126.0) — the honest core of "Blueprint Inflation": an
 * agent emits a tiny spec, Mneme expands it into deterministic boilerplate
 * locally (no syntax errors, no re-typing), saving OUTPUT tokens.
 *
 * HONEST scope: KNOWN templates only (ts-model + CRUD, test-skeleton, config).
 * It does NOT generate arbitrary business logic — it leaves TODO markers exactly
 * where you must write the real logic.
 *
 *   mneme scaffold --spec '{"kind":"ts-model","model":"User","fields":{"id":"string","email":"string"},"crud":true}'
 *   mneme scaffold --spec-file blueprint.json --out src/        # write the files
 *   mneme scaffold --spec '{"kind":"config","format":"env","entries":{"port":3000}}' --json
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { scaffold } from "@mneme-ai/core";
import { appendSaving } from "./savings.js";

function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }

export function registerScaffoldCommands(program: Command): void {
  program
    .command("scaffold")
    .description("🧱 Expand a compact SPEC into deterministic boilerplate locally (saves OUTPUT tokens). KNOWN templates only: ts-model (+CRUD), test-skeleton, config — leaves TODO markers where YOU write the real logic. NOT a generator of arbitrary business logic.")
    .option("--spec <json>", "the blueprint spec as inline JSON.")
    .option("--spec-file <path>", "read the spec JSON from a file.")
    .option("--out <dir>", "write the generated files under this dir (else print to stdout).")
    .option("--json", "structured JSON output (files + measured saving).")
    .action((opts: { spec?: string; specFile?: string; out?: string; json?: boolean }) => {
      let raw = opts.spec;
      if (!raw && opts.specFile) { try { if (existsSync(opts.specFile)) raw = readFileSync(opts.specFile, "utf8"); } catch { /* */ } }
      if (!raw) { out("✗ provide --spec '<json>' or --spec-file <path>"); process.exitCode = 1; return; }
      let spec: unknown;
      try { spec = JSON.parse(raw); } catch (e) { out(`✗ invalid spec JSON: ${(e as Error).message}`); process.exitCode = 1; return; }

      const r = scaffold.scaffold(spec as Parameters<typeof scaffold.scaffold>[0]);
      if (!r.ok) { out(`✗ ${r.error ?? "scaffold failed"}`); out(`  ${r.note}`); process.exitCode = 1; return; }

      // record the OUTPUT-token saving into the signed treasury ledger
      try { appendSaving(process.cwd(), { source: "scaffold", tokensBefore: r.measure.codeTokens, tokensAfter: r.measure.specTokens }); } catch { /* */ }

      if (opts.json) { outJson(r); return; }
      if (opts.out) {
        const cwd = process.cwd();
        for (const f of r.files) {
          const p = resolve(cwd, join(opts.out, f.path));
          try { if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content); out(`✓ wrote ${join(opts.out, f.path)} (${f.content.split("\n").length} lines)`); }
          catch (e) { out(`✗ write ${f.path}: ${(e as Error).message}`); }
        }
      } else {
        for (const f of r.files) { out(`# ── ${f.path} ──`); process.stdout.write(f.content); }
      }
      out(`\n🧱 ${r.kind}: spec ~${r.measure.specTokens} tok → ~${r.measure.codeTokens} tok of code (${r.measure.outputReductionPct}% output-token saving, ${r.measure.expansionRatio}× expansion)`);
      out(`  ${r.note}`);
    });
}

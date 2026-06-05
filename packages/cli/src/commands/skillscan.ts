/**
 * `mneme skillscan` (v3.2.0) — the signed provenance gate for AI agent skills / MCP tools.
 * Scan a skill (a file or a directory) against the 8-point checklist, pin it by content hash,
 * and (optionally) mint a NOTARY (Ed25519) provenance receipt that anyone verifies OFFLINE.
 *   skillscan <path> [--sign] [--out receipt.json] [--json]
 *   skillscan verify <receipt.json> [--path <skill>]   (also re-hashes the skill if --path given)
 */
import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { skillscan, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const SKILL_EXT = new Set([".md", ".markdown", ".json", ".mjs", ".cjs", ".js", ".ts", ".txt", ".yaml", ".yml", ".toml", ".sh", ".py"]);

/** Read a skill's text: a single file, or concatenate the skill-ish files in a directory (≤512KB). */
function readSkill(path: string): { text: string; files: string[] } {
  if (!existsSync(path)) return { text: "", files: [] };
  const st = statSync(path);
  if (st.isFile()) return { text: readFileSync(path, "utf8"), files: [path] };
  const parts: string[] = []; const files: string[] = []; let total = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || total > 512_000) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (SKILL_EXT.has(extname(e.name).toLowerCase()) && total < 512_000) {
        try { const c = readFileSync(p, "utf8"); parts.push(`\n# ── ${e.name} ──\n${c}`); files.push(p); total += c.length; } catch { /* */ }
      }
    }
  };
  walk(path, 0);
  return { text: parts.join("\n"), files };
}

export function registerSkillscanCommands(program: Command): void {
  const k = program.command("skillscan").description("🛂 SKILLSCAN — the signed provenance gate for AI agent skills / MCP tools: 8-point static scan (prompt-injection · exfiltration · secret · dangerous-command · obfuscation · external-fetch · credential-access · privilege-escalation) + a content-hash + an offline-verifiable NOTARY receipt. The supply-chain frontier, local-first.");

  k.command("scan <path>", { isDefault: true }).description("Scan a skill file/dir; optionally mint a signed provenance receipt.")
    .option("--sign", "mint a NOTARY-signed provenance receipt").option("--out <file>", "write the receipt JSON").option("--json", "emit the full result as JSON")
    .action((path: string, o: { sign?: boolean; out?: string; json?: boolean }) => {
      const { text, files } = readSkill(path);
      if (!text.trim()) { out(`✗ nothing to scan at ${path}`); process.exitCode = 2; return; }
      const r = skillscan.scanSkill(text);
      const subject = `skill:${basename(path)}`;
      let receipt: unknown = null;
      if (o.sign || o.out) {
        try { receipt = notary.issueReceipt(process.cwd(), { kind: "skill-provenance", subject, payload: { contentHash: r.contentHash, bytes: r.bytes, verdict: r.verdict, hits: r.hits, files: files.length }, includePayload: true, issuedAt: Date.now() }); } catch { /* */ }
        if (o.out && receipt) writeFileSync(o.out, JSON.stringify(receipt, null, 2), "utf8");
      }
      if (o.json) { out(JSON.stringify({ result: r, receipt }, null, 2)); if (r.verdict === "BLOCK") process.exitCode = 2; return; }
      const icon = r.verdict === "BLOCK" ? "🔴" : r.verdict === "REVIEW" ? "🟡" : "🟢";
      out(`🛂 SKILLSCAN — ${icon} ${r.verdict} · ${files.length} file(s) · ${r.bytes}B · sha256 ${r.contentHash.slice(0, 16)}…`);
      for (const h of r.hits) out(`   🚩 ${h.id} (${h.severity})${h.evidence ? "  " + h.evidence : ""}`);
      if (!r.hits.length) out("   ✓ no risk-class hits across the 8-point checklist");
      if (receipt) out(`   🪪 signed provenance receipt${o.out ? " → " + o.out : ""} (verify offline: mneme skillscan verify)`);
      if (r.verdict === "BLOCK") process.exitCode = 2;
    });

  k.command("verify <receipt>").description("Verify a provenance receipt OFFLINE (Ed25519); with --path, re-hash the skill to confirm it's unchanged.")
    .option("--path <skill>", "re-scan this skill and confirm its content-hash matches the receipt")
    .action((receiptFile: string, o: { path?: string }) => {
      if (!existsSync(receiptFile)) { out("receipt not found"); process.exitCode = 2; return; }
      let receipt: { payload?: { contentHash?: string; verdict?: string } };
      try { receipt = JSON.parse(readFileSync(receiptFile, "utf8")); } catch { out("✗ invalid receipt JSON"); process.exitCode = 2; return; }
      const v = notary.verifyReceipt(receipt);
      out(v.valid ? "✓ signature VALID (Ed25519, offline)" : `✗ signature INVALID: ${v.reason}`);
      if (v.valid && receipt.payload) out(`   verdict at signing: ${receipt.payload.verdict} · pinned sha256 ${String(receipt.payload.contentHash).slice(0, 16)}…`);
      if (o.path && receipt.payload?.contentHash) {
        const now = skillscan.scanSkill(readSkill(o.path).text);
        const match = now.contentHash === receipt.payload.contentHash;
        out(match ? "   ✓ content UNCHANGED since signing (hash matches)" : "   ⚠ content CHANGED since signing — receipt does NOT cover the current skill!");
        if (!match) process.exitCode = 2;
      }
      if (!v.valid) process.exitCode = 2;
    });
}

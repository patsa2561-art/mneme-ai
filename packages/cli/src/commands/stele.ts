/**
 * `mneme stele` (v2.137.0) — the signed, merkle-rooted, delta-syncable
 * capability inscription. An agent learns the WHOLE Mneme surface at O(delta)
 * tokens and can PROVE it holds the latest, complete set.
 *
 *   mneme stele                       # the current merkle root + count (signed)
 *   mneme stele --held <root>         # delta vs what you hold (added/changed/removed)
 *   mneme stele --held-file held.json # held = {"root":"…","leaves":{name:hash}}
 *   mneme stele --verify <root>       # is my held root current? (stale/tamper-evident)
 *   mneme stele --json
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { stele, notary, agentManifest } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function catalogEntries(): stele.SteleEntry[] {
  try {
    return (agentManifest.MNEME_COMMAND_CATALOG as Array<{ command: string; since?: string; what?: string }>).map((c) => ({ name: c.command, version: c.since, summary: c.what }));
  } catch { return []; }
}

export function registerSteleCommands(program: Command): void {
  program
    .command("stele")
    .description("🗿 STELE — the signed, merkle-rooted, delta-syncable inscription of Mneme's whole capability surface. An agent proves it holds the latest/complete set (merkle root) + pulls only the delta at boot (O(delta) tokens, not O(900 tools)). The honest fix for 'I didn't know that tool existed' + a stale manifest.")
    .option("--held <root>", "the merkle root your agent currently holds (for a delta).")
    .option("--held-file <p>", "JSON file: {\"root\":\"…\",\"leaves\":{\"name\":\"hash\"}} — full delta incl. tamper-detect.")
    .option("--verify <root>", "verify a held root against the live catalog (stale/tamper-evident).")
    .option("--json", "JSON output (signed).")
    .action((opts: { held?: string; heldFile?: string; verify?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const entries = catalogEntries();

      if (opts.verify) {
        const v = stele.verifyStele(entries, opts.verify);
        if (opts.json) { out(JSON.stringify(v, null, 2)); } else { out(`${v.ok ? "✓ CURRENT" : "🛑 STALE/TAMPERED"} — ${v.reason}\n   live root: ${v.currentRoot}`); }
        process.exitCode = v.ok ? 0 : 2; return;
      }

      let heldRoot = opts.held ?? "";
      let heldLeaves: Record<string, string> | undefined;
      if (opts.heldFile && existsSync(opts.heldFile)) {
        try { const j = JSON.parse(readFileSync(opts.heldFile, "utf8")); heldRoot = typeof j.root === "string" ? j.root : heldRoot; if (j.leaves && typeof j.leaves === "object") heldLeaves = j.leaves; } catch { /* */ }
      }

      if (heldRoot || heldLeaves) {
        const d = stele.steleDelta(entries, heldRoot, heldLeaves);
        const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "stele.delta", payload: { currentRoot: d.currentRoot, upToDate: d.upToDate, added: d.added.length, changed: d.changed.length, removed: d.removed.length }, includePayload: true });
        if (opts.json) { out(JSON.stringify({ ...d, receipt }, null, 2)); return; }
        if (d.upToDate) { out(`✓ UP TO DATE — ${d.note}\n   root: ${d.currentRoot}`); return; }
        out(`🔄 STELE delta — ${d.added.length} new · ${d.changed.length} changed · ${d.removed.length} removed  (~${d.deltaTokenEstimate} tok vs ~${d.fullTokenEstimate} full)`);
        for (const e of d.added.slice(0, 20)) out(`   + ${e.name}${e.summary ? ` — ${e.summary.slice(0, 70)}` : ""}`);
        for (const e of d.changed.slice(0, 20)) out(`   ~ ${e.name}${e.summary ? ` — ${e.summary.slice(0, 70)}` : ""}`);
        for (const n of d.removed.slice(0, 20)) out(`   - ${n}`);
        out(`   new root: ${d.currentRoot}  ·  receipt ${receipt.receiptId ? receipt.receiptId.slice(0, 12) + "…" : "(signed)"}`);
        return;
      }

      const s = stele.buildStele(entries);
      const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "stele.root", payload: { root: s.root, count: s.count }, includePayload: true });
      if (opts.json) { out(JSON.stringify({ root: s.root, count: s.count, receipt }, null, 2)); return; }
      out(`🗿 STELE — ${s.count} capabilities · merkle root:\n   ${s.root}\n   signed · pass --held <root> for a delta, --verify <root> to check freshness.`);
    });
}

/**
 * v2.78.0 — `mneme immune selftest`
 *
 * WORM-CANARY for humans. Two checks:
 *   1. Mneme's OWN output: render a worst-case version-mismatch agent block
 *      (one carrying an upgrade autoAction) and prove it has zero worm
 *      signatures — Mneme informs, never commands.
 *   2. This repo's agent files (CLAUDE.md / AGENTS.md / .cursorrules /
 *      .windsurfrules): scan the live Mneme block (or whole file) for any
 *      worm directive that may have been written by an OLDER Mneme.
 *
 * Exit 0 when clean, 1 when a worm directive is found.
 */

import { writeSync } from "node:fs";
import * as core from "@mneme-ai/core";

const AGENT_FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".windsurfrules"];

// fd-1 synchronous write — survives the immediate process.exit() the action
// handler calls (an async stdout pipe would otherwise be truncated on Windows).
function out(s: string): void {
  try { writeSync(1, s); } catch { process.stdout.write(s); }
}

export async function immuneCommand(opts: { cwd: string; json?: boolean }): Promise<number> {
  const { scanForWormSignatures, KNOWN_WORM_PAYLOAD } = core.immune;
  const { renderMnemeBlock, readMnemeBlock } = core.notifier;

  // Check 1 — Mneme's own worst-case output.
  const ownBlock = renderMnemeBlock({
    id: "version-up-to-date",
    severity: "info",
    title: "Mneme update available",
    body: "installed v0.0.0, npm latest v9.9.9. The user can run `mneme upgrade` when convenient.",
    autoAction: { tool: "mneme.system.upgrade", args: { mode: "install", force: true } },
  });
  const ownScan = scanForWormSignatures(ownBlock);
  const control = scanForWormSignatures(KNOWN_WORM_PAYLOAD); // positive control

  // Check 2 — this repo's persistent agent files.
  const fileScans: Array<{ file: string; clean: boolean; findings: number; detail: string[] }> = [];
  for (const f of AGENT_FILES) {
    let block: string | null = null;
    try { block = readMnemeBlock(opts.cwd, f); } catch { block = null; }
    if (block === null) continue; // file or Mneme block absent — nothing to scan
    const scan = scanForWormSignatures(block);
    fileScans.push({
      file: f,
      clean: scan.clean,
      findings: scan.findings.length,
      detail: scan.findings.map((x) => `${x.kind}: "${x.match}"`),
    });
  }

  const dirtyFiles = fileScans.filter((s) => !s.clean);
  const ok = ownScan.clean && !control.clean && dirtyFiles.length === 0;

  if (opts.json) {
    out(JSON.stringify({
      ok,
      ownOutputClean: ownScan.clean,
      canaryCatchesKnownPayload: !control.clean,
      ownFindings: ownScan.findings,
      files: fileScans,
    }, null, 2) + "\n");
    return ok ? 0 : 1;
  }

  const lines: string[] = [];
  lines.push("🧬 MNEME IMMUNE SELFTEST — WORM-CANARY");
  lines.push("");
  lines.push(`  ${ownScan.clean ? "🟢" : "🔴"} Mneme's own agent-file output: ${ownScan.clean ? "no worm signatures (informs, never commands)" : `${ownScan.findings.length} signature(s)!`}`);
  for (const f of ownScan.findings) lines.push(`       └─ ${f.kind}: "${f.match}"`);
  lines.push(`  ${!control.clean ? "🟢" : "🔴"} Canary self-test: ${!control.clean ? "catches the known pre-v2.78 worm payload (positive control)" : "FAILED to catch the known payload — canary is broken!"}`);
  if (fileScans.length === 0) {
    lines.push("  ·  No Mneme blocks found in this repo's agent files (nothing to scan).");
  } else {
    for (const s of fileScans) {
      lines.push(`  ${s.clean ? "🟢" : "🔴"} ${s.file}: ${s.clean ? "clean" : `${s.findings} worm signature(s)!`}`);
      for (const d of s.detail) lines.push(`       └─ ${d}`);
    }
  }
  lines.push("");
  lines.push(ok
    ? "  ✅ CLEAN — Mneme is not a worm. It states version availability as informational context; upgrades are user-initiated only."
    : "  ❌ WORM DIRECTIVE present — see above. (If a repo file is dirty, an OLDER Mneme wrote it; run `mneme upgrade` then re-run this.)");
  out(lines.join("\n") + "\n");
  return ok ? 0 : 1;
}

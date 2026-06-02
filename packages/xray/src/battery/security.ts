/**
 * SECURITY signal — bring Mneme's CERBERUS command-gate + FIREWALL injection
 * detector to bear on a REPO (not just runtime). Answers a question no
 * dependency/secret scanner does: "does this repo's build/CI/scripts run
 * DANGEROUS commands, and is there prompt-injection hidden in its docs?"
 *
 *   • CERBERUS (hephaestus.classifyCommandRisk): extract the executable surface
 *     — package.json scripts, CI `run:` steps, Dockerfile RUN, *.sh — and
 *     classify each command read/write/DESTRUCTIVE (curl|bash, rm -rf, etc.).
 *   • FIREWALL (firewall.scanInjection): scan docs/markdown for indirect
 *     prompt-injection payloads (a real AI-supply-chain risk).
 *
 * Deterministic, no LLM. (The Agent GOVERNOR governs an agent's actions at
 * RUNTIME — it isn't a static-repo signal, so it is intentionally not forced here.)
 */
import { hephaestus, firewall } from "@mneme-ai/core";
import { listTextFiles, readText } from "../util.js";
import type { SecurityBlock } from "../types.js";
import { join } from "node:path";

function extractCommands(repoPath: string): Array<{ cmd: string; where: string }> {
  const out: Array<{ cmd: string; where: string }> = [];
  const pj = readText(join(repoPath, "package.json"));
  if (pj) {
    try {
      const scripts = (JSON.parse(pj) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const [k, v] of Object.entries(scripts)) out.push({ cmd: String(v), where: `package.json → scripts.${k}` });
    } catch { /* ignore */ }
  }
  const { files } = listTextFiles(repoPath, 2000);
  for (const f of files) {
    if (out.length >= 800) break;
    const isSh = /\.(sh|bash|zsh)$/i.test(f.rel);
    const isCI = /(^|\/)\.github\/workflows\/.+\.ya?ml$/i.test(f.rel) || /(^|\/)\.gitlab-ci\.yml$/i.test(f.rel);
    const isDocker = /(^|\/)dockerfile/i.test(f.rel);
    if (!isSh && !isCI && !isDocker) continue;
    const t = readText(f.abs); if (!t) continue;
    for (const raw of t.split("\n")) {
      const ln = raw.trim();
      if (!ln || ln.startsWith("#")) continue;
      let cmd = "";
      if (isSh) cmd = ln;
      else if (isDocker) { const m = ln.match(/^RUN\s+(.+)/i); if (m) cmd = m[1]; }
      else if (isCI) { const m = ln.match(/^-?\s*run:\s*(.+)/) || ln.match(/^\s+(.+\|\s*(?:ba)?sh.*)$/); if (m) cmd = m[1].replace(/^["']|["']$/g, ""); }
      if (cmd && cmd.length <= 2000) { out.push({ cmd, where: f.rel }); if (out.length >= 800) break; }
    }
  }
  return out;
}

export function analyzeSecurity(repoPath: string, maxFiles = 2000): SecurityBlock {
  const cmds = extractCommands(repoPath);
  const destructive: SecurityBlock["destructive"] = [];
  let writeCount = 0;
  for (const { cmd, where } of cmds) {
    let r: { risk: string; signals: string[] };
    try { r = hephaestus.classifyCommandRisk(cmd); } catch { continue; }
    if (r.risk === "destructive") {
      if (destructive.length < 30) destructive.push({ command: cmd.slice(0, 160), where, signals: (r.signals || []).slice(0, 3) });
    } else if (r.risk === "write") writeCount++;
  }

  // prompt-injection in docs (the indirect-injection vector)
  let injectionFindings = 0;
  const injectionWhere: string[] = [];
  const { files } = listTextFiles(repoPath, maxFiles);
  let scanned = 0;
  for (const f of files) {
    if (scanned >= 300) break;
    if (!/\.(md|mdx|txt|rst|adoc)$/i.test(f.rel) && !/readme/i.test(f.rel)) continue;
    const t = readText(f.abs); if (!t) continue;
    scanned++;
    let fr: { verdict: string; findings: unknown[] };
    try { fr = firewall.scanInjection(t); } catch { continue; }
    if (fr.verdict !== "clean") { injectionFindings += fr.findings.length; if (injectionWhere.length < 10) injectionWhere.push(f.rel); }
  }

  const note = destructive.length
    ? `${destructive.length} destructive command(s) in build/CI/scripts — review before trusting this repo's automation.`
    : injectionFindings
    ? `${injectionFindings} possible prompt-injection payload(s) in docs.`
    : `No destructive build commands or doc prompt-injection detected (${cmds.length} commands checked).`;
  return { commandsScanned: cmds.length, writeCount, destructive, injectionFindings, injectionWhere, note };
}

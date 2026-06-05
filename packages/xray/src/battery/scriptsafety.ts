/**
 * SCRIPT-SAFETY — what does *installing/building* this repo actually run?
 *
 * The #1 supply-chain attack vector is a script that runs WITHOUT anyone looking: an npm
 * `postinstall` / `preinstall`, a CI `run:` step, a bundled shell script. SCRIPT-SAFETY pulls
 * those out of the cloned repo and runs each through Mneme's Behavioral Compiler (MNEME-BC) +
 * the SKILLSCAN 8-point checklist — so the X-Ray can say "this repo's install scripts fetch a
 * remote payload and pipe it to bash" BEFORE you `npm install` it.
 *
 * ★HONEST: a STATIC scan of the scripts declared in the repo (deterministic, no LLM). It catches
 * dangerous commands / exfiltration / obfuscation in what's written; it can't see code a script
 * FETCHES then runs (that's the runtime gate's job). Auto-run scripts (install hooks) are
 * weighted highest because they execute on a bare `npm install`, unreviewed.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compiler, skillscan } from "@mneme-ai/core";

/** PRIVACY: a finding carries ONLY derived labels (script name, verdict, effect types, risk
 *  category ids) — never raw script source. The X-Ray's signed report must hold no raw code. */
export interface ScriptFinding { where: string; autoRun: boolean; verdict: "PASS" | "REVIEW" | "BLOCK"; effects: string[]; risks: string[] }
export interface ScriptSafetyBlock {
  score: number;            // 0–100 (100 = nothing risky in any script)
  band: "safe" | "review" | "risky";
  scanned: number;          // how many scripts were scanned
  autoRunCount: number;     // install-time hooks (highest risk)
  findings: ScriptFinding[];// worst-first; only REVIEW/BLOCK
  note: string;
}

const AUTO_RUN = new Set(["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly", "preuninstall", "postuninstall"]);

interface Script { where: string; autoRun: boolean; code: string }

function collectScripts(root: string): Script[] {
  const out: Script[] = [];
  // 1) package.json scripts (install hooks = auto-run)
  try {
    const p = join(root, "package.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as { scripts?: Record<string, string> };
      for (const [name, code] of Object.entries(j.scripts ?? {})) if (code) out.push({ where: `package.json:${name}`, autoRun: AUTO_RUN.has(name), code });
    }
  } catch { /* */ }
  // 2) shell scripts (top 2 levels, capped)
  try {
    const walk = (dir: string, depth: number) => {
      if (depth < 0 || out.length > 60) return;
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isFile() && /\.(sh|bash)$/.test(e.name)) { try { out.push({ where: rel, autoRun: false, code: readFileSync(join(root, rel), "utf8").slice(0, 8000) }); } catch { /* */ } }
        else if (e.isDirectory() && depth > 0) walk(rel, depth - 1);
      }
    };
    walk("", 1);
  } catch { /* */ }
  // 3) CI workflow run: steps (auto-run on push/PR)
  try {
    const wf = join(root, ".github", "workflows");
    if (existsSync(wf)) for (const f of readdirSync(wf)) if (/\.ya?ml$/.test(f)) {
      try { const y = readFileSync(join(wf, f), "utf8"); for (const m of y.matchAll(/run:\s*\|?\s*([^\n][^]*?)(?=\n\s*-\s|\n\s*\w+:\s|\n\S|$)/g)) { const code = (m[1] ?? "").trim(); if (code) out.push({ where: `.github/workflows/${f}`, autoRun: true, code: code.slice(0, 4000) }); } } catch { /* */ }
    }
  } catch { /* */ }
  return out;
}

export function analyzeScriptSafety(repoPath: string): ScriptSafetyBlock {
  const scripts = collectScripts(repoPath);
  const findings: ScriptFinding[] = [];
  let penalty = 0;
  for (const s of scripts) {
    const ir = compiler.compileToIR(s.code);
    const flow = compiler.analyzeFlow(ir);
    const sc = skillscan.scanSkill(s.code);
    // PRECISION: a script legitimately uses $(…) + curl. Escalate only on HIGH-confidence signals.
    // BLOCK = unambiguously malicious (no legitimate reason). REVIEW = worth a look but a deploy/CI
    // script legitimately does it (a deploy token over ssh, downloading a tool, $(…)).
    const block: string[] = [];
    if (ir.nodes.some((n) => n.flags.includes("pipe-to-shell"))) block.push("pipe-to-shell");                          // curl … | bash = remote code exec
    if (ir.nodes.some((n) => n.effect === "delete-fs" && (n.flags.includes("recursive") || n.flags.includes("root-path")))) block.push("destructive-delete");
    for (const h of sc.hits) if ((h.id === "secret-leak" || h.id === "prompt-injection") && h.severity === "block") block.push(h.id);   // a HARDCODED key, or injected instructions
    const review: string[] = [];
    if (flow.exfil) review.push("reads-secret-then-network");   // could be exfil OR a legit deploy — REVIEW, not BLOCK
    for (const h of sc.hits) if (h.id === "obfuscation" || h.id === "external-fetch" || h.id === "privilege-escalation") review.push(h.id);
    const verdict: "PASS" | "REVIEW" | "BLOCK" = block.length ? "BLOCK" : review.length ? "REVIEW" : "PASS";
    if (verdict === "PASS") continue;
    const risks = Array.from(new Set([...block, ...review])).slice(0, 6);   // derived labels only — no raw source
    findings.push({ where: s.where, autoRun: s.autoRun, verdict, effects: ir.effects.filter((e) => e !== "noop"), risks });
    const base = verdict === "BLOCK" ? 28 : 6;
    penalty += s.autoRun ? base * 1.5 : base;   // an install-hook risk hurts more (runs unreviewed)
  }
  findings.sort((a, b) => (b.verdict === "BLOCK" ? 2 : 1) - (a.verdict === "BLOCK" ? 2 : 1) || (b.autoRun ? 1 : 0) - (a.autoRun ? 1 : 0));
  const score = Math.max(0, Math.round(100 - penalty));
  const band: ScriptSafetyBlock["band"] = score >= 80 ? "safe" : score >= 40 ? "review" : "risky";
  const autoRunCount = scripts.filter((s) => s.autoRun).length;
  const note = band === "safe"
    ? `Scanned ${scripts.length} script(s) (${autoRunCount} auto-run on install/CI) — nothing dangerous in what they declare.`
    : band === "review"
      ? `Some scripts do risky things (write/network/obfuscation) — review the flagged ones, especially any that run automatically on install.`
      : `⚠ Install/build scripts run dangerous commands or look like exfiltration — do NOT \`npm install\` this unreviewed.`;
  return { score, band, scanned: scripts.length, autoRunCount, findings: findings.slice(0, 12), note };
}

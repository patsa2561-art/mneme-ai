/**
 * v2.19.87 — Five outlier CLI commands:
 *   mneme whistle scan|audit          (#8 AI Whistleblower)
 *   mneme funeral <repo-path>          (#9 AI Funeral)
 *   mneme socratic <file>              (#10 Reverse Stack Overflow)
 *   mneme deps predict <package>       (#11 Dependency Death Predictor)
 *   mneme confess [--svg out.svg]      (#12 AI Confessional)
 *
 * All five run Ollama-free + reuse existing Mneme primitives where
 * possible (compliance.dlp scrubber, pulse HMAC chain pattern, etc.).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── #8 WHISTLEBLOWER ──────────────────────────────────────────────────

export interface WhistleOptions {
  cwd: string;
  mode: "scan" | "audit";
  text?: string;
  filePath?: string;
  vendor?: string;
  limit?: number;
  json?: boolean;
}

export async function whistleCommand(opts: WhistleOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  if (opts.mode === "audit") {
    const incidents = core.whistleblower.readIncidents(repoRoot, { limit: opts.limit ?? 20 });
    if (opts.json) { process.stdout.write(JSON.stringify(incidents, null, 2) + "\n"); return; }
    process.stdout.write(`🕵️ MNEME WHISTLEBLOWER — audit log (${incidents.length})\n\n`);
    for (const inc of incidents) {
      const badge = inc.severity === "block" ? "🚨" : inc.severity === "warn" ? "⚠" : "ℹ";
      process.stdout.write(`  ${badge} ${inc.ts.slice(0, 19)} · ${inc.vendor.padEnd(12)} · ${inc.class}\n`);
      process.stdout.write(`     ${inc.rationale}\n     evidence: ${inc.evidence}\n\n`);
    }
    if (incidents.length === 0) process.stdout.write(`  (no incidents — your AI tooling is behaving)\n`);
    return;
  }

  // scan
  const text = opts.text ?? (opts.filePath ? readFileSync(opts.filePath, "utf8") : "");
  if (!text) { process.stderr.write("whistle scan requires --text \"...\" or --file <path>\n"); process.exit(1); return; }
  const result = core.whistleblower.scanWhistleAndRecord(repoRoot, text, { vendor: opts.vendor ?? "unknown" });
  if (opts.json) { process.stdout.write(JSON.stringify(result, null, 2) + "\n"); }
  else {
    process.stdout.write(`🕵️ MNEME WHISTLEBLOWER\n\n  ${result.summary}\n\n`);
    for (const inc of result.incidents) {
      const badge = inc.severity === "block" ? "🚨" : inc.severity === "warn" ? "⚠" : "ℹ";
      process.stdout.write(`  ${badge} ${inc.class}: ${inc.rationale}\n     evidence: ${inc.evidence}\n     context: …${inc.context}…\n\n`);
    }
  }
  if (result.verdict === "block") process.exit(2);
}

// ─── #9 AI FUNERAL ─────────────────────────────────────────────────────

export interface FuneralOptions {
  cwd: string;
  repoPath?: string;
  archived?: boolean;
  output?: string;
  tweet?: boolean;
  json?: boolean;
}

export async function funeralCommand(opts: FuneralOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const target = resolve(opts.repoPath ?? opts.cwd);
  if (!existsSync(target + "/.git")) {
    process.stderr.write(`Not a git repository: ${target}\n`); process.exit(1); return;
  }
  const stats = core.funeral.collectEulogyStats(target, { archived: opts.archived });
  const eulogy = core.funeral.renderEulogy(stats);
  const tombstone = core.funeral.renderTombstoneAscii(stats);
  const svg = core.funeral.renderTombstoneSvg(stats);
  const tweets = core.funeral.renderTweetThread(stats);

  if (opts.output) writeFileSync(opts.output, svg, "utf8");
  if (opts.json) { process.stdout.write(JSON.stringify({ stats, eulogy, tombstone, svgPath: opts.output ?? null, tweets }, null, 2) + "\n"); return; }

  process.stdout.write(`⚰️ AI FUNERAL — ${stats.repoName}\n\n`);
  process.stdout.write(tombstone + "\n\n");
  process.stdout.write(eulogy + "\n\n");
  if (opts.output) process.stdout.write(`  📜 SVG memorial card written: ${opts.output}\n\n`);
  if (opts.tweet) {
    process.stdout.write(`──── Tweet thread (copy-paste) ────\n\n`);
    tweets.forEach((t, i) => process.stdout.write(`${i + 1}/${tweets.length}\n${t}\n\n`));
  }
}

// ─── #10 SOCRATIC (REVERSE STACK OVERFLOW) ─────────────────────────────

export interface SocraticOptions {
  cwd: string;
  filePath?: string;
  text?: string;
  pickedHypothesisId?: string;
  userExplanation?: string;
  json?: boolean;
}

export async function socraticCommand(opts: SocraticOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const code = opts.text ?? (opts.filePath ? readFileSync(opts.filePath, "utf8") : "");
  if (!code) { process.stderr.write("socratic requires --file <path> or --text \"...\"\n"); process.exit(1); return; }
  const target = opts.filePath ?? "<stdin>";
  const reading = core.socratic.readSocratic(target, code);

  if (opts.pickedHypothesisId) {
    core.socratic.recordSocraticAnswer(opts.cwd, {
      target, pickedHypothesisId: opts.pickedHypothesisId,
      userExplanation: opts.userExplanation ?? "",
      ts: new Date().toISOString(),
    });
  }

  if (opts.json) { process.stdout.write(JSON.stringify(reading, null, 2) + "\n"); return; }
  process.stdout.write(`❓ REVERSE STACK OVERFLOW — ${target}\n\n`);
  process.stdout.write(`  Mneme noticed: ${reading.features.length === 0 ? "no strong signals — falling back to general hypotheses" : reading.features.join(" · ")}\n\n`);
  process.stdout.write(`  Three guesses about WHY you wrote it this way. Tell me which is right.\n\n`);
  for (const h of reading.hypotheses) {
    process.stdout.write(`  ${h.rank}. ${h.text}\n     [${h.id}] ${h.evidence}\n\n`);
  }
  process.stdout.write(`  When you pick:  mneme socratic --file <path> --picked <h_id> --explain "...."\n`);
}

// ─── #11 DEPENDENCY DEATH PREDICTOR ────────────────────────────────────

export interface DepsPredictOptions {
  cwd: string;
  packageName: string;
  json?: boolean;
}

function npmView(pkg: string): { latestPublishedAt?: string; deprecated?: boolean; maintainerCount?: number } {
  try {
    const json = execSync(`npm view ${pkg} time deprecated maintainers --json`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const parsed = JSON.parse(json);
    const time = parsed.time || {};
    // Find the latest published time.
    const versions = Object.keys(time).filter((k) => k !== "created" && k !== "modified");
    const latest = versions.length > 0 ? versions[versions.length - 1]! : null;
    return {
      latestPublishedAt: latest ? time[latest] : undefined,
      deprecated: typeof parsed.deprecated === "string" && parsed.deprecated.length > 0,
      maintainerCount: Array.isArray(parsed.maintainers) ? parsed.maintainers.length : undefined,
    };
  } catch { return {}; }
}

export async function depsPredictCommand(opts: DepsPredictOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const npm = npmView(opts.packageName);
  const monthsSinceLatest = npm.latestPublishedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(npm.latestPublishedAt)) / (30 * 24 * 3600_000)))
    : undefined;
  const report = core.depMortality.predictMortality({
    name: opts.packageName,
    latestPublishedAt: npm.latestPublishedAt,
    monthsSinceLatest,
    monthsSinceFeatureRelease: monthsSinceLatest, // proxy
    deprecated: npm.deprecated,
    maintainerCount: npm.maintainerCount,
  });
  if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); }
  else {
    const badge = report.band === "dead" ? "💀" : report.band === "moribund" ? "⚠️" : report.band === "watch" ? "👀" : report.band === "healthy" ? "✓" : "🌱";
    process.stdout.write(`💀 MNEME DEP MORTALITY — ${opts.packageName}\n\n`);
    process.stdout.write(`  ${badge} ${report.band.toUpperCase()}  ·  score=${report.score.toFixed(2)}  ·  P(abandoned in 18mo)=${(report.probability18mo * 100).toFixed(0)}%\n\n`);
    process.stdout.write(`  reasons:\n`);
    for (const r of report.reasons) {
      process.stdout.write(`    [${r.signal.padEnd(15)}] raw=${r.raw.toFixed(2)} · ${r.note}\n`);
    }
    process.stdout.write(`\n  ${report.recommendation}\n`);
  }
  if (report.band === "dead" || report.band === "moribund") process.exit(2);
}

// ─── #12 AI CONFESSIONAL ───────────────────────────────────────────────

export interface ConfessOptions {
  cwd: string;
  mode: "submit" | "list";
  vendor?: string;
  question?: string;
  aiAnswer?: string;
  truth?: string;
  category?: string;
  output?: string;
  limit?: number;
  json?: boolean;
}

export async function confessCommand(opts: ConfessOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = resolve(opts.cwd);

  if (opts.mode === "list") {
    const confs = core.aiConfessional.listConfessions(repoRoot, { limit: opts.limit ?? 20 });
    if (opts.json) { process.stdout.write(JSON.stringify(confs, null, 2) + "\n"); return; }
    process.stdout.write(`⛪ AI CONFESSIONAL — ${confs.length} confessions on the wall\n\n`);
    for (const c of confs) {
      process.stdout.write(`  ${c.id}  ${c.ts.slice(0,10)}  ${c.vendor.padEnd(12)}  ${c.category}\n`);
      process.stdout.write(`     "${c.falseClaim.slice(0, 80)}${c.falseClaim.length > 80 ? "…" : ""}"\n\n`);
    }
    return;
  }

  // submit
  if (!opts.vendor || !opts.aiAnswer || !opts.truth) {
    process.stderr.write("confess submit requires --vendor, --ai-answer, --truth (and optional --question / --category)\n");
    process.exit(1); return;
  }
  const conf = core.aiConfessional.formConfession({
    vendor: opts.vendor,
    userQuestion: opts.question ?? "",
    aiAnswer: opts.aiAnswer,
    realTruth: opts.truth,
    category: (opts.category as "math" | "fact" | "code" | "history" | "science" | "policy" | "other" | undefined) ?? "other",
  });
  const recorded = core.aiConfessional.recordConfession(repoRoot, conf);
  const svg = core.aiConfessional.renderConfessionCardSvg(recorded);
  if (opts.output) writeFileSync(opts.output, svg, "utf8");
  if (opts.json) { process.stdout.write(JSON.stringify({ confession: recorded, svgPath: opts.output ?? null }, null, 2) + "\n"); return; }
  process.stdout.write(`⛪ AI CONFESSIONAL — confession recorded\n\n`);
  process.stdout.write(`  id:       ${recorded.id}\n  vendor:   ${recorded.vendor}\n  category: ${recorded.category}\n\n`);
  process.stdout.write(`  ${recorded.liturgy.replace(/\n/g, "\n  ")}\n\n`);
  if (opts.output) process.stdout.write(`  📜 Share card written: ${opts.output}\n`);
  else process.stdout.write(`  (pass --output card.svg to write the shareable confession card)\n`);
}

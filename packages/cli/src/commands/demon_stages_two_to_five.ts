/**
 * `mneme teeth/wings/godmode/avatar` (v1.44.0)
 *
 * CLI surface for DEMON STAGES 2-5. Per feedback_ai_does_everything,
 * the AI agent runs these — the user just describes the outcome.
 * Subcommands are read-only by default; mutations are explicit.
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

// =====================================================================
// STAGE 2 — TEETH
// =====================================================================
export function registerTeethCommand(program: Command): void {
  const teeth = program
    .command("teeth")
    .description("DEMON STAGE 2 — bug-bounty harvester, ransom-proof vault, stake-weighted genome marketplace.");

  // 2.1 Bug-bounty harvester
  const bounty = teeth.command("bounty").description("Scan deps for known advisories + draft bounty reports (never auto-submits).");
  bounty
    .command("scan")
    .description("Scan repo's package.json against `.mneme/advisories/*.jsonl` and produce drafts.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethBountyHarvester } = await import("@mneme-ai/core");
      const r = teethBountyHarvester.harvestBounties(process.cwd());
      out(opts, r, [
        `scanned:   ${r.scanned} deps`,
        `drafted:   ${r.drafted.length}  ·  skipped: ${r.skipped.length}  ·  errors: ${r.errors.length}`,
        ...r.drafted.map((d) => `  + ${d.advisoryId} (${d.severity}) ${d.package}@${d.installedVersion} → ${d.reportPath}`),
      ]);
    });
  bounty
    .command("submitted")
    .description("List previously drafted reports (the submitted ledger).")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethBountyHarvester } = await import("@mneme-ai/core");
      const r = teethBountyHarvester.listSubmittedDrafts(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      if (r.length === 0) { process.stdout.write("(no drafts yet)\n"); return; }
      for (const d of r) process.stdout.write(`  ${d.at}  ${d.advisoryId.padEnd(20)} ${d.package}\n`);
    });

  // 2.2 Ransom vault
  const vault = teeth.command("vault").description("Ransomware-proof Merkle snapshots of `.mneme/`.");
  vault
    .command("snapshot")
    .description("Take a Merkle snapshot of `.mneme/`.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethRansomVault } = await import("@mneme-ai/core");
      const s = teethRansomVault.takeSnapshot(process.cwd());
      out(opts, s, [
        `snapshot:  ${s.takenAt}`,
        `root:      ${s.rootHash.slice(0, 16)}...`,
        `files:     ${s.fileCount}  ·  bytes: ${s.totalBytes}  ·  canary: ${s.canaryOk ? "ok" : "TRIPPED"}`,
      ]);
    });
  vault
    .command("verify")
    .description("Verify current `.mneme/` against the latest snapshot.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethRansomVault } = await import("@mneme-ai/core");
      const v = teethRansomVault.verifyVault(process.cwd());
      out(opts, v, [
        `outcome:   ${v.outcome}${v.silentEncryptionSuspected ? "  ⚠ SILENT-ENCRYPTION-SUSPECTED" : ""}`,
        `canary:    ${v.canaryOk ? "ok" : "TRIPPED"}`,
        `changed:   ${v.changed.length} files`,
        ...v.changed.slice(0, 10).map((c) => `  ${c.reason.padEnd(8)} ${c.path}`),
      ]);
    });
  vault
    .command("chain")
    .description("Verify the snapshot chain integrity.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethRansomVault } = await import("@mneme-ai/core");
      const c = teethRansomVault.verifyChain(process.cwd());
      out(opts, c, [`chain:     ${c.ok ? "ok" : `BROKEN at index ${c.brokenAt}`}  ·  length: ${c.length}`]);
    });

  // 2.3 Genome market
  const market = teeth.command("market").description("Stake-weighted vaccine genome marketplace (local, deterministic).");
  market
    .command("list")
    .description("List published cards + verdicts.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { teethGenomeMarket } = await import("@mneme-ai/core");
      const verdicts = teethGenomeMarket.computeAllVerdicts(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(verdicts, null, 2) + "\n"); return; }
      if (verdicts.length === 0) { process.stdout.write("(no cards published)\n"); return; }
      for (const v of verdicts) {
        const status = v.revoked ? "✗ REVOKED" : v.ratified ? "✓ RATIFIED" : "○ pending";
        process.stdout.write(`  ${status.padEnd(13)} ${v.cardId.padEnd(20)} stake=${v.netStake.toString().padStart(6)}  vouch=${v.vouchCount}  refute=${v.refuteCount}\n`);
      }
    });
}

// =====================================================================
// STAGE 3 — WINGS
// =====================================================================
export function registerWingsCommand(program: Command): void {
  const wings = program
    .command("wings")
    .description("DEMON STAGE 3 — continuous shipper, vendor arbitrage router, synthetic adversarial army.");

  // 3.2 Arbitrage
  const arb = wings.command("arbitrage").description("Recommend cheapest competent vendor for a task class.");
  arb
    .command("recommend <taskClass>")
    .description("Get a routing recommendation for a task class.")
    .option("--in <n>", "Estimated input tokens", (v) => parseInt(v, 10), 1000)
    .option("--out <n>", "Estimated output tokens", (v) => parseInt(v, 10), 500)
    .option("--json", "JSON output")
    .action(async (taskClass: string, opts: { in?: number; out?: number } & CommonOpts) => {
      const { wingsArbitrage } = await import("@mneme-ai/core");
      const r = wingsArbitrage.recommendRoute(process.cwd(), taskClass, opts.in ?? 1000, opts.out ?? 500);
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(`task:      ${r.taskClass}  (in=${r.estTokensIn} out=${r.estTokensOut})\n`);
      if (!r.recommended) { process.stdout.write(`recommend: NONE — ${r.reasoning}\n`); return; }
      process.stdout.write(`recommend: ${r.recommended.vendor} (${r.recommended.model})  $${r.recommended.estCostUsd.toFixed(6)}  rate-LB=${r.recommended.successRateLB}  trials=${r.recommended.trialsSeen}${r.recommended.diversityPick ? "  [diversity-pick]" : ""}\n`);
      process.stdout.write(`reason:    ${r.reasoning}\n`);
    });

  // 3.3 Synthetic army
  const army = wings.command("army").description("Generate adversarial test prompts ('soldiers').");
  army
    .command("generate")
    .description("Generate a deterministic batch from the local user-prompt corpus fingerprint.")
    .option("--count <n>", "Number of soldiers", (v) => parseInt(v, 10), 50)
    .option("--json", "JSON output")
    .action(async (opts: { count?: number } & CommonOpts) => {
      const { wingsSyntheticArmy } = await import("@mneme-ai/core");
      const a = wingsSyntheticArmy.generateArmy(process.cwd(), { count: opts.count });
      if (opts.json) { process.stdout.write(JSON.stringify(a, null, 2) + "\n"); return; }
      process.stdout.write(`generated: ${a.count} soldiers · fingerprint ${a.corpusFingerprint.slice(0, 12)}...\n`);
      for (const [k, v] of Object.entries(a.byClass)) process.stdout.write(`  ${k.padEnd(22)} ${v}\n`);
    });
}

// =====================================================================
// STAGE 4 — GOD MODE
// =====================================================================
export function registerGodModeCommand(program: Command): void {
  const god = program
    .command("godmode")
    .description("DEMON STAGE 4 — Mneme OS supervisor, compliance reporter, dead-vendor planner.");

  // 4.2 Compliance report
  god
    .command("compliance-report")
    .description("Generate a SOC2 / ISO 42001 / EU AI Act evidence report from local audit logs.")
    .option("--days <n>", "Window size in days", (v) => parseInt(v, 10), 30)
    .option("--json", "JSON output")
    .action(async (opts: { days?: number } & CommonOpts) => {
      const { godComplianceReporter } = await import("@mneme-ai/core");
      const days = opts.days ?? 30;
      const end = new Date();
      const start = new Date(end.getTime() - days * 86400 * 1000);
      const r = godComplianceReporter.generateComplianceReport(process.cwd(), { windowStart: start, windowEnd: end });
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(`report:    ${r.reportPath}\n`);
      process.stdout.write(`window:    ${r.windowStart} → ${r.windowEnd}\n`);
      process.stdout.write(`events:    ${r.totalEvents}\n`);
      for (const [fw, c] of Object.entries(r.coverageByFramework)) process.stdout.write(`  ${fw.padEnd(12)} ${c.covered}/${c.total} (${c.percent}%)\n`);
      process.stdout.write(`gaps:      ${r.gaps.length}\n`);
    });

  // 4.3 Dead-vendor planner
  const dv = god.command("dead-vendor").description("Detect deprecated/abandoned vendors and plan migrations.");
  dv
    .command("scan")
    .description("Show formally deprecated + soft-dead vendors.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { godDeadVendor } = await import("@mneme-ai/core");
      const r = godDeadVendor.scanDeadVendors(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(`formal:    ${r.formallyDeprecated.length}\n`);
      for (const d of r.formallyDeprecated) process.stdout.write(`  ${d.vendor} (${d.model}) — deprecated ${d.deprecatedAt}\n`);
      process.stdout.write(`soft:      ${r.softDeaths.length}\n`);
      for (const s of r.softDeaths) process.stdout.write(`  ${s.vendor} — last success ${s.lastSuccessAt ?? "never"} (${s.daysSilent}d silent)\n`);
    });
  dv
    .command("plan <vendor>")
    .description("Build a migration plan for a specific dead vendor.")
    .option("--json", "JSON output")
    .action(async (vendor: string, opts: CommonOpts) => {
      const { godDeadVendor } = await import("@mneme-ai/core");
      const p = godDeadVendor.buildMigrationPlan(process.cwd(), vendor);
      if (opts.json) { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); return; }
      process.stdout.write(`plan:      ${p.planPath}\n`);
      process.stdout.write(`migrate:   ${p.taskClassesToMigrate.length} task class(es)\n`);
      for (const r of p.replacements) process.stdout.write(`  ${r.taskClass.padEnd(20)} → ${r.recommendedVendor ?? "(manual)"}  (${(r.recommendedScore * 100).toFixed(0)}%, ${r.trialsForRec} trials)\n`);
    });
}

// =====================================================================
// STAGE 5 — AVATAR
// =====================================================================
export function registerAvatarCommand(program: Command): void {
  const avatar = program
    .command("avatar")
    .description("DEMON STAGE 5 — gossip mesh, vendor-neutral lingua stream, replicating-wisdom transfer.");

  // 5.1 Gossip mesh
  const mesh = avatar.command("mesh").description("Filesystem-based p2p wisdom sharing (no servers).");
  mesh
    .command("seen")
    .description("List recently seen mesh messages.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarGossipMesh } = await import("@mneme-ai/core");
      const r = avatarGossipMesh.listSeen(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      if (r.length === 0) { process.stdout.write("(no mesh activity yet)\n"); return; }
      for (const s of r.slice(-50)) process.stdout.write(`  ${s.at}  ${s.outcome.padEnd(20)} ${s.sender.padEnd(20)} ${s.id.slice(0, 12)}\n`);
    });
  mesh
    .command("quarantine")
    .description("List quota-exceeded messages held in quarantine.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarGossipMesh } = await import("@mneme-ai/core");
      const r = avatarGossipMesh.listQuarantine(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      if (r.length === 0) { process.stdout.write("(quarantine empty)\n"); return; }
      for (const m of r) process.stdout.write(`  ${m.emittedAt}  ${m.sender.padEnd(20)} ${m.kind.padEnd(12)} ${m.id.slice(0, 12)}\n`);
    });

  // 5.2 Lingua
  const lingua = avatar.command("lingua").description("Vendor-neutral knowledge stream (universal JSONL schema).");
  lingua
    .command("stream")
    .description("Emit the unified Mneme stream.")
    .option("--since <iso>", "Only events at or after this ISO timestamp")
    .option("--max <n>", "Max events", (v) => parseInt(v, 10), 1000)
    .option("--json", "JSON output (always; schema is the point)")
    .action(async (opts: { since?: string; max?: number } & CommonOpts) => {
      const { avatarLingua } = await import("@mneme-ai/core");
      const s = avatarLingua.emitStream(process.cwd(), { since: opts.since, maxEvents: opts.max });
      // Always JSON for this command — the whole point is interop
      process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    });
  lingua
    .command("schema")
    .description("Print the Lingua v1 schema descriptor.")
    .action(async () => {
      const { avatarLingua } = await import("@mneme-ai/core");
      process.stdout.write(JSON.stringify(avatarLingua.schema(), null, 2) + "\n");
    });

  // 5.3 Wisdom packs
  const pack = avatar.command("pack").description("Replicating-wisdom transfer packs (.mwt).");
  pack
    .command("create")
    .description("Pack the top-K ratified vaccines into a portable .mwt file.")
    .option("--sender <id>", "Donor sender id (defaults to git user)", "anonymous")
    .option("--top <n>", "Max vaccines per pack", (v) => parseInt(v, 10), 20)
    .option("--json", "JSON output")
    .action(async (opts: { sender?: string; top?: number } & CommonOpts) => {
      const { avatarReplicatingWisdom } = await import("@mneme-ai/core");
      const mnemeVersion = process.env["npm_package_version"] ?? "1.44.0";
      const p = avatarReplicatingWisdom.packWisdom(process.cwd(), { donorSender: opts.sender ?? "anonymous", donorMnemeVersion: mnemeVersion, topK: opts.top });
      if (opts.json) { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); return; }
      process.stdout.write(`packId:    ${p.packId.slice(0, 16)}...\n`);
      process.stdout.write(`vaccines:  ${p.vaccines.length}\n`);
      process.stdout.write(`metadata:  ratified=${p.metadata.ratifiedCount} revoked=${p.metadata.revokedCount} rejection-rate=${(p.metadata.rejectionRate * 100).toFixed(0)}%\n`);
    });
  pack
    .command("list")
    .description("List local packs.")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarReplicatingWisdom } = await import("@mneme-ai/core");
      const r = avatarReplicatingWisdom.listLocalPacks(process.cwd());
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      if (r.length === 0) { process.stdout.write("(no packs yet)\n"); return; }
      for (const p of r) process.stdout.write(`  ${p.packedAt}  ${p.packId.slice(0, 12)}  vaccines=${p.vaccines.length}  donor=${p.donorSender}\n`);
    });
}

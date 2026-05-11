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
    .description("Generate evidence report for 12 frameworks: SOC2 / ISO 42001 / EU AI Act + 9 banking (SOX / FFIEC / BCBS-239 / PCI-DSS / SR 11-7 / GLBA / MAS / HKMA / BoT).")
    .option("--days <n>", "Window size in days (default 30).", (v) => parseInt(v, 10), 30)
    .option("--framework <fw>", "Filter to a single framework. Comma-separate for multiple. e.g. --framework SOX,PCI-DSS.")
    .option("--json", "JSON output")
    .action(async (opts: { days?: number; framework?: string } & CommonOpts) => {
      const { godComplianceReporter } = await import("@mneme-ai/core");
      const days = opts.days ?? 30;
      const end = new Date();
      const start = new Date(end.getTime() - days * 86400 * 1000);
      const r = godComplianceReporter.generateComplianceReport(process.cwd(), { windowStart: start, windowEnd: end });

      // v1.49.0 -- optional framework filter for vertical use cases
      // (e.g. a US bank only cares about SOX/FFIEC/SR-11-7/PCI-DSS).
      const filter = opts.framework ? new Set(opts.framework.split(",").map((s) => s.trim())) : null;
      const framework2body: Record<string, string> = {
        "SOC2-CC":     "AICPA SOC 2 Common Criteria",
        "ISO-42001":   "ISO/IEC 42001 AI Management System",
        "EU-AI-ACT":   "EU AI Act 2024",
        "SOX":         "US Sarbanes-Oxley s.404",
        "FFIEC":       "US Federal Financial Institutions Examination Council",
        "BCBS-239":    "Basel Committee Risk Data Aggregation Principles",
        "PCI-DSS":     "Payment Card Industry Data Security Standard v4.0",
        "SR-11-7":     "US Federal Reserve Model Risk Management",
        "GLBA":        "US Gramm-Leach-Bliley Act (financial privacy)",
        "MAS-TRM":     "Monetary Authority of Singapore -- Tech Risk Mgmt",
        "HKMA-TM-G-1": "Hong Kong Monetary Authority TM-G-1",
        "BoT-IT-RM":   "Bank of Thailand IT Risk Management Notification",
      };

      if (opts.json) {
        const filtered = filter ? Object.fromEntries(Object.entries(r.coverageByFramework).filter(([fw]) => filter.has(fw))) : r.coverageByFramework;
        process.stdout.write(JSON.stringify({ ...r, coverageByFramework: filtered }, null, 2) + "\n");
        return;
      }

      process.stdout.write("Mneme Compliance Evidence Report (v1.49 -- 12 frameworks)\n");
      process.stdout.write("─".repeat(72) + "\n");
      process.stdout.write(`report saved:     ${r.reportPath}\n`);
      process.stdout.write(`window:           ${r.windowStart}  →  ${r.windowEnd}\n`);
      process.stdout.write(`events analyzed:  ${r.totalEvents}\n\n`);
      process.stdout.write("Coverage by framework:\n");
      for (const [fw, c] of Object.entries(r.coverageByFramework)) {
        if (filter && !filter.has(fw)) continue;
        const bar = "█".repeat(Math.round(c.percent / 5)).padEnd(20);
        process.stdout.write(`  ${fw.padEnd(13)} ${c.covered}/${c.total}  ${bar} ${String(c.percent).padStart(3)}%   ${framework2body[fw] ?? ""}\n`);
      }
      process.stdout.write(`\ngaps (controls with zero evidence): ${r.gaps.length}\n`);
      if (r.gaps.length > 0) {
        process.stdout.write("First 10:\n");
        for (const g of r.gaps.slice(0, 10)) process.stdout.write(`  · ${g.framework} ${g.controlId} -- ${g.title}\n`);
      }
      process.stdout.write("\n");
      process.stdout.write("> ⚠ This is audit-trail-ready evidence, NOT a certification. Bring your own auditor.\n");
      process.stdout.write("> Filter to your jurisdiction:  --framework SOX,FFIEC,SR-11-7  (US bank)\n");
      process.stdout.write(">                              --framework MAS-TRM  (SG)  HKMA-TM-G-1  (HK)  BoT-IT-RM  (TH)\n");
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
  // v1.49.0 — default `status` subcommand is what testers naturally type.
  // Summarises seen + quarantine + secret state so the operator gets a
  // single answer to "is the mesh healthy".
  mesh
    .command("status", { isDefault: true })
    .description("Show mesh health: seen-msg counts, quarantine size, secret state. [DEFAULT]")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarGossipMesh } = await import("@mneme-ai/core");
      const seen = avatarGossipMesh.listSeen(process.cwd());
      const quarantine = avatarGossipMesh.listQuarantine(process.cwd());
      const counts = { accepted: 0, duplicate: 0, "bad-signature": 0, "quota-exceeded": 0, "hops-exceeded": 0, "trusted-auto-apply": 0 } as Record<string, number>;
      for (const s of seen) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
      const senders = new Set(seen.map((s) => s.sender));
      const summary = {
        mesh: "filesystem-gossip",
        seenTotal: seen.length,
        uniqueSenders: senders.size,
        outcomeCounts: counts,
        quarantineSize: quarantine.length,
      };
      if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
      process.stdout.write("Mneme mesh — Stage 5.1 gossip mesh\n");
      process.stdout.write("─".repeat(72) + "\n");
      process.stdout.write(`seen total:        ${seen.length} messages\n`);
      process.stdout.write(`unique senders:    ${senders.size}\n`);
      process.stdout.write(`accepted:          ${counts.accepted}\n`);
      process.stdout.write(`duplicates:        ${counts.duplicate}\n`);
      process.stdout.write(`bad signatures:    ${counts["bad-signature"]}  (cross-mesh isolation working)\n`);
      process.stdout.write(`quota-exceeded:    ${counts["quota-exceeded"]}  (in quarantine)\n`);
      process.stdout.write(`trusted auto-apply: ${counts["trusted-auto-apply"]}\n`);
      process.stdout.write(`quarantine:        ${quarantine.length} held messages\n`);
      process.stdout.write("\n");
      process.stdout.write("Tell your AI: \"mesh seen / mesh quarantine\" for per-message detail.\n");
    });
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
  // v1.49.0 — default `status` shows the schema descriptor + the latest
  // event count, so testers see at a glance whether the stream is alive.
  lingua
    .command("status", { isDefault: true })
    .description("Show Lingua schema version + event totals across the unified stream. [DEFAULT]")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarLingua } = await import("@mneme-ai/core");
      const schema = avatarLingua.schema();
      const stream = avatarLingua.emitStream(process.cwd(), { maxEvents: 1 });
      const totals = avatarLingua.emitStream(process.cwd(), { maxEvents: 10000 });
      const summary = { schema, latestEvent: stream.events[0] ?? null, totalEmitted: totals.totalEmitted, totalRead: totals.totalRead, kindsCovered: schema.kinds.length };
      if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
      process.stdout.write("Mneme Lingua — Stage 5.2 vendor-neutral knowledge stream\n");
      process.stdout.write("─".repeat(72) + "\n");
      process.stdout.write(`schema:           v${schema.version} (${schema.topLevel.length} top-level fields)\n`);
      process.stdout.write(`event kinds:      ${schema.kinds.length} (${schema.kinds.join(", ")})\n`);
      process.stdout.write(`events emitted:   ${totals.totalEmitted}\n`);
      process.stdout.write(`latest at:        ${stream.events[0]?.at ?? "(empty)"}\n`);
      process.stdout.write("\n");
      process.stdout.write("Tell your AI: \"lingua stream\" for the full JSONL output (interop with any vendor).\n");
    });
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
  // v1.49.0 — default `status` lists local packs + inheritance log so
  // testers don't have to remember separate `list` / `inherited` calls.
  pack
    .command("status", { isDefault: true })
    .description("Show local wisdom packs + inheritance receipts. [DEFAULT]")
    .option("--json", "JSON output")
    .action(async (opts: CommonOpts) => {
      const { avatarReplicatingWisdom } = await import("@mneme-ai/core");
      const local = avatarReplicatingWisdom.listLocalPacks(process.cwd());
      const inherits = avatarReplicatingWisdom.listInheritances(process.cwd());
      const summary = {
        localPacks: local.length,
        inherited: inherits.length,
        latestPack: local[local.length - 1] ?? null,
        latestInherit: inherits[inherits.length - 1] ?? null,
      };
      if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
      process.stdout.write("Mneme wisdom packs — Stage 5.3\n");
      process.stdout.write("─".repeat(72) + "\n");
      process.stdout.write(`local packs:      ${local.length}\n`);
      process.stdout.write(`inherited from:   ${inherits.length} packs\n`);
      if (local.length > 0) {
        const last = local[local.length - 1]!;
        process.stdout.write(`latest pack:      ${last.packId.slice(0, 16)}  (${last.vaccines.length} vaccines, donor=${last.donorSender})\n`);
      }
      process.stdout.write("\n");
      process.stdout.write("Tell your AI: \"create a wisdom pack\" / \"list local packs\" for actions.\n");
    });
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

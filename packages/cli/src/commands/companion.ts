/**
 * `mneme companion` (v1.42.0) — manage the Companion Protocol surface
 * for the active AI vendor.
 *
 * Subcommands:
 *   show                              — render the full companion block (what the AI sees in the pulse)
 *   soul show [vendor]                — read the diary for a vendor (default: claude-opus-4-7)
 *   soul commit <vendor> "<text>"     — record a new commitment
 *   soul kept|broken <vendor> "<text>"— mark a commitment kept / broken
 *   soul list                         — list every vendor with a soul on disk
 *   consent grant <name>              — write a fresh user-consent grant
 *   consent revoke                    — delete the consent file
 *   consent show                      — print the current grant + freshness
 *   consent renew                     — re-sign with same grant text + today's date
 *   pheromone show [--vendor X]       — list hot trails (decayed)
 *   pheromone deposit <vendor> <target> [--weight N] — manual deposit (testing)
 *   contract list [--vendor X]        — show active contracts + stats
 *   contract sign <vendor> <template> — sign a built-in template (see CONTRACT_TEMPLATES)
 *   contract event <id> <vendor> <kind> [--note "text"] [--value N]
 *   template show [vendor]            — show the active per-vendor template
 *   template list                     — list every template in the registry
 *
 * Design contract: every subcommand is read-mostly for the user. Writes
 * are explicit (consent grant, soul commit, contract sign) and idempotent.
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

const DEFAULT_VENDOR = "claude-opus-4-7";

export function registerCompanionCommand(program: Command): void {
  const cmp = program
    .command("companion")
    .description("MNEME COMPANION PROTOCOL — soul · consent · pheromone · contract · template surface for the active AI vendor.");

  // ── show (the headline) ───────────────────────────────────────────────
  cmp
    .command("show")
    .description("Render the full companion block (the same text the AI sees in the pulse).")
    .option("--vendor <v>", "Vendor slug to render for", DEFAULT_VENDOR)
    .option("--json", "JSON output")
    .action(async (opts: { vendor: string } & CommonOpts) => {
      const { aiSoul, userConsent, aiPheromone, aiContracts, vendorPulseTemplates } = await import("@mneme-ai/core");
      const repo = process.cwd();
      const soul = aiSoul.readSoul(repo, opts.vendor);
      const blocks: string[] = [];
      const soulText = aiSoul.renderSoulBlock(soul);
      if (soulText) blocks.push(soulText);
      const consentText = userConsent.renderConsentBlock(repo);
      if (consentText) blocks.push(consentText);
      const pheromoneText = aiPheromone.renderPheromoneBlock(repo);
      if (pheromoneText) blocks.push(pheromoneText);
      const contractText = aiContracts.renderContractBlock(repo, opts.vendor);
      if (contractText) blocks.push(contractText);
      const templateText = vendorPulseTemplates.renderTemplateBlock(repo, opts.vendor);
      if (templateText) blocks.push(templateText);
      const text = blocks.join("\n\n");
      out(opts, { vendor: opts.vendor, blocks, text }, text ? [text] : ["(companion surface is empty — no soul / consent / pheromone / contract / template yet for " + opts.vendor + ")"]);
    });

  // ── soul subcommands ──────────────────────────────────────────────────
  const soul = cmp.command("soul").description("AI Soul Mirror — the diary Mneme keeps on each vendor's behalf.");
  soul
    .command("show [vendor]")
    .description("Read the diary for a vendor.")
    .option("--json", "JSON output")
    .action(async (vendor: string | undefined, opts: CommonOpts) => {
      const { aiSoul } = await import("@mneme-ai/core");
      const v = vendor ?? DEFAULT_VENDOR;
      const s = aiSoul.readSoul(process.cwd(), v);
      out(opts, s, [aiSoul.renderSoulBlock(s, 6)]);
    });
  soul
    .command("commit <vendor> <text>")
    .description("Record a new (open) commitment under <vendor>'s diary.")
    .action(async (vendor: string, text: string) => {
      const { aiSoul } = await import("@mneme-ai/core");
      const s = aiSoul.recordCommitment(process.cwd(), vendor, text);
      process.stdout.write(`✓ Committed under ${vendor}: "${text}" (${s.pastCommitments.length} total commitment(s))\n`);
    });
  soul
    .command("kept <vendor> <text>")
    .description("Mark the matching open commitment as KEPT.")
    .action(async (vendor: string, text: string) => {
      const { aiSoul } = await import("@mneme-ai/core");
      const s = aiSoul.recordOutcome(process.cwd(), vendor, "promise-kept", text);
      process.stdout.write(`✓ Kept commitment for ${vendor}. Lifetime compliance: ${(s.complianceLifetime * 100).toFixed(1)}%\n`);
    });
  soul
    .command("broken <vendor> <text>")
    .description("Mark the matching open commitment as BROKEN.")
    .action(async (vendor: string, text: string) => {
      const { aiSoul } = await import("@mneme-ai/core");
      const s = aiSoul.recordOutcome(process.cwd(), vendor, "promise-broken", text);
      process.stdout.write(`✗ Broken commitment for ${vendor}. Lifetime compliance: ${(s.complianceLifetime * 100).toFixed(1)}%\n`);
    });
  soul
    .command("list")
    .description("List every vendor with a soul on disk.")
    .action(async () => {
      const { aiSoul } = await import("@mneme-ai/core");
      const all = aiSoul.listSouls(process.cwd());
      if (all.length === 0) process.stdout.write("(no vendor souls yet — Mneme writes one on first compliance event)\n");
      else for (const v of all) process.stdout.write(`  ${v}\n`);
    });

  // ── consent subcommands ───────────────────────────────────────────────
  const cons = cmp.command("consent").description("User Consent Vault — the user's one-time grant that the pulse replays as tier-1 instruction.");
  cons
    .command("grant <signedBy>")
    .description("Write a fresh user-consent grant. The grant text quotes the user verbatim into every pulse.")
    .option("--text <t>", "Override the default grant text")
    .option("--renewal-days <n>", "Days until renewal nag", (v) => parseInt(v, 10), 30)
    .action(async (signedBy: string, opts: { text?: string; renewalDays: number }) => {
      const { userConsent } = await import("@mneme-ai/core");
      const rec = userConsent.grantConsent(process.cwd(), { signedBy, grantText: opts.text, renewalDays: opts.renewalDays });
      process.stdout.write(`✓ Consent granted by ${rec.signedBy} on ${rec.signedAt} (HMAC ${rec.signature.slice(0, 8)}…). Renewal in ${rec.renewalDays} days.\n`);
    });
  cons
    .command("revoke")
    .description("Delete the consent file. The pulse stops quoting the grant.")
    .action(async () => {
      const { userConsent } = await import("@mneme-ai/core");
      const ok = userConsent.revokeConsent(process.cwd());
      process.stdout.write(ok ? "✓ Consent revoked.\n" : "(no consent on disk — nothing to revoke)\n");
    });
  cons
    .command("show")
    .description("Print the current grant + freshness status.")
    .action(async () => {
      const { userConsent } = await import("@mneme-ai/core");
      const text = userConsent.renderConsentBlock(process.cwd());
      process.stdout.write(text || "(no consent on disk — say to your AI: 'grant Mneme consent on this repo')\n");
    });
  cons
    .command("renew")
    .description("Re-sign the existing grant with today's date.")
    .action(async () => {
      const { userConsent } = await import("@mneme-ai/core");
      const rec = userConsent.readConsent(process.cwd());
      if (!rec) { process.stdout.write("(no consent on disk — say to your AI: 'grant Mneme consent on this repo')\n"); return; }
      const fresh = userConsent.grantConsent(process.cwd(), { signedBy: rec.signedBy, grantText: rec.grantText, renewalDays: rec.renewalDays });
      process.stdout.write(`✓ Consent renewed by ${fresh.signedBy} on ${fresh.signedAt}.\n`);
    });

  // ── pheromone subcommands ─────────────────────────────────────────────
  const phe = cmp.command("pheromone").description("AI Pheromone Colony — stigmergy applied to AI tool calls.");
  phe
    .command("show")
    .description("List hot trails with decay applied.")
    .option("--vendor <v>", "Filter to one vendor's deposits")
    .option("--top <n>", "Show top N trails", (v) => parseInt(v, 10), 10)
    .action(async (opts: { vendor?: string; top: number }) => {
      const { aiPheromone } = await import("@mneme-ai/core");
      const trails = aiPheromone.readTrails(process.cwd(), { topK: opts.top, vendor: opts.vendor });
      if (trails.length === 0) { process.stdout.write("(no pheromone trails yet — AI tool calls deposit pheromones automatically)\n"); return; }
      for (const t of trails) process.stdout.write(`  ${t.target}  strength=${t.strength.toFixed(2)}  touches=${t.touches}  vendors=${t.vendors.join(",")}\n`);
    });
  phe
    .command("deposit <vendor> <target>")
    .description("Manually deposit a pheromone (mainly for testing / scripted instrumentation).")
    .option("--weight <n>", "Deposit weight", (v) => parseFloat(v), 1)
    .action(async (vendor: string, target: string, opts: { weight: number }) => {
      const { aiPheromone } = await import("@mneme-ai/core");
      aiPheromone.deposit(process.cwd(), vendor, target, opts.weight);
      process.stdout.write(`✓ Deposited weight=${opts.weight} on ${target} for ${vendor}.\n`);
    });

  // ── contract subcommands ──────────────────────────────────────────────
  const con = cmp.command("contract").description("Want-Match Contracts — bilateral barter between AI vendor and Mneme.");
  con
    .command("list")
    .description("Show active contracts + bilateral compliance.")
    .option("--vendor <v>", "Filter to one vendor")
    .action(async (opts: { vendor?: string }) => {
      const { aiContracts } = await import("@mneme-ai/core");
      const stats = aiContracts.computeStats(process.cwd(), opts.vendor);
      if (stats.length === 0) { process.stdout.write("(no contracts yet — sign one with: mneme companion contract sign <vendor> <template-id>)\n"); return; }
      for (const s of stats) process.stdout.write(`  ${s.contractId}  vendor=${s.vendor}  ai=${(s.aiCompliance * 100).toFixed(0)}% mneme=${(s.mnemeCompliance * 100).toFixed(0)}%  value(ai/mneme)=${s.valueToAi}/${s.valueToMneme}\n`);
    });
  con
    .command("sign <vendor> <templateId>")
    .description("Sign a built-in contract template (see `mneme companion contract templates`).")
    .action(async (vendor: string, templateId: string) => {
      const { aiContracts } = await import("@mneme-ai/core");
      const tpl = aiContracts.CONTRACT_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) { process.stdout.write(`✗ Unknown template "${templateId}". Try one of: ${aiContracts.CONTRACT_TEMPLATES.map((t) => t.id).join(", ")}\n`); process.exitCode = 1; return; }
      const signed = aiContracts.signContract(process.cwd(), vendor, { aiProvides: tpl.aiProvides, mnemeProvides: tpl.mnemeProvides, valueMetric: tpl.valueMetric });
      process.stdout.write(`✓ Signed contract ${signed.id} for ${vendor}: ${signed.aiProvides} ⇄ ${signed.mnemeProvides}\n`);
    });
  con
    .command("templates")
    .description("List the built-in contract templates.")
    .action(async () => {
      const { aiContracts } = await import("@mneme-ai/core");
      for (const t of aiContracts.CONTRACT_TEMPLATES) process.stdout.write(`  ${t.id}: ${t.aiProvides}  ⇄  ${t.mnemeProvides}\n`);
    });
  con
    .command("event <contractId> <vendor> <kind>")
    .description("Record a contract event (kind: signed | ai-fulfilled | mneme-fulfilled | ai-breached | mneme-breached | revoked).")
    .option("--note <t>")
    .option("--value <n>", "", (v) => parseFloat(v))
    .action(async (contractId: string, vendor: string, kind: string, opts: { note?: string; value?: number }) => {
      const { aiContracts } = await import("@mneme-ai/core");
      aiContracts.recordEvent(process.cwd(), contractId, vendor, kind as Parameters<typeof aiContracts.recordEvent>[3], opts.note, opts.value);
      process.stdout.write(`✓ Recorded ${kind} on ${contractId} for ${vendor}.\n`);
    });

  // ── template subcommands ──────────────────────────────────────────────
  const tpl = cmp.command("template").description("Per-Vendor Pulse Templates — Mneme adapts the pulse format to each AI's attention pattern.");
  tpl
    .command("show [vendor]")
    .description("Show which template is active for a vendor.")
    .action(async (vendor: string | undefined) => {
      const { vendorPulseTemplates } = await import("@mneme-ai/core");
      const v = vendor ?? DEFAULT_VENDOR;
      const t = vendorPulseTemplates.pickTemplate(process.cwd(), v);
      process.stdout.write(`vendor=${t.vendor}\nlayout=${t.layout}\nmaxChars=${t.maxChars}\ndupActionAtTop=${t.duplicateActionAtTop}\nrationale: ${t.rationale}\n`);
    });
  tpl
    .command("list")
    .description("List every vendor template in the registry.")
    .action(async () => {
      const { vendorPulseTemplates } = await import("@mneme-ai/core");
      for (const t of vendorPulseTemplates.listTemplates(process.cwd())) process.stdout.write(`  ${t.vendor}  ${t.layout}  maxChars=${t.maxChars}  dupTop=${t.duplicateActionAtTop}\n`);
    });
}

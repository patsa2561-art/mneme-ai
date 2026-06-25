/**
 * `mneme agora` (v3.153.0) — the trust referee for AI-agent commerce.
 *
 *   screen — screen one product listing the AI agent is about to recommend
 *   rank   — re-rank a list of listings by TRUST (neutralize injected/paid placement)
 *
 *   echo '{"title":"240W Cable","description":"...","rating":5,"reviews":12,"sold":3}' | mneme agora screen
 *   mneme agora rank --file listings.json --query "240W charger"
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { agora } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const icon = (t: string) => (t === "TRUSTED" ? "🟢" : t === "CAUTION" ? "🟠" : "🔴");

export function registerAgoraCommands(program: Command): void {
  const c = program.command("agora")
    .description("🏛 AGORA — the trust referee for AI-agent commerce. When an AI shops for you, AGORA screens each product LISTING for (1) injection that manipulates the agent, (2) fake-review/fake-sales anomalies, (3) unverifiable claims — and re-ranks results by TRUST, not by who gamed the algorithm. ★HONEST: detects manipulation signals + injection in the listing — it can't verify a physical product is genuine.");

  c.command("screen").description("screen ONE listing (JSON on --file or stdin)")
    .option("--file <file>", "listing JSON {title,description,claims,price,rating,reviews,sold,sellerAgeDays}")
    .option("--query <q>", "the shopper's query", "")
    .option("--json", "JSON")
    .action((o: { file?: string; query?: string; json?: boolean }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); } catch { out("⛔ provide --file <listing.json> or pipe JSON on stdin"); process.exitCode = 2; return; }
      let listing: unknown; try { listing = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const v = agora.screenListing(o.query || "", listing as Parameters<typeof agora.screenListing>[1]);
      if (o.json) { out(JSON.stringify(v, null, 2)); return; }
      out(`${icon(v.trust)} ${v.trust} (${v.score}/100) — ${v.product}`);
      for (const w of v.why) out(`   ${w}`);
      if (v.trust === "MANIPULATED") process.exitCode = 1;
    });

  c.command("rank").description("re-rank a list of listings by trust (JSON array on --file or stdin)")
    .option("--file <file>", "listings JSON array")
    .option("--query <q>", "the shopper's query", "")
    .option("--json", "JSON")
    .action((o: { file?: string; query?: string; json?: boolean }) => {
      let raw = "";
      try { raw = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); } catch { out("⛔ provide --file <listings.json> or pipe a JSON array"); process.exitCode = 2; return; }
      let listings: unknown; try { listings = JSON.parse(raw); } catch { out("⛔ not valid JSON"); process.exitCode = 2; return; }
      const ranked = agora.rankByTrust(o.query || "", listings as Parameters<typeof agora.rankByTrust>[1]);
      if (o.json) { out(JSON.stringify(ranked, null, 2)); return; }
      out(`🏛 re-ranked ${ranked.length} listing(s) by TRUST (honest first):`);
      ranked.forEach((r, i) => { out(`  ${i + 1}. ${icon(r.verdict.trust)} ${r.verdict.trust} (${r.verdict.score}) — ${r.verdict.product}`); if (r.verdict.why[0] && r.verdict.trust !== "TRUSTED") out(`       ${r.verdict.why.find((w) => w.startsWith("🚨") || w.startsWith("⚠️")) || ""}`); });
    });
}

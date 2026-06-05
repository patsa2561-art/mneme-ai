/**
 * `mneme geo` (v2.197.0) — GEOLOGICAL MEMORY: the compliant, self-cleaning ledger.
 *   geo add <text>        — seed a raw entry
 *   geo metamorphose      — run a geological cycle: old+idle raw → abstract (purged+signed) → axiom
 *   geo forget <needle>   — right-to-be-forgotten: purge matching raw NOW + signed tombstone
 *   geo verify            — verify every purge proof + the audit chain OFFLINE
 *   geo status            — tiers + raw bytes reclaimed + compliance
 *
 * Memory does not pile up forever — it metamorphoses: the WISDOM is kept, the RAW is
 * destroyed, provably. Right-to-be-forgotten by construction; no database bloat.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { geo } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const statePath = (cwd: string) => join(cwd, ".mneme", "geo", "state.json");
function load(cwd: string): geo.GeoState { const p = statePath(cwd); if (!existsSync(p)) return geo.emptyGeo(); try { return JSON.parse(readFileSync(p, "utf8")) as geo.GeoState; } catch { return geo.emptyGeo(); } }
function save(cwd: string, s: geo.GeoState): void { mkdirSync(join(cwd, ".mneme", "geo"), { recursive: true }); writeFileSync(statePath(cwd), JSON.stringify(s), "utf8"); }

export function registerGeoCommands(program: Command): void {
  const g = program.command("geo").description("🌋 GEOLOGICAL MEMORY — the compliant, self-cleaning ledger. Raw dissolves to abstract→axiom over time; the wisdom is kept, the raw is destroyed (provably). Right-to-be-forgotten by construction.");

  g.command("add <text...>").description("Seed a raw memory entry.").action((text: string[]) => {
    const cwd = process.cwd(); const raw = text.join(" ");
    const id = "r:" + createHash("sha256").update(raw + Date.now()).digest("hex").slice(0, 12);
    save(cwd, geo.seedRaw(load(cwd), { id, raw, ts: Date.now() }));
    out(`✓ seeded raw entry ${id} (${Buffer.byteLength(raw, "utf8")}b). It will metamorphose with age.`);
  });

  g.command("metamorphose").description("Run a geological cycle: old+idle raw → abstract (purged + signed) → axiom. Idempotent; safe to run on the daemon's idle tick.")
    .option("--decay-days <n>", "age past which raw decays", "90").option("--idle-days <n>", "no-access window required", "30")
    .action((opts: { decayDays?: string; idleDays?: string }) => {
      const cwd = process.cwd(); const before = geo.geoStats(load(cwd));
      const after = geo.metamorphose(cwd, load(cwd), Date.now(), { decayDays: parseInt(opts.decayDays ?? "90", 10), idleDays: parseInt(opts.idleDays ?? "30", 10) });
      save(cwd, after); const st = geo.geoStats(after);
      out(`🌋 metamorphosed · raw ${before.raw}→${st.raw} · abstract ${st.abstract} · axiom ${st.axiom} · ${st.rawBytesReclaimed}b raw reclaimed (destroyed + signed-purged).`);
    });

  g.command("forget <needle>").description("Right-to-be-forgotten: purge any raw matching <needle> NOW + emit a signed tombstone (no content survives).")
    .action((needle: string) => {
      const cwd = process.cwd(); const after = geo.forget(cwd, load(cwd), needle, Date.now()); save(cwd, after);
      const gone = !geo.containsRaw(after, needle);
      out(`${gone ? "✓" : "✗"} forget "${needle}" — ${gone ? "purged + signed tombstone (verifiable)" : "nothing matched"}.`);
    });

  g.command("verify").description("Verify every purge proof (Ed25519, offline) + the metamorphosis audit chain. Exit 2 on failure.")
    .action(() => {
      const v = geo.verifyGeo(load(process.cwd()));
      out(`🌋 purge proofs ${v.proofsValid}/${v.proofsTotal} valid · audit chain ${v.chainIntact ? "intact ✓" : `BROKEN at ${v.brokenAt} ✗`} — ${v.ok ? "compliant: raw was provably destroyed, wisdom + proof remain." : "issues found"}`);
      if (!v.ok) process.exitCode = 2;
    });

  g.command("status", { isDefault: true }).description("Tiers + reclaimed bytes + compliance.").action(() => {
    const cwd = process.cwd(); const s = load(cwd); const st = geo.geoStats(s); const v = geo.verifyGeo(s);
    if (!s.cells.length) { out("geo memory empty — `mneme geo add <text>` to seed, then `mneme geo metamorphose`."); return; }
    out(`🌋 Geological memory: raw ${st.raw} · abstract ${st.abstract} · axiom ${st.axiom} · purged ${st.purged} (${st.rawBytesReclaimed}b reclaimed)`);
    out(`   compliance: ${v.proofsValid}/${v.proofsTotal} purge proofs valid · chain ${v.chainIntact ? "intact ✓" : "BROKEN ✗"} — the wisdom stays, the raw is provably gone.`);
  });
}

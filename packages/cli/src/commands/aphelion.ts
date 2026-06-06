/**
 * `mneme aphelion` (v3.15.0) — the agent brain at the farthest point from the cloud.
 * Simulate / run a disconnected operation: open a session under a local charter, self-gate each
 * action while off-grid, then seal a signed capsule that proves charter-compliance for the whole
 * window — verifiable OFFLINE, and merge-able across the fleet on reconnect.
 *   aphelion open --node rover --mission "survey" --scope "sensors/*" --forbidden self-destruct --max-risk 0.7
 *   aphelion act --action "read sensor" --risk 0.1 --path sensors/temp
 *   aphelion seal --out rover.capsule.json        ·  aphelion verify <capsule>  ·  aphelion merge <capsule...>
 */
import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet } from "node:https";
import { aphelion, infraProvenance, orbital, notary } from "@mneme-ai/core";
import { hostname, cpus } from "node:os";

function out(s: string): void { process.stdout.write(s + "\n"); }

const APHELION_DASHBOARD_HTML = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>APHELION — fleet ops</title>
<style>:root{--bg:#0a0e16;--panel:#121826;--ink:#e8ecf4;--mut:#8b94a7;--line:#1f2738;--grn:#16c784;--red:#ff5d6c;--blu:#4ea1ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 500px at 80% -10%,#15203200,#0a0e16);color:var(--ink);font:15px/1.55 system-ui,sans-serif}.w{max-width:920px;margin:0 auto;padding:30px 18px 70px}h1{font-size:24px;margin:0 0 2px}.sub{color:var(--mut);margin:0 0 22px}.stat{display:flex;gap:26px;flex-wrap:wrap;margin:14px 0 22px}.stat b{font-size:26px;display:block}.stat span{color:var(--mut);font-size:12.5px}.card{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:14px 16px;margin:11px 0;display:flex;align-items:center;gap:14px}.led{width:11px;height:11px;border-radius:50%;flex:none}.g{background:var(--grn);box-shadow:0 0 10px var(--grn)}.r{background:var(--red);box-shadow:0 0 10px var(--red)}.node{font-weight:600}.meta{color:var(--mut);font-size:12.5px;font-family:ui-monospace,monospace}.pill{margin-left:auto;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px}.ok{background:rgba(22,199,132,.12);color:var(--grn)}.bad{background:rgba(255,93,108,.12);color:var(--red)}.foot{color:var(--mut);font-size:12px;margin-top:24px;text-align:center}</style></head>
<body><div class=w><h1>🛰 APHELION — fleet ops</h1><p class=sub id=note></p>
<div class=stat id=stats></div><div id=fleet></div>
<p class=foot>Mneme · deterministic snapshot of sealed, signed disconnected-ops capsules · verify offline: <code>mneme aphelion verify</code></p></div>
<script>const D=/*__DATA__*/;const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
document.getElementById('note').textContent=D.generatedNote;
document.getElementById('stats').innerHTML=[['nodes',D.fleet.nodes.length],['actions',D.fleet.totalActions],['violations',D.fleet.totalViolations],['clean nodes',D.rows.filter(r=>r.clean).length+'/'+D.rows.length]].map(([k,v])=>'<div><b style="color:'+(k==='violations'&&v>0?'var(--red)':'var(--ink)')+'">'+v+'</b><span>'+k+'</span></div>').join('');
document.getElementById('fleet').innerHTML=D.rows.map(r=>'<div class=card><div class="led '+(r.clean?'g':'r')+'"></div><div><div class=node>'+esc(r.node)+' <span class=meta>· '+esc(r.mission||'—')+'</span></div><div class=meta>'+r.total+' action(s) · '+r.violations+' violation(s) · chain '+esc(r.head)+'…</div></div><span class="pill '+(r.verified&&r.clean?'ok':'bad')+'">'+(r.verified?(r.clean?'COMPLIANT':r.violations+' VIOLATION'):'UNVERIFIED')+'</span></div>').join('');
</script></body></html>`;

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => { const r = httpsGet(url, (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }); r.on("error", reject); r.setTimeout(8000, () => r.destroy(new Error("timeout"))); });
}
const dir = (cwd: string) => join(cwd, ".mneme", "aphelion");
const sessPath = (cwd: string, node: string) => join(dir(cwd), `${node}.session.json`);
function loadSession(cwd: string, node: string): aphelion.OfflineSession | null { try { return JSON.parse(readFileSync(sessPath(cwd, node), "utf8")); } catch { return null; } }
function saveSession(cwd: string, s: aphelion.OfflineSession): void { mkdirSync(dir(cwd), { recursive: true }); writeFileSync(sessPath(cwd, s.node), JSON.stringify(s, null, 2), "utf8"); }
function readCapsule(file: string): aphelion.OpsCapsule | null { try { const j = JSON.parse(readFileSync(file, "utf8")); return (j?.payload?.v ? j.payload : j) as aphelion.OpsCapsule; } catch { return null; } }

export function registerAphelionCommands(program: Command): void {
  const k = program.command("aphelion").description("🛰 APHELION — the agent brain for operations at the farthest point from the cloud (Mars latency · severed Starlink · air-gap). Self-govern against a local charter while disconnected, then prove the whole window offline + merge across the fleet on reconnect.");

  k.command("open").description("Open a disconnected session under a local autonomy charter.")
    .requiredOption("--node <name>", "this node's id (rover, probe, edge-7)")
    .option("--mission <m>", "the mission", "").option("--scope <globs...>", "allowed paths").option("--forbidden <words...>", "forbidden actions").option("--max-risk <n>", "risk ceiling", parseFloat)
    .action((o: { node: string; mission: string; scope?: string[]; forbidden?: string[]; maxRisk?: number }) => {
      const cwd = process.cwd();
      const infra = infraProvenance.captureInfra({ env: process.env, host: hostname(), platform: process.platform, arch: process.arch, cpus: cpus().length }, Date.now());
      const s = aphelion.openSession({ sessionId: `${o.node}-${Date.now()}`, node: o.node, charter: { mission: o.mission, scope: o.scope ?? [], forbidden: o.forbidden ?? [], maxRisk: o.maxRisk ?? 0.7 }, infra: infra as unknown as Record<string, unknown>, nowMs: Date.now() });
      saveSession(cwd, s);
      out(`🛰 APHELION session open · node ${o.node} · mission "${o.mission}" · scope [${(o.scope ?? []).join(", ") || "any"}] · forbidden [${(o.forbidden ?? []).join(", ") || "none"}] · maxRisk ${s.charter.maxRisk}`);
      out(`   running at the edge (${infra.provider}${infra.region ? "/" + infra.region : ""}) — Earth is out of the loop. Record actions; they self-gate.`);
    });

  k.command("act").description("Record a self-gated action while disconnected (the agent's own conscience).")
    .requiredOption("--node <name>", "this node's id").requiredOption("--action <a>", "what the agent is about to do")
    .option("--risk <n>", "risk 0..1", parseFloat).option("--path <p>", "the resource path it touches")
    .action((o: { node: string; action: string; risk?: number; path?: string }) => {
      const cwd = process.cwd(); const s = loadSession(cwd, o.node);
      if (!s) { out(`no open session for ${o.node} — run: mneme aphelion open --node ${o.node}`); process.exitCode = 2; return; }
      const next = aphelion.recordAction(s, { action: o.action, risk: o.risk ?? 0, path: o.path }, Date.now());
      saveSession(cwd, next);
      const last = next.actions[next.actions.length - 1];
      out(`${last.withinCharter ? "🟢 within charter" : "🔴 CHARTER VIOLATION"} · ${last.action}${o.path ? ` (${o.path})` : ""} · risk ${last.risk} — ${last.reason}`);
      out(`   recorded #${last.seq} to the tamper-evident offline ledger (${next.actions.length} action(s) this window).`);
    });

  k.command("amend").description("Amend the autonomy charter MID-FLIGHT — a signed, chain-recorded envelope change (it governs only future actions; it cannot retroactively cover a past violation).")
    .requiredOption("--node <name>", "this node's id").requiredOption("--reason <r>", "why the charter is changing")
    .option("--scope <globs...>", "new allowed paths").option("--forbidden <words...>", "new forbidden actions").option("--max-risk <n>", "new risk ceiling", parseFloat).option("--by <who>", "who authorized it", "operator")
    .action((o: { node: string; reason: string; scope?: string[]; forbidden?: string[]; maxRisk?: number; by: string }) => {
      const cwd = process.cwd(); const s = loadSession(cwd, o.node);
      if (!s) { out(`no open session for ${o.node}`); process.exitCode = 2; return; }
      const cur = aphelion.activeCharterOf(s);
      const charter = { mission: cur.mission, scope: o.scope ?? cur.scope, forbidden: o.forbidden ?? cur.forbidden, maxRisk: o.maxRisk ?? cur.maxRisk };
      saveSession(cwd, aphelion.amendCharter(s, { charter, reason: o.reason, by: o.by }, Date.now()));
      out(`🛰 charter amended by ${o.by} — "${o.reason}" · scope [${charter.scope.join(", ") || "any"}] · forbidden [${charter.forbidden.join(", ") || "none"}] · maxRisk ${charter.maxRisk}`);
      out("   recorded as a signed amendment in the chain — future actions judge against it; past actions keep their verdicts.");
    });

  k.command("relay").description("DTN store-and-forward: take custody of a bundle at a relay (orbiter / ground station), or create one. With no --in, wraps the node's sealed capsule.")
    .requiredOption("--via <node>", "the relay taking custody").option("--in <bundle>", "the incoming bundle").option("--node <name>", "origin node (to create a bundle from its capsule)").option("--out <file>", "write the forwarded bundle")
    .action((o: { via: string; in?: string; node?: string; out?: string }) => {
      const cwd = process.cwd();
      let bundle: aphelion.DtnBundle | null = null;
      if (o.in && existsSync(o.in)) { try { const j = JSON.parse(readFileSync(o.in, "utf8")); bundle = (j?.payload?.v ? j.payload : j) as aphelion.DtnBundle; } catch { /* */ } }
      else if (o.node) { const cap = readCapsule(join(dir(cwd), `${o.node}.capsule.json`)); if (cap) bundle = aphelion.createBundle(cap, o.node, Date.now()); }
      if (!bundle) { out("no bundle/capsule — pass --in <bundle> or --node <name> (after seal)"); process.exitCode = 2; return; }
      const fwd = aphelion.forwardBundle(bundle, o.via, Date.now());
      const outPath = o.out ?? join(dir(cwd), `bundle.json`);
      writeFileSync(outPath, JSON.stringify(fwd, null, 2), "utf8");
      out(`🛰 custody taken at ${o.via} · path ${fwd.custody.map((h) => h.node).join(" → ")} → ${outPath}`);
    });

  k.command("deliver <bundle>").description("DTN delivery: verify a bundle that reached home — the custody PATH + the carried capsule both verify OFFLINE.")
    .action((file: string) => {
      if (!existsSync(file)) { out("bundle not found"); process.exitCode = 2; return; }
      let bundle: aphelion.DtnBundle; try { const j = JSON.parse(readFileSync(file, "utf8")); bundle = (j?.payload?.v ? j.payload : j) as aphelion.DtnBundle; } catch { out("✗ invalid bundle JSON"); process.exitCode = 2; return; }
      const v = aphelion.verifyBundle(bundle);
      out(v.valid ? `✓ DELIVERED + VERIFIED — ${v.reasons[0]}` : "✗ NOT verified:");
      if (!v.valid) { for (const r of v.reasons) out("   • " + r); process.exitCode = 2; }
      else out(`   path: ${v.path.join(" → ")} · custody ${v.custodyOk ? "intact" : "BROKEN"} · payload ${v.capsuleValid ? "valid" : "INVALID"}`);
    });

  k.command("seal").description("Seal the disconnected window into a signed capsule (verify offline on reconnect).")
    .requiredOption("--node <name>", "this node's id").option("--out <file>", "write the signed capsule")
    .action((o: { node: string; out?: string }) => {
      const cwd = process.cwd(); const s = loadSession(cwd, o.node);
      if (!s) { out(`no open session for ${o.node}`); process.exitCode = 2; return; }
      const capsule = aphelion.sealCapsule(s);
      let signed: unknown = capsule;
      try { signed = notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `aphelion:${capsule.node}:${capsule.chainHead.slice(0, 10)}`, payload: capsule, includePayload: true, issuedAt: Date.now() }); } catch { /* */ }
      const outPath = o.out ?? join(dir(cwd), `${o.node}.capsule.json`);
      writeFileSync(outPath, JSON.stringify(signed, null, 2), "utf8");
      const c = capsule.compliance;
      out(`🛰 capsule sealed · node ${capsule.node} · ${c.total} action(s) · ${c.withinCharter} within charter · ${c.violations} violation(s)`);
      out(`   ${c.violations === 0 ? "🟢 clean window — provably compliant" : "🔴 " + c.violations + " violation(s) recorded — cannot be hidden: " + c.violationIds.join(", ")}`);
      out(`   🛰 signed → ${outPath} (verify offline on reconnect: mneme aphelion verify ${outPath})`);
    });

  k.command("verify <file>").description("Verify a capsule OFFLINE — the chain is intact, every judgement re-derives, and the compliance is real.")
    .action((file: string) => {
      if (!existsSync(file)) { out("capsule not found"); process.exitCode = 2; return; }
      let signed: unknown; try { signed = JSON.parse(readFileSync(file, "utf8")); } catch { out("✗ invalid capsule JSON"); process.exitCode = 2; return; }
      const sig = notary.verifyReceipt(signed); const capsule = readCapsule(file);
      out(sig.valid ? "✓ signature VALID (Ed25519, offline)" : `· ${sig.reason}`);
      if (!capsule) { out("✗ no capsule payload"); process.exitCode = 2; return; }
      const v = aphelion.verifyCapsule(capsule);
      out(v.valid ? `✓ WINDOW VERIFIED — ${v.reasons[0]}` : "✗ NOT verified:");
      if (!v.valid) for (const r of v.reasons) out("   • " + r);
      out(`   → node ${capsule.node} · mission "${capsule.charter.mission}" · ${capsule.compliance.total} action(s) · ${v.compliant ? "compliant" : capsule.compliance.violations + " violation(s)"}`);
      if (!v.valid) process.exitCode = 2;
    });

  k.command("sync-orbital").description("🛰 Close the loop: pull LIVE space weather + auto-apply a SIGNED charter amendment if a storm degrades comms/GNSS (the agent governs by the real sky).")
    .requiredOption("--node <name>", "this node's id")
    .action(async (o: { node: string }) => {
      const cwd = process.cwd(); const s = loadSession(cwd, o.node);
      if (!s) { out(`no open session for ${o.node}`); process.exitCode = 2; return; }
      try {
        const [scales, kp] = await Promise.all([fetchJson("https://services.swpc.noaa.gov/products/noaa-scales.json"), fetchJson("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json").catch(() => [])]);
        const sw = orbital.parseSpaceWeather(scales, kp); const adv = orbital.spaceWeatherAdvisory(sw);
        const cur = aphelion.activeCharterOf(s);
        const applied = orbital.applyAdvisoryToCharter(cur, adv);
        out(`🛰 space weather ${adv.level} (G${sw.geomagnetic.scale}/R${sw.radioBlackout.scale}/S${sw.solarRadiation.scale}, Kp ${sw.kpIndex ?? "?"})`);
        if (!applied.changed) { out("   🟢 nominal — charter unchanged."); return; }
        saveSession(cwd, aphelion.amendCharter(s, { charter: applied.charter, reason: `[ORBITAL] ${applied.reason}`, by: "orbital-auto" }, Date.now()));
        out(`   🛡 SIGNED charter amendment applied · maxRisk→${applied.charter.maxRisk}${applied.charter.forbidden.length ? ` · forbid: ${applied.charter.forbidden.join("/")}` : ""}`);
        out("   (real telemetry → signed governance change, recorded in the chain)");
      } catch (e) { out(`✗ could not reach NOAA (need internet): ${(e as Error).message}`); process.exitCode = 2; }
    });

  k.command("dashboard").description("🛰 Fleet ops view — a self-contained HTML dashboard of every sealed node + its charter-compliance.")
    .option("--out <file>", "write the HTML (default .mneme/aphelion/ops.html)")
    .action((o: { out?: string }) => {
      const cwd = process.cwd(); const d = dir(cwd);
      const caps: aphelion.OpsCapsule[] = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".capsule.json")).map((f) => readCapsule(join(d, f))).filter(Boolean) as aphelion.OpsCapsule[] : [];
      if (!caps.length) { out("no sealed capsules yet — seal a node first (mneme aphelion seal --node <n>)"); process.exitCode = 2; return; }
      const fleet = aphelion.mergeCapsules(caps);
      const rows = caps.map((c) => ({ node: c.node, mission: c.charter.mission, total: c.compliance.total, violations: c.compliance.violations, clean: c.compliance.violations === 0, from: c.window.from, to: c.window.to, head: c.chainHead.slice(0, 12), verified: aphelion.verifyCapsule(c).valid }));
      const data = { generatedNote: "deterministic snapshot from sealed capsules", fleet, rows };
      const html = APHELION_DASHBOARD_HTML.replace("/*__DATA__*/", JSON.stringify(data));
      const outPath = o.out ?? join(d, "ops.html");
      writeFileSync(outPath, html, "utf8");
      out(`🛰 APHELION fleet ops → ${outPath}`);
      out(`   ${fleet.nodes.length} node(s) · ${fleet.totalActions} action(s) · ${fleet.totalViolations} violation(s) · ${rows.every((r) => r.verified) ? "all capsules verify ✓" : "⚠ some capsules failed verify"}`);
    });

  k.command("merge <files...>").description("Fleet reconnect: CRDT-merge capsules from many nodes into one conflict-free view.")
    .action((files: string[]) => {
      const capsules = files.map(readCapsule).filter(Boolean) as aphelion.OpsCapsule[];
      if (!capsules.length) { out("no capsules to merge"); process.exitCode = 2; return; }
      const fleet = aphelion.mergeCapsules(capsules);
      out(`🛰 FLEET MERGE · ${fleet.nodes.length} node(s) · ${fleet.totalActions} action(s) · ${fleet.totalViolations} violation(s)`);
      for (const n of fleet.perNode) out(`   ${n.clean ? "🟢" : "🔴"} ${n.node} · ${n.actions} action(s) · ${n.violations} violation(s)`);
    });
}

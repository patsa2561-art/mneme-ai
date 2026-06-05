/**
 * v2.83.0 — `mneme gephyra <action>` · the Toll Booth of Truth.
 *
 *   mneme gephyra cross --claim "..." --from AGENT [--to AGENT] [--action A]
 *        route a claim through the bridge: truth-customs (real ACGV) + immune +
 *        honesty toll + conscience + signed crossing stamp.
 *   mneme gephyra status   — live: crossings, hallucinations caught, chain intact
 *   mneme gephyra log      — replay the crossing black box
 */

import { writeSync } from "node:fs";
import { createServer } from "node:http";
import * as core from "@mneme-ai/core";

function out(s: string): void { try { writeSync(1, s); } catch { process.stdout.write(s); } }

export interface GephyraOpts {
  cwd: string; action: string;
  claim?: string; from?: string; to?: string; frameAction?: string; port?: number; json?: boolean;
}

export async function gephyraCommand(o: GephyraOpts): Promise<number> {
  const g = core.gephyra;

  if (o.action === "cross") {
    if (!o.claim || !o.from) { out("✗ cross requires --claim and --from\n"); return 2; }
    const r = await g.crossBridge(o.cwd, { claim: o.claim, fromAgent: o.from, toAgent: o.to, action: o.frameAction }, {
      verify: g.apoptosisTruthCustoms(o.cwd),
    });
    if (o.json) { out(JSON.stringify(r, null, 2) + "\n"); return r.disposition === "QUARANTINED" ? 1 : 0; }
    const icon = r.disposition === "PASS" ? "🟢" : r.disposition === "CORRECTED" ? "🟠" : r.disposition === "QUARANTINED" ? "🔴" : "⚪";
    out(`🌉 GEPHYRA crossing — ${icon} ${r.disposition} (${r.verdict})\n`);
    out(`  from: ${r.fromAgent}${r.toAgent ? ` → ${r.toAgent}` : ""}  ·  honesty: ${r.honestyBand}  ·  scrutiny: ${r.scrutiny}\n`);
    if (r.deliveredClaim !== r.claim) out(`  delivered (corrected): ${r.deliveredClaim || "(blocked)"}\n`);
    if (r.evidence) out(`  evidence: ${r.evidence}\n`);
    for (const t of r.threats) out(`  🛑 threat: ${t.kind} — "${t.match}"\n`);
    for (const n of r.nudges) out(`  💡 nudge → ${r.fromAgent}: ${n}\n`);
    if (r.degraded.length) out(`  ⚠ degraded: ${r.degraded.join(", ")}\n`);
    out(`  stamp: ${r.receipt ? r.receipt.receiptId.slice(0, 16) + "… (verifies offline)" : "(unsigned — recorder failed)"}\n`);
    return r.disposition === "QUARANTINED" ? 1 : 0;
  }

  if (o.action === "status") {
    const s = g.bridgeStatus(o.cwd);
    if (o.json) { out(JSON.stringify(s, null, 2) + "\n"); return 0; }
    out(`🌉 GEPHYRA status\n  crossings: ${s.crossings}  (🟢 ${s.passed} pass · 🟠 ${s.corrected} corrected · 🔴 ${s.quarantined} quarantined · ⚪ ${s.unverified} unverified)\n  hallucinations / threats caught: ${s.hallucinationsCaught}\n  black box: ${s.chainValid ? "INTACT ✓" : "TAMPERED ✗"}\n`);
    return 0;
  }

  if (o.action === "log") {
    const rep = g.bridgeReplay(o.cwd);
    if (o.json) { out(JSON.stringify(rep, null, 2) + "\n"); return 0; }
    out(`🎞 GEPHYRA crossing log — ${rep.frames} frame(s), chain ${rep.chainValid ? "VALID ✓" : "BROKEN ✗"}\n`);
    for (const n of rep.narrative) out(`  ${n}\n`);
    return 0;
  }

  if (o.action === "advertise") {
    const adv = g.gephyraAdvertisement(o.cwd, core.agentManifest.MNEME_COMMAND_CATALOG as Array<{ command: string }>);
    if (o.json) { out(JSON.stringify(adv, null, 2) + "\n"); return 0; }
    out(adv.text + "\n");
    return 0;
  }

  if (o.action === "serve") {
    const port = o.port ?? 17742; // 17741 is the existing polygraph bridge
    const server = createServer((req, res) => {
      const url = req.url ?? ""; const m = req.method ?? "GET";
      const reply = (r: { status: number; body: unknown }) => { res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body)); };
      const kq = new URLSearchParams(url.split("?")[1] ?? "");
      // GET surfaces
      if (m === "GET" && url.startsWith("/openapi.json")) { reply({ status: 200, body: g.a2aOpenApi() }); return; }
      if (m === "GET" && url.startsWith("/keryx/webhook")) { const ch = kq.get("hub.challenge"); if (ch !== null) { res.writeHead(200, { "content-type": "text/plain" }); res.end(ch); return; } reply({ status: 200, body: { ok: true } }); return; }
      if (m === "GET" && url.startsWith("/keryx/drain")) { void g.handleKeryxRelay(o.cwd, "drain", "", { daemon: kq.get("daemon") ?? "default" }).then(reply).catch((e: Error) => reply({ status: 500, body: { error: e.message } })); return; }
      const isMcp = url.startsWith("/mcp"), isSV = url.startsWith("/savant/verify"), isSR = url.startsWith("/savant/repair");
      const isFw = url.startsWith("/firewall"), isRi = url.startsWith("/rail/ingress"), isRe = url.startsWith("/rail/egress"), isRk = url.startsWith("/reckon");
      const isKExpect = url.startsWith("/keryx/expect"), isKWebhook = url.startsWith("/keryx/webhook");
      const known = url.startsWith("/cross") || isMcp || isSV || isSR || isFw || isRi || isRe || isRk || isKExpect || isKWebhook;
      if (m !== "POST" || !known) { reply({ status: 404, body: { error: "POST /cross|/mcp|/savant/verify|/savant/repair|/firewall|/rail/ingress|/rail/egress|/reckon|/keryx/expect|/keryx/webhook/:provider · GET /status|/openapi.json|/keryx/drain" } }); return; }
      let body = ""; req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", () => {
        const provider = isKWebhook ? (url.split("/keryx/webhook/")[1]?.split("?")[0] || "generic") : "";
        const handler = isSV ? g.handleSavantRequest(o.cwd, body, "verify")
          : isSR ? g.handleSavantRequest(o.cwd, body, "repair")
          : isFw ? g.handleA2ARequest(o.cwd, body, "firewall")
          : isRi ? g.handleA2ARequest(o.cwd, body, "rail-ingress")
          : isRe ? g.handleA2ARequest(o.cwd, body, "rail-egress")
          : isRk ? g.handleA2ARequest(o.cwd, body, "reckon")
          : isKExpect ? g.handleKeryxRelay(o.cwd, "expect", body, {})
          : isKWebhook ? g.handleKeryxRelay(o.cwd, "webhook", body, { provider }, req.headers as Record<string, string | string[] | undefined>)
          : isMcp ? g.handleMcpCallRequest(o.cwd, body)
          : g.handleCrossRequest(o.cwd, body);
        void handler.then(reply).catch((e: Error) => reply({ status: 500, body: { error: e.message } }));
      });
    });
    server.on("error", (e) => { out(`✗ GEPHYRA serve failed: ${(e as Error).message}\n`); process.exit(1); });
    server.listen(port, () => {
      out(`🌉 GEPHYRA serving on :${port}\n  POST /cross         {claim, fromAgent}  → truth-customs + signed crossing\n  POST /mcp           {tool, agent, args?} → route any MCP tool call through truth-customs\n  POST /savant/verify {claim}             → 🧠 savant prove-or-unknown verdict (TRUE/FALSE/UNKNOWN) + signed lineage\n  POST /savant/repair {draft}             → 🧠 fact-check + repair an agent's draft answer\n  (Ctrl-C to stop. Every crossing is recorded + stamped.)\n`);
    });
    await new Promise<void>(() => { /* run until killed */ });
    return 0;
  }

  out(`✗ Unknown gephyra action "${o.action}". Try: cross | status | log | advertise | serve\n`);
  return 2;
}

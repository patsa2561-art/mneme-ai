/**
 * `mneme live` — the real-time health of Mneme's background support for AI agents.
 * Gathers live facts (daemon heartbeat · hook wired · every provider's send+clear readiness +
 * reachability · relay · state integrity · an end-to-end pipeline canary) and renders one verdict:
 * LIVE / DEGRADED / DOWN — with auto-heal. Catches SILENT breakage before a user ever hits it.
 */
import type { Command } from "commander";
import { existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { live, agentFit, proofLoop, turnSignal } from "@mneme-ai/core";
import { appendFileSync, readFileSync as _rf } from "node:fs";
function proofLedgerPath(cwd: string): string { return join(cwd, ".mneme", "proof", "ledger.jsonl"); }
function loadProof(cwd: string): proofLoop.Assist[] { try { return _rf(proofLedgerPath(cwd), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

function out(s: string): void { process.stdout.write(s + "\n"); }
function ping(url: string): Promise<boolean> { return new Promise((res) => { try { const r = httpsGet(url, (x) => { x.resume(); res((x.statusCode ?? 0) > 0 && (x.statusCode ?? 0) < 500); }); r.on("error", () => res(false)); r.setTimeout(6000, () => { r.destroy(); res(false); }); } catch { res(false); } }); }
function postForm(host: string, path: string, body: string): Promise<number> { return new Promise((res) => { try { const r = httpsRequest({ hostname: host, path, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } }, (x) => { x.resume(); res(x.statusCode ?? 0); }); r.on("error", () => res(0)); r.setTimeout(6000, () => { r.destroy(); res(0); }); r.write(body); r.end(); } catch { res(0); } }); }

export function registerLiveCommands(program: Command): void {
  const proof = program.command("proof").description("📊 LIVE PROOF — a measured, per-agent scorecard of what Mneme actually did for you: hallucinations caught · leaks blocked · injections neutralized · commands gated · tokens saved. The value, counted — not claimed.");
  proof.command("show", { isDefault: true }).description("the live scorecard").action(() => {        // `mneme proof` → the live scorecard
    const cwd = process.cwd(); const sc = proofLoop.scorecard(loadProof(cwd), { now: Date.now() });
    if (!sc.total && !sc.tokensSaved) { out("📊 No assists recorded yet. Mneme logs one each time it catches/blocks/gates/saves while you work."); return; }
    out(`📊 MNEME LIVE PROOF — ${sc.harmsPrevented} harms prevented · ${sc.tokensSaved.toLocaleString()} tokens saved · ${sc.total} total assists`);
    for (const [k, v] of Object.entries(sc.byKind)) out(`   ${String(v).padStart(5)}  ${k.replace(/_/g, " ")}`);
    if (sc.agents.length) { out("   per agent:"); for (const a of sc.agents.slice(0, 8)) out(`     ${a.agent.padEnd(16)} ${a.harmsPrevented} harms · ${a.tokensSaved.toLocaleString()} tok · ${a.total} assists`); }
  });
  proof.command("verify").description("Verify the proof ledger is an intact hash chain (tamper-evident — a CEO-grade signed scorecard, not an editable file).").action(() => {
    const cwd = process.cwd(); const recs = loadProof(cwd) as proofLoop.ChainedAssist[];
    const v = proofLoop.verifyProofChain(recs);
    out(v.ok ? `🔒 proof ledger VERIFIED — ${v.length} assists, hash chain intact (no row edited/inserted/removed)` : `🔴 proof ledger BROKEN at index ${v.firstBrokenIndex} — tampering or corruption`);
    if (!v.ok) process.exitCode = 2;
  });
  proof.command("record").description("Log an assist (organs/agents call this when they catch/block/gate/save).")
    .requiredOption("--agent <id>").requiredOption("--kind <k>", proofLoop.ASSIST_KINDS.join("|")).option("--count <n>").option("--detail <t>")
    .action((o: { agent: string; kind: string; count?: string; detail?: string }) => {
      const cwd = process.cwd();
      const a = proofLoop.normalizeAssist({ agent: o.agent, kind: o.kind as proofLoop.AssistKind, count: o.count ? Number(o.count) : 1, detail: o.detail, at: Date.now() });
      try { proofLoop.appendAssistChained(proofLedgerPath(cwd), a); } catch { /* */ }
      out(`✓ logged (signed/chained): ${a.agent} · ${a.kind}${a.count > 1 ? " ×" + a.count : ""}`);
    });
  program.command("quickstart").alias("start-here").description("🚀 START HERE — the ONE first-value path for you (auto-detected), not the 988-tool firehose.")
    .action(() => {
      const a = agentFit.detectActiveAgent(process.env as Record<string, string | undefined>);
      out("🚀 Mneme — your 60-second first value:\n");
      if (a) {
        out(`You're in ${a.label} (fit ${a.fit}/100). Do ONE of these now:`);
        out(`  1. Approve risky actions from your phone:  tell me \"set up phone approvals, token: <BotFather token>\"`);
        out(`     → I run: mneme pager autosetup --telegram-token <token>  (you never type it)`);
        out(`  2. Verify any claim right now:             mneme verify \"<a factual claim>\"`);
        out(`  3. See what's worth doing this turn:       mneme signal \"<your task>\"`);
      } else {
        out("Pick the line that matches you:");
        out("  💬 chat with ChatGPT/Gemini/Claude.ai →  mneme polygraph autosetup --persist   (truth dots)");
        out("  🧑‍💻 code with an AI agent           →  mneme pager autosetup --telegram-token <token>   (approve from phone)");
        out("  🏢 want proof your agents are governed →  mneme proof   ·   mneme proof verify");
      }
      out("\n   more depth when you want it: mneme atlas  ·  full guide: docs/GETTING-STARTED.md");
    });
  program.command("signal [text]").description("🛰 TURN-SIGNAL — given this turn's text, the ONE highest-value Mneme move right now (verify/blind/fortify/gate/recall/loopguard) or 'nothing needed'. Deterministic, honest abstention. --bench measures precision/recall/F1 on the labeled corpus.")
    .option("--all", "show every warranted move, not just the top one").option("--json", "machine-readable")
    .option("--bench", "measure precision/recall/F1 on the labeled EN+Thai corpus")
    .action((text: string | undefined, o: { all?: boolean; json?: boolean; bench?: boolean }) => {
      if (o.bench) {
        const r = turnSignal.recallBenchmark();
        if (o.json) { out(JSON.stringify(r, null, 2)); return; }
        out(`🛰 TURN-SIGNAL benchmark (${r.total} labeled turns, EN+Thai + hard negatives):`);
        out(`   precision ${r.precision} · recall ${r.recall} · F1 ${r.f1} · false-fire ${r.falseFireRate}`);
        if (r.misses.length) { out("   misses:"); for (const m of r.misses) out(`     expect ${m.expect} got ${m.got} · ${m.text}`); } else out("   ✓ 0 misses on the corpus");
        return;
      }
      if (!text) { out("usage: mneme signal \"<turn text>\"  ·  or: mneme signal --bench"); return; }
      const sigs = turnSignal.detectTurnSignals(text);
      if (o.json) { out(JSON.stringify(sigs, null, 2)); return; }
      if (!sigs.length) { out("· nothing checkable in this turn — no Mneme move needed (abstain)"); return; }
      for (const s of (o.all ? sigs : sigs.slice(0, 1))) out(`🛰 ${s.move.toUpperCase()} → ${s.tool}\n   ${s.why}  [matched: ${s.evidence}]`);
    });
  program.command("fit").description("🧩 AGENT-FIT — how tightly Mneme integrates with the AI agent you're running (auto-detected) + the exact native wiring. `--all` shows every agent's integration tier.")
    .option("--all", "list every agent's fit tier + wiring").option("--json", "machine-readable")
    .action((o: { all?: boolean; json?: boolean }) => {
      const active = agentFit.detectActiveAgent(process.env as Record<string, string | undefined>);
      if (o.json) { out(JSON.stringify({ active: active?.id ?? null, profiles: agentFit.listFits() }, null, 2)); return; }
      if (o.all) {
        out("🧩 Mneme AGENT-FIT — native integration tightness per AI agent:");
        for (const p of agentFit.listFits()) out(`   ${p.tier.padEnd(8)} ${String(p.fit).padStart(3)}  ${p.label}  —  ${p.surfaces.join("·")}`);
        out("   (FULL = MCP + per-action gate + per-turn signal · LIMITED = instructions/browser only)");
        return;
      }
      if (!active) { out("🧩 No AI-agent env detected. Run inside an agent, or `mneme fit --all` to see all integrations."); return; }
      out(`🧩 You're running: ${active.label}  →  fit ${active.fit}/100 (${active.tier})`);
      out(`   surfaces: ${active.surfaces.join(" · ")}`);
      out(`   live signal: ${active.liveMechanism}`);
      out(`   native wiring: ${active.wiring}`);
    });

  program.command("vitals").description("📡 MNEME LIVE — is Mneme actually supporting your AI agent right now? One verdict (LIVE/DEGRADED/DOWN) from real probes: daemon · hook · every provider's send+clear readiness · relay · state · an end-to-end pipeline canary. Catches silent breakage.")
    .option("--heal", "auto-run the safe heal actions (restart daemon, etc.)")
    .option("--json", "machine-readable report")
    .action(async (o: { heal?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      const m = (p: string) => join(cwd, ".mneme", "pager", p);
      // daemon heartbeat
      let daemonHeartbeatAgeMs: number | null = null;
      try { if (existsSync(m("daemon.heartbeat"))) daemonHeartbeatAgeMs = Date.now() - statSync(m("daemon.heartbeat")).mtimeMs; } catch { /* */ }
      // hook
      let hookWired = false;
      try { for (const f of [".claude/settings.json", ".claude/settings.local.json"]) { const p = join(cwd, f); if (existsSync(p) && readFileSync(p, "utf8").includes("pager request")) hookWired = true; } } catch { /* */ }
      // config + providers
      let cfg: Record<string, unknown> = {}; try { cfg = JSON.parse(readFileSync(m("config.json"), "utf8")); } catch { /* */ }
      let provs: Record<string, { token?: string; channelId?: string; channelSecret?: string; phoneId?: string; to?: string }> = {};
      try { provs = JSON.parse(readFileSync(join(cwd, ".mneme", "keryx", "providers.json"), "utf8")); } catch { /* */ }
      const tgCfg = cfg["telegramToken"] ? { token: String(cfg["telegramToken"]) } : null;
      // reachability probes (real, short-timeout)
      const tgReach = tgCfg ? await ping(`https://api.telegram.org/bot${tgCfg.token}/getMe`) : null;
      const lineReach = provs.line?.channelId && provs.line?.channelSecret ? (await postForm("api.line.me", "/v2/oauth/accessToken", `grant_type=client_credentials&client_id=${provs.line.channelId}&client_secret=${provs.line.channelSecret}`)) === 200 : null;
      const relayCfg = cfg["keryxRelay"] ? String(cfg["keryxRelay"]) : "";
      const relayReach = relayCfg ? await ping(`${relayCfg.replace(/\/$/, "")}/keryx/drain?daemon=default`) : null;
      // state + canary
      let stateOk = true; try { JSON.parse(readFileSync(m("state.json"), "utf8")); } catch { stateOk = existsSync(m("state.json")) ? false : true; }
      const canary = live.approvalCanary();

      const facts: live.LiveFacts = {
        daemonHeartbeatAgeMs, hookWired,
        relay: relayCfg ? { configured: true, reachable: relayReach } : { configured: false, reachable: null },
        providers: [
          { name: "telegram", cfg: tgCfg, reachable: tgReach },
          { name: "line", cfg: provs.line ?? null, reachable: lineReach },
          { name: "slack", cfg: provs.slack ?? null }, { name: "discord", cfg: provs.discord ?? null }, { name: "whatsapp", cfg: provs.whatsapp ?? null },
        ],
        stateOk, canaryOk: canary.ok,
      };
      const rep = live.evaluateLiveness(facts);
      if (o.json) { out(JSON.stringify({ ...rep, canary }, null, 2)); return; }
      const ico = rep.verdict === "live" ? "🟢" : rep.verdict === "degraded" ? "🟡" : "🔴";
      out(`📡 MNEME LIVE — ${ico} ${rep.summary}`);
      for (const p of rep.probes) out(`   ${p.status === "live" ? "✓" : p.status === "degraded" ? "▴" : "✗"} ${p.name.padEnd(20)} ${p.detail}${p.heal ? `  → ${p.heal}` : ""}`);
      if (!canary.ok) out(`   canary steps: ${canary.steps.filter((s) => !s.ok).map((s) => s.step).join(", ")} FAILED`);
      if (o.heal && rep.heals.length) {
        out(`\n🔧 healing: ${rep.heals.join(" · ")}`);
        if (rep.heals.includes("mneme pager doctor")) { try { spawn(process.execPath, [process.argv[1], "pager", "doctor"], { stdio: "ignore", detached: true }).unref(); out("   ✓ daemon restart kicked"); } catch { /* */ } }
      }
      if (rep.verdict !== "live") process.exitCode = 2;
    });
}

/**
 * `mneme live` — the real-time health of Mneme's background support for AI agents.
 * Gathers live facts (daemon heartbeat · hook wired · every provider's send+clear readiness +
 * reachability · relay · state integrity · an end-to-end pipeline canary) and renders one verdict:
 * LIVE / DEGRADED / DOWN — with auto-heal. Catches SILENT breakage before a user ever hits it.
 */
import type { Command } from "commander";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { live, agentFit } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function ping(url: string): Promise<boolean> { return new Promise((res) => { try { const r = httpsGet(url, (x) => { x.resume(); res((x.statusCode ?? 0) > 0 && (x.statusCode ?? 0) < 500); }); r.on("error", () => res(false)); r.setTimeout(6000, () => { r.destroy(); res(false); }); } catch { res(false); } }); }
function postForm(host: string, path: string, body: string): Promise<number> { return new Promise((res) => { try { const r = httpsRequest({ hostname: host, path, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } }, (x) => { x.resume(); res(x.statusCode ?? 0); }); r.on("error", () => res(0)); r.setTimeout(6000, () => { r.destroy(); res(0); }); r.write(body); r.end(); } catch { res(0); } }); }

export function registerLiveCommands(program: Command): void {
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

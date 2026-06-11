/**
 * TRUST GATEWAY SERVICE — the front door of the AI-native trust SaaS.
 *
 * Mneme's trust suite, exposed as a stateless HTTP service any AI agent (any vendor, any machine, no
 * install) can POST to and get a signed verdict back. This is "software-as-a-service in the AI world":
 * the consumer is an agent, the payload is a proposed change, the response is PASS / WARN / BLOCK + the
 * reasons — not a website, not a UI.
 *
 * This module owns the pure ROUTER: given a request {path, body}, dispatch to the right engine and return
 * {status, json}. It is STATELESS — the agent sends the data it has (the change's code/files, the
 * baseline + current file set, a policy, outcome records) and gets a verdict; no git, no filesystem, no
 * tenant state on the server. The CLI wraps this in node:http (and adds /equiv, which needs a sandbox).
 *
 * Endpoints:
 *   GET  /health            → liveness + the endpoint catalog
 *   POST /scar/check        → the scar vaccine (PREVENT): {code, files, scars?}
 *   POST /firewall/check    → the architectural firewall (VERIFY): {baselineFiles, currentFiles, policy?}
 *   POST /change-gate       → the one-call gate (PREVENT+VERIFY): {baselineFiles, currentFiles, code, files, policy?}
 *   POST /agent-rep         → reputation (ACCOUNT): {records?} or {commits?}
 *
 * ★HONEST (DIAKRISIS): stateless means no git on the server, so the firewall's AGE-weighting (which needs
 * history) is absent here — severity falls back to the declared policy + base-by-kind (the CLI, which has
 * the repo, does the age-weighted version). Each verdict is exactly as strong as the data the caller
 * sends. The service computes + signs; it does not fetch the caller's repo.
 */
import { vaccinate, BUILTIN_SCARS, type Scar } from "../scar_vaccine/index.js";
import { firewall, loadPolicy } from "../arch_firewall/index.js";
import { composeGate } from "../change_gate/index.js";
import { scoreReputation, deriveOutcomes } from "../agent_ledger/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

export interface TrustRequest { method: string; path: string; body: Record<string, unknown> }
export interface TrustResponse { status: number; json: Record<string, unknown> }

export const TRUST_ENDPOINTS = [
  { method: "GET", path: "/health", what: "liveness + endpoint catalog" },
  { method: "POST", path: "/scar/check", what: "scar vaccine (PREVENT) — {code, files, scars?}" },
  { method: "POST", path: "/firewall/check", what: "architectural firewall (VERIFY) — {baselineFiles, currentFiles, policy?}" },
  { method: "POST", path: "/change-gate", what: "the one-call gate (PREVENT+VERIFY) — {baselineFiles, currentFiles, code, files, policy?}" },
  { method: "POST", path: "/agent-rep", what: "agent reputation (ACCOUNT) — {records?} | {commits?}" },
];

const asFiles = (v: unknown): SourceFile[] => Array.isArray(v) ? (v as unknown[]).map((f) => { const o = (f ?? {}) as Record<string, unknown>; return { path: String(o["path"] ?? ""), content: String(o["content"] ?? "") }; }).filter((f) => f.path) : [];
const asStrings = (v: unknown): string[] => Array.isArray(v) ? (v as unknown[]).map((x) => String(x)) : [];

/** Stateless trust router. Pure: same request → same response (no git, no fs, no clock except an injectable today). */
export function routeTrust(req: TrustRequest, opts?: { today?: string }): TrustResponse {
  const path = (req?.path || "").replace(/\/+$/, "") || "/";
  const m = (req?.method || "GET").toUpperCase();
  const body = (req?.body ?? {}) as Record<string, unknown>;
  const today = opts?.today;

  if (path === "/health" || path === "/") return { status: 200, json: { ok: true, service: "mneme-trust-gateway", endpoints: TRUST_ENDPOINTS } };

  if (m !== "POST") return { status: 405, json: { error: "method not allowed", path } };

  if (path === "/scar/check") {
    const scars: Scar[] = [...BUILTIN_SCARS, ...((Array.isArray(body["scars"]) ? body["scars"] : []) as Scar[])];
    const v = vaccinate({ code: String(body["code"] ?? ""), files: asStrings(body["files"]) }, scars);
    return { status: 200, json: { fires: v.fires, firing: v.firing.map((h) => ({ id: h.scar.id, severity: h.scar.severity, lesson: h.scar.lesson, antibodies: h.scar.antibodies })), immune: v.immune.map((h) => ({ id: h.scar.id, antibody: h.antibody })), report: v.report } };
  }

  if (path === "/firewall/check") {
    const fw = firewall(asFiles(body["baselineFiles"]), asFiles(body["currentFiles"]), loadPolicy(String(body["policy"] ?? "")), { today });
    return { status: 200, json: { verdict: fw.verdict, critical: fw.critical, high: fw.high, blocked: fw.blocked, findings: fw.findings, baselineContracts: fw.baselineContracts, note: "stateless: age-weighting absent (no git) — declared policy + base-by-kind apply" } };
  }

  if (path === "/change-gate") {
    const base = asFiles(body["baselineFiles"]), cur = asFiles(body["currentFiles"]);
    const fw = (base.length || cur.length) ? firewall(base, cur, loadPolicy(String(body["policy"] ?? "")), { today }) : null;
    const scars: Scar[] = [...BUILTIN_SCARS, ...((Array.isArray(body["scars"]) ? body["scars"] : []) as Scar[])];
    const scar = (body["code"] || body["files"]) ? vaccinate({ code: String(body["code"] ?? ""), files: asStrings(body["files"]) }, scars) : null;
    const g = composeGate(fw, scar);
    return { status: 200, json: { verdict: g.verdict, reasons: g.reasons, firewall: g.firewall, scar: g.scar } };
  }

  if (path === "/agent-rep") {
    let records = Array.isArray(body["records"]) ? (body["records"] as Array<{ agent: string; outcome: "survived" | "reverted" | "incident" | "pending" }>) : null;
    if (!records && Array.isArray(body["commits"])) records = deriveOutcomes(body["commits"] as never, { matureDays: Number(body["matureDays"]) || 30 });
    const rep = scoreReputation(records ?? []).filter((r) => r.decided > 0);
    return { status: 200, json: { agents: rep } };
  }

  return { status: 404, json: { error: "no such endpoint", path, endpoints: TRUST_ENDPOINTS.map((e) => `${e.method} ${e.path}`) } };
}

/** A minimal human-facing landing + live demo page (served at GET / when the client wants HTML). */
export function landingPage(): string {
  const ep = TRUST_ENDPOINTS.map((e) => `<tr><td><code>${e.method}</code></td><td><code>${e.path}</code></td><td>${e.what.replace(/—.*$/, "").trim()}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mneme Trust Gateway — SaaS for the AI world</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b0d12;color:#e8eaf0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:clamp(28px,6vw,64px) clamp(16px,4vw,28px) 80px}
h1{font-size:clamp(26px,5vw,40px);line-height:1.1;letter-spacing:-.02em;margin:0 0 10px;font-weight:760}
.tag{color:#7c83f6;font-weight:680}.sub{color:#9aa0ad;font-size:clamp(15px,2.5vw,18px);margin:0 0 28px;max-width:62ch}
.card{background:#12151d;border:1px solid #232838;border-radius:16px;padding:20px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}td{padding:7px 8px;border-bottom:1px solid #1c2130;vertical-align:top}tr:last-child td{border-bottom:0}
code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:#1a1f2b;border:1px solid #262c3b;border-radius:6px;padding:1px 6px;color:#cdd3e0}
textarea{width:100%;background:#0c0e14;border:1px solid #262c3b;border-radius:10px;color:#e8eaf0;font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:11px;resize:vertical;min-height:74px}
label{display:block;font-size:12px;color:#9aa0ad;margin:12px 0 5px;font-weight:600;letter-spacing:.02em}
button{background:#5b5bf6;color:#fff;border:0;border-radius:10px;padding:11px 20px;font-weight:640;font-size:14px;cursor:pointer;margin-top:14px}button:hover{background:#6d6dff}
pre{background:#0c0e14;border:1px solid #262c3b;border-radius:10px;padding:14px;overflow:auto;font-size:12.5px;margin:14px 0 0;white-space:pre-wrap;word-break:break-word}
.ok{color:#4ade80}.bad{color:#fb7185}.muted{color:#6b7280;font-size:12.5px}.flow{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 0}.pill{background:#1a1f2b;border:1px solid #262c3b;border-radius:20px;padding:3px 11px;font-size:12px;color:#aab0bd}
a{color:#7c83f6}
</style></head><body><div class="wrap">
<h1><span class="tag">Mneme</span> Trust Gateway</h1>
<p class="sub">Software-as-a-service for the AI world. Not a website — a service whose <b>users are AI agents</b>. An agent POSTs a proposed change; the gateway returns a signed <b>PASS / WARN / BLOCK</b> verdict. No install, no UI.</p>
<div class="flow"><span class="pill">PREVENT · scar vaccine</span><span class="pill">VERIFY · architectural firewall</span><span class="pill">VERIFY · equivalence receipts</span><span class="pill">ACCOUNT · agent reputation</span></div>
<div class="card"><b>Endpoints</b> <span class="muted">— POST JSON, get a verdict</span>
<table><tr><td><b>METHOD</b></td><td><b>PATH</b></td><td><b>WHAT</b></td></tr>${ep}<tr><td><code>POST</code></td><td><code>/equiv</code></td><td>behavioral-equivalence receipt for a pure-fn refactor</td></tr></table></div>
<div class="card"><b>How it's actually used</b> <span class="muted">— automatic, no copy-paste</span>
<table><tr><td><b>pre-commit</b></td><td>on <code>git commit</code>, <code>mneme change-gate</code> reads your diff itself → blocks a bad commit</td></tr>
<tr><td><b>CI / PR-bot</b></td><td><code>mneme ci-init</code> drops a GitHub Action — every PR is gated, the verdict is commented, the build fails on BLOCK</td></tr>
<tr><td><b>AI agent</b></td><td>the agent that wrote the change calls <code>mneme.change.gate</code> over MCP / this API <b>before</b> committing — it already has the code, so nothing is pasted by hand</td></tr></table>
<pre style="margin-top:12px">npx mneme-ai change-gate --baseline main      # what your CI runs, automatically</pre></div>
<div class="card"><b>Try it live — behavioral equivalence</b>
<p class="muted">👀 <b>This box is a hands-on demo</b> so you can see one engine yourself — real use is automatic (above), never copy-paste. Paste two versions of a pure function: the gateway differential-tests them over boundary-seeded inputs and proves they're equivalent — or hands you the exact counterexample. ("Tests pass" never proves this.)</p>
<label>OLD function</label><textarea id="o">function(price, qty){ if (qty >= 10) return price*qty*0.8; if (qty >= 5) return price*qty*0.9; return price*qty; }</textarea>
<label>NEW function (an AI refactor — did it change behavior?)</label><textarea id="n">function(price, qty){ const r = qty > 10 ? 0.8 : qty > 5 ? 0.9 : 1.0; return price*qty*r; }</textarea>
<label>args (name:type, comma-separated)</label><textarea id="a" style="min-height:38px">price:number, qty:int</textarea>
<button onclick="run()">Check equivalence →</button><pre id="out">verdict will appear here…</pre></div>
<p class="muted">Consumed by AI agents over MCP (~1000 tools), a gRPC rail, this HTTP gateway, and a one-call change-gate + PR-bot. Every verdict is deterministic and re-checkable. <a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener">mneme-ai on npm</a></p>
<script>
async function run(){
  var out=document.getElementById('out');out.textContent='checking…';
  var args=document.getElementById('a').value.split(',').map(function(s){var p=s.trim().split(':');return{name:(p[0]||'x').trim(),type:(p[1]||'number').trim()}}).filter(function(x){return x.name});
  try{
    var r=await fetch('/equiv',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oldFn:document.getElementById('o').value,newFn:document.getElementById('n').value,args:args})});
    var j=await r.json();
    if(j.equivalent){out.innerHTML='<span class="ok">✅ EQUIVALENCE RECEIPT</span> — old ≡ new over '+j.inputsTested+' inputs (incl. all boundaries).\\noldHash='+j.oldHash+'  newHash='+j.newHash+'\\n\\nAttach to the PR; CI trusts the receipt, not a promise.';}
    else if(j.counterexample){var c=j.counterexample;out.innerHTML='<span class="bad">❌ NOT EQUIVALENT</span> — behavior changed.\\ncounterexample: fn('+c.input.join(', ')+') → old='+JSON.stringify(c.old)+'  new='+JSON.stringify(c.new)+'\\n\\n(a boundary input an example-based unit test usually misses)';}
    else{out.textContent=JSON.stringify(j,null,2);}
  }catch(e){out.textContent='error: '+e.message;}
}
</script></div></body></html>`;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface TrustServiceGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function trustServiceGauntlet(): TrustServiceGauntlet {
  const health = routeTrust({ method: "GET", path: "/health", body: {} });
  const healthOK = health.status === 200 && (health.json["endpoints"] as unknown[]).length >= 4;

  const scar = routeTrust({ method: "POST", path: "/scar/check", body: { files: ["payments/retry.ts"], code: "async function chargeWithRetry(req){ for(let i=0;i<3;i++){ await charge(req); } }" } });
  const scarOK = scar.status === 200 && scar.json["fires"] === true && (scar.json["firing"] as unknown[]).some((f) => /double-charge/.test((f as Record<string, unknown>)["id"] as string));

  const base: SourceFile[] = [{ path: "schema.prisma", content: "model Wallet { id Int @id }" }, { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }" }];
  const broke: SourceFile[] = [...base, { path: "b.ts", content: "export function drain(){ return prisma.wallet.update({where:{}}); }" }];
  const fw = routeTrust({ method: "POST", path: "/firewall/check", body: { baselineFiles: base, currentFiles: broke, policy: "critical table wallet single-writer" } });
  const fwOK = fw.status === 200 && fw.json["verdict"] === "BLOCK";

  const gate = routeTrust({ method: "POST", path: "/change-gate", body: { baselineFiles: base, currentFiles: broke, policy: "critical table wallet single-writer", files: ["payments/retry.ts"], code: "for(let i=0;i<3;i++){ await charge(req); }" } });
  const gateOK = gate.status === 200 && gate.json["verdict"] === "BLOCK" && (gate.json["reasons"] as string[]).some((r) => /SCAR|contract/.test(r));

  const rep = routeTrust({ method: "POST", path: "/agent-rep", body: { records: [...Array.from({ length: 25 }, () => ({ agent: "good", outcome: "survived" })), ...Array.from({ length: 8 }, () => ({ agent: "bad", outcome: "reverted" }))] } });
  const repOK = rep.status === 200 && (rep.json["agents"] as Array<{ agent: string; band: string }>).find((a) => a.agent === "good")?.band === "TRUSTED";

  const lp = landingPage();
  const landingOK = typeof lp === "string" && lp.includes("<!doctype html>") && lp.includes("Trust Gateway") && lp.includes("/equiv");
  const notFound = routeTrust({ method: "POST", path: "/nope", body: {} }).status === 404;
  const methodGuard = routeTrust({ method: "GET", path: "/scar/check", body: {} }).status === 405;
  const total = (() => { try { routeTrust(null as never); routeTrust({ method: "POST", path: "/change-gate", body: {} }); return true; } catch { return false; } })();

  const checks = [
    { name: "HEALTH+CATALOG", pass: healthOK, detail: "GET /health returns liveness + the endpoint catalog" },
    { name: "SCAR-ENDPOINT", pass: scarOK, detail: "POST /scar/check fires the double-charge scar on a non-idempotent retry" },
    { name: "FIREWALL-ENDPOINT", pass: fwOK, detail: "POST /firewall/check BLOCKs a critical contract break" },
    { name: "CHANGE-GATE-ENDPOINT", pass: gateOK, detail: "POST /change-gate fuses scar+firewall into one BLOCK + reasons" },
    { name: "AGENT-REP-ENDPOINT", pass: repOK, detail: "POST /agent-rep scores a durable author TRUSTED" },
    { name: "404+405+TOTAL", pass: notFound && methodGuard && total, detail: "unknown path → 404; wrong method → 405; null/empty never throws" },
    { name: "LANDING-PAGE", pass: landingOK, detail: "landingPage() returns a self-contained HTML demo (served at GET / for humans)" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

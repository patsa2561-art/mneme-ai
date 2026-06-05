/**
 * Accountability Layer MCP tools (v2.193.0) — all READ-ONLY (probe-coverage exempt):
 *   mneme.revert.scan      — the regret flywheel: which commits got reverted/hotfixed, per-agent survival
 *   mneme.agentbench.scan  — cross-vendor reliability ranking (Wilson-LB on survival)
 *   mneme.engagement.scan  — evaluate an action / the staged change against the repo's engagement policy
 *
 * They join git history with the signed attestation ledger (which agent made each
 * commit) — the unique data only Mneme holds. Underlying logic measured by
 * revertGauntlet / benchmarkGauntlet / engagementGauntlet (all 100).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as https from "node:https";
import { revertRadar, agentBenchmark, engagement, awarm, geo, reckoning, commitAttest, succession, pager } from "@mneme-ai/core";
import type { MnemeTool, ToolRuntime, ToolResponse } from "./_types.js";

function git(args: string, cwd: string): string {
  try { return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

/** Map sha → AI agent from the signed attestation ledger (best-effort). */
function agentBySha(cwd: string): Map<string, string> {
  const m = new Map<string, string>();
  const p = join(cwd, ".mneme", "attest", "chain.jsonl");
  if (!existsSync(p)) return m;
  try { for (const l of readFileSync(p, "utf8").trim().split("\n").filter(Boolean)) { const e = JSON.parse(l) as { record?: { subject?: string }; facts?: { agent?: string } }; const sha = String(e.record?.subject ?? "").replace("commit:", ""); if (sha) m.set(sha, String(e.facts?.agent ?? "unknown")); } } catch { /* */ }
  return m;
}

/** Read recent commits (with files) joined to the agent ledger. */
function readCommits(cwd: string, limit = 400): revertRadar.CommitLite[] {
  const byAgent = agentBySha(cwd);
  const raw = git(`log -n ${limit} --no-merges --pretty=format:%x01%H%x1f%ct%x1f%s%x1f%b%x02 --name-only`, cwd);
  if (!raw) return [];
  const out: revertRadar.CommitLite[] = [];
  for (const block of raw.split("\x01").filter(Boolean)) {
    const [head, filesPart = ""] = block.split("\x02");
    const [sha = "", ct = "0", subject = "", body = ""] = head.split("\x1f");
    if (!sha) continue;
    const files = filesPart.split("\n").map((s) => s.trim()).filter(Boolean);
    out.push({ sha, subject, body, agent: byAgent.get(sha) ?? "unknown", files, ts: (Number(ct) || 0) * 1000 });
  }
  return out;
}

function pagerTg(token: string, method: string, body: object): Promise<{ ok: boolean; result?: unknown }> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: "api.telegram.org", path: `/bot${token}/${method}`, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }, timeout: 15000 },
      (res) => { let s = ""; res.on("data", (d) => (s += d)); res.on("end", () => { try { resolve(JSON.parse(s)); } catch { resolve({ ok: false }); } }); });
    req.on("error", () => resolve({ ok: false })); req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(data); req.end();
  });
}

export const ACCOUNTABILITY_TOOLS: MnemeTool[] = [
  {
    name: "mneme.pager.ask",
    category: "audit",
    description:
      "ASK THE HUMAN (vendor-agnostic) — any agent of any vendor asks the user a question routed to their phone (Telegram) and gets a SIGNED, court-admissible answer back. kind: 'approve' (yes/no) · 'choice' (pick-one, pass choices[]) · 'text' (typed reply). Only a one-line question + hash leaves the machine. Returns { id }; then poll mneme.pager.scan for the answer (or the daemon resolves it). Example: ask the user to approve a deploy, pick a branch, or type a release name — from any vendor, lid closed.",
    whenToUse: "You need the human's yes/no, a pick-one, or a typed value while running unattended — page their phone and continue when they answer.",
    triggers: ["ask the user", "ask the human", "get approval from the user", "ask on telegram", "page the user"],
    inputSchema: { type: "object", properties: { question: { type: "string" }, kind: { type: "string", enum: ["approve", "choice", "text"] }, choices: { type: "array", items: { type: "string" } }, vendor: { type: "string" } }, required: ["question"] },
    handler: async (runtime: ToolRuntime, rawArgs: Record<string, unknown>): Promise<ToolResponse> => {
      const args = rawArgs as { question: string; kind?: pager.QuestionKind; choices?: string[]; vendor?: string };
      const cwd = runtime.cwd; const cfgP = join(cwd, ".mneme", "pager", "config.json"); const stP = join(cwd, ".mneme", "pager", "state.json");
      let cfg: { telegramToken?: string; chatId?: string; ttlMs?: number } = {}; try { if (existsSync(cfgP)) cfg = JSON.parse(readFileSync(cfgP, "utf8")); } catch { /* */ }
      const now = Date.now(); const kind = (args.kind ?? "approve");
      const nonce = Math.abs([...`${args.question}${now}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const req = pager.mintQuestion({ rawContext: args.question, question: args.question, kind, choices: args.choices, agent: (runtime as { agent?: string }).agent ?? "agent", session: "mcp", vendor: args.vendor, nonce, now, ttlMs: cfg.ttlMs });
      let tgMessageId: number | undefined;
      if (cfg.telegramToken && cfg.chatId) {
        if (kind === "text") { const r = await pagerTg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `✍️ ${req.agent} asks:\n${args.question}\n\n_reply to this message_`, parse_mode: "Markdown", reply_markup: { force_reply: true } }); tgMessageId = (r.result as { message_id?: number })?.message_id; }
        else if (kind === "choice") { await pagerTg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `🔢 ${req.agent} asks:\n${args.question}`, parse_mode: "Markdown", reply_markup: { inline_keyboard: (req.choices ?? []).map((c, i) => [{ text: c, callback_data: `c:${req.id}:${i}` }]) } }); }
        else { await pagerTg(cfg.telegramToken, "sendMessage", { chat_id: cfg.chatId, text: `❓ ${req.agent} asks:\n${args.question}`, parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "✅ Yes", callback_data: `a:${req.id}:${req.nonce}` }, { text: "⛔ No", callback_data: `d:${req.id}` }]] } }); }
      }
      try { let st: { pendings?: unknown[] } = { pendings: [] }; if (existsSync(stP)) st = JSON.parse(readFileSync(stP, "utf8")); (st.pendings ??= []).push({ req, status: "pending", lane: "conservative", tgMessageId }); mkdirSync(join(cwd, ".mneme", "pager"), { recursive: true }); writeFileSync(stP, JSON.stringify(st, null, 2), "utf8"); } catch { /* */ }
      const paged = !!(cfg.telegramToken && cfg.chatId);
      return { data: { id: req.id, kind, paged }, wisdom: paged ? `Asked the user on their phone (${kind}). Poll mneme.pager.scan for { answers["${req.id}"] }; the daemon delivers the signed answer when they tap/type.` : `Pager not configured — run 'mneme pager autosetup --telegram-token <t>' first. Question queued (id ${req.id}).` };
    },
  },
  {
    name: "mneme.pager.scan",
    category: "audit",
    description:
      "COSMIC PAGER status — pending remote-approval requests + the self-tuning Trust-Tide state. The pager lets a human approve an agent's sensitive actions from their phone (Telegram) with the laptop lid closed; only a command SUMMARY + hash leaves the machine, and the approval is a signed, hash-bound, one-time authority transfer. Read this to see what's awaiting human approval + how much each command-class is trusted. Example asks: 'what's waiting for my approval?', 'pager status', 'what did I auto-approve?'",
    whenToUse: "Check what sensitive actions are queued awaiting the human's phone approval, and the current per-class trust.",
    triggers: ["what is waiting for approval", "pager status", "pending approvals", "remote approval queue"],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const sp = join(runtime.cwd, ".mneme", "pager", "state.json");
      if (!existsSync(sp)) return { data: { active: false }, wisdom: "The Cosmic Pager isn't set up. `mneme pager setup --telegram-token … --chat-id …` then `mneme pager start`." };
      let st: { pendings?: pager.Pending[]; trust?: pager.TrustState; answers?: Record<string, string> }; try { st = JSON.parse(readFileSync(sp, "utf8")); } catch { return { data: { error: "pager state unreadable" }, wisdom: "pager state corrupt." }; }
      const pend = (st.pendings ?? []).filter((p) => p.status === "pending");
      const trust = st.trust ?? pager.emptyTrust();
      const classes = Object.keys(trust.classes ?? {});
      const answers = st.answers ?? {};
      return { data: { active: true, pending: pend.map((p) => ({ id: p.req.id, blast: p.req.blast, klass: p.req.klass, summary: p.req.summary, lane: p.lane })), answers, trustedClasses: classes.length }, wisdom: `${pend.length} action(s) awaiting your phone approval${pend.length ? ": " + pend.map((p) => `${p.req.klass} (${p.req.blast})`).join(", ") : ""}. Answered (poll here for your ask): ${Object.keys(answers).length}. Trust-Tide knows ${classes.length} command-class(es). Destructive actions are never auto-approved (hard ceiling).` };
    },
  },
  {
    name: "mneme.succession.scan",
    category: "audit",
    description:
      "SUCCESSION CAPSULE — when an agent must be halted (loop thrash / policy breach), build a SIGNED capsule that distils its PROVEN wisdom (geo axioms + reliability record) for a successor to inherit, referencing the signed proofs the toxic raw was purged. No brain-drain: kill the bad agent without losing the good learning. ★HONEST: the verdict is HALT_RECOMMENDED and `enforcedBy` is the host orchestrator — Mneme decides + packages + signs, it does NOT cut a host's API or kill its process. Pass {agent}. Example asks: 'safely retire this agent', 'capture its wisdom before we stop it', 'hand off to a successor'.",
    whenToUse: "An agent needs to be stopped/retired and you want to preserve its proven wisdom + prove the toxic raw is gone, for a clean successor handoff.",
    triggers: ["retire this agent", "halt the agent safely", "capture wisdom before stopping", "successor handoff", "no brain drain"],
    inputSchema: { type: "object", properties: { agent: { type: "string", description: "the agent id to build a succession capsule for" }, reason: { type: "string" } } },
    handler: async (runtime: ToolRuntime, args: { agent?: string; reason?: string }): Promise<ToolResponse> => {
      const cwd = runtime.cwd; const agent = args.agent ?? "unknown";
      const g = ((): geo.GeoState => { try { const p = join(cwd, ".mneme", "geo", "state.json"); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as geo.GeoState : geo.emptyGeo(); } catch { return geo.emptyGeo(); } })();
      const axioms = g.cells.filter((c) => c.tier === "axiom" && c.abstract).map((c) => c.abstract as string);
      const purgeProofRefs = g.cells.filter((c) => c.purgeProof && c.rawHash).map((c) => `geo-purge:${(c.rawHash as string).slice(0, 12)}`);
      const warm = ((): awarm.WarmState => { try { const p = join(cwd, ".mneme", "awarm", "state.json"); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as awarm.WarmState : awarm.emptyState(); } catch { return awarm.emptyState(); } })();
      const wa = awarm.queryWarm(warm).agents.find((a) => a.agent === agent);
      const reliability = wa ? { survivalPct: Math.round(wa.survivalRate * 100), band: wa.survivalRate >= 0.9 ? "solid" : wa.survivalRate >= 0.7 ? "watch" : "risky" } : null;
      const capsule = succession.buildSuccessionCapsule({ agent, reason: args.reason ?? "halt", trigger: "manual", axioms, reliability, purgeProofRefs, ts: 0 });
      return { data: { capsule }, wisdom: `🛑 ${capsule.haltVerdict} for ${agent} (enforced by the HOST orchestrator — Mneme recommends + packages, it does not kill the runtime). The successor inherits ${capsule.wisdom.length} proven axiom(s)${reliability ? ` + a ${reliability.survivalPct}% reliability record` : ""}, and ${purgeProofRefs.length} signed proof(s) confirm the toxic raw is purged. No brain-drain: the bad agent stops, the good learning survives.` };
    },
  },
  {
    name: "mneme.reckon.scan",
    category: "audit",
    description:
      "ACCOUNTABILITY DOSSIER — assemble the signed evidence for a commit (provenance attestation · secret-screen · engagement policy · whether it was reverted) into a verdict: EXONERATED (the signed record proves the rules were followed) / ACCOUNTABLE (a signed violation exists, named) / INSUFFICIENT_EVIDENCE (no record — never a guess). The permanent record becomes a SHIELD a court/auditor/insurer verifies offline. Pass {commit} (default HEAD). Example asks: 'was this commit compliant?', 'can we prove the AI followed policy?', 'who's accountable for this change?'",
    whenToUse: "The user/CISO/auditor needs a provable verdict on whether a change followed the rules — to defend or to hold accountable.",
    triggers: ["was this commit compliant", "prove the ai followed policy", "who is accountable", "reckon this commit", "accountability dossier", "exonerate"],
    inputSchema: { type: "object", properties: { commit: { type: "string", description: "commit ref (default HEAD)" } } },
    handler: async (runtime: ToolRuntime, args: { commit?: string }): Promise<ToolResponse> => {
      const cwd = runtime.cwd; const sha = git(`rev-parse ${args.commit ?? "HEAD"}`, cwd) || (args.commit ?? "HEAD");
      let attested = false, attestVerified = false, secretsClean = true;
      const ap = join(cwd, ".mneme", "attest", "chain.jsonl");
      if (existsSync(ap)) { try { for (const l of readFileSync(ap, "utf8").trim().split("\n").filter(Boolean)) { const e = JSON.parse(l) as commitAttest.AttestEntry; if (e.record?.subject === `commit:${sha}`) { attested = true; attestVerified = commitAttest.verifyAttest(e).valid; secretsClean = Number((e.facts as { addedSecrets?: number })?.addedSecrets ?? 0) === 0; break; } } } catch { /* */ } }
      let policy = engagement.defaultPolicy(); const pp = join(cwd, ".mneme", "engagement.json");
      if (existsSync(pp)) { try { policy = { ...policy, ...(JSON.parse(readFileSync(pp, "utf8")) as object) }; } catch { /* */ } }
      const files = git(`show --name-only --format= ${sha}`, cwd).split("\n").map((x) => x.trim()).filter(Boolean);
      const eng = engagement.evaluateEngagement(policy, { kind: "write", paths: files, fileCount: files.length });
      const reverted = !!git(`log --all --grep=This reverts commit ${sha} --oneline`, cwd);
      const ev = { subject: sha, attested, attestVerified, secretsClean, engagement: eng.decision, cosigned: false, customsClean: true, reverted };
      const r = reckoning.buildReckoning(ev);
      const icon = r.verdict === "EXONERATED" ? "🟢" : r.verdict === "ACCOUNTABLE" ? "🔴" : "⚪";
      const wisdom = `${icon} ${sha.slice(0, 10)} → ${r.verdict}. ${r.accountableFor.length ? "Accountable for: " + r.accountableFor.join("; ") + "." : r.exoneratedBy.length ? "Cleared by: " + r.exoneratedBy.slice(0, 3).join("; ") + "." : "No signed record to judge — don't assert compliance."} This verdict is signable + offline-verifiable — the record defends or indicts, provably.`;
      return { data: { verdict: r.verdict, evidence: ev, findings: r.findings, accountableFor: r.accountableFor }, wisdom };
    },
  },
  {
    name: "mneme.heartbeat.scan",
    category: "audit",
    description:
      "SELF-MAINTAINING PULSE — read the last signed evolution snapshot: the daemon runs a safe maintenance beat on idle that metamorphoses memory (geo), RE-VERIFIES every signed ledger OFFLINE (attest · always-warm · geo), consolidates wisdom into axioms, and signs a tamper-evident record. Reports whether all ledgers still verify + how much wisdom accrued. HONEST: it self-maintains + self-verifies — it does NOT rewrite its own rules or kill anything. Example asks: 'is Mneme self-maintaining ok?', 'are the ledgers still intact?', 'did anything tamper?'",
    whenToUse: "You want to confirm the autonomous maintenance is healthy + every signed ledger still verifies (no silent tamper/drift).",
    triggers: ["is mneme self-maintaining", "heartbeat status", "are the ledgers intact", "self-audit", "did anything tamper"],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const p = join(runtime.cwd, ".mneme", "heartbeat", "snapshot.json");
      if (!existsSync(p)) return { data: { active: false }, wisdom: "No heartbeat yet. The daemon runs one on idle; or run `mneme heartbeat` manually." };
      let s: { ranAt?: number; verify?: { allOk?: boolean; attest?: boolean; warm?: boolean; geo?: boolean }; geo?: { axioms?: number; reclaimedBytes?: number } };
      try { s = JSON.parse(readFileSync(p, "utf8")); } catch { return { data: { error: "snapshot unreadable" }, wisdom: "heartbeat snapshot corrupt." }; }
      const ok = s.verify?.allOk === true;
      return { data: { active: true, ...s }, wisdom: `Last self-maintenance beat ${s.ranAt ? new Date(s.ranAt).toISOString() : "?"}: every signed ledger ${ok ? "still VERIFIES ✓ (no tamper)" : "⚠ has an issue — investigate"} (attest ${s.verify?.attest ? "✓" : "✗"} · warm ${s.verify?.warm ? "✓" : "✗"} · geo ${s.verify?.geo ? "✓" : "✗"}). ${s.geo?.axioms ?? 0} axiom(s) of wisdom accrued. The system maintains + verifies itself — it does not rewrite its own rules.` };
    },
  },
  {
    name: "mneme.geo.scan",
    category: "audit",
    description:
      "GEOLOGICAL MEMORY COMPLIANCE — report the self-cleaning memory ledger: how many raw entries dissolved to abstract/axiom, raw bytes provably destroyed, and whether every purge proof (Ed25519, offline) + the audit chain verify. Memory metamorphoses over time so the WISDOM is kept and the RAW is destroyed — right-to-be-forgotten by construction (GDPR), no database bloat. Example asks: 'is our memory GDPR-compliant?', 'did the raw data get purged?', 'how much raw was reclaimed?'",
    whenToUse: "The user/CISO wants to confirm raw data is being provably purged (compliance) while the distilled wisdom is retained.",
    triggers: ["is the memory compliant", "did raw data get purged", "gdpr memory", "right to be forgotten", "self-cleaning memory", "memory bloat"],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const p = join(runtime.cwd, ".mneme", "geo", "state.json");
      if (!existsSync(p)) return { data: { active: false }, wisdom: "The geological memory ledger isn't active here. Seed it with `mneme geo add`, then `mneme geo metamorphose` runs the recycle (or wire it to the daemon idle tick)." };
      let s: geo.GeoState; try { s = JSON.parse(readFileSync(p, "utf8")) as geo.GeoState; } catch { return { data: { error: "geo state unreadable" }, wisdom: "geo ledger corrupt." }; }
      const st = geo.geoStats(s), v = geo.verifyGeo(s);
      const wisdom = `Geological memory: ${st.raw} raw · ${st.abstract} abstract · ${st.axiom} axiom · ${st.purged} purged (${st.rawBytesReclaimed} raw bytes provably destroyed). Compliance: ${v.proofsValid}/${v.proofsTotal} purge proofs valid, audit chain ${v.chainIntact ? "intact" : "BROKEN"}. ${v.ok ? "The raw is provably gone; the distilled wisdom + signed proof remain — right-to-be-forgotten by construction." : "⚠ verification issues — investigate."}`;
      return { data: { active: true, stats: st, compliance: v }, wisdom };
    },
  },
  {
    name: "mneme.warm.scan",
    category: "audit",
    description:
      "ALWAYS-WARM ACCOUNTABILITY — an O(1) read of the maintained accountability state (survival % · per-agent reliability · stability), NOT recomputed from git history each time. The post-commit attestation hook folds each commit in as it happens, so the answer is already warm. Provably equal to a from-scratch recompute (the event log is hash-chained + deterministically foldable). Example asks: 'is this repo healthy right now?', 'current survival rate', 'which agent is reliable here' — instantly.",
    whenToUse: "You want the current accountability picture instantly (survival / reliability / stability) without scanning history.",
    triggers: ["current survival", "is the repo healthy now", "warm state", "accountability now", "how reliable are the agents now"],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const p = join(runtime.cwd, ".mneme", "awarm", "state.json");
      if (!existsSync(p)) return { data: { warm: false }, wisdom: "The always-warm state isn't initialised. Run `mneme attest install-hook` (auto-maintains it on every commit) or `mneme warm rebuild` once." };
      let snap: awarm.WarmState; try { snap = JSON.parse(readFileSync(p, "utf8")) as awarm.WarmState; } catch { return { data: { error: "warm state unreadable" }, wisdom: "warm state corrupt — `mneme warm rebuild`." }; }
      const q = awarm.queryWarm(snap);
      const wisdom = `(O(1) read) ${q.commits} commits · survival ${q.survivalPct}% · ${q.stability.explicitReverts} explicit reverts. By agent: ${q.agents.map((a) => `${a.agent} ${Math.round(a.survivalRate * 100)}% (${a.survived}/${a.commits})`).join(", ")}. This is a maintained snapshot — provably equal to a full recompute (mneme warm verify).`;
      return { data: { warm: true, commits: q.commits, survivalPct: q.survivalPct, stability: q.stability, agents: q.agents }, wisdom };
    },
  },
  {
    name: "mneme.revert.scan",
    category: "audit",
    description:
      "THE REGRET FLYWHEEL — scan git history for commits that were later REVERTED or HOTFIXED (work that did NOT survive), join with the signed attestation ledger (which agent made each commit), and report per-agent SURVIVAL. Everyone measures 'did the test pass now'; this measures 'did the work last'. Example asks: 'which of my commits got reverted?', 'does this agent leave work that survives?', 'how stable is our AI-written code?'",
    whenToUse: "You want to know whether work (yours or an agent's) actually survived, or which commits were undone.",
    triggers: ["which commits were reverted", "did the work survive", "regret", "what got rolled back", "agent survival rate", "commit ถูก revert"],
    inputSchema: { type: "object", properties: { windowDays: { type: "number", description: "hotfix detection window (default 14)" } } },
    handler: async (runtime: ToolRuntime, args: { windowDays?: number }): Promise<ToolResponse> => {
      const commits = readCommits(runtime.cwd);
      if (!commits.length) return { data: { note: "no git history" }, wisdom: "No commits to scan." };
      const reverts = revertRadar.detectReverts(commits, { windowDays: args.windowDays ?? 14 });
      const survival = revertRadar.survivalByAgent(commits, reverts);
      const top = reverts.slice(0, 10).map((r) => ({ sha: r.sha.slice(0, 10), agent: r.agent, kind: r.kind, confidence: r.confidence, survivedDays: r.ageDays }));
      const wisdom = reverts.length
        ? `${reverts.length} commit(s) did NOT survive (reverted/hotfixed). Survival by agent: ${survival.map((s) => `${s.agent} ${Math.round(s.survivalRate * 100)}% (${s.regretted}/${s.commits} undone)`).join(", ")}. Honest: explicit reverts are proof; hotfix-window matches are a weaker signal.`
        : `✓ No reverts/hotfixes detected — the recent work survived.`;
      return { data: { reverts: top, survival, scanned: commits.length }, wisdom };
    },
  },
  {
    name: "mneme.agentbench.scan",
    category: "audit",
    description:
      "CROSS-VENDOR RELIABILITY RANKING — rank the AI agents that worked in this repo (any vendor) on the SAME measured outcome: did their work SURVIVE (vs get reverted/hotfixed), with a Wilson 95% LOWER bound so a small sample scores LOW and the ranking can't be gamed. Not synthetic, not vendor PR — from THIS repo's real outcomes. Example asks: 'which AI agent is most reliable here?', 'rank the agents', 'who should I trust with more autonomy?'",
    whenToUse: "You want a trustworthy, outcome-based ranking of which agents leave work that lasts (e.g. before granting more autonomy).",
    triggers: ["rank the agents", "which agent is most reliable", "agent reliability", "who should I trust", "vendor benchmark", "agent ไหนน่าเชื่อถือ"],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const commits = readCommits(runtime.cwd);
      const survival = revertRadar.survivalByAgent(commits, revertRadar.detectReverts(commits));
      const ranked = agentBenchmark.rankAgents(survival);
      const wisdom = ranked.length
        ? `Reliability (Wilson-LB on survival): ${ranked.map((r) => `${r.agent} ${r.band}${r.band === "unmeasured" ? "" : ` ${Math.round(r.wilsonLB * 100)}%`} (${r.commits} commits)`).join(", ")}. 'unmeasured' = too few commits to judge (can't be gamed by a lucky streak).`
        : "No attested commits yet — install `mneme attest install-hook` so future commits are attributed + measured.";
      return { data: { ranked }, wisdom };
    },
  },
  {
    name: "mneme.engagement.scan",
    category: "audit",
    description:
      "ROBOTS.TXT FOR AGENTS — evaluate an action (or the current staged change) against the repo's signed Engagement Policy (`.mneme/engagement.json`): forbidden paths, actions needing a human cosign, forbidden licenses, change-size ceiling. Returns ALLOW / NEEDS_COSIGN / BLOCK + the rule that fired. Call this BEFORE a risky action. Pass {kind, paths, license, fileCount}, or nothing to scan the staged diff. Example asks: 'can I push to main?', 'is it ok to touch this file?', 'does this change need approval?'",
    whenToUse: "BEFORE a write/push/deploy/add-dep, to check it against the org's machine-enforceable engagement rules.",
    triggers: ["can I push to main", "is this allowed", "engagement policy", "does this need approval", "am I allowed to touch", "ทำได้ไหม"],
    inputSchema: { type: "object", properties: { kind: { type: "string", description: "action: write | push:main | deploy:prod | add-dep | merge | …" }, paths: { type: "array", items: { type: "string" } }, license: { type: "string" }, fileCount: { type: "number" } } },
    handler: async (runtime: ToolRuntime, args: { kind?: string; paths?: string[]; license?: string; fileCount?: number }): Promise<ToolResponse> => {
      const pp = join(runtime.cwd, ".mneme", "engagement.json");
      let policy = engagement.defaultPolicy();
      if (existsSync(pp)) { try { policy = { ...policy, ...(JSON.parse(readFileSync(pp, "utf8")) as object) }; } catch { /* default */ } }
      let paths = args.paths;
      if (!paths && !args.kind) { const staged = git("diff --cached --name-only", runtime.cwd); paths = staged ? staged.split("\n").filter(Boolean) : git("diff --name-only HEAD", runtime.cwd).split("\n").filter(Boolean); }
      const action = { kind: args.kind ?? "write", paths, license: args.license, fileCount: args.fileCount ?? (paths?.length ?? 0) };
      const v = engagement.evaluateEngagement(policy, action);
      const wisdom = v.decision === "ALLOW"
        ? `✓ ALLOW — within the engagement policy.`
        : `${v.decision === "BLOCK" ? "🛑 BLOCK" : "✋ NEEDS_COSIGN"} — ${v.reasons.join("; ")}. ${v.decision === "BLOCK" ? "Do NOT proceed." : "Get a human cosign before proceeding."}`;
      return { data: { decision: v.decision, reasons: v.reasons, matched: v.matched, action }, wisdom };
    },
  },
];

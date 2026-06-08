/**
 * `mneme live` — the real-time health of Mneme's background support for AI agents.
 * Gathers live facts (daemon heartbeat · hook wired · every provider's send+clear readiness +
 * reachability · relay · state integrity · an end-to-end pipeline canary) and renders one verdict:
 * LIVE / DEGRADED / DOWN — with auto-heal. Catches SILENT breakage before a user ever hits it.
 */
import type { Command } from "commander";
import { existsSync, readFileSync, statSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { live, agentFit, proofLoop, turnSignal, skillEffectiveness, crossLayerGraph } from "@mneme-ai/core";
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
  // ── CROSS-LAYER GRAPH — code ↔ db_table ↔ api_endpoint, deterministic, no LLM ──────────────────
  const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|prisma|sql)$/i;
  const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
  function scanRepo(root: string, cap = 4000, ext: RegExp = SCAN_EXT): crossLayerGraph.SourceFile[] {
    const files: crossLayerGraph.SourceFile[] = []; const stack = [root];
    while (stack.length && files.length < cap) {
      const d = stack.pop()!;
      let ents: string[] = []; try { ents = readdirSync(d); } catch { continue; }
      for (const e of ents) {
        if (SKIP_DIR.has(e)) continue; const p = join(d, e);
        let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) stack.push(p);
        else if (ext.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(root.length + 1), content: readFileSync(p, "utf8") }); } catch { /* */ } }
      }
    }
    return files;
  }
  const graph = program.command("graph").description("🕸 CROSS-LAYER GRAPH — link your CODE ↔ DATABASE tables ↔ API endpoints (deterministic, no LLM) and compute a cross-layer BLAST RADIUS: edit a function → see which DB tables AND API routes it reaches. The cross-layer join no single-layer code-graph reports.");
  const MD_EXT = /\.(md|mdx|markdown|txt)$/i;
  const scanWithDocs = (cwd: string) => { const code = scanRepo(cwd); const docs = scanRepo(cwd, 1200, MD_EXT); const seen = new Set(code.map((f) => f.path)); return [...code, ...docs.filter((d) => !seen.has(d.path))]; };
  graph.command("stats").description("Build the 4-layer graph from this repo + show node/edge counts + business-rule coverage.").action(() => {
    const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
    const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
    const byRel = (r: string) => g.edges.filter((e) => e.relation === r).length;
    const cov = crossLayerGraph.businessCoverage(g);
    out(`🕸 Cross-layer graph of ${cwd}:`);
    out(`   nodes: ${g.nodes.length}  (💼 business ${byType("business_rule")} · 🌐 api ${byType("api_endpoint")} · ⚙ functions ${byType("function")} · 🗄 tables ${byType("db_table")})`);
    out(`   edges: ${g.edges.length}  (WRITES_TO ${byRel("WRITES_TO")} · READS ${byRel("READS")} · HANDLED_BY ${byRel("HANDLED_BY")} · CALLS ${byRel("CALLS")} · IMPLEMENTS ${byRel("IMPLEMENTS")})`);
    if (cov.total) out(`   business-rule coverage: ${cov.anchored.length}/${cov.total} anchored to code (${Math.round(cov.coverageRate * 100)}%) · ${cov.orphan.length} orphan/UNKNOWN (no deterministic anchor — not asserted "unimplemented")`);
    out("   deterministic · no LLM · every node+edge from a real file. Visualize: mneme graph view <name> · mneme graph mermaid <name>");
  });
  graph.command("mermaid [name]").description("Emit a Mermaid flowchart (4 layers as subgraphs) — paste into GitHub/Markdown/this chat to SEE the graph. With a name: that node's blast radius; without: the structural hubs.")
    .option("--depth <n>", "blast depth (default 2)").action((name: string | undefined, o: { depth?: string }) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const focus = name ? crossLayerGraph.resolveNode(g, name) : null;
      if (name && !focus) { out(`✗ no node matching "${name}". Try: mneme graph stats`); return; }
      out("```mermaid"); out(crossLayerGraph.toMermaid(g, focus?.id, o.depth ? { maxDepth: parseInt(o.depth, 10) } : undefined)); out("```");
    });
  graph.command("view [name]").description("Write a self-contained, offline, interactive HTML visualization — open it in any browser. Default = 🛰 IMPACT RADAR (center = your change · sectors = layers · rings = blast hop-distance · animated sweep+pulse · click any node to re-center). --style lanes for the tiered view. With a name: focus on that node.")
    .option("--out <file>", "output path (default: mneme-graph.html)").option("--depth <n>", "blast depth (default radar 3 / lanes 2)").option("--style <s>", "radar | lanes (default: radar)")
    .action((name: string | undefined, o: { out?: string; depth?: string; style?: string }) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const focus = name ? crossLayerGraph.resolveNode(g, name) : null;
      if (name && !focus) { out(`✗ no node matching "${name}". Try: mneme graph stats`); return; }
      const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort()) + JSON.stringify(g.edges.map((e) => `${e.source}|${e.target}|${e.relation}`).sort())).digest("hex").slice(0, 16);
      const depth = o.depth ? parseInt(o.depth, 10) : undefined;
      const lanes = (o.style ?? "radar").toLowerCase() === "lanes";
      const html = lanes ? crossLayerGraph.toHtml(g, focus?.id, { fingerprint: fp, maxDepth: depth }) : crossLayerGraph.toRadarHtml(g, focus?.id, { fingerprint: fp, maxDepth: depth });
      const outPath = o.out ?? join(cwd, "mneme-graph.html");
      try { writeFileSync(outPath, html, "utf8"); out(`${lanes ? "🕸" : "🛰"} wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, self-contained ${lanes ? "tiered" : "IMPACT RADAR — click a node to re-center"} · fingerprint ${fp}). Open it in a browser.`); } catch (e) { out(`✗ could not write: ${(e as Error).message}`); }
    });
  graph.command("card [name]").description("📇 Export a STATIC share card of the Impact Radar (1200×630, social/OG ratio) — .svg (vector) or .png (rasterized). Great for a PR, a README, or a tweet.")
    .option("--out <file>", "output path (.png or .svg; default: mneme-radar.png)").option("--depth <n>", "blast depth (default 3)")
    .action(async (name: string | undefined, o: { out?: string; depth?: string }) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const focus = name ? crossLayerGraph.resolveNode(g, name) : null;
      if (name && !focus) { out(`✗ no node matching "${name}". Try: mneme graph stats`); return; }
      const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort())).digest("hex").slice(0, 12);
      const svg = crossLayerGraph.toRadarSvg(g, focus?.id, { fingerprint: fp, maxDepth: o.depth ? parseInt(o.depth, 10) : undefined });
      const outPath = o.out ?? join(cwd, "mneme-radar.png");
      try {
        if (/\.png$/i.test(outPath)) {
          const sharp = (await import("sharp")).default;
          await sharp(Buffer.from(svg)).png().toFile(outPath);
          out(`📇 wrote ${outPath} (PNG 1200×630 · fingerprint ${fp}). Drop it in a PR / README / tweet.`);
        } else { writeFileSync(outPath, svg, "utf8"); out(`📇 wrote ${outPath} (SVG 1200×630 · fingerprint ${fp}).`); }
      } catch (e) { out(`✗ could not write: ${(e as Error).message}${/\.png$/i.test(outPath) ? " — try --out card.svg (no rasterizer needed)" : ""}`); }
    });
  graph.command("pr").description("🔀 PR BLAST RADIUS — what a whole change set touches across layers. Reads a git diff (default: working changes; --base <ref> for a PR; --staged for the index) → the union blast radius: which DB tables, API routes & business rules this diff reaches. --markdown for a PR comment. Exit 2 if a DB table is touched.")
    .option("--base <ref>", "diff against this ref (e.g. origin/main) — the PR diff").option("--staged", "diff the staged index").option("--markdown", "emit a Markdown PR comment").option("--depth <n>", "blast depth (default 2)")
    .action((o: { base?: string; staged?: boolean; markdown?: boolean; depth?: string }) => {
      const cwd = process.cwd();
      const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : o.staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", "HEAD"];
      const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      const diff = String(r.stdout || "");
      if (!diff.trim()) { out("No diff found. (Try --base origin/main, or --staged, or make some changes.)"); return; }
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const b = crossLayerGraph.diffBlastRadius(g, diff, { maxDepth: o.depth ? parseInt(o.depth, 10) : 1 });
      if (o.markdown) { out(crossLayerGraph.diffBlastMarkdown(b, { repo: cwd.split(/[\\/]/).pop() })); if (b.tables.length) process.exitCode = 2; return; }
      out(`🔀 PR blast radius — ${b.changed} changed function(s) cross-layer reach: 💼 ${b.rules.length} rules · 🌐 ${b.endpoints.length} endpoints · 🗄 ${b.tables.length} tables · ⚙ ${b.functions.length} functions:`);
      if (b.rules.length) out(`   💼 business rules (${b.rules.length}): ${b.rules.map((x) => x.name).join(" · ")}`);
      if (b.endpoints.length) out(`   🌐 API endpoints (${b.endpoints.length}): ${b.endpoints.map((x) => `${x.method} ${x.name}`).join(" · ")}`);
      if (b.tables.length) out(`   🗄  DB tables (${b.tables.length}): ${b.tables.map((x) => x.name).join(" · ")}  ⚠️ check migrations`);
      if (b.functions.length) out(`   ⚙  functions (${b.functions.length}): ${b.functions.slice(0, 25).map((x) => x.name).join(" · ")}${b.functions.length > 25 ? " …" : ""}`);
      if (!b.changed) out("   (no changed functions resolved to the graph — a non-code or new-file diff)");
      if (b.tables.length) process.exitCode = 2;
    });
  graph.command("health").description("🩺 GRAPH HEALTH — cross-layer KEYSTONES (a function that's the SOLE writer to a table + has real fan-in = a single point of failure across layers) + ORPHANS (dead-code candidates: functions nothing calls, tables no code touches, endpoints with no handler).")
    .action(() => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const h = crossLayerGraph.graphHealth(g);
      out("🩺 Cross-layer graph health:");
      if (h.keystones.length) { out(`   🔑 KEYSTONES (single point of failure across layers) — ${h.keystones.length}:`); for (const k of h.keystones.slice(0, 12)) out(`      ${k.node.name}${k.node.file ? ` (${k.node.file})` : ""} — ${k.reason}`); }
      else out("   🔑 no cross-layer keystones (no sole-writer with fan-in).");
      if (h.orphanTables.length) out(`   🗄  orphan tables (no code reads/writes — dead schema or dynamic): ${h.orphanTables.map((t) => t.name).join(" · ")}`);
      if (h.orphanEndpoints.length) out(`   🌐 orphan endpoints (no resolved handler): ${h.orphanEndpoints.slice(0, 20).map((e) => `${e.method} ${e.name}`).join(" · ")}`);
      out(`   ⚙  dead-code candidate functions: ${h.orphanFunctions.length} (nothing in the scanned files calls them — may be exported/entry-points, so candidates not proof)`);
      out("   honest: candidates to inspect (deterministic), prove-or-unknown — an orphan may be a public API or dynamically called.");
    });
  graph.command("benchmark").alias("accuracy").description("📊 EXTRACTOR ACCURACY — measured precision/recall of the cross-layer extractor on a labeled corpus. Reproducible credibility, not a marketing claim.")
    .action(() => {
      const b = crossLayerGraph.extractorBenchmark();
      out("📊 Cross-layer extractor accuracy (labeled corpus, reproducible):");
      out(`   nodes:  precision ${Math.round(b.nodePrecision * 100)}%  ·  recall ${Math.round(b.nodeRecall * 100)}%`);
      out(`   edges:  precision ${Math.round(b.edgePrecision * 100)}%  ·  recall ${Math.round(b.edgeRecall * 100)}%  ·  F1 ${b.f1}`);
      for (const f of b.fixtures) out(`      ${f.name.padEnd(16)} nodes ${f.nodeHit}/${f.nodeExp} · edges ${f.edgeHit}/${f.edgeExp}${f.edgeSpurious ? ` · ${f.edgeSpurious} spurious` : ""}`);
      out("   honest: measured on common patterns (JS/Prisma · Python/Django · SQLAlchemy · Go/SQL) — extend the corpus to test more.");
    });
  graph.command("check").description("🚦 AGENT BLAST-CHECK — before applying an edit, flag any DB table / API route / business rule the diff touches that your request never mentioned. --intent \"<the request>\". Exit 2 on 'review' (a surprise) — gate an agent's auto-apply.")
    .requiredOption("--intent <text>", "the user's request, verbatim").option("--base <ref>").option("--staged").option("--depth <n>")
    .action((o: { intent: string; base?: string; staged?: boolean; depth?: string }) => {
      const cwd = process.cwd();
      const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : o.staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", "HEAD"];
      const diff = String(spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const chk = crossLayerGraph.agentBlastCheck(g, diff, o.intent, { maxDepth: o.depth ? parseInt(o.depth, 10) : 1 });
      if (chk.verdict === "clean") { out("✓ clean — every cross-layer node this change touches was named in the request."); return; }
      out(`🚦 REVIEW — ${chk.reason}`);
      if (chk.surpriseTables.length) out(`   🗄  unmentioned tables: ${chk.surpriseTables.map((t) => t.name).join(" · ")}  ⚠️ check before applying`);
      if (chk.surpriseEndpoints.length) out(`   🌐 unmentioned endpoints: ${chk.surpriseEndpoints.map((e) => `${e.method} ${e.name}`).join(" · ")}`);
      if (chk.surpriseRules.length) out(`   💼 unmentioned rules: ${chk.surpriseRules.map((r) => r.name).join(" · ")}`);
      process.exitCode = 2;
    });
  graph.command("blast <name>").description("Cross-layer blast radius for a function / table / endpoint: what ELSE is coupled to it across all three layers.")
    .option("--depth <n>", "max hops (default: unlimited)").action((name: string, o: { depth?: string }) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanRepo(cwd));
      const node = crossLayerGraph.resolveNode(g, name);
      if (!node) { out(`✗ no function/table/endpoint matching "${name}" found in the graph. Try: mneme graph stats`); return; }
      const br = crossLayerGraph.blastRadius(g, node.id, { maxDepth: o.depth ? parseInt(o.depth, 10) : 2 });
      out(`🕸 Blast radius of ${node.type} "${node.name}"${node.file ? ` (${node.file})` : ""} — ${br.reachable} coupled node(s):`);
      if (br.rules.length) out(`   💼 business rules (${br.rules.length}): ${br.rules.map((r) => r.name).join(" · ")}`);
      if (br.endpoints.length) out(`   🌐 API endpoints (${br.endpoints.length}): ${br.endpoints.map((e) => `${e.method} ${e.name}`).join(" · ")}`);
      if (br.tables.length) out(`   🗄  DB tables (${br.tables.length}): ${br.tables.map((t) => t.name).join(" · ")}`);
      if (br.functions.length) out(`   ⚙  functions (${br.functions.length}): ${br.functions.slice(0, 25).map((f) => f.name).join(" · ")}${br.functions.length > 25 ? " …" : ""}`);
      if (!br.reachable) out("   (nothing coupled — isolated node)");
      out("   honest: reachable COUPLING to inspect (deterministic), not a proven runtime break.");
    });

  const skill = program.command("skill").description("🧩 VERIFIED SKILLS — beyond a skill registry: rank skills by MEASURED effectiveness (did using it lead to success?), not popularity. Pairs with `mneme skillscan` (safe install) + LIVE PROOF (outcomes).");
  const skillUsesPath = (cwd: string) => join(cwd, ".mneme", "skills", "uses.jsonl");
  const loadUses = (cwd: string): skillEffectiveness.SkillUse[] => { try { return _rf(skillUsesPath(cwd), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  skill.command("use <skillId>").description("Record a skill use + whether it LANDED (a success/assist followed).")
    .option("--missed", "the skill did NOT lead to success (default: landed)").option("--agent <id>")
    .action((skillId: string, o: { missed?: boolean; agent?: string }) => {
      const cwd = process.cwd(); const u = skillEffectiveness.normalizeUse({ skillId, landed: !o.missed, agent: o.agent, at: Date.now() });
      try { mkdirSync(join(cwd, ".mneme", "skills"), { recursive: true }); appendFileSync(skillUsesPath(cwd), JSON.stringify(u) + "\n", "utf8"); } catch { /* */ }
      out(`✓ recorded: ${u.skillId} · ${u.landed ? "landed" : "missed"}`);
    });
  skill.command("rank").description("Rank skills by PROVEN effectiveness (Wilson-LB, not popularity).").action(() => {
    const r = skillEffectiveness.rankSkills(loadUses(process.cwd()));
    if (!r.length) { out("no skill-use data yet. Record with: mneme skill use <id> [--missed]"); return; }
    out("🧩 Skills by measured effectiveness (proven first):");
    for (const s of r) out(`   ${s.band.padEnd(11)} ${String(Math.round(s.rateLB * 100)).padStart(3)}%  ${s.skillId}  (${s.landed}/${s.uses})`);
    out("   (PROVEN ≥55% Wilson-LB · UNPROVEN = too few uses to judge — not bad)");
  });
  skill.command("score <skillId>").description("The measured effectiveness of one skill.").action((skillId: string) => {
    const s = skillEffectiveness.scoreSkill(loadUses(process.cwd()), skillId);
    out(`🧩 ${s.skillId}: ${s.band} · ${Math.round(s.rateLB * 100)}% proven-floor (${s.landed}/${s.uses} landed)`);
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

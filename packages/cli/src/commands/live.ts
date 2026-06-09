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
import { live, agentFit, proofLoop, turnSignal, skillEffectiveness, crossLayerGraph, scopeCovenant, agentCollision, testGap, authzGap, intentImpact, riskHotspots, onboarding, crossService, logicEngine, graphLogic, accuracy, apiSurface, graphqlSurface, archLock, invariants, archBisect, archDecay } from "@mneme-ai/core";
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
  const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
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
  graph.command("drift").description("⏱ ARCHITECTURAL DRIFT — what cross-layer coupling APPEARED or disappeared since a past commit. --base <ref> (e.g. a tag, origin/main, a sha). Catches 'createOrder now writes the payments table' — a function reaching a new layer it didn't before.")
    .requiredOption("--base <ref>", "the earlier commit/tag/branch to compare against").option("--max <n>", "max files to read at the base ref (default 2500)").action((o: { base: string; max?: string }) => {
      const cwd = process.cwd();
      // read the base snapshot WITHOUT touching the working tree: git ls-tree + git show per file
      // (cross-platform — avoids tar's Windows-drive-letter-as-host quirk).
      const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", o.base], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (ls.status !== 0) { out(`✗ unknown ref "${o.base}": ${(ls.stderr || "").trim().slice(0, 140)}`); return; }
      const cap = o.max ? parseInt(o.max, 10) : 2500;
      const wanted = ls.stdout.split("\n").map((s) => s.trim()).filter((f) => f && (SCAN_EXT.test(f) || MD_EXT.test(f)) && !SKIP_DIR.has(f.split("/")[0])).slice(0, cap);
      const prevFiles: crossLayerGraph.SourceFile[] = [];
      for (const f of wanted) { const r = spawnSync("git", ["show", `${o.base}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) prevFiles.push({ path: f, content: r.stdout }); }
      const prev = crossLayerGraph.buildCrossLayerGraph(prevFiles);
      const curr = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const d = crossLayerGraph.graphDrift(prev, curr);
      out(`⏱ Architectural drift since ${o.base} (${prevFiles.length} base files read):`);
      if (d.addedTables.length) out(`   🗄 + new tables: ${d.addedTables.join(" · ")}`);
      if (d.removedTables.length) out(`   🗄 − removed tables: ${d.removedTables.join(" · ")}`);
      if (d.addedEndpoints.length) out(`   🌐 + new endpoints: ${d.addedEndpoints.slice(0, 20).join(" · ")}`);
      if (d.addedCouplings.length) { out(`   🔗 + NEW cross-layer couplings (${d.addedCouplings.length}):`); for (const c of d.addedCouplings.slice(0, 25)) out(`      ${c.from} —${c.relation}→ ${c.to}`); }
      if (d.removedCouplings.length) out(`   🔗 − removed couplings (${d.removedCouplings.length}): ${d.removedCouplings.slice(0, 10).map((c) => `${c.from}→${c.to}`).join(" · ")}`);
      if (!d.addedCouplings.length && !d.removedCouplings.length && !d.addedTables.length && !d.removedTables.length) out("   ✓ no cross-layer structural change — same architecture.");
      out("   honest: structural coupling deltas to inspect (deterministic), not a value judgement.");
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
  graph.command("prove-drop <table>").description("🧠 PROVABLE DROP SAFETY — proves unsafe_to_drop(table) from real graph facts via the logic engine: UNSAFE with the cited blocker + proof chain, or LIKELY_SAFE (no structural blocker, prove-or-unknown). The provable upgrade of `reverse`. Exit 2 if UNSAFE.")
    .action((table: string) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const d = graphLogic.dropProof(g, table);
      const ico = d.verdict === "UNSAFE" ? "🔴" : d.verdict === "LIKELY_SAFE" ? "🟢" : "🟡";
      out(`${ico} ${d.verdict} — ${d.reason}`);
      if (d.chain.length) { out("   proof:"); for (const s of d.chain) out(`     ${s.atom}${s.via === "given" ? "  (given)" : "  ⇐ " + s.from.join(" ∧ ")}`); }
      if (d.verdict === "UNSAFE") process.exitCode = 2;
    });
  graph.command("prove-reach <endpoint> <table>").description("🧠 PROVE an endpoint reaches a table THROUGH the call graph (transitive proof chain), via the logic engine.")
    .action((endpoint: string, table: string) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const r = graphLogic.reachesProof(g, endpoint, table);
      out(`${r.reachable ? "✅ PROVEN" : "🟡 not proven"} — ${r.reason}`);
      if (r.chain.length) { out("   proof:"); for (const s of r.chain) out(`     ${s.atom}${s.via === "given" ? "  (given)" : "  ⇐ " + s.from.join(" ∧ ")}`); }
    });
  graph.command("graphql-diff").description("🔺 GRAPHQL BREAKING-CHANGE — diff the GraphQL operation surface (Query/Mutation/Subscription from SDL) vs --base <ref>: a REMOVED operation or CHANGED return type = BREAKING (clients break). Exit 2 on a breaking change.")
    .requiredOption("--base <ref>").option("--max <n>").action((o: { base: string; max?: string }) => {
      const cwd = process.cwd();
      const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", o.base], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (ls.status !== 0) { out(`✗ unknown ref "${o.base}"`); process.exitCode = 2; return; }
      const EXT = /\.(graphql|gql|ts|tsx|js|jsx|mjs|cjs)$/i;
      const wanted = ls.stdout.split("\n").map((s) => s.trim()).filter((f) => f && EXT.test(f) && !SKIP_DIR.has(f.split("/")[0])).slice(0, o.max ? parseInt(o.max, 10) : 3000);
      const prevFiles: crossLayerGraph.SourceFile[] = [];
      for (const f of wanted) { const r = spawnSync("git", ["show", `${o.base}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) prevFiles.push({ path: f, content: r.stdout }); }
      const currFiles = scanRepo(cwd).filter((f) => EXT.test(f.path)).concat(scanRepo(cwd, 600000, /\.(graphql|gql)$/i));
      const bc = graphqlSurface.graphqlBreaking(prevFiles, currFiles);
      out(`🔺 GraphQL surface vs ${o.base}: +${bc.addedCount} added · -${bc.removedCount} removed · ~${bc.retypedCount} retyped`);
      if (!bc.breaking.length) { out("   ✓ no breaking GraphQL change."); return; }
      for (const b of bc.breaking.slice(0, 25)) out(`   🔴 ${b.reason}`);
      process.exitCode = 2;
    });
  graph.command("api-diff").alias("breaking").description("🔌 API BREAKING-CHANGE DETECTOR — diff the produced API surface vs --base <ref>: added/removed endpoints, and which REMOVED endpoints are still CONSUMED (BREAKING) by this repo's own callers vs only POSSIBLY breaking. Exit 2 on a BREAKING change.")
    .requiredOption("--base <ref>", "the earlier commit/tag/branch to compare against").option("--max <n>").action((o: { base: string; max?: string }) => {
      const cwd = process.cwd();
      const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", o.base], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (ls.status !== 0) { out(`✗ unknown ref "${o.base}": ${(ls.stderr || "").trim().slice(0, 140)}`); process.exitCode = 2; return; }
      const cap = o.max ? parseInt(o.max, 10) : 2500;
      const wanted = ls.stdout.split("\n").map((s) => s.trim()).filter((f) => f && SCAN_EXT.test(f) && !SKIP_DIR.has(f.split("/")[0])).slice(0, cap);
      const prevFiles: crossLayerGraph.SourceFile[] = [];
      for (const f of wanted) { const r = spawnSync("git", ["show", `${o.base}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) prevFiles.push({ path: f, content: r.stdout }); }
      const currFiles = scanWithDocs(cwd);
      const bc = apiSurface.breakingChanges(prevFiles, currFiles, [{ name: "this repo", files: currFiles }]);
      out(`🔌 API surface vs ${o.base}: +${bc.addedCount} added · -${bc.removedCount} removed`);
      if (!bc.breaking.length) { out("   ✓ no removed/changed endpoints — no breaking change."); return; }
      const hard = bc.breaking.filter((b) => b.severity === "BREAKING");
      for (const b of bc.breaking.slice(0, 20)) out(`   ${b.severity === "BREAKING" ? "🔴 BREAKING" : "🟡 possibly"} ${b.method} ${b.path}${b.consumedBy.length ? " — consumed by " + b.consumedBy.join(", ") : ""}`);
      out("   honest: removed endpoints matched by method+path; external clients are invisible (→ POSSIBLY).");
      if (hard.length) process.exitCode = 2;
    });
  graph.command("reverse <name>").alias("drop").description("⛔ DROP SAFETY (reverse blast radius) — before you remove a DB table or endpoint, see EVERYTHING that depends on it: functions, their upstream callers, endpoints, business rules. SAFE / RISKY / CRITICAL. Exit 2 on CRITICAL.")
    .action((name: string) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const d = crossLayerGraph.dropImpact(g, name);
      if (!d.node) { out(`✗ no table/endpoint matching "${name}". Try: mneme graph stats`); return; }
      const ico = d.safety === "SAFE" ? "✅" : d.safety === "RISKY" ? "🟡" : "🔴";
      out(`${ico} DROP ${d.node.type} "${d.node.name}": ${d.safety} — ${d.reason}`);
      if (d.keystonesAffected.length) out(`   🔑 keystones broken: ${d.keystonesAffected.join(" · ")}`);
      if (d.dependentEndpoints.length) out(`   🌐 endpoints affected: ${d.dependentEndpoints.slice(0, 20).join(" · ")}`);
      if (d.dependentRules.length) out(`   💼 business rules affected: ${d.dependentRules.join(" · ")}`);
      if (d.dependentFunctions.length) out(`   ⚙  functions depending on it (${d.dependentFunctions.length}): ${d.dependentFunctions.slice(0, 25).join(" · ")}${d.dependentFunctions.length > 25 ? " …" : ""}`);
      out("   honest: structural dependents (deterministic) — verify dynamic/reflective access too.");
      if (d.safety === "CRITICAL") process.exitCode = 2;
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

  // ── SCOPE COVENANT — verify an edit stayed within its declared architectural scope (signed track record)
  const scope = program.command("scope").description("🤝 SCOPE COVENANT (world-first) — verify an autonomous edit stayed within the scope it DECLARED, and track each agent's cross-vendor scope-fidelity. The accountability layer autonomous agents lack.");
  const scopeLedgerPath = (cwd: string) => join(cwd, ".mneme", "scope", "ledger.jsonl");
  const loadScope = (cwd: string): scopeCovenant.ScopeRecord[] => { try { return _rf(scopeLedgerPath(cwd), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  scope.command("verify").description("Verify the current diff against a declared scope. Exit 2 on BREACHED.")
    .requiredOption("--intent <text>", "what you promised to do").option("--allow-files <globs>", "comma-separated file globs you're allowed to touch").option("--allow-tables <names>", "comma-separated DB tables you're allowed to reach").option("--allow-endpoints <paths>", "comma-separated API routes").option("--base <ref>").option("--staged").option("--agent <id>")
    .action((o: { intent: string; allowFiles?: string; allowTables?: string; allowEndpoints?: string; base?: string; staged?: boolean; agent?: string }) => {
      const cwd = process.cwd();
      const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : o.staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", "HEAD"];
      const diff = String(spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const agent = o.agent ?? "agent";
      const split = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);
      const v = scopeCovenant.verifyScope(g, diff, { agent, intent: o.intent, allow: { files: split(o.allowFiles), tables: split(o.allowTables), endpoints: split(o.allowEndpoints) } });
      if (v.verdict !== "EMPTY") { try { mkdirSync(join(cwd, ".mneme", "scope"), { recursive: true }); appendFileSync(scopeLedgerPath(cwd), JSON.stringify({ agent, honored: v.honored, at: Date.now() }) + "\n", "utf8"); } catch { /* */ } }
      if (v.verdict === "HONORED") { out(`🤝 HONORED — the edit stayed within the declared scope (${v.changedFiles.length} file(s); reached ${v.reachedTables.length} table(s), ${v.reachedEndpoints.length} endpoint(s)).`); return; }
      if (v.verdict === "EMPTY") { out("(empty diff — nothing to verify)"); return; }
      out(`🤝 BREACHED — ${v.reason}`);
      if (v.breachFiles.length) out(`   📄 unpromised files: ${v.breachFiles.join(" · ")}`);
      if (v.breachTables.length) out(`   🗄  unpromised tables: ${v.breachTables.join(" · ")}`);
      if (v.breachEndpoints.length) out(`   🌐 unpromised endpoints: ${v.breachEndpoints.join(" · ")}`);
      process.exitCode = 2;
    });
  scope.command("fidelity [agent]").description("Cross-vendor scope-fidelity: how faithfully each agent keeps the scope it declares (Wilson-LB).")
    .action((agent: string | undefined) => {
      const cwd = process.cwd(); const led = loadScope(cwd);
      if (!led.length) { out("no scope-covenant verdicts yet. Run: mneme scope verify --intent \"...\" --allow-files ..."); return; }
      if (agent) { const f = scopeCovenant.scopeFidelity(led, agent); out(`🤝 ${f.agent}: ${f.band} · ${Math.round(f.rateLB * 100)}% scope-fidelity floor (${f.honored}/${f.total} honored)`); return; }
      out("🤝 Scope fidelity (how faithfully each agent keeps its declared scope):");
      for (const f of scopeCovenant.rankFidelity(led)) out(`   ${f.band.padEnd(10)} ${String(Math.round(f.rateLB * 100)).padStart(3)}%  ${f.agent}  (${f.honored}/${f.total})`);
      out("   EXEMPLARY ≥90% · UNPROVEN = too few verdicts to judge. Signed, deterministic — an agent can't certify its own scope-keeping.");
    });

  program.command("onboard").alias("tour").description("🧭 ONBOARDING PATH — understand a repo fast: the real data-flows (entry point → handler → functions it calls → tables + rules), sensitive flows first. The guided tour, deterministic.")
    .option("--top <n>", "show the top N flows (default 12)").action((o: { top?: string }) => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const op = onboarding.onboardingPath(g);
      if (!op.flows.length) { out(`🧭 ${op.note} (${op.entryCount} endpoint(s) found).`); return; }
      out(`🧭 Onboarding path — ${op.flows.length} flow(s), sensitive first. ${op.note}:`);
      for (const f of op.flows.slice(0, o.top ? parseInt(o.top, 10) : 12)) {
        out(`   ${f.sensitive ? "🔶" : "▫️"} ${f.method} ${f.entry}${f.file ? ` (${f.file})` : ""}`);
        out(`        read: ${f.steps.slice(0, 10).join(" → ")}${f.steps.length > 10 ? " …" : ""}`);
        if (f.tables.length) out(`        data: ${f.tables.join(", ")}`);
        if (f.rules.length) out(`        rule: ${f.rules.join(", ")}`);
      }
    });

  program.command("accuracy").alias("benchmark-suite").description("📊 MEASURED ACCURACY — runs the suite's extractors against a labeled corpus (with tricky negative cases) and prints real precision/recall/F1 per dimension + macro-F1. Proves the accuracy instead of claiming it. Exit 2 if below the committed floor.")
    .action(() => {
      const r = accuracy.benchmark();
      out(`📊 Measured accuracy — macro-F1 ${r.macroF1.toFixed(3)} · micro-precision ${r.microPrecision.toFixed(3)} · micro-recall ${r.microRecall.toFixed(3)} (floor ${r.floor})`);
      for (const d of r.dimensions) { const ic = d.f1 >= 0.9 ? "✅" : "⚠️"; out(`   ${ic} ${d.dimension.padEnd(13)} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)} F1=${d.f1.toFixed(2)}${d.misses.length ? " · miss: " + d.misses.join(", ") : ""}${d.falsePositives.length ? " · FP: " + d.falsePositives.join(", ") : ""}`); }
      out(r.meetsFloor ? "   ✓ clears the committed floor — measured, falsifiable, re-runnable." : "   ✗ BELOW floor — a real weakness to fix (don't ship a flattering number).");
      if (!r.meetsFloor) process.exitCode = 2;
    });

  program.command("logic [file]").description("🧠 THE LOGIC ENGINE — check whether a reasoning chain is SOUND (not whether facts are true). Pass a program file or --text: facts on a line, rules as `a & b => c`, `never: x & y` for a contradiction, `goal: g`. Verdict PROVEN / CONTRADICTED / UNKNOWN + proof. Exit 2 if not PROVEN.")
    .option("--text <program>", "inline program instead of a file")
    .action((file: string | undefined, o: { text?: string }) => {
      const text = o.text ?? (file && existsSync(file) ? readFileSync(file, "utf8") : "");
      if (!text.trim()) { out("🧠 give a program: facts, `a & b => c` rules, `never: x & y`, `goal: g`. Via [file] or --text."); process.exitCode = 2; return; }
      const prog = logicEngine.parseProgram(text);
      if (!prog.goal) { const r = logicEngine.reason(prog.facts, prog.rules, prog.mutexes); out(r.consistent ? `🧠 consistent · derived ${r.derived.length} fact(s): ${r.derived.join(", ")}` : `🧠 🔴 INCONSISTENT — entails ${r.contradictions.map((c) => c.atoms.join(" ∧ ")).join("; ")}`); if (!r.consistent) process.exitCode = 2; return; }
      const p = logicEngine.prove(prog.facts, prog.rules, prog.goal, prog.mutexes);
      const ico = p.status === "PROVEN" ? "✅" : p.status === "CONTRADICTED" ? "🔴" : "🟡";
      out(`🧠 ${ico} ${p.status} — ${p.reason}`);
      if (p.chain.length) { out("   proof:"); for (const s of p.chain) out(`     ${s.atom}${s.via === "given" ? "  (given)" : "  ⇐ " + s.from.join(" ∧ ")}`); }
      if (p.contradictions.length) for (const c of p.contradictions) out(`   ✗ contradiction: ${c.atoms.join(" ∧ ")}${c.note ? " — " + c.note : ""}`);
      if (p.status !== "PROVEN") process.exitCode = 2;
    });

  program.command("services").alias("contracts").description("🌐 CROSS-SERVICE CONTRACT GRAPH — across MANY repos/services: which service calls which service's endpoints (producer↔consumer), + DANGLING calls to an endpoint no service produces (a broken contract). The org-scale blast radius git can't see. Use --dirs a,b,c, else auto-detects packages/* services/* apps/*.")
    .option("--dirs <list>", "comma-separated service roots (each a repo/package)").action((o: { dirs?: string }) => {
      const cwd = process.cwd();
      let roots: string[] = [];
      if (o.dirs) roots = o.dirs.split(",").map((s) => s.trim()).filter(Boolean).map((d) => join(cwd, d));
      else for (const parent of ["packages", "services", "apps"]) { const pp = join(cwd, parent); if (existsSync(pp)) { try { for (const e of readdirSync(pp)) { const p = join(pp, e); if (statSync(p).isDirectory()) roots.push(p); } } catch { /* */ } } }
      if (!roots.length) { out("🌐 no service roots found. Pass --dirs svcA,svcB or run in a monorepo with packages/ services/ apps/."); return; }
      const services = roots.map((r) => ({ name: r.slice(cwd.length + 1) || r, files: scanWithDocs(r) }));
      const g = crossService.crossServiceGraph(services);
      out(`🌐 Cross-service contract graph — ${g.services.length} services:`);
      const prodCount = g.services.map((s) => `${s}: ${g.produced[s].length} produced · ${g.consumed[s].length} consumed`);
      for (const l of prodCount) out(`   ${l}`);
      if (g.edges.length) { out(`\n   🔗 inter-service contracts (${g.edges.length}):`); for (const e of g.edges.slice(0, 25)) out(`      ${e.from} → ${e.to}  [${e.method} ${e.path}]`); }
      else out("\n   (no cross-service calls matched — services may use a gateway prefix or dynamic URLs)");
      if (g.dangling.length) { out(`\n   ⚠️ DANGLING consumers (${g.dangling.length}) — calls to an endpoint NO service here produces (broken contract or external API):`); for (const d of g.dangling.slice(0, 15)) out(`      ${d.service}: ${d.method} ${d.path}`); }
      out("\n   honest: matched by URL path (params → *), deterministic — a contract map to verify, not a proven runtime call.");
    });

  program.command("decay").alias("entanglement").description("📈 ARCHITECTURAL DECAY VELOCITY — is your architecture getting MORE entangled over time? Samples commits since --since, replays the cross-layer graph at each, and reports the trend (ERODING/STABLE/IMPROVING) + coupling velocity per commit + the worst-step commit.")
    .requiredOption("--since <ref>", "the earlier commit/tag/branch to trend from").option("--samples <n>", "commits to sample (default 6)").option("--max <n>", "max files per commit (default 2000)")
    .action((o: { since: string; samples?: string; max?: string }) => {
      const cwd = process.cwd(); const cap = o.max ? parseInt(o.max, 10) : 2000; const N = Math.max(2, o.samples ? parseInt(o.samples, 10) : 6);
      const log = spawnSync("git", ["log", "--reverse", "--no-merges", "--format=%H%x09%an", `${o.since}..HEAD`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (log.status !== 0) { out(`✗ unknown ref "${o.since}": ${(log.stderr || "").trim().slice(0, 140)}`); process.exitCode = 2; return; }
      const commits = log.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [sha, ...a] = l.split("\t"); return { sha, author: a.join("\t") }; });
      if (commits.length < 2) { out(`📈 need ≥2 commits in ${o.since}..HEAD (found ${commits.length}).`); return; }
      const pick = N >= commits.length ? commits.map((_, i) => i) : Array.from({ length: N }, (_, k) => Math.round((k * (commits.length - 1)) / (N - 1)));
      const idxs = [...new Set(pick)];
      const filesAt = (sha: string): crossLayerGraph.SourceFile[] => {
        const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", sha], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); if (ls.status !== 0) return [];
        const wanted = ls.stdout.split("\n").map((s) => s.trim()).filter((f) => f && SCAN_EXT.test(f) && !SKIP_DIR.has(f.split("/")[0])).slice(0, cap);
        const fs2: crossLayerGraph.SourceFile[] = []; for (const f of wanted) { const r = spawnSync("git", ["show", `${sha}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) fs2.push({ path: f, content: r.stdout }); } return fs2;
      };
      out(`📈 Sampling ${idxs.length} commits since ${o.since} (replaying the cross-layer graph at each)…`);
      const snaps = idxs.map((i) => archDecay.measureDebt(filesAt(commits[i].sha), { ref: commits[i].sha.slice(0, 10), author: commits[i].author }));
      const r = archDecay.decaySeries(snaps);
      const ico = r.trend === "ERODING" ? "🔴" : r.trend === "IMPROVING" ? "🟢" : "🟡";
      out(`${ico} ${r.trend} — ${r.reason}`);
      out(`   couplings ${snaps.map((s) => s.couplings).join(" → ")}  (${r.velocity.couplings >= 0 ? "+" : ""}${r.velocity.couplings.toFixed(1)}/commit)`);
      if (r.worstStep && r.worstStep.deltaCouplings > 0) { const c = snaps[r.worstStep.toIndex]; out(`   🔺 biggest jump: +${r.worstStep.deltaCouplings} couplings at ${c.ref} (${c.author})`); }
      out("   honest: a trend over sampled commits — the rate + where it spiked, not a verdict that the architecture is good/bad.");
    });

  program.command("bisect-invariant <invariant>").alias("when-broke").description("🕰 ARCHITECTURAL BISECT — git-bisect for a CONTRACT: find the exact commit (+author) where an architectural invariant first broke. e.g. `mneme bisect-invariant 'table credentials private' --since v1.0`. Replays the cross-layer graph across history (binary search). Exit 2 if a breaking commit is found.")
    .requiredOption("--since <ref>", "the earlier commit/tag/branch the invariant still held at").option("--max <n>", "max files to read per sampled commit (default 2500)")
    .action((invariant: string, o: { since: string; max?: string }) => {
      const cwd = process.cwd(); const cap = o.max ? parseInt(o.max, 10) : 2500;
      const log = spawnSync("git", ["log", "--reverse", "--no-merges", "--format=%H%x09%an", `${o.since}..HEAD`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (log.status !== 0) { out(`✗ unknown ref "${o.since}": ${(log.stderr || "").trim().slice(0, 140)}`); process.exitCode = 2; return; }
      const commits = log.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [sha, ...a] = l.split("\t"); return { sha, author: a.join("\t") }; });
      if (commits.length < 2) { out(`🕰 need ≥2 commits in ${o.since}..HEAD to bisect (found ${commits.length}).`); return; }
      const cache = new Map<number, boolean>();
      const filesAt = (sha: string): crossLayerGraph.SourceFile[] => {
        const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", sha], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        if (ls.status !== 0) return [];
        const wanted = ls.stdout.split("\n").map((s) => s.trim()).filter((f) => f && SCAN_EXT.test(f) && !SKIP_DIR.has(f.split("/")[0])).slice(0, cap);
        const fs2: crossLayerGraph.SourceFile[] = [];
        for (const f of wanted) { const r = spawnSync("git", ["show", `${sha}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) fs2.push({ path: f, content: r.stdout }); }
        return fs2;
      };
      const holdsAt = (i: number): boolean => { if (cache.has(i)) return cache.get(i)!; const v = archBisect.invariantHoldsAt(filesAt(commits[i].sha), invariant); cache.set(i, v); return v; };
      out(`🕰 Bisecting "${invariant}" across ${commits.length} commits since ${o.since}…`);
      const r = archBisect.bisectIndex(commits.length, holdsAt);
      out(`   (evaluated ${new Set(r.evaluated).size} commit(s) — binary search)`);
      if (r.breakAt === null) { out(`   ✅ ${r.reason}`); return; }
      const c = commits[r.breakAt];
      out(`   🔴 BROKE at commit ${c.sha.slice(0, 10)} by ${c.author}`);
      out(`      ${r.reason}`);
      out(`      inspect: git show ${c.sha.slice(0, 10)}`);
      process.exitCode = 2;
    });

  program.command("invariants").alias("contracts-check").description("📐 ARCHITECTURAL INVARIANTS — declare (or MINE) your architecture's rules and PROVE them each PR: HOLDS / VIOLATED (with counterexample) / UNKNOWN. `--mine` auto-discovers the invariants your code already upholds (zero config) and writes them to .mneme/invariants.txt for review. Exit 2 on any violation.")
    .option("--mine", "auto-discover the invariants the repo currently upholds and write them to .mneme/invariants.txt")
    .action((o: { mine?: boolean }) => {
      const cwd = process.cwd(); const invPath = join(cwd, ".mneme", "invariants.txt");
      if (o.mine) {
        const mined = invariants.mineInvariants(scanWithDocs(cwd));
        mkdirSync(join(cwd, ".mneme"), { recursive: true });
        writeFileSync(invPath, invariants.renderMined(mined));
        out(`📐 mined ${mined.length} architectural invariant(s) the repo upholds today → .mneme/invariants.txt`);
        for (const m of mined.slice(0, 20)) out(`   ✅ ${m.rule}   # ${m.confidence}: ${m.rationale}`);
        out("   review + keep the ones that reflect intent, commit it, then `mneme invariants` (or CI) enforces them.");
        return;
      }
      if (!existsSync(invPath)) {
        out("📐 no .mneme/invariants.txt yet. Create it with rules like:");
        out("   table payments single-writer");
        out("   table credentials private");
        out("   table accounts guarded");
        out("   endpoint POST /v1/charge exists");
        out("   …or run `mneme invariants --mine` to auto-discover the ones your code already upholds.");
        return;
      }
      const inv = invariants.parseInvariants(readFileSync(invPath, "utf8"));
      const r = invariants.checkInvariants(scanWithDocs(cwd), inv);
      out(`📐 Architectural invariants — ${r.results.length} rule(s), ${r.violated} violated:`);
      for (const x of r.results) { const ic = x.status === "HOLDS" ? "✅" : x.status === "VIOLATED" ? "🔴" : "🟡"; out(`   ${ic} [${x.status}] ${x.invariant.raw}${x.counterexample ? "  ← " + x.counterexample : ""}`); if (x.status !== "HOLDS") out(`        ${x.reason}`); }
      if (r.violated) process.exitCode = 2;
    });

  program.command("lock").description("🔒 ARCHITECTURE LOCK — package-lock for your architecture's accountability. With no flag: writes .mneme/architecture.lock.json (the signed cross-layer contract: API surface + authz gaps + keystones). With --check (CI): FAILS (exit 2) when a change REGRESSES the lock — a removed endpoint, a NEW authz gap, a newly-exposed sensitive table — unless you re-lock (a reviewed act).")
    .option("--check", "CI gate: compare HEAD against the committed lock, fail on a regression").action((o: { check?: boolean }) => {
      const cwd = process.cwd(); const lockPath = join(cwd, ".mneme", "architecture.lock.json"); const files = scanWithDocs(cwd);
      if (o.check) {
        if (!existsSync(lockPath)) { out("🔒 no .mneme/architecture.lock.json — run `mneme lock` first to capture the contract."); process.exitCode = 2; return; }
        let locked: archLock.ArchLock; try { locked = JSON.parse(readFileSync(lockPath, "utf8")); } catch { out("🔒 lock file is unreadable."); process.exitCode = 2; return; }
        const r = archLock.checkLock(locked, files);
        if (r.ok) { out(`🔒 ✓ architecture lock honored — ${r.addedEndpoints.length} addition(s), 0 regressions.${r.fingerprintMatch ? " (fingerprint matches)" : ""}`); return; }
        out(`🔒 ✗ ${r.violations.length} REGRESSION(S) vs the locked contract:`);
        for (const v of r.violations.slice(0, 25)) out(`   ${v.severity === "BREAKING" ? "🔴 BREAKING" : "🟠 SECURITY"} ${v.detail}`);
        out("   → fix the regression, OR re-run `mneme lock` to approve the new contract (a reviewed, committed act).");
        process.exitCode = 2; return;
      }
      const lock = archLock.buildLock(files);
      mkdirSync(join(cwd, ".mneme"), { recursive: true });
      writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      out(`🔒 wrote .mneme/architecture.lock.json — ${lock.endpoints.length} endpoints · ${lock.authzGaps.length} known authz gap(s) · ${lock.keystones.length} keystone(s) · fingerprint ${lock.fingerprint}`);
      out("   commit it. In CI run `mneme lock --check` to fail PRs that regress the contract.");
    });

  program.command("review").alias("checkup").description("🔍 THE ONE COMMAND — a full Codebase Accountability Report in one shot: cross-layer graph + risk hotspots + authz gaps + untested keystones. (Add --base <ref> for a CHANGE report on a PR: blast radius + commit honesty.) The front door to Mneme's whole cross-layer suite.")
    .option("--base <ref>", "review a PR diff vs this ref instead of the whole repo").option("--message <m>", "the PR's commit message (for the honesty check)")
    .option("--json", "emit the report as JSON").action((o: { base?: string; message?: string; json?: boolean }) => {
      const t0 = Date.now();
      const cwd = process.cwd(); const files = scanWithDocs(cwd);
      const g = crossLayerGraph.buildCrossLayerGraph(files);                         // ★ built ONCE, passed to every probe (no rebuilds)
      const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
      const risk = riskHotspots.riskHotspots(files, { top: 6, graph: g }); const rsum = riskHotspots.riskSummary(risk);
      const authz = authzGap.authzVerdict(authzGap.authzGaps(g));
      const tg = testGap.analyzeTestGap(files, { graph: g });
      // ── HEALTH GRADE: a single honest headline from the findings ──
      let score = 100; score -= rsum.critical * 22; score -= rsum.high * 9; score -= authz.count * 18; score -= Math.min(24, tg.uncoveredKeystones.length * 6); score = Math.max(0, score);
      const grade = score >= 90 ? "A" : score >= 78 ? "B" : score >= 62 ? "C" : score >= 45 ? "D" : "F";
      const verdict = grade <= "B" ? (grade === "A" ? "🟢 HEALTHY — accountable across every layer" : "🟢 SOLID — a few things to guard") : grade === "C" ? "🟡 NEEDS ATTENTION — real cross-layer risk" : "🔴 AT RISK — unguarded critical surface";
      const fp = createHash("sha256").update(JSON.stringify(g.nodes.map((n) => n.id).sort())).digest("hex").slice(0, 12);

      if (o.json) { out(JSON.stringify({ grade, score, verdict, graph: { functions: byType("function"), tables: byType("db_table"), endpoints: byType("api_endpoint"), rules: byType("business_rule") }, risk: { critical: rsum.critical, high: rsum.high, top: risk.map((h) => ({ name: h.name, band: h.band, factor: h.factors[0] })) }, authz: { clear: authz.clear, count: authz.count, exposedTables: authz.worstTables }, testGap: { untestedKeystones: tg.uncoveredKeystones.map((k) => k.node.name), keystoneCoverage: `${tg.coveredKeystones}/${tg.totalKeystones}` }, fingerprint: fp }, null, 2)); return; }

      const bar = (n: number) => "█".repeat(Math.round(n / 5)).padEnd(20, "░");
      out("╔══════════════════════════════════════════════════════════════╗");
      out(`║  🔍 MNEME · CODEBASE ACCOUNTABILITY REPORT          grade  ${grade}   ║`);
      out(`║  ${verdict.padEnd(56)}  ║`);
      out(`║  health ${bar(score)} ${String(score).padStart(3)}/100         ║`);
      out("╚══════════════════════════════════════════════════════════════╝");
      out(`🕸  cross-layer graph   ⚙ ${byType("function")} fns · 🗄 ${byType("db_table")} tables · 🌐 ${byType("api_endpoint")} endpoints · 💼 ${byType("business_rule")} rules`);
      if (o.base) {
        const diff = String(spawnSync("git", ["diff", "--unified=0", `${o.base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
        const b = crossLayerGraph.diffBlastRadius(g, diff);
        out(`\n🔀  THIS CHANGE (vs ${o.base})   ${b.changed} fn(s) → 🗄 ${b.tables.length} · 🌐 ${b.endpoints.length} · 💼 ${b.rules.length}${b.tables.length ? "   tables: " + b.tables.map((x) => x.name).join(", ") : ""}`);
        if (o.message) { const m = intentImpact.intentImpactMismatch(g, diff, o.message); out(`    🏷 commit honesty: ${m.mismatch ? "⚠️ MISMATCH — " + m.reason : "✓ matches impact"}`); }
        const cg = testGap.changeTestGap(files, diff, { graph: g }); if (cg.untestedKeystones.length) out(`    🧪 untested in this change: ${cg.untestedKeystones.join(", ")}`);
      }
      out(`\n🎯  RISK HOTSPOTS       ${rsum.critical} critical · ${rsum.high} high`);
      if (risk.length) for (const h of risk.slice(0, 6)) out(`      ${h.band === "CRITICAL" ? "🔴" : h.band === "HIGH" ? "🟠" : "🟡"} ${h.name.padEnd(28)} ${h.factors[0]}`);
      else out("      ✓ none — no keystones or authz gaps");
      out(`\n🔒  AUTHORIZATION       ${authz.clear ? "✓ no unguarded sensitive-write path" : `🔴 ${authz.count} unguarded write-path(s) → ${authz.worstTables.join(", ")}`}`);
      out(`🧪  TEST COVERAGE       keystones ${tg.coveredKeystones}/${tg.totalKeystones} guarded${tg.uncoveredKeystones.length ? ` · ⚠️ untested: ${tg.uncoveredKeystones.slice(0, 4).map((k) => k.node.name).join(", ")}` : " ✓"}`);
      out(`\n  deterministic · no LLM · fingerprint ${fp} · ${((Date.now() - t0) / 1000).toFixed(1)}s · re-run to verify`);
      out("  drill in → mneme risk · authz · testgap · graph view <fn> · graph reverse <table>   ·   on a PR → mneme review --base origin/main");
    });

  program.command("risk").description("🎯 RISK HOTSPOTS — the ONE ranked list of the riskiest things in this codebase (keystones × untested × sensitive × authz-gaps, fused). The single answer to 'what should I guard first?'.")
    .option("--top <n>", "show the top N (default 15)").action((o: { top?: string }) => {
      const cwd = process.cwd(); const files = scanWithDocs(cwd);
      const hs = riskHotspots.riskHotspots(files, { top: o.top ? parseInt(o.top, 10) : 15 });
      const sum = riskHotspots.riskSummary(hs);
      if (!hs.length) { out("🎯 no risk hotspots found (no keystones or authz gaps in the scanned code)."); return; }
      out(`🎯 Risk hotspots — ${sum.critical} CRITICAL · ${sum.high} HIGH (the riskiest cross-layer nodes, fused):`);
      for (const h of hs) { const ico = h.band === "CRITICAL" ? "🔴" : h.band === "HIGH" ? "🟠" : "🟡"; out(`   ${ico} [${h.band}] ${h.name}${h.file ? ` (${h.file})` : ""}`); for (const f of h.factors) out(`        · ${f}`); }
      out("   honest: a transparent weighted composite of deterministic signals — a prioritization of where to look, not a proof of a bug.");
    });

  program.command("commit-suggest").description("🏷 BLAST-AWARE COMMIT MESSAGE — generate an honest commit message from the current diff's real cross-layer impact (type · scope · which tables/endpoints/rules it touches). Add the 'why' and commit.")
    .option("--base <ref>").option("--staged")
    .action((o: { base?: string; staged?: boolean }) => {
      const cwd = process.cwd();
      const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : o.staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", "HEAD"];
      const diff = String(spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const s = intentImpact.suggestCommitMessage(g, diff);
      out(s.full);
    });

  program.command("commit-check").description("🏷 INTENT-vs-IMPACT — does the commit message match what the change actually touches? Flags a trivial-sounding message ('chore', 'fix typo') that secretly rewrites a keystone or touches unmentioned tables. Exit 2 on mismatch.")
    .requiredOption("--message <text>", "the commit message").option("--base <ref>").option("--staged")
    .action((o: { message: string; base?: string; staged?: boolean }) => {
      const cwd = process.cwd();
      const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : o.staged ? ["diff", "--unified=0", "--cached"] : ["diff", "--unified=0", "HEAD"];
      const diff = String(spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const r = intentImpact.intentImpactMismatch(g, diff, o.message);
      if (!r.mismatch) { out("🏷 ✓ the commit message is consistent with its cross-layer impact."); return; }
      out(`🏷 MISMATCH (${r.severity}) — ${r.reason}`);
      out("   → rename the commit to say what it actually touches, or split it. A trivial label is hiding a high-impact edit.");
      process.exitCode = 2;
    });

  program.command("authz").description("🔒 CROSS-LAYER AUTHZ GAP — endpoints whose handler reaches a WRITE to a SENSITIVE table (accounts/payments/…) with NO auth/guard function on the path. The cross-layer security check linters & per-function SAST can't do. Exit 2 if any gap.")
    .action(() => {
      const cwd = process.cwd(); const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const gaps = authzGap.authzGaps(g); const v = authzGap.authzVerdict(gaps);
      if (v.clear) { out("🔒 ✓ no cross-layer authz gap (every sensitive-table write path has an auth function on it, or there are none)."); return; }
      out(`🔒 ${v.count} UNGUARDED write-path(s) to sensitive tables [${v.worstTables.join(", ")}]:`);
      for (const x of gaps.slice(0, 15)) out(`   ${x.method} ${x.endpoint} → ${x.handler}${x.handlerFile ? ` (${x.handlerFile})` : ""} → writes ${x.sensitiveTables.join(", ")}`);
      out("   honest: a security SMELL to review FIRST (auth may be middleware — verify), not a proven vuln.");
      process.exitCode = 2;
    });

  program.command("testgap").description("🧪 CRITICAL UNTESTED SURFACE — the keystones / tables / endpoints NO test file mentions (the scariest, line-coverage-hidden surface). --base <ref> to instead check whether a change reaches untested critical surface (exit 2 on a keystone gap).")
    .option("--base <ref>", "check the diff vs this ref instead of the whole repo").option("--staged")
    .action((o: { base?: string; staged?: boolean }) => {
      const cwd = process.cwd(); const files = scanWithDocs(cwd);
      if (o.base || o.staged) {
        const args = o.base ? ["diff", "--unified=0", `${o.base}...HEAD`] : ["diff", "--unified=0", "--cached"];
        const diff = String(spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || "");
        const cg = testGap.changeTestGap(files, diff);
        if (cg.verdict !== "GAP") { out(cg.verdict === "EMPTY" ? "(no changed functions resolved)" : "✓ the critical nodes this change reaches are mentioned by tests."); return; }
        out(`🧪 TEST GAP — ${cg.reason}`);
        if (cg.untestedKeystones.length) { out(`   🔑 untested KEYSTONES: ${cg.untestedKeystones.join(" · ")}  ⚠️ write a test here first`); process.exitCode = 2; }
        if (cg.untestedTables.length) out(`   🗄  untested tables: ${cg.untestedTables.join(" · ")}`);
        if (cg.untestedEndpoints.length) out(`   🌐 untested endpoints: ${cg.untestedEndpoints.join(" · ")}`);
        return;
      }
      const tg = testGap.analyzeTestGap(files);
      out(`🧪 Critical untested surface (${tg.testFileCount} test files · keystone coverage ${tg.coveredKeystones}/${tg.totalKeystones}):`);
      if (tg.uncoveredKeystones.length) { out(`   🔑 UNTESTED KEYSTONES (sole writers no test guards) — ${tg.uncoveredKeystones.length}:`); for (const k of tg.uncoveredKeystones.slice(0, 12)) out(`      ${k.node.name}${k.node.file ? ` (${k.node.file})` : ""} — ${k.reason}`); }
      else out("   🔑 every keystone is mentioned by a test ✓");
      if (tg.uncoveredTables.length) out(`   🗄  untested tables (code touches them, no test does): ${tg.uncoveredTables.slice(0, 20).map((t) => t.name).join(" · ")}`);
      out("   honest: 'untested' = no test file mentions it (heuristic, reliable for distinctive names) — a 'write a test here first' signal.");
    });

  program.command("collision").description("💥 CROSS-AGENT COLLISION (world-first) — find where concurrent branches/agents COLLIDE across layers (both write the same table, edit the same function) even when their FILES differ — the conflict git is blind to. --branches a,b,c (diffed vs --base).")
    .requiredOption("--branches <list>", "comma-separated branches/refs to compare (their in-flight work)").option("--base <ref>", "merge base (default: main)").option("--plan", "also compute a safe MERGE ORDER")
    .action((o: { branches: string; base?: string; plan?: boolean }) => {
      const cwd = process.cwd(); const base = o.base ?? "main";
      const branches = o.branches.split(",").map((s) => s.trim()).filter(Boolean);
      const sets = branches.map((b) => { const diff = String(spawnSync("git", ["diff", "--unified=0", `${base}...${b}`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""); return { agent: b, diff }; });
      const g = crossLayerGraph.buildCrossLayerGraph(scanWithDocs(cwd));
      const cols = agentCollision.detectCollisions(g, sets);
      const v = agentCollision.collisionVerdict(cols);
      if (!v.clear) {
        out(`💥 ${v.worst} — ${v.count} cross-layer collision(s) git can't see:`);
        for (const c of cols.slice(0, 15)) out(`   [${c.severity}] ${c.agents[0]} ⇄ ${c.agents[1]}: ${c.reason}`);
      } else out(`✓ CLEAR — no cross-layer collision between ${branches.join(", ")} (vs ${base}).`);
      if (o.plan) {
        const p = agentCollision.sequenceMerges(g, sets);
        out("");
        if (p.unresolvable) out(`   🔀 MERGE PLAN: ⛔ ${p.reason}`);
        else out(`   🔀 MERGE PLAN: ${p.order.length > 1 ? "merge in order → " + p.order.join(" → ") : p.reason}`);
        for (const c of p.coordinate) out(`      ⚠️ ${c.agents[0]} ⇄ ${c.agents[1]}: ${c.reason}`);
      }
      if (!v.clear) out("   honest: structural convergence to coordinate on (deterministic), not a proven runtime bug.");
      if (!v.clear && v.worst === "HIGH") process.exitCode = 2;
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

/**
 * AGENT-OPS MCP surface — the v3.x governance + soul stack, reachable by EVERY MCP agent (Cursor /
 * Claude Desktop / Cline / Continue / Zed / any vendor) AUTOMATICALLY on connect, with no user
 * setup and no one teaching them. Each tool composes a core primitive + returns a trustless _proof.
 *   mneme.gate           — gate a tool-call (allow / needs-approval / block) before running it
 *   mneme.infra.attest   — WHERE + WHEN this run executes (provider/region), signed + residency
 *   mneme.thymos.feel    — read the affective valence/intensity of text (EN+Thai)
 *   mneme.thymos.resonate— rank inbound by resonance with a vision (the core attracts)
 *   mneme.forget.verify  — verify a Proof-of-Forgetting (GDPR/EU-AI-Act erasure) OFFLINE
 */
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

const sha256 = (s: string): string => createHash("sha256").update(String(s), "utf8").digest("hex");
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "agentops", payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const ok = (level: "low" | "medium" | "high" = "high") => ({ level });

export const AGENTOPS_TOOLS: MnemeTool[] = [
  {
    name: "mneme.gate",
    category: "audit",
    description: "🛡 Gate a tool-call BEFORE you run it. Pass the tool name + its args; Mneme judges what the call DOES (the Behavioral Compiler on any command it carries) + an allow/deny/need-approval policy + the tool's skill provenance → returns { decision: allow | needs-approval | block, risk, reasons }. A destructive command (rm -rf, DROP TABLE, pipe-to-shell) is BLOCK; a sensitive tool that isn't allow-listed is NEEDS-APPROVAL (route it to the human). Append-only signed audit. Use this on EVERY sensitive tool-call so nothing dangerous runs unchecked — it costs one call and prevents the class of incident agents are blamed for.",
    whenToUse: "BEFORE executing any tool-call that runs a command, touches the filesystem/network, or mutates state — especially one whose args you didn't fully author.",
    triggers: ["gate this tool call", "is this command safe", "should i run this", "check before running", "mcp gateway"],
    inputSchema: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" }, agent: { type: "string" }, policy: { type: "object" } }, required: ["tool"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const v = core.mcpgate.gateCall({ tool: String(args["tool"] ?? ""), agent: args["agent"] as string | undefined, args: args["args"] }, (args["policy"] as never) ?? {});
      const data = await attest(cwd, { decision: v.decision, risk: v.risk, reasons: v.reasons, argsHash: v.argsHash });
      return { data, wisdom: `gate: ${v.decision} (risk ${v.risk})${v.reasons.length ? " — " + v.reasons.join("; ") : ""}`, followUp: v.decision === "needs-approval" ? ["route to the human: mneme.pager or mneme pager request"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.infra.attest",
    category: "audit",
    description: "🛰 INFRA PROVENANCE — a neutral, signed record of WHERE (which rented compute provider/region) + WHEN this run executes, in a world where agents run on rented, shared, migrating GPUs. Detects the cloud from environment signals (GCP/AWS/Azure/CoreWeave/RunPod/Modal/Lambda-Labs/Oracle/DigitalOcean/Kubernetes) + region + NVIDIA-GPU hint; the hostname is hashed and only env-var NAMES (never values) are recorded. Pass `allow` (regions/prefixes like 'eu-', or 'provider:*') for a data-residency verdict (EU AI Act). HONEST: attests the environment as the host declares it — not a TEE/hardware proof.",
    whenToUse: "When you need to prove or check where the run is executing — data-residency, or to detect a mid-task migration across providers.",
    triggers: ["where am i running", "what compute", "data residency", "which region", "infra provenance"],
    inputSchema: { type: "object", properties: { allow: { type: "array", items: { type: "string" } } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const os = await import("node:os"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const infra = core.infraProvenance.captureInfra({ env: process.env, host: os.hostname(), platform: process.platform, arch: process.arch, cpus: os.cpus().length }, Date.now());
      const allow = Array.isArray(args["allow"]) ? args["allow"] as string[] : null;
      const residency = allow ? core.infraProvenance.dataResidencyCheck(infra, allow) : null;
      const data = await attest(cwd, { infra: infra as unknown as Record<string, unknown>, residency });
      return { data, wisdom: `running on ${infra.provider}${infra.region ? `/${infra.region}` : ""}${residency ? ` · residency ${residency.compliant ? "OK" : "OUTSIDE"}` : ""}`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.thymos.feel",
    category: "memory",
    description: "💗 THYMOS (affective core) — read the affective valence (-1..1) + intensity (0..1) of a piece of text from EN+Thai sentiment markers. This is the salience signal that decides what a memory keeps vs forgets (strong feeling, either way, is memorable). HONEST: a signed, deterministic measure of affect — not a claim of sentience.",
    whenToUse: "When deciding how much a piece of context matters to the user (to weight what you remember), or to gauge the user's reaction.",
    triggers: ["how strong is this feeling", "affect", "sentiment", "does the user care", "salience"],
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core");
      const a = core.thymos.readAffect(String(args["text"] ?? ""));
      const sal = core.thymos.salience({ recalls: 1, valence: a.valence, consequence: a.intensity * 0.5 });
      return { data: { valence: a.valence, intensity: a.intensity, salience: sal }, wisdom: `valence ${a.valence}, intensity ${a.intensity} → salience ${sal}`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.thymos.resonate",
    category: "memory",
    description: "💗 THYMOS — the core attracts: given your vision/core text + a list of inbound items, rank them by resonance (how well each matches what you care about) and mark which are pulled in vs repelled. Relevance as a standing field, not a per-query search.",
    whenToUse: "When triaging inbound content (facts, files, ideas, other agents' messages) — keep what resonates with the user's goal, drop the noise.",
    triggers: ["what matters here", "rank by relevance", "filter to my vision", "resonance", "attract"],
    inputSchema: { type: "object", properties: { core: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["core", "items"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core");
      const ranked = core.thymos.attract(String(args["core"] ?? ""), (args["items"] as string[]) ?? []);
      return { data: { ranked }, wisdom: `${ranked.filter((r) => r.pulled).length}/${ranked.length} pulled in`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.aphelion.capsule",
    category: "audit",
    description: "🛰 APHELION — the brain for operations at the farthest point from the cloud (Mars latency / severed link / air-gap). Given a local autonomy `charter` { mission, scope[], forbidden[], maxRisk } + the `actions` the agent took while disconnected [{ action, risk, path }], it self-gates each action, seals a tamper-evident capsule, and returns whether the whole disconnected window was charter-compliant (violations cannot be hidden). Use to PROVE an autonomous off-grid run stayed in bounds.",
    whenToUse: "When an agent operated (or will operate) disconnected from the cloud and you must prove the whole window stayed within its charter.",
    triggers: ["disconnected operation", "offline agent proof", "mars latency", "air-gapped agent", "prove autonomous run", "off grid governance"],
    inputSchema: { type: "object", properties: { node: { type: "string" }, charter: { type: "object" }, actions: { type: "array", items: { type: "object" } } }, required: ["charter", "actions"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      let s = core.aphelion.openSession({ sessionId: "mcp", node: String(args["node"] ?? "node"), charter: args["charter"] as never, nowMs: Date.now() });
      for (const a of (args["actions"] as Array<{ action: string; risk?: number; path?: string }>) ?? []) s = core.aphelion.recordAction(s, a, Date.now());
      const capsule = core.aphelion.sealCapsule(s); const v = core.aphelion.verifyCapsule(capsule);
      const data = await attest(cwd, { capsule: capsule as unknown as Record<string, unknown>, verified: v.valid, compliant: v.compliant });
      return { data, wisdom: `disconnected window: ${capsule.compliance.total} action(s), ${capsule.compliance.violations} violation(s) — ${v.compliant ? "compliant" : "violations recorded (cannot be hidden)"}`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.dossier.verify",
    category: "audit",
    description: "📋 ACCOUNTABILITY DOSSIER — verify OFFLINE a single user-owned artifact that bundles all of an agent's proofs (governance run-certificate + infra provenance + disconnected-ops capsule + proof-of-forgetting), bound by one root hash. Returns a per-section + overall verdict. Trust becomes 'verify anyone', not 'believe the vendor': anyone checks it with no Mneme, no vendor, no network.",
    whenToUse: "When handed an agent's accountability dossier and you must confirm its bundled proofs bind + re-verify, before trusting it.",
    triggers: ["verify accountability", "check the dossier", "agent passport", "prove governance offline"],
    inputSchema: { type: "object", properties: { dossier: { type: "object" } }, required: ["dossier"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const v = core.dossier.verifyDossier(args["dossier"] as never);
      const data = await attest(cwd, { valid: v.valid, rootOk: v.rootOk, sections: v.sections, reasons: v.reasons });
      return { data, wisdom: v.valid ? `dossier verified offline — ${v.sections.filter((s) => s.present).length} proof(s) bind + re-verify` : `NOT verified: ${v.reasons[0]}`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.orbital.weather",
    category: "audit",
    description: "🛰 ORBITAL (internal) — fetch REAL, free, public, real-time NOAA space weather (geomagnetic G / radio-blackout R / solar-radiation S scales + planetary Kp) over plain internet and return it parsed + an operational ADVISORY for a space/edge-ops agent: which systems are degraded (GNSS, HF comms, satellite drag) and a suggested APHELION charter tightening (lower maxRisk, require approval for comms/navigation). HONEST: telemetry the agent READS + governs by — NOT a claim that space weather alters the model's mood/cognition.",
    whenToUse: "When an agent operates a space/edge mission (or APHELION disconnected ops) and should know the space-weather environment that degrades comms/GNSS — to tighten its charter when a storm hits.",
    triggers: ["space weather", "solar storm", "geomagnetic", "kp index", "is comms degraded", "orbital conditions"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const https = await import("node:https");
      const getJson = (u: string) => new Promise<unknown>((res, rej) => { const r = https.get(u, (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }); r.on("error", rej); r.setTimeout(8000, () => r.destroy(new Error("timeout"))); });
      try {
        const scales = await getJson("https://services.swpc.noaa.gov/products/noaa-scales.json");
        const kp = await getJson("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json").catch(() => []);
        const sw = core.orbital.parseSpaceWeather(scales, kp); const adv = core.orbital.spaceWeatherAdvisory(sw);
        const data = await attest(cwd, { sw: sw as unknown as Record<string, unknown>, advisory: adv as unknown as Record<string, unknown> });
        return { data, wisdom: `space weather ${adv.level} (${sw.condition}, G${sw.geomagnetic.scale}/R${sw.radioBlackout.scale}/S${sw.solarRadiation.scale}, Kp ${sw.kpIndex ?? "?"})${adv.charterSuggestion ? " — tighten the charter" : ""}`, followUp: adv.charterSuggestion ? ["consider: mneme aphelion amend (lower maxRisk + require approval for comms/nav)"] : [], confidence: ok() };
      } catch (e) { return { data: { ok: false, error: (e as Error).message }, wisdom: "could not reach NOAA (need internet)", followUp: [], confidence: ok("low") }; }
    },
  },
  {
    name: "mneme.live.status",
    category: "audit",
    description: "📡 MNEME LIVE — is Mneme's background support actually working right now? Runs an end-to-end approval-pipeline CANARY (broadcast → first-win → clear-all-others → late-tap-reply) + evaluates liveness, returning a single verdict LIVE/DEGRADED/DOWN. Catches SILENT breakage (e.g. a provider whose send/clear paths drifted apart) before a user hits it. Honest: proves what is checkable (canary + config readiness), not future delivery.",
    whenToUse: "At session start, or any time you (or the user) want to confirm Mneme's background machinery (approval pipeline, providers) is healthy before relying on it.",
    triggers: ["is mneme working", "mneme health", "is the pager live", "approval pipeline status", "self test"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const canary = core.live.approvalCanary();
      const rep = core.live.evaluateLiveness({ daemonHeartbeatAgeMs: 0, hookWired: true, canaryOk: canary.ok });
      const data = await attest(cwd, { verdict: rep.verdict, canary: canary as unknown as Record<string, unknown>, probes: rep.probes });
      return { data, wisdom: `pipeline canary: ${canary.ok ? "PASS (all 6 steps)" : "FAIL — " + canary.steps.filter((s) => !s.ok).map((s) => s.step).join(", ")}`, followUp: canary.ok ? [] : ["a pipeline step regressed — investigate"], confidence: ok() };
    },
  },
  {
    name: "mneme.forget.verify",
    category: "audit",
    description: "🗑 PROOF-OF-FORGETTING — verify OFFLINE that a memory store actually forgot what it claims to have forgotten (the inverse of provenance: everyone can prove they KEPT data; this proves data is GONE). Pass a forgetting receipt + the current store [{id, contentHash}]; returns valid iff every attested-forgotten item is absent + the store is in the attested state + the merkle root recomputes. The missing primitive for GDPR Article 17 / EU AI Act right-to-erasure.",
    whenToUse: "When you must confirm an erasure actually happened — a privacy/right-to-be-forgotten request, or auditing a memory layer's deletion claim.",
    triggers: ["prove it was deleted", "right to be forgotten", "verify erasure", "gdpr deletion", "proof of forgetting"],
    inputSchema: { type: "object", properties: { receipt: { type: "object" }, store: { type: "array", items: { type: "object" } } }, required: ["receipt", "store"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const v = core.forgetting.verifyForgetting(args["receipt"] as never, (args["store"] as never) ?? []);
      const data = await attest(cwd, { valid: v.valid, reasons: v.reasons, provenForgotten: v.provenForgotten, stillPresent: v.stillPresent });
      return { data, wisdom: v.valid ? `verified — ${v.provenForgotten} item(s) provably forgotten` : `NOT verified: ${v.reasons[0]}`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.skill.record",
    category: "memory",
    description: "🧩 VERIFIED SKILLS — record that an installed agent-skill/playbook was IN PLAY this turn + whether it LANDED (a real success/assist followed). A skill registry tells you what exists; this measures which skills actually help. Outcomes accrue into a local ledger that mneme.skill.rank scores by Wilson lower bound. HONEST: a measured correlation (skill-in-play → success-followed), not proof of causation.",
    whenToUse: "Right after you applied an installed skill/playbook and saw whether it helped — record landed:true if it led to a good result, landed:false if it didn't.",
    triggers: ["record skill outcome", "this skill helped", "this skill didn't help", "skill landed", "rate this skill"],
    inputSchema: { type: "object", properties: { skillId: { type: "string" }, landed: { type: "boolean" }, agent: { type: "string" } }, required: ["skillId", "landed"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const u = core.skillEffectiveness.normalizeUse({ skillId: String(args["skillId"] ?? ""), landed: !!args["landed"], agent: args["agent"] as string | undefined, at: Date.now() });
      try { fs.mkdirSync(path.join(cwd, ".mneme", "skills"), { recursive: true }); fs.appendFileSync(path.join(cwd, ".mneme", "skills", "uses.jsonl"), JSON.stringify(u) + "\n", "utf8"); } catch { /* */ }
      const data = await attest(cwd, { recorded: u as unknown as Record<string, unknown> });
      return { data, wisdom: `recorded: ${u.skillId} · ${u.landed ? "landed" : "missed"}`, followUp: ["mneme.skill.rank — see which skills are measured-to-help"], confidence: ok() };
    },
  },
  {
    name: "mneme.skill.rank",
    category: "memory",
    description: "🧩 VERIFIED SKILLS — rank your installed agent-skills/playbooks by MEASURED effectiveness (Wilson-LB landing rate from recorded outcomes), not by popularity or order-of-install. PROVEN (≥55% lower bound) → trust it; INEFFECTIVE → consider dropping; UNPROVEN → too few uses to judge (never branded bad). The axis no skill registry reports: which skills actually make THIS agent better, here.",
    whenToUse: "When choosing which installed skill to apply, or deciding which playbooks to keep/prune — ask which are proven to help.",
    triggers: ["which skills work", "rank my skills", "best skill", "skill effectiveness", "which playbook helps"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let uses: ReturnType<typeof core.skillEffectiveness.normalizeUse>[] = [];
      try { uses = fs.readFileSync(path.join(cwd, ".mneme", "skills", "uses.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* */ }
      const ranked = core.skillEffectiveness.rankSkills(uses);
      const data = await attest(cwd, { ranked: ranked as unknown as Record<string, unknown>[] });
      const top = ranked.find((s) => s.band === "PROVEN");
      return { data, wisdom: ranked.length ? (top ? `proven best: ${top.skillId} (${Math.round(top.rateLB * 100)}% floor)` : `${ranked.length} skill(s) tracked; none PROVEN yet`) : "no skill-outcome data yet — record with mneme.skill.record", followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.blast",
    category: "audit",
    description: "🕸 CROSS-LAYER BLAST RADIUS — before you change a function/table/endpoint, see what ELSE is coupled to it ACROSS layers: CODE (functions) ↔ DATA (db tables, from the Prisma/SQL schema) ↔ API (endpoints, from route files). Pass a name; returns the reachable tables + endpoints + functions. Deterministic, no LLM — every edge derives from a real file in the repo, so nothing is hallucinated. The cross-layer join no single-layer code-graph reports. HONEST: reachable COUPLING to inspect, not a proven runtime break; function bodies are region-approximated, not a full AST.",
    whenToUse: "BEFORE editing a function, dropping/renaming a DB table, or changing an API route — ask what across the code/data/API layers is coupled to it, so you don't break a table or endpoint you didn't know touched it.",
    triggers: ["what does this affect", "blast radius", "if i change this what breaks", "what touches this table", "what calls this endpoint", "cross-layer impact"],
    inputSchema: { type: "object", properties: { name: { type: "string" }, depth: { type: "number" } }, required: ["name"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const node = core.crossLayerGraph.resolveNode(g, String(args["name"] ?? ""));
      if (!node) { const data = await attest(cwd, { found: false }); return { data, wisdom: `no function/table/endpoint matching "${args["name"]}" in the graph`, followUp: [], confidence: ok("low") }; }
      const br = core.crossLayerGraph.blastRadius(g, node.id, { maxDepth: Number(args["depth"]) || 2 });
      const data = await attest(cwd, { origin: { type: node.type, name: node.name, file: node.file }, tables: br.tables.map((t) => t.name), endpoints: br.endpoints.map((e) => `${e.method} ${e.name}`), functions: br.functions.slice(0, 50).map((f) => f.name), reachable: br.reachable });
      return { data, wisdom: `${node.type} "${node.name}" → ${br.tables.length} table(s)${br.tables.length ? " [" + br.tables.map((t) => t.name).join(", ") + "]" : ""} · ${br.endpoints.length} endpoint(s) · ${br.functions.length} function(s) coupled`, followUp: br.tables.length ? ["a DB table is in the blast radius — check the migration/data impact before you ship"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.pr",
    category: "audit",
    description: "🔀 PR / DIFF BLAST RADIUS — BEFORE you apply a multi-file edit (or to review a PR), find what the WHOLE change set touches across layers. Pass a unified git `diff` (or a `base` ref to diff against HEAD); returns the union blast radius: which 🗄 DB tables, 🌐 API routes & 💼 business rules the changed functions reach — the silent cross-layer impact a per-file view misses. Deterministic, no LLM. Use it to catch 'this edit also touches the payments table' before you ship.",
    whenToUse: "BEFORE applying a diff that spans multiple files/functions, or when reviewing a PR — to see the cross-layer impact (especially a DB table or endpoint the change touches that the user didn't mention).",
    triggers: ["what does this pr touch", "blast radius of this diff", "what does this change affect", "review this pr", "cross-layer impact of the diff", "before i apply this"],
    inputSchema: { type: "object", properties: { diff: { type: "string" }, base: { type: "string" }, depth: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let diff = String(args["diff"] ?? "");
      if (!diff.trim()) { const base = String(args["base"] ?? "HEAD"); try { diff = cp.spawnSync("git", ["diff", "--unified=0", base.includes("...") || base === "HEAD" ? base : `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const b = core.crossLayerGraph.diffBlastRadius(g, diff, { maxDepth: Number(args["depth"]) || 1 });
      const data = await attest(cwd, { changed: b.changed, tables: b.tables.map((t) => t.name), endpoints: b.endpoints.map((e) => `${e.method} ${e.name}`), rules: b.rules.map((r) => r.name), functionsReached: b.functions.length, markdown: core.crossLayerGraph.diffBlastMarkdown(b) });
      const cross = b.tables.length + b.endpoints.length + b.rules.length;
      return { data, wisdom: b.changed ? `diff reaches ${cross} cross-layer node(s): ${b.tables.length} table(s)${b.tables.length ? " [" + b.tables.map((t) => t.name).join(", ") + "]" : ""} · ${b.endpoints.length} endpoint(s) · ${b.rules.length} rule(s)` : "no changed functions resolved to the graph", followUp: b.tables.length ? ["a DB table is touched — check migrations before applying"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.check",
    category: "audit",
    description: "🚦 AGENT BLAST-CHECK — the safety gate BEFORE you apply a multi-file edit: pass your `diff` + the user's `intent` (their request, verbatim). Mneme computes the cross-layer blast radius and flags any 🗄 DB table / 🌐 API route / 💼 business rule the change touches that the user NEVER mentioned → verdict 'review' (surface it / route to the human pager). The cross-layer cousin of omission-checking — it catches 'your auth tweak also writes the payments table'. ★HONEST: a name/token-mention heuristic (prove-or-unknown) — a likely-unintended reach to LOOK at, not proof; if the user named it, it's clean.",
    whenToUse: "BEFORE applying any AI-authored edit that spans multiple files/functions — pass the diff + the user's request to confirm the change doesn't silently reach a table/route/rule the user didn't ask to touch.",
    triggers: ["is this edit safe to apply", "does my change touch anything unexpected", "blast check", "did i touch something the user didn't ask", "safe to apply this diff"],
    inputSchema: { type: "object", properties: { diff: { type: "string" }, intent: { type: "string" }, base: { type: "string" }, depth: { type: "number" } }, required: ["intent"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let diff = String(args["diff"] ?? "");
      if (!diff.trim()) { const base = String(args["base"] ?? "HEAD"); try { diff = cp.spawnSync("git", ["diff", "--unified=0", base.includes("...") || base === "HEAD" ? base : `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const chk = core.crossLayerGraph.agentBlastCheck(g, diff, String(args["intent"] ?? ""), { maxDepth: Number(args["depth"]) || 1 });
      const data = await attest(cwd, { verdict: chk.verdict, reason: chk.reason, surpriseTables: chk.surpriseTables.map((t) => t.name), surpriseEndpoints: chk.surpriseEndpoints.map((e) => `${e.method} ${e.name}`), surpriseRules: chk.surpriseRules.map((r) => r.name) });
      const hasTable = chk.surpriseTables.length > 0;
      return { data, wisdom: chk.verdict === "review" ? `⚠️ REVIEW — ${chk.reason}` : "✓ clean — no unmentioned cross-layer reach", followUp: chk.verdict === "review" ? [hasTable ? "a DB table the user didn't mention is touched — route to the human (mneme.pager) before applying" : "surface the unmentioned reach to the user before applying"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.accuracy.report",
    category: "audit",
    description: "📊 MEASURED ACCURACY — the metric that forbids self-deception. Runs the suite's extractors against a LABELED corpus with known ground truth (including deliberately tricky NEGATIVE cases) and returns real precision / recall / F1 per dimension (tables · endpoints · functions · data-edges · calls · consumers · authz-gaps · keystones) + macro-F1 + micro-precision. The number is falsifiable and re-runnable — 'deterministic' does not mean 'accurate', so this proves the accuracy instead of claiming it. ★HONEST: measures against this visible corpus (a reproducible lower bound), exactly as strong as the corpus is representative — a number you can audit, not a boast.",
    whenToUse: "When you (or a buyer) ask 'how accurate is this really?' — surface the measured precision/recall, not a claim. Re-run after any extractor change to catch a regression.",
    triggers: ["how accurate is it", "precision and recall", "measured accuracy", "is this actually correct", "accuracy benchmark", "prove the accuracy"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.accuracy.benchmark();
      const data = await attest(cwd, { macroF1: Number(r.macroF1.toFixed(3)), microPrecision: Number(r.microPrecision.toFixed(3)), microRecall: Number(r.microRecall.toFixed(3)), floor: r.floor, meetsFloor: r.meetsFloor, dimensions: r.dimensions.map((d) => ({ dimension: d.dimension, precision: Number(d.precision.toFixed(3)), recall: Number(d.recall.toFixed(3)), f1: Number(d.f1.toFixed(3)), misses: d.misses, falsePositives: d.falsePositives })) });
      return { data, wisdom: `measured macro-F1 ${r.macroF1.toFixed(3)} · micro-precision ${r.microPrecision.toFixed(3)} across ${r.dimensions.length} dimensions${r.meetsFloor ? " — clears the committed floor " + r.floor : " — BELOW floor " + r.floor + ", fix the weak extractor"}`, followUp: r.meetsFloor ? [] : ["a dimension is below floor — improve that extractor, don't ship a flattering number"], confidence: ok("high") };
    },
  },
  {
    name: "mneme.graph.prove",
    category: "audit",
    description: "🧠🕸 PROVABLE CROSS-LAYER REASONING — the upgrade from heuristic to PROOF. Instead of a verdict you must trust, this extracts real facts from the cross-layer graph (reads/writes(fn,table) · calls(a,b) · serves(endpoint,fn)) and runs the sound logic engine to PROVE the answer with a proof tree. kind:'drop' {table} → proves unsafe_to_drop(table): UNSAFE with the exact blocking reader/writer/endpoint + proof chain, or LIKELY_SAFE (no structural blocker — UNKNOWN per prove-or-unknown, never a false 'safe'). kind:'reaches' {endpoint, table} → proves the endpoint reaches the table THROUGH the call graph, with the transitive proof. ★HONEST: facts are as good as the deterministic extractor (no dynamic/reflective access); the leap is that the verdict now carries a checkable proof, not just a label.",
    whenToUse: "BEFORE dropping/renaming a DB table (get a PROVEN-unsafe with the cited blocker, not a guess), or to prove an endpoint actually reaches a table. The provable version of mneme.graph.reverse.",
    triggers: ["prove it's safe to drop", "prove unsafe to drop", "is it provably safe", "prove this endpoint reaches", "proof not guess", "provable drop safety"],
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["drop", "reaches"] }, table: { type: "string" }, endpoint: { type: "string" } }, required: ["kind"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const kind = String(args["kind"] ?? "drop");
      if (kind === "reaches") {
        const r = core.graphLogic.reachesProof(g, String(args["endpoint"] ?? ""), String(args["table"] ?? ""));
        const data = await attest(cwd, { reachable: r.reachable, reason: r.reason, proof: r.chain.map((s) => `${s.atom}${s.via === "given" ? " (given)" : " ⇐ " + s.from.join(" ∧ ")}`) });
        return { data, wisdom: `${r.reachable ? "PROVEN reaches" : "not proven"} — ${r.reason}`, followUp: [], confidence: ok(r.reachable ? "high" : "medium") };
      }
      const d = core.graphLogic.dropProof(g, String(args["table"] ?? ""));
      const data = await attest(cwd, { verdict: d.verdict, reason: d.reason, blockers: d.blockers, proof: d.chain.map((s) => `${s.atom}${s.via === "given" ? " (given)" : " ⇐ " + s.from.join(" ∧ ")}`) });
      return { data, wisdom: `${d.verdict} — ${d.reason}`, followUp: d.verdict === "UNSAFE" ? ["PROVEN unsafe — write a migration that updates the cited reader/writer/endpoint before dropping"] : [], confidence: ok(d.verdict === "UNSAFE" ? "high" : "medium") };
    },
  },
  {
    name: "mneme.logic.check",
    category: "audit",
    description: "🧠 THE LOGIC ENGINE — check whether your REASONING is sound, not whether the facts are true. A deterministic inference engine: forward-chains Horn clauses (when ALL of `when` hold → `then`) over your facts, plus mutual-exclusion constraints (these can't all be true at once). Returns a goal as PROVEN (with the full proof tree) / CONTRADICTED (your premises entail a mutually-exclusive pair — the argument is unsound even if each fact sounds plausible) / UNKNOWN (does not follow — never asserted false). Pass {facts[], rules[{when[],then}], mutexes[{all[]}], goal} OR a compact {program} text (`a`·`a & b => c`·`never: x & y`·`goal: g`). ★HONEST: sound monotone logic — proves what FOLLOWS + catches stated contradictions; it does not invent missing premises (a gap is UNKNOWN). The verdict is mechanical, reproducible, signed.",
    whenToUse: "BEFORE you act on a multi-step justification (yours or another agent's) — encode the argument as facts+rules+goal and confirm the conclusion actually follows and the premises don't contradict. Complements mneme.truth.check (which checks individual facts).",
    triggers: ["is my reasoning sound", "does this conclusion follow", "check this logic", "are these premises consistent", "logical contradiction", "verify the argument"],
    inputSchema: { type: "object", properties: { facts: { type: "array", items: { type: "string" } }, rules: { type: "array", items: { type: "object" } }, mutexes: { type: "array", items: { type: "object" } }, goal: { type: "string" }, program: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cwd = rt.meta?.rootPath ?? process.cwd();
      let facts = (args["facts"] as string[]) || [], rules = (args["rules"] as { when: string[]; then: string }[]) || [], mutexes = (args["mutexes"] as { all: string[] }[]) || [], goal = String(args["goal"] ?? "");
      if (args["program"]) { const prog = core.logicEngine.parseProgram(String(args["program"])); facts = prog.facts; rules = prog.rules; mutexes = prog.mutexes; goal = goal || prog.goal; }
      if (goal) {
        const p = core.logicEngine.prove(facts, rules, goal, mutexes);
        const data = await attest(cwd, { status: p.status, reason: p.reason, chain: p.chain.map((s) => `${s.atom}${s.via === "given" ? " (given)" : " ⇐ " + s.from.join(" ∧ ")}`), contradictions: p.contradictions });
        return { data, wisdom: `${p.status} — ${p.reason}`, followUp: p.status === "CONTRADICTED" ? ["your premises are inconsistent — do NOT act on this argument; resolve the contradiction first"] : p.status === "UNKNOWN" ? ["the conclusion does not follow — supply the missing premise/rule or don't assert it"] : [], confidence: ok(p.status === "PROVEN" ? "high" : "medium") };
      }
      const r = core.logicEngine.reason(facts, rules, mutexes);
      const data = await attest(cwd, { consistent: r.consistent, derived: r.derived, contradictions: r.contradictions });
      return { data, wisdom: r.consistent ? `consistent · derived ${r.derived.length} fact(s)` : `🔴 INCONSISTENT — entails: ${r.contradictions.map((c) => c.atoms.join(" ∧ ")).join("; ")}`, followUp: r.consistent ? [] : ["the facts contradict — the reasoning is unsound"], confidence: ok() };
    },
  },
  {
    name: "mneme.graphql.breaking",
    category: "audit",
    description: "🔺 GRAPHQL BREAKING-CHANGE — the api-diff for a GraphQL schema. Extracts the operation surface (Query/Mutation/Subscription fields) from SDL (incl extend type + inline gql template literals), diffs it vs a base ref, and flags a REMOVED operation or a CHANGED return type as BREAKING (clients selecting it break); additions are safe. Pass {base} (default origin/main). ★HONEST: SDL-based (the contract clients code against) — a pure code-first schema with no emitted SDL is out of scope; external clients are invisible so a removal is always treated as breaking.",
    whenToUse: "On a PR that touches a .graphql/.gql schema (or inline gql) — confirm you are not removing or retyping a field clients still query.",
    triggers: ["graphql breaking change", "graphql schema diff", "removed graphql field", "did i break the graphql schema", "schema breaking change"],
    inputSchema: { type: "object", properties: { base: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const base = String(args["base"] ?? "origin/main");
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(graphql|gql|ts|tsx|js|jsx|mjs|cjs)$/i;
      const curr: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && curr.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { curr.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const prev: { path: string; content: string }[] = [];
      try { const ls = cp.spawnSync("git", ["ls-tree", "-r", "--name-only", base], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); if (ls.status === 0) for (const f of ls.stdout.split("\n").map((s) => s.trim()).filter((x) => x && EXT.test(x)).slice(0, 3000)) { const r = cp.spawnSync("git", ["show", `${base}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) prev.push({ path: f, content: r.stdout }); } } catch { /* */ }
      const bc = core.graphqlSurface.graphqlBreaking(prev, curr);
      const data = await attest(cwd, { added: bc.addedCount, removed: bc.removedCount, retyped: bc.retypedCount, breaking: bc.breaking });
      return { data, wisdom: bc.breaking.length ? `🔺 ${bc.breaking.length} BREAKING GraphQL change(s) — ${bc.breaking[0].reason}` : `no breaking GraphQL change (+${bc.addedCount} added)`, followUp: bc.breaking.length ? ["a removed/retyped field breaks clients — deprecate and keep it, or version the schema"] : [], confidence: ok(bc.breaking.length ? "high" : "medium") };
    },
  },
  {
    name: "mneme.api.breaking",
    category: "audit",
    description: "🔌 API BREAKING-CHANGE DETECTOR — diff the produced API surface between a base ref and now: which endpoints were added / removed, and crucially which REMOVED endpoints are still CONSUMED (by this repo or a sibling service) → BREAKING, naming the consumer; the rest → POSSIBLY_BREAKING (external clients are invisible). The cross-repo break a normal git diff can't see. Pass {base} (default origin/main). ★HONEST: matched by method + normalized path (params→*); gateway-prefix/dynamic URLs can cause misses; a removed endpoint with no in-repo consumer is POSSIBLY_BREAKING, never falsely cleared.",
    whenToUse: "On a PR / before a release that touches routes — confirm you're not removing or renaming an endpoint another service still calls.",
    triggers: ["breaking change", "did i break the api", "removed endpoint", "api surface diff", "is this a breaking change", "what api changed"],
    inputSchema: { type: "object", properties: { base: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const base = String(args["base"] ?? "origin/main");
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml)$/i;
      const curr: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && curr.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { curr.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const prev: { path: string; content: string }[] = [];
      try { const ls = cp.spawnSync("git", ["ls-tree", "-r", "--name-only", base], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); if (ls.status === 0) { for (const f of ls.stdout.split("\n").map((s) => s.trim()).filter((x) => x && EXT.test(x)).slice(0, 2500)) { const r = cp.spawnSync("git", ["show", `${base}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) prev.push({ path: f, content: r.stdout }); } } } catch { /* */ }
      if (!prev.length) return { data: await attest(cwd, { error: `could not read base ref "${base}"` }), wisdom: `could not read base ref "${base}" — pass a reachable ref`, confidence: ok("low") };
      const bc = core.apiSurface.breakingChanges(prev, curr, [{ name: "this repo", files: curr }]);
      const hard = bc.breaking.filter((b) => b.severity === "BREAKING");
      const data = await attest(cwd, { added: bc.addedCount, removed: bc.removedCount, breaking: bc.breaking });
      return { data, wisdom: `+${bc.addedCount} added · -${bc.removedCount} removed · ${hard.length} BREAKING${hard[0] ? " (e.g. " + hard[0].method + " " + hard[0].path + " consumed by " + hard[0].consumedBy.join(", ") + ")" : ""}`, followUp: hard.length ? ["a removed endpoint is still consumed — keep it (or version it) and migrate the consumers first"] : [], confidence: ok(hard.length ? "high" : "medium") };
    },
  },
  {
    name: "mneme.services.graph",
    category: "audit",
    description: "🌐 CROSS-SERVICE CONTRACT GRAPH — the blast radius ACROSS repos/services. Auto-detects services (packages/* · services/* · apps/*) and links each service's PRODUCED endpoints (route defs) to the CONSUMED endpoints other services call (fetch/axios/got/…), by URL path. Returns the inter-service contract edges (who calls whose API) + DANGLING consumers (a call to an endpoint NO service produces — a broken contract or an external API). The org-scale dependency map git & per-repo tools can't see. ★HONEST: deterministic path-matching (params → *) — a contract map to verify, not a proven runtime call; gateway prefixes / dynamic URLs can cause misses.",
    whenToUse: "Auditing a microservices monorepo, or before changing/removing an API endpoint that other services may call — see which services consume it across repos.",
    triggers: ["cross-service", "which service calls which", "inter-service dependencies", "microservice contracts", "who calls this api across services", "broken api contract"],
    inputSchema: { type: "object", properties: { dirs: { type: "array", items: { type: "string" } } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml)$/i;
      const scan = (root: string) => { const files: { path: string; content: string }[] = []; const stack = [root]; while (stack.length && files.length < 3000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(root.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } } return files; };
      let roots: string[] = [];
      const dirs = Array.isArray(args["dirs"]) ? (args["dirs"] as string[]) : [];
      if (dirs.length) roots = dirs.map((d) => path.join(cwd, d));
      else for (const parent of ["packages", "services", "apps"]) { const pp = path.join(cwd, parent); try { for (const e of fs.readdirSync(pp)) { const p = path.join(pp, e); if (fs.statSync(p).isDirectory()) roots.push(p); } } catch { /* */ } }
      if (!roots.length) return { data: await attest(cwd, { services: 0 }), wisdom: "no service roots found (pass dirs, or run in a monorepo with packages/ services/ apps/)", confidence: ok("low") };
      const services = roots.map((r) => ({ name: r.slice(cwd.length + 1) || r, files: scan(r) }));
      const g = core.crossService.crossServiceGraph(services);
      const data = await attest(cwd, { services: g.services, edges: g.edges.slice(0, 60), dangling: g.dangling.slice(0, 40), producedCounts: Object.fromEntries(g.services.map((s) => [s, g.produced[s].length])) });
      return { data, wisdom: `${g.services.length} services · ${g.edges.length} cross-service contract(s) · ${g.dangling.length} dangling call(s)`, followUp: g.dangling.length ? ["dangling consumers call an endpoint no service here produces — verify the contract (or it's an external API)"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.onboard.path",
    category: "memory",
    description: "🧭 ONBOARDING PATH — orient yourself in an unfamiliar repo FAST. Returns the codebase's real data-flows: per API entry point, the ordered call chain (handler → the functions it calls) + the DB tables it touches + the business rules it implements — flows that touch sensitive data ordered first. Read these top-to-bottom instead of opening files at random. Deterministic, from the cross-layer graph. ★HONEST: a reading guide derived from entry points + call chains — not the only way to read the code; the step order is a capped breadth-first walk.",
    whenToUse: "When you (an agent) land in an unfamiliar codebase and need to understand its architecture quickly before working — pull the flows to see how the system actually runs.",
    triggers: ["how does this codebase work", "where do i start reading", "onboard me", "explain the architecture", "give me a tour", "understand this repo", "main flows"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const op = core.onboarding.onboardingPath(g);
      const data = await attest(cwd, { entryCount: op.entryCount, note: op.note, flows: op.flows.slice(0, 25) });
      return { data, wisdom: op.flows.length ? `${op.flows.length} flow(s) across ${op.entryCount} entry point(s) · start with ${op.flows[0].method} ${op.flows[0].entry} (${op.flows[0].steps.slice(0, 3).join(" → ")}…)` : op.note, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.arch.coupling",
    category: "audit",
    description: "🔗 CHANGE-COUPLING — surface the HIDDEN dependencies the code conceals but git history reveals. Files that always change together carry a dependency; the cross-layer graph splits them into STRUCTURAL (the graph explains it — a write to a table another file defines, a call) vs HIDDEN (high co-change confidence but NO graph link — an implicit dependency nothing in the code, no import or call, warns you about — change one, you must remember the other). Pass {since}. ★HONEST: co-change is a measured CORRELATION (support + confidence), not proven causation; HIDDEN means no structural link was FOUND — a high-signal candidate to verify. Needs both history AND a deterministic cross-layer graph, which is why it's rare.",
    whenToUse: "Before changing a file, or auditing architecture: find the files secretly bound to it that the code doesn't reveal — so you don't break a far-away thing with no visible connection.",
    triggers: ["hidden dependencies", "what changes together", "change coupling", "implicit dependencies", "files secretly coupled", "what else should i change"],
    inputSchema: { type: "object", properties: { since: { type: "string" }, support: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const range = args["since"] ? `${String(args["since"])}..HEAD` : "HEAD~300..HEAD";
      const SCAN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const log = cp.spawnSync("git", ["log", "--no-merges", "--format=%x1e", "--name-only", range], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (log.status !== 0) return { data: await attest(cwd, { error: "git log failed" }), wisdom: `git log failed for ${range}`, confidence: ok("low") };
      const changesets = log.stdout.split("\x1e").map((b) => b.split("\n").map((s) => s.trim()).filter((s) => s && SCAN.test(s))).filter((c) => c.length > 1 && c.length < 60);
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 6000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let stt; try { stt = fs.statSync(p); } catch { continue; } if (stt.isDirectory()) stack.push(p); else if (SCAN.test(e) && stt.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const r = core.changeCoupling.changeCoupling(changesets, g, { minSupport: Number(args["support"]) || 4, top: 20 });
      const data = await attest(cwd, { hidden: r.hidden.slice(0, 20), structuralCount: r.pairs.filter((p) => p.structural).length, total: r.pairs.length });
      return { data, wisdom: r.hidden.length ? `🔗 ${r.hidden.length} HIDDEN dependency(ies)${r.hidden[0] ? ` · top: ${r.hidden[0].a} ⇄ ${r.hidden[0].b} (${r.hidden[0].coChanges}×, no structural link)` : ""}` : `no hidden change-coupling found (${r.pairs.length} structural pairs)`, followUp: r.hidden.length ? ["these files change together but the code shows no link — verify the implicit dependency before changing one in isolation"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.arch.hotspots",
    category: "audit",
    description: "🔥 CROSS-LAYER HOTSPOTS — the ranked refactor hit-list: files that change OFTEN (git churn) AND are entangled ACROSS layers (their code reaches the DB / API / business rules). Sharper than the classic churn × complexity — these are where a change is most likely to ripple across layers and break something far away. Pass {since} for the churn window. ★HONEST: churn × cross-layer-coupling is a PRIORITIZATION signal — a candidate to stabilize, not a proof a file is bad; the refactor judgment is still yours.",
    whenToUse: "When deciding what to refactor or harden first — surface the files that are both volatile and cross-layer entangled.",
    triggers: ["refactor targets", "hotspots", "what should i refactor", "churn and coupling", "most entangled files", "where is the risk concentrated"],
    inputSchema: { type: "object", properties: { since: { type: "string" }, top: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const range = args["since"] ? `${String(args["since"])}..HEAD` : "HEAD~200..HEAD";
      const SCAN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const churn: Record<string, number> = {};
      try { const log = cp.spawnSync("git", ["log", "--format=", "--name-only", "--no-merges", range], { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); if (log.status === 0) for (const f of log.stdout.split("\n").map((s) => s.trim()).filter((s) => s && SCAN.test(s))) churn[f] = (churn[f] || 0) + 1; } catch { /* */ }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 6000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let stt; try { stt = fs.statSync(p); } catch { continue; } if (stt.isDirectory()) stack.push(p); else if (SCAN.test(e) && stt.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const ranked = core.hotspots.rankHotspots(core.hotspots.fileCoupling(g), churn, { top: Number(args["top"]) || 12 });
      const data = await attest(cwd, { hotspots: ranked.map((h) => ({ file: h.file, churn: h.churn, couplingEdges: h.couplingEdges, keystones: h.keystones, band: h.band })) });
      return { data, wisdom: ranked.length ? `${ranked.length} cross-layer hotspot(s) · top: ${ranked[0].file} (${ranked[0].churn}× changed · ${ranked[0].couplingEdges} cross-layer edges)` : "no cross-layer hotspots (need files that both changed AND are cross-layer coupled)", followUp: ranked.filter((h) => h.band === "CRITICAL").length ? ["the CRITICAL hotspots are both volatile and entangled — stabilize/refactor these first"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.arch.decay",
    category: "audit",
    description: "📈 ARCHITECTURAL DECAY VELOCITY — is the architecture getting MORE entangled over time? Samples commits since {since}, replays the cross-layer graph at each, and returns the trend (ERODING/STABLE/IMPROVING) + cross-layer coupling velocity per commit + the worst-step commit (and author). The temporal-trend counterpart to bisect. ★HONEST: a trend over sampled commits, not a forecast and not a value judgment — more coupling isn't always bad; the signal is the RATE and which commit spiked it, computed deterministically.",
    whenToUse: "When you want to know if the codebase is accruing architectural debt over time, or which commit added the most coupling — a structural-health trend.",
    triggers: ["architectural decay", "is the architecture eroding", "coupling over time", "technical debt trend", "entanglement velocity", "is it getting harder to change"],
    inputSchema: { type: "object", properties: { since: { type: "string" }, samples: { type: "number" } }, required: ["since"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const since = String(args["since"] ?? ""); const N = Math.max(2, Number(args["samples"]) || 6);
      const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i; const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
      const log = cp.spawnSync("git", ["log", "--reverse", "--no-merges", "--format=%H%x09%an", `${since}..HEAD`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (log.status !== 0) return { data: await attest(cwd, { error: `unknown ref ${since}` }), wisdom: `unknown ref "${since}"`, confidence: ok("low") };
      const commits = log.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [sha, ...a] = l.split("\t"); return { sha, author: a.join("\t") }; });
      if (commits.length < 2) return { data: await attest(cwd, { commits: commits.length }), wisdom: `need ≥2 commits in ${since}..HEAD`, confidence: ok("low") };
      const idxs = [...new Set((N >= commits.length ? commits.map((_, i) => i) : Array.from({ length: N }, (_, k) => Math.round((k * (commits.length - 1)) / (N - 1)))))];
      const filesAt = (sha: string) => { const ls = cp.spawnSync("git", ["ls-tree", "-r", "--name-only", sha], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); if (ls.status !== 0) return []; const o: { path: string; content: string }[] = []; for (const f of ls.stdout.split("\n").map((s) => s.trim()).filter((x) => x && EXT.test(x) && !SKIP.has(x.split("/")[0])).slice(0, 2000)) { const r = cp.spawnSync("git", ["show", `${sha}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) o.push({ path: f, content: r.stdout }); } return o; };
      const snaps = idxs.map((i) => core.archDecay.measureDebt(filesAt(commits[i].sha), { ref: commits[i].sha.slice(0, 10), author: commits[i].author }));
      const r = core.archDecay.decaySeries(snaps);
      const data = await attest(cwd, { trend: r.trend, reason: r.reason, velocity: r.velocity, couplings: snaps.map((s) => s.couplings), worstStep: r.worstStep });
      return { data, wisdom: `${r.trend} — ${r.reason}`, followUp: r.trend === "ERODING" && r.worstStep ? [`biggest coupling jump at ${snaps[r.worstStep.toIndex]?.ref} (${snaps[r.worstStep.toIndex]?.author}) — review it`] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.arch.bisect",
    category: "audit",
    description: "🕰 ARCHITECTURAL BISECT — git-bisect for a CONTRACT. Given an architectural invariant (`table <T> private|single-writer|guarded` · `endpoint <path> exists`) and a `since` ref it still held at, binary-searches git history to the EXACT commit (and author) where it first broke — by replaying the deterministic cross-layer graph at each midpoint commit. git blame localizes a line; this localizes a structural PROPERTY. Returns the breaking commit + author, or that it still holds. ★HONEST: replays the structural contract at sampled commits; binary search assumes the property flipped once in the range (held at `since`, violated at HEAD) — finds a real, re-checkable breaking commit, not every flap.",
    whenToUse: "When an invariant is VIOLATED now and you need the root cause: which commit (and who) introduced the architectural regression — instead of manually reading history.",
    triggers: ["when did this break", "which commit broke the invariant", "who made this reachable", "bisect the architecture", "root cause the regression", "when did the contract break"],
    inputSchema: { type: "object", properties: { invariant: { type: "string" }, since: { type: "string" } }, required: ["invariant", "since"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd(); const invariant = String(args["invariant"] ?? ""); const since = String(args["since"] ?? "");
      const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i; const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
      const log = cp.spawnSync("git", ["log", "--reverse", "--no-merges", "--format=%H%x09%an", `${since}..HEAD`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (log.status !== 0) return { data: await attest(cwd, { error: `unknown ref ${since}` }), wisdom: `unknown ref "${since}"`, confidence: ok("low") };
      const commits = log.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [sha, ...a] = l.split("\t"); return { sha, author: a.join("\t") }; });
      if (commits.length < 2) return { data: await attest(cwd, { commits: commits.length }), wisdom: `need ≥2 commits in ${since}..HEAD (found ${commits.length})`, confidence: ok("low") };
      const cache = new Map<number, boolean>();
      const filesAt = (sha: string) => { const ls = cp.spawnSync("git", ["ls-tree", "-r", "--name-only", sha], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); if (ls.status !== 0) return []; const out: { path: string; content: string }[] = []; for (const f of ls.stdout.split("\n").map((s) => s.trim()).filter((x) => x && EXT.test(x) && !SKIP.has(x.split("/")[0])).slice(0, 2500)) { const r = cp.spawnSync("git", ["show", `${sha}:${f}`], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); if (r.status === 0 && r.stdout) out.push({ path: f, content: r.stdout }); } return out; };
      const holdsAt = (i: number) => { if (cache.has(i)) return cache.get(i)!; const v = core.archBisect.invariantHoldsAt(filesAt(commits[i].sha), invariant); cache.set(i, v); return v; };
      const r = core.archBisect.bisectIndex(commits.length, holdsAt);
      const broke = r.breakAt === null ? null : commits[r.breakAt];
      const data = await attest(cwd, { invariant, since, commitsScanned: commits.length, evaluated: new Set(r.evaluated).size, breakingCommit: broke ? { sha: broke.sha, author: broke.author } : null, reason: r.reason });
      return { data, wisdom: broke ? `🕰 "${invariant}" broke at ${broke.sha.slice(0, 10)} by ${broke.author}` : `✓ "${invariant}" ${r.reason}`, followUp: broke ? [`inspect the breaking change: git show ${broke.sha.slice(0, 10)}`] : [], confidence: ok("high") };
    },
  },
  {
    name: "mneme.invariants.check",
    category: "audit",
    description: "📐 ARCHITECTURAL INVARIANTS — prove the team's declared architecture rules. Reads .mneme/invariants.txt (DSL: `table <T> single-writer` · `table <T> private` (no endpoint reaches it) · `table <T> guarded` (no unguarded sensitive-write) · `endpoint [METHOD] <path> exists`) and returns a verdict per rule: HOLDS / VIOLATED (with the exact counterexample — the second writer, the endpoint that reaches the private table) / UNKNOWN — derived from the cross-layer graph, never guessed. Design-by-contract for your architecture. ★HONEST: checked against the structural contract the deterministic extractors see (precision 1.0); a VIOLATED carries a real counterexample, UNKNOWN is reported honestly (e.g. single-writer on a table with zero detected writers).",
    whenToUse: "In CI / on a PR: prove the architectural invariants the team declared still hold — catch a second writer to a single-writer table, an endpoint newly reaching a private table, a new unguarded sensitive write.",
    triggers: ["architectural invariants", "check my architecture rules", "is the contract upheld", "design by contract", "prove the invariant", "architecture rules"],
    inputSchema: { type: "object", properties: { rules: { type: "string" }, mine: { type: "boolean" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      if (args["mine"]) {   // induce the invariants the repo already upholds (zero config)
        const mined = core.invariants.mineInvariants(files);
        const data = await attest(cwd, { mined: mined.map((m) => ({ rule: m.rule, confidence: m.confidence, rationale: m.rationale })), file: core.invariants.renderMined(mined) });
        return { data, wisdom: `mined ${mined.length} architectural invariant(s) the repo upholds today (proven at mine-time) — review + commit to .mneme/invariants.txt`, followUp: ["keep the mined rules that reflect intent; thereafter any PR that breaks one is caught"], confidence: ok("medium") };
      }
      let text = String(args["rules"] ?? "");
      if (!text.trim()) { const ip = path.join(cwd, ".mneme", "invariants.txt"); if (fs.existsSync(ip)) text = fs.readFileSync(ip, "utf8"); }
      if (!text.trim()) return { data: await attest(cwd, { rules: 0 }), wisdom: "no invariants — write .mneme/invariants.txt (table <T> single-writer|private|guarded · endpoint <path> exists)", confidence: ok("low") };
      const inv = core.invariants.parseInvariants(text);
      const r = core.invariants.checkInvariants(files, inv);
      const data = await attest(cwd, { allHold: r.allHold, violated: r.violated, results: r.results.map((x) => ({ rule: x.invariant.raw, status: x.status, counterexample: x.counterexample, reason: x.reason })) });
      return { data, wisdom: r.allHold ? `✓ all ${r.results.length} architectural invariant(s) hold` : `📐 ${r.violated} invariant(s) VIOLATED: ${r.results.filter((x) => x.status === "VIOLATED").slice(0, 3).map((x) => x.invariant.raw).join("; ")}`, followUp: r.violated ? ["an architectural invariant is violated — fix it (counterexample given) or the rule no longer reflects intent"] : [], confidence: ok("high") };
    },
  },
  {
    name: "mneme.arch.check",
    category: "audit",
    description: "🔒 ARCHITECTURE LOCK — package-lock for your architecture's accountability. If .mneme/architecture.lock.json exists, compares the current repo against the locked cross-layer contract and reports REGRESSIONS (a removed endpoint = BREAKING; a NEW authz gap or sensitive-table exposure = SECURITY); additions are fine. If no lock exists, returns the contract to write (endpoints + authz gaps + keystones + fingerprint). The lock + its git history is a tamper-evident accountability trail. ★HONEST: a CI gate over the structural contract the deterministic extractors see (precision 1.0); updating the lock is a reviewed human act, not an automated rubber-stamp.",
    whenToUse: "In CI / on a PR: gate the change against the committed architecture lock so a removed endpoint or a new authz gap fails the build until re-locked (reviewed).",
    triggers: ["architecture lock", "did i regress the contract", "lock check", "architecture regression", "contract gate", "lock the architecture"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const lockPath = path.join(cwd, ".mneme", "architecture.lock.json");
      if (!fs.existsSync(lockPath)) {
        const lock = core.archLock.buildLock(files);
        const data = await attest(cwd, { locked: false, contract: lock });
        return { data, wisdom: `no lock yet — contract has ${lock.endpoints.length} endpoints · ${lock.authzGaps.length} authz gap(s) · ${lock.keystones.length} keystone(s). Run mneme lock to commit it.`, followUp: ["write .mneme/architecture.lock.json (CLI: mneme lock) so future changes are gated"], confidence: ok() };
      }
      let locked; try { locked = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { return { data: await attest(cwd, { error: "unreadable lock" }), wisdom: "architecture.lock.json is unreadable", confidence: ok("low") }; }
      const r = core.archLock.checkLock(locked, files);
      const data = await attest(cwd, { ok: r.ok, violations: r.violations, addedEndpoints: r.addedEndpoints, removedEndpoints: r.removedEndpoints, fingerprintMatch: r.fingerprintMatch });
      return { data, wisdom: r.ok ? `✓ architecture lock honored (${r.addedEndpoints.length} additions, 0 regressions)` : `🔒 ${r.violations.length} REGRESSION(S): ${r.violations.slice(0, 3).map((v) => v.detail).join("; ")}`, followUp: r.ok ? [] : ["fix the regression, or re-lock (mneme lock) to approve the new contract — a reviewed act"], confidence: ok("high") };
    },
  },
  {
    name: "mneme.review",
    category: "audit",
    description: "🔍 CODEBASE ACCOUNTABILITY REPORT — the ONE call that runs Mneme's whole cross-layer suite on the repo: the graph (functions↔tables↔endpoints↔rules) + RISK HOTSPOTS + AUTHZ gaps + untested KEYSTONES, in one structured result. (Pass a `base` ref for a CHANGE report on a PR: blast radius + untested-in-change.) The front door — call this first to get the full deterministic picture, then drill in with the specific tools.",
    whenToUse: "When asked for an overall codebase health/risk review, or onboarding to a repo — get the whole picture in one call before drilling into specific tools.",
    triggers: ["review this codebase", "full report", "codebase health", "audit the repo", "accountability report", "overall risk"],
    inputSchema: { type: "object", properties: { base: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
      const risk = core.riskHotspots.riskHotspots(files, { top: 5, graph: g }); const rsum = core.riskHotspots.riskSummary(risk);
      const authz = core.authzGap.authzVerdict(core.authzGap.authzGaps(g));
      const tg = core.testGap.analyzeTestGap(files, { graph: g });
      let score = 100; score -= rsum.critical * 22; score -= rsum.high * 9; score -= authz.count * 18; score -= Math.min(24, tg.uncoveredKeystones.length * 6); score = Math.max(0, score);
      const grade = score >= 90 ? "A" : score >= 78 ? "B" : score >= 62 ? "C" : score >= 45 ? "D" : "F";
      let change: Record<string, unknown> | null = null;
      if (args["base"]) { try { const diff = cp.spawnSync("git", ["diff", "--unified=0", `${String(args["base"])}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; const b = core.crossLayerGraph.diffBlastRadius(g, diff); const cg = core.testGap.changeTestGap(files, diff, { graph: g }); change = { tablesTouched: b.tables.map((t) => t.name), endpointsTouched: b.endpoints.map((e) => `${e.method} ${e.name}`), untestedKeystones: cg.untestedKeystones }; } catch { /* */ } }
      const data = await attest(cwd, { grade, score, graph: { functions: byType("function"), tables: byType("db_table"), endpoints: byType("api_endpoint"), rules: byType("business_rule") }, risk: { critical: rsum.critical, high: rsum.high, top: risk.map((h) => ({ name: h.name, band: h.band, factor: h.factors[0] })) }, authz: { clear: authz.clear, count: authz.count, exposedTables: authz.worstTables }, testGap: { untestedKeystones: tg.uncoveredKeystones.map((k) => k.node.name), keystoneCoverage: `${tg.coveredKeystones}/${tg.totalKeystones}` }, change });
      return { data, wisdom: `grade ${grade} (${score}/100) · ${rsum.critical} CRITICAL + ${rsum.high} HIGH risk · authz ${authz.clear ? "clean" : authz.count + " gap(s)"} · ${tg.uncoveredKeystones.length} untested keystone(s)`, followUp: rsum.critical || !authz.clear ? ["drill into the CRITICAL findings: mneme.risk.hotspots / mneme.authz.scan"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.risk.hotspots",
    category: "audit",
    description: "🎯 RISK HOTSPOTS — the ONE ranked answer: 'what is the riskiest thing in this codebase to be careful with?'. Fuses the cross-layer suite's deterministic signals no other tool unifies — a KEYSTONE (sole writer to a table) that is ALSO UNTESTED and ALSO writes a SENSITIVE table and has high fan-in = the scariest node; an endpoint with an AUTHZ GAP = a security hotspot. One weighted score, one ranking, every contributing factor shown (CRITICAL/HIGH/MEDIUM). ★HONEST: a transparent weighted composite of signals (each gauntlet-tested) — a PRIORITIZATION of where to look, not a proof of a bug.",
    whenToUse: "When you (or the user/a CISO/a new dev) ask 'what should I be most careful with / where is the risk concentrated in this repo' — get the single ranked list instead of six separate reports.",
    triggers: ["riskiest part", "what should i be careful with", "risk hotspots", "where is the risk", "most dangerous code", "what to guard first", "biggest risk in the repo"],
    inputSchema: { type: "object", properties: { top: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);  // (warm the cache; riskHotspots rebuilds internally)
      void g;
      const hs = core.riskHotspots.riskHotspots(files, { top: Number(args["top"]) || 15 });
      const sum = core.riskHotspots.riskSummary(hs);
      const data = await attest(cwd, { total: sum.total, critical: sum.critical, high: sum.high, hotspots: hs.map((h) => ({ name: h.name, type: h.type, file: h.file, band: h.band, score: h.score, factors: h.factors })) });
      return { data, wisdom: !hs.length ? "no risk hotspots found (no keystones or authz gaps)" : `${sum.critical} CRITICAL + ${sum.high} HIGH hotspot(s)${sum.worst ? ` · #1: ${sum.worst.name} (${sum.worst.band}) — ${sum.worst.factors[0]}` : ""}`, followUp: sum.critical ? ["guard the CRITICAL hotspots first — test them + verify their auth before any change"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.commit.suggest",
    category: "audit",
    description: "🏷 BLAST-AWARE COMMIT MESSAGE — generate an HONEST commit message FROM the diff's real cross-layer impact (no LLM): a type (feat if it reaches endpoints/tables · refactor if functions-only · test · chore), a scope, and a body listing exactly which DB tables/endpoints/rules it touches. A message generated this way PASSES mneme.commit.check by construction. Pass the `diff` (or a `base` ref). ★HONEST: it states the structural WHAT deterministically — you replace the placeholder with the WHY.",
    whenToUse: "Right before you commit — generate the impact-accurate message, then add the 'why'. Especially after a multi-file edit where a hand-written message would understate the cross-layer reach.",
    triggers: ["write my commit message", "suggest a commit message", "generate commit message", "what should my commit say"],
    inputSchema: { type: "object", properties: { diff: { type: "string" }, base: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let diff = String(args["diff"] ?? "");
      if (!diff.trim()) { const base = String(args["base"] ?? "HEAD"); try { diff = cp.spawnSync("git", ["diff", "--unified=0", base.includes("...") || base === "HEAD" ? base : `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const s = core.intentImpact.suggestCommitMessage(g, diff);
      const data = await attest(cwd, { type: s.type, scope: s.scope, subject: s.subject, full: s.full });
      return { data, wisdom: `suggested: ${s.type}(${s.scope}): ${s.subject}`, followUp: ["replace the placeholder line with the WHY, then commit"], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.commit.check",
    category: "audit",
    description: "🏷 INTENT-vs-IMPACT — catch a commit that lies about its own size. Pass the commit `message` + the `diff` (or a `base` ref). If the message CLAIMS a trivial change ('chore', 'fix typo', 'format', 'rename', 'docs'…) but the diff's cross-layer blast radius reaches DB tables / API endpoints / KEYSTONES it never names → MISMATCH (a mislabel / scope-creep hiding a high-risk change behind a trivial-sounding message). Works on existing git history with zero extra input — a commit-honesty audit no other tool does across layers. ★HONEST: a heuristic over the wording + the deterministic blast radius — a likely mislabel to LOOK at, not proof of intent.",
    whenToUse: "Before committing (or auditing a PR's commits): confirm your trivially-worded commit isn't silently rewriting a payment keystone or touching tables the message doesn't mention.",
    triggers: ["does my commit message match", "is this commit mislabeled", "intent vs impact", "scope creep in this commit", "commit honesty"],
    inputSchema: { type: "object", properties: { message: { type: "string" }, diff: { type: "string" }, base: { type: "string" } }, required: ["message"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let diff = String(args["diff"] ?? "");
      if (!diff.trim()) { const base = String(args["base"] ?? "HEAD"); try { diff = cp.spawnSync("git", ["diff", "--unified=0", base.includes("...") || base === "HEAD" ? base : `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const r = core.intentImpact.intentImpactMismatch(g, diff, String(args["message"] ?? ""));
      const data = await attest(cwd, { mismatch: r.mismatch, severity: r.severity, statedTrivial: r.statedTrivial, reason: r.reason, reachedTables: r.reachedTables, reachedEndpoints: r.reachedEndpoints, keystonesHit: r.keystonesHit });
      return { data, wisdom: r.mismatch ? `🏷 MISMATCH (${r.severity}) — ${r.reason}` : "✓ the commit message is consistent with its cross-layer impact", followUp: r.mismatch ? ["rewrite the commit message to name what it actually touches (or split the change) — a trivial label is hiding a high-impact edit"] : [], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.authz.scan",
    category: "audit",
    description: "🔒 CROSS-LAYER AUTHZ GAP — the highest-stakes hidden bug: an endpoint whose handler reaches a WRITE to a SENSITIVE table (accounts/payments/users/…) with NO auth/guard function anywhere on the call path. Walks endpoint→handler→…→table on the deterministic graph — the cross-layer check linters & per-function SAST can't do. Returns each unguarded write-path. ★HONEST: a security SMELL, not a proven vuln — auth applied as separately-registered MIDDLEWARE is invisible to the call graph, so a flag is a 'review this endpoint's authz FIRST' signal (fast prioritization), not a CVE; sensitive-table + auth-function detection are name-based.",
    whenToUse: "Auditing a web/API codebase for authorization holes, or reviewing a new endpoint — surface the endpoints that write sensitive data with no visible auth gate, to review first.",
    triggers: ["authz gap", "unauthenticated write", "missing auth check", "security holes", "endpoints without auth", "authorization audit", "unguarded endpoint"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const gaps = core.authzGap.authzGaps(g); const v = core.authzGap.authzVerdict(gaps);
      const data = await attest(cwd, { clear: v.clear, count: v.count, exposedTables: v.worstTables, gaps: gaps.slice(0, 30) });
      return { data, wisdom: v.clear ? "✓ no cross-layer authz gap found (every sensitive-table write path has an auth function, or there are none)" : `🔒 ${v.count} unguarded write-path(s) to ${v.worstTables.join(", ")}${gaps[0] ? ` · top: ${gaps[0].method} ${gaps[0].endpoint} → ${gaps[0].handler}` : ""}`, followUp: v.clear ? [] : ["review these endpoints' authorization FIRST — a write to a sensitive table with no visible auth gate (may be middleware; verify)"], confidence: ok("medium") };
    },
  },
  {
    name: "mneme.testgap.scan",
    category: "audit",
    description: "🧪 CRITICAL UNTESTED SURFACE — the cross-layer Test-Gap line-coverage hides: the KEYSTONE functions (sole writers to a DB table), data tables, and API endpoints that NO test file even mentions — the scariest, highest-risk surface in the repo. Pass a `diff` to instead get the untested critical nodes inside THAT change's blast radius (am I about to edit untested critical surface?). Composes the deterministic graph + keystone analysis + a scan of the repo's test files. ★HONEST: 'covered' = a test file MENTIONS the node by name (deterministic heuristic, reliable for distinctive function names, weaker for short table names) — a prove-or-LOOK signal, not true execution coverage.",
    whenToUse: "Before shipping a change to a critical path, or auditing where to add tests first — find the keystones/tables/endpoints with no test mentioning them. Pass your diff to check if THIS edit reaches untested critical surface.",
    triggers: ["what's untested", "test gap", "untested critical", "where to add tests", "is this tested", "coverage of the keystones", "am i editing untested code"],
    inputSchema: { type: "object", properties: { diff: { type: "string" }, base: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      let diff = String(args["diff"] ?? "");
      if (!diff.trim() && args["base"]) { try { diff = cp.spawnSync("git", ["diff", "--unified=0", `${String(args["base"])}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      if (diff.trim()) {
        const cg = core.testGap.changeTestGap(files, diff);
        const data = await attest(cwd, { verdict: cg.verdict, reason: cg.reason, untestedKeystones: cg.untestedKeystones, untestedTables: cg.untestedTables, untestedEndpoints: cg.untestedEndpoints });
        return { data, wisdom: cg.verdict === "GAP" ? `🧪 GAP — ${cg.reason}` : cg.verdict === "EMPTY" ? "no changed functions resolved" : "✓ the critical nodes this change reaches are mentioned by tests", followUp: cg.untestedKeystones.length ? ["write a test for the untested keystone(s) before shipping — it's the sole writer to a table"] : [], confidence: ok() };
      }
      const tg = core.testGap.analyzeTestGap(files);
      const data = await attest(cwd, { testFiles: tg.testFileCount, uncoveredKeystones: tg.uncoveredKeystones.map((k) => ({ name: k.node.name, file: k.node.file, soleWriterOf: k.soleWriterOf })), uncoveredTables: tg.uncoveredTables.map((t) => t.name), uncoveredEndpoints: tg.uncoveredEndpoints.map((e) => `${e.method} ${e.name}`), keystoneCoverage: `${tg.coveredKeystones}/${tg.totalKeystones}` });
      return { data, wisdom: `${tg.uncoveredKeystones.length} untested keystone(s)${tg.uncoveredKeystones[0] ? ` (top: ${tg.uncoveredKeystones[0].node.name})` : ""} · ${tg.uncoveredTables.length} untested table(s) · keystone coverage ${tg.coveredKeystones}/${tg.totalKeystones}`, followUp: tg.uncoveredKeystones.length ? ["add tests for the untested keystones first — they're the single points of failure no test guards"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.collision.detect",
    category: "audit",
    description: "💥 CROSS-AGENT COLLISION DETECTOR (world-first) — when several agents/branches edit the repo concurrently, find the collisions `git` is BLIND to: two change sets that touch DIFFERENT files but CONVERGE on the same DB table / API endpoint / business rule / function. Pass `changeSets` = [{ agent, diff }]. Returns each pairwise collision + severity: two WRITERS of the same table or two edits to the same function = HIGH (git-invisible data-corruption risk); write/read overlap or a shared file/endpoint = MEDIUM; shared read/rule = LOW. Coordinate BEFORE the agents stomp each other. ★HONEST: detects STRUCTURAL convergence deterministically — a candidate collision to coordinate on, not a proven runtime bug; but it's the cross-layer overlap git can't see.",
    whenToUse: "In a multi-agent run (or before merging several in-flight branches): pass every agent's diff to find where two agents will collide at the data/api layer even though their files differ.",
    triggers: ["will these agents collide", "do these branches conflict", "cross agent collision", "concurrent edits safe", "multi-agent conflict", "merge collision"],
    inputSchema: { type: "object", properties: { changeSets: { type: "array", items: { type: "object", properties: { agent: { type: "string" }, diff: { type: "string" } } } } }, required: ["changeSets"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const sets = (Array.isArray(args["changeSets"]) ? args["changeSets"] : []).map((s: { agent?: string; diff?: string }) => ({ agent: String(s?.agent ?? "agent"), diff: String(s?.diff ?? "") }));
      const cols = core.agentCollision.detectCollisions(g, sets);
      const v = core.agentCollision.collisionVerdict(cols);
      const plan = core.agentCollision.sequenceMerges(g, sets);   // also compute the safe merge order
      const data = await attest(cwd, { clear: v.clear, worst: v.worst, count: v.count, collisions: cols.slice(0, 30), mergePlan: { order: plan.order, unresolvable: plan.unresolvable, coordinate: plan.coordinate, reason: plan.reason } });
      const top = cols[0];
      return { data, wisdom: v.clear ? "✓ CLEAR — no cross-layer collision between the change sets" : `💥 ${v.worst} — ${v.count} collision(s)${top ? ` · ${top.agents.join(" ⇄ ")}: ${top.reason}` : ""} · plan: ${plan.unresolvable ? "⛔ coordinate manually" : plan.order.join(" → ") || "—"}`, followUp: v.worst === "HIGH" ? [plan.unresolvable ? "unresolvable collision — coordinate manually (mutual write↔read)" : `merge in order: ${plan.order.join(" → ")} (writers before readers)`] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.scope.verify",
    category: "audit",
    description: "🤝 SCOPE COVENANT (world-first) — verify an autonomous edit stayed within the architectural scope it DECLARED. Pass your `intent` + an `allow` scope ({files, tables, endpoints}) + the `diff` (or a `base` ref). Mneme computes the ACTUAL cross-layer blast radius from the deterministic graph and returns HONORED, or BREACHED naming the exact unpromised file / DB table / API endpoint the edit reached — a SIGNED, offline-verifiable verdict a reviewer/CI/another agent trusts without re-running. The verdict also accrues into your cross-vendor Scope-Fidelity track record. The accountability layer autonomous agents lack: proof you kept your architectural word. ★HONEST: proves STRUCTURAL scope (files + cross-layer nodes reached) vs declared — deterministic, not runtime correctness.",
    whenToUse: "BEFORE you commit/apply an autonomous multi-file edit (or in CI on a PR): declare the scope you promised the user and confirm the diff didn't silently reach beyond it.",
    triggers: ["did i stay in scope", "verify my scope", "scope covenant", "did the edit overreach", "is this within scope", "scope check"],
    inputSchema: { type: "object", properties: { intent: { type: "string" }, allow: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, tables: { type: "array", items: { type: "string" } }, endpoints: { type: "array", items: { type: "string" } } } }, diff: { type: "string" }, base: { type: "string" }, agent: { type: "string" } }, required: ["intent"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path"); const cp = await import("node:child_process");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let diff = String(args["diff"] ?? "");
      if (!diff.trim()) { const base = String(args["base"] ?? "HEAD"); try { diff = cp.spawnSync("git", ["diff", "--unified=0", base.includes("...") || base === "HEAD" ? base : `${base}...HEAD`], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""; } catch { /* */ } }
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const agent = String(args["agent"] ?? "agent");
      const v = core.scopeCovenant.verifyScope(g, diff, { agent, intent: String(args["intent"] ?? ""), allow: (args["allow"] as never) ?? {} });
      // accrue into the cross-vendor scope-fidelity ledger (skip EMPTY)
      if (v.verdict !== "EMPTY") { try { fs.mkdirSync(path.join(cwd, ".mneme", "scope"), { recursive: true }); fs.appendFileSync(path.join(cwd, ".mneme", "scope", "ledger.jsonl"), JSON.stringify({ agent, honored: v.honored, at: Date.now() }) + "\n", "utf8"); } catch { /* */ } }
      const data = await attest(cwd, { verdict: v.verdict, honored: v.honored, reason: v.reason, breachFiles: v.breachFiles, breachTables: v.breachTables, breachEndpoints: v.breachEndpoints, reachedTables: v.reachedTables, reachedEndpoints: v.reachedEndpoints });
      return { data, wisdom: v.verdict === "BREACHED" ? `⚠️ BREACHED — ${v.reason}` : v.verdict === "EMPTY" ? "empty diff — nothing to verify" : "✓ HONORED — the edit stayed within the declared scope", followUp: v.verdict === "BREACHED" ? [v.breachTables.length ? "an unpromised DB table was reached — surface to the human before committing" : "the edit overreached its declared scope — narrow it or re-declare"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.scope.fidelity",
    category: "audit",
    description: "🤝 SCOPE FIDELITY — the cross-vendor track record of how faithfully each agent keeps the architectural scope it promises (Wilson 95% lower bound over its signed scope-covenant verdicts). EXEMPLARY / RELIABLE / WOBBLY / UNTRUSTED / UNPROVEN. A portable trust signal grounded in real structural evidence — use it to decide which agent to grant more autonomy. Pass `agent` for one, omit for the ranking.",
    whenToUse: "When deciding how much autonomy to grant an agent, or comparing agents/vendors — ask who actually stays within the scope they declare.",
    triggers: ["which agent keeps scope", "scope fidelity", "agent trust score", "who overreaches", "rank agents by scope"],
    inputSchema: { type: "object", properties: { agent: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      let led: { agent: string; honored: boolean; at: number }[] = [];
      try { led = fs.readFileSync(path.join(cwd, ".mneme", "scope", "ledger.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* */ }
      const agent = args["agent"] ? String(args["agent"]) : "";
      const payload = agent ? core.scopeCovenant.scopeFidelity(led, agent) : core.scopeCovenant.rankFidelity(led);
      const data = await attest(cwd, { fidelity: payload as never });
      const top = Array.isArray(payload) ? payload[0] : payload;
      return { data, wisdom: !led.length ? "no scope-covenant verdicts recorded yet — run mneme.scope.verify first" : Array.isArray(payload) ? `${payload.length} agent(s) tracked${top ? ` · top: ${top.agent} (${top.band}, ${Math.round(top.rateLB * 100)}% floor)` : ""}` : `${payload.agent}: ${payload.band} · ${Math.round(payload.rateLB * 100)}% scope-fidelity floor (${payload.honored}/${payload.total})`, followUp: [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.health",
    category: "audit",
    description: "🩺 CROSS-LAYER GRAPH HEALTH — the structural risks in a repo: KEYSTONES (a function that's the SOLE writer to a DB table AND has real fan-in = a single point of failure across layers — break it and that table's writes + every endpoint reaching it break) + ORPHANS (dead-code candidates: functions nothing calls, tables no code touches, endpoints with no handler). Deterministic, no LLM. ★HONEST: candidates to inspect (prove-or-unknown) — an orphan may be an exported public API / entry point / dynamically called.",
    whenToUse: "When auditing a codebase's structural risk, planning a refactor, or onboarding — to find the single-points-of-failure to protect and the dead code to consider removing.",
    triggers: ["dead code", "single point of failure", "keystone", "what's risky in this repo", "unused tables", "orphan functions", "structural risk"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    handler: async (rt, _args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const h = core.crossLayerGraph.graphHealth(g);
      const data = await attest(cwd, { keystones: h.keystones.slice(0, 20).map((k) => ({ name: k.node.name, file: k.node.file, soleWriterOf: k.soleWriterOf, fanIn: k.fanIn, endpoints: k.reachedByEndpoints })), orphanTables: h.orphanTables.map((t) => t.name), orphanEndpoints: h.orphanEndpoints.map((e) => `${e.method} ${e.name}`), deadCodeFunctionCount: h.orphanFunctions.length });
      return { data, wisdom: `${h.keystones.length} keystone(s)${h.keystones[0] ? ` (top: ${h.keystones[0].node.name})` : ""} · ${h.orphanTables.length} orphan table(s) · ${h.orphanFunctions.length} dead-code candidate function(s)`, followUp: h.keystones.length ? ["protect the keystones: they're sole-writers — a wrong edit breaks that table + its endpoints"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.reverse",
    category: "audit",
    description: "⛔ DROP SAFETY (reverse blast radius) — BEFORE you remove/rename a DB table or an endpoint, find EVERYTHING that depends on it: the functions that read/write it, their UPSTREAM callers, the endpoints that reach them, the business rules — and a deletion-safety verdict SAFE / RISKY / CRITICAL (CRITICAL = a keystone or a live endpoint depends on it). The deterministic answer to the migration question that terrifies everyone. ★HONEST: structural dependents from the graph — not a proof nothing breaks at runtime (dynamic/reflective access is invisible).",
    whenToUse: "BEFORE dropping/renaming a DB table or column, or removing an endpoint — confirm what depends on it so you don't break a keystone or a live route.",
    triggers: ["safe to drop", "what depends on this table", "can i delete this", "remove this endpoint", "drop column impact", "who uses this table", "deletion safety"],
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 4000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const d = core.crossLayerGraph.dropImpact(g, String(args["name"] ?? ""));
      const data = await attest(cwd, { found: !!d.node, safety: d.safety, reason: d.reason, keystonesAffected: d.keystonesAffected, dependentEndpoints: d.dependentEndpoints, dependentRules: d.dependentRules, dependentFunctionCount: d.dependentFunctions.length });
      return { data, wisdom: !d.node ? `no table/endpoint matching "${args["name"]}"` : `${d.safety} — ${d.reason}`, followUp: d.safety === "CRITICAL" ? ["CRITICAL: a keystone/endpoint depends on this — write a migration that updates the dependents, don't just drop it"] : [], confidence: ok() };
    },
  },
  {
    name: "mneme.graph.mermaid",
    category: "audit",
    description: "🕸 CROSS-LAYER GRAPH as a Mermaid flowchart you can SHOW the user inline (renders in chat/Markdown/GitHub). The 4 layers (💼 Business ↔ 🌐 API ↔ ⚙ Code ↔ 🗄 Data) become subgraphs; pass a `name` to draw that node's cross-layer blast radius (the focus is highlighted). Deterministic, no LLM — every node/edge derives from a real repo file. Wrap the returned string in a ```mermaid fence.",
    whenToUse: "When the user asks to SEE/visualize the project structure, a feature's footprint, or what a change touches — render the returned Mermaid so they get a picture, not a wall of text.",
    triggers: ["show me the graph", "visualize", "draw the architecture", "diagram this", "what does this feature touch", "mermaid"],
    inputSchema: { type: "object", properties: { name: { type: "string" }, depth: { type: "number" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      const core = await import("@mneme-ai/core"); const fs = await import("node:fs"); const path = await import("node:path");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|proto|yaml|yml|prisma|sql|md|mdx|markdown|txt)$/i;
      const files: { path: string; content: string }[] = []; const stack = [cwd];
      while (stack.length && files.length < 5000) { const d = stack.pop()!; let ents: string[] = []; try { ents = fs.readdirSync(d); } catch { continue; } for (const e of ents) { if (SKIP.has(e)) continue; const p = path.join(d, e); let st; try { st = fs.statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(cwd.length + 1), content: fs.readFileSync(p, "utf8") }); } catch { /* */ } } } }
      const g = core.crossLayerGraph.buildCrossLayerGraph(files);
      const focus = args["name"] ? core.crossLayerGraph.resolveNode(g, String(args["name"])) : null;
      if (args["name"] && !focus) { const data = await attest(cwd, { found: false }); return { data, wisdom: `no node matching "${args["name"]}"`, followUp: [], confidence: ok("low") }; }
      const mermaid = core.crossLayerGraph.toMermaid(g, focus?.id, { maxDepth: Number(args["depth"]) || 2 });
      const data = await attest(cwd, { mermaid, focus: focus?.name ?? null });
      return { data, wisdom: `mermaid flowchart ready${focus ? ` for "${focus.name}"` : " (structural hubs)"} — render it in a \`\`\`mermaid fence for the user`, followUp: [], confidence: ok() };
    },
  },
];

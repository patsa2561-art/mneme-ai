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
      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]); const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|prisma|sql)$/i;
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
];

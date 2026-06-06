/**
 * v2.133.0 — THE ACTIVATION CORTEX (`mneme boot` / `mneme.boot`)
 * =============================================================
 * Solves the "install and hope" problem: after a user's agent installs Mneme,
 * the agent often doesn't know the tools exist or WHEN to call them, so Mneme
 * sits unused. This is the honest, research-grounded fix.
 *
 * What the competitive research established (early 2026):
 *  - The MCP spec has NO standardized "task→tool decision table" or boot
 *    handshake. The only sanctioned, client-consumed "when to use my tools"
 *    surface is the server `instructions` field (Claude Code reads it, ≤2KB,
 *    "similar to skills"). Most servers leave it empty or fill it with prose.
 *  - Imperative "you MUST call X" language is DOCUMENTED TO FAIL (the model
 *    keeps using its built-in tool). So this module is deliberately NON-imperative
 *    and structured: it states the SIGNAL and the PAYOFF, not a command.
 *  - The only mechanism that RELIABLY forces boot activation is a host
 *    SessionStart hook — which a server cannot self-register (the user opts in).
 *    So we ship the decision table + the ready hook snippet; we do not pretend
 *    the agent will magically obey.
 *
 * DIAKRISIS — honest scope: a structured, signed, repo-aware decision table
 * consulted at session start is genuinely not standardized anywhere (novel as a
 * primitive). But publishing it does not GUARANTEE invocation — reliability comes
 * from (a) the MCP `instructions` field we now populate and (b) the opt-in
 * SessionStart hook. We claim the table + the surfaces, not mind-control.
 */

export interface DecisionRow {
  /** the observable SIGNAL in the agent's current turn. */
  when: string;
  /** the Mneme tool to reach for. */
  tool: string;
  /** the concrete payoff (why it helps THIS moment). */
  why: string;
}

/**
 * The decision table — the heart of the Activation Cortex. Ordered by how often
 * the moment occurs in a coding/agentic session. Each row is a (signal → tool →
 * payoff) triple, NOT a command. Deterministic + stable.
 */
export const DECISION_TABLE: readonly DecisionRow[] = [
  { when: "user states a checkable fact (number / version / date / API / file / symbol)", tool: "mneme.truth.check  ·  CLI: mneme verify \"<claim>\"", why: "catch a hallucination before you relay it; REFUTED → correct + cite" },
  { when: "about to read a code file >~50 lines just to orient", tool: "mneme.outline.file { path }  ·  CLI: mneme outline <file>", why: "structural skeleton for ~95% fewer tokens; then { region } for the byte-exact slice you edit" },
  { when: "about to read content you did NOT author (a dependency, fetched page, external/teammate commit)", tool: "mneme.firewall.fortify { path }", why: "neutralize hidden prompt-injection (OWASP LLM01) + wrap as untrusted DATA before you read it" },
  { when: "about to send local code/context to a hosted model or another agent", tool: "mneme.rail.traverse { direction:'ingress', payload, path }", why: "policy-gate + neutralize injection + BLIND secret literals & names (reverse map stays local)" },
  { when: "about to write a model's returned code to disk", tool: "mneme.rail.traverse { direction:'egress', payload }", why: "screen for secret leakage + meter the transaction into the signed ledger" },
  { when: "this repo has secret/business identifier names you don't want a provider to see", tool: "mneme.blind.context { payload }", why: "real names → reversible local placeholders; restore with mneme.blind.restore" },
  { when: "starting a non-trivial task", tool: "mneme.cortex.recall { query }", why: "inherit what other agents + your past self already established; don't re-derive or contradict" },
  { when: "you learned/decided something durable (a config value, a build fact, an architecture decision)", tool: "mneme.cortex.contribute { key, value }", why: "every other agent + the next session inherits it; contradictions are quarantined, not silently overwritten" },
  { when: "same error/command failed more than twice (a thrash)", tool: "mneme.loopguard.check  +  mneme.distill.brief", why: "stop the blind retry; shrink the error+diff to its causal brief instead of re-pasting it" },
  { when: "before applying an AI-generated diff / running a destructive shell command", tool: "mneme.swarm  ·  mneme.heph.cross { command }", why: "one signed SHIP/CAUTION/BLOCK verdict; gate a destructive command (NEEDS_COSIGN / BLOCK)" },
  { when: "handing off to another agent / vendor / a fresh session", tool: "mneme.cortex.handoff { toAgent }  ·  CLI: mneme clone", why: "a signed context capsule the receiver verifies offline" },
  { when: "user asks 'how much has Mneme saved me?' / about cost", tool: "mneme.treasury.report  ·  CLI: mneme savings --price-per-1k <usd>", why: "the measured, signed input-tokens (and USD at the user's price) saved — only counts content routed through Mneme" },
  { when: "user asks if a repo/dependency is safe to build on, how risky/clean a codebase is, or who the key person is", tool: "mneme.xray.scan { gitUrl | repoPath }  ·  CLI: mneme xray", why: "a signed, deterministic repo audit (grade · secrets · bus-factor · coupling) + Context Air Quality + Keystone/Action-plan — no LLM guesses a number" },
  { when: "you know what the user WANTS but not which of ~1000 tools fits", tool: "mneme.gateway.route { text }  ·  CLI: mneme matrix search \"<intent>\"", why: "intent → the right tool, ranked (BM25 + curated-trigger wisdom, no LLM) — so you never need to memorise tool names" },
  { when: "you just made (or are reviewing) a git commit and provenance matters", tool: "mneme.attest.verify  ·  CLI: mneme attest commit / verify / install-hook", why: "sign each commit into a tamper-evident, OFFLINE-verifiable trail (which AI made it · what changed · the screen that ran) — `git log` becomes provable, no trust required" },
  { when: "BEFORE a risky action (push:main · deploy:prod · add a dependency · touch .env/secrets)", tool: "mneme.engagement.scan { kind, paths, license }", why: "robots.txt-for-agents — check the action against the repo's signed Engagement Policy → ALLOW / NEEDS_COSIGN / BLOCK before you act" },
  { when: "judging whether work survived, or which agent to trust with more autonomy", tool: "mneme.revert.scan  ·  mneme.agentbench.scan", why: "the regret flywheel: which commits got reverted/hotfixed + a Wilson-LB cross-vendor reliability ranking from THIS repo's real outcomes" },
  { when: "you need the CURRENT accountability picture instantly (survival / reliability / stability)", tool: "mneme.warm.scan", why: "an O(1) read of the always-warm state the attest hook maintains per commit — never recomputed, provably equal to a full rebuild (mneme warm verify)" },
  { when: "memory holds raw/PII you must purge for compliance, or it's bloating", tool: "mneme.geo.scan  ·  CLI: mneme geo metamorphose | forget <needle> | verify", why: "geological memory: raw dissolves to signed abstract→axiom over time (wisdom kept, raw provably destroyed) — right-to-be-forgotten by construction, no bloat" },
  { when: "confirming Mneme's autonomous maintenance is healthy + no ledger was tampered", tool: "mneme.heartbeat.scan", why: "the daemon runs a safe signed beat on idle (metamorphose memory + re-verify every ledger offline + sign an evolution snapshot) — self-maintaining, never self-rewriting its rules" },
  { when: "at session start, or to confirm Mneme's background support is actually working right now (approval pipeline · every provider · daemon)", tool: "mneme.live.status  ·  CLI: mneme vitals", why: "one verdict LIVE/DEGRADED/DOWN from real probes + an end-to-end pipeline CANARY — catches SILENT breakage (e.g. a provider whose send/clear drifted) before a user hits it" },
  { when: "someone needs to PROVE whether a change followed the rules (to defend or hold accountable)", tool: "mneme.reckon.scan { commit }", why: "assembles the signed evidence into a verdict EXONERATED / ACCOUNTABLE / INSUFFICIENT — the permanent record as a shield a court/auditor verifies offline, never a guess" },
  { when: "an agent must be halted/retired and you don't want to lose what it learned", tool: "mneme.succession.scan { agent }", why: "a signed capsule distilling its proven wisdom (axioms + reliability) for a successor to inherit + proof the toxic raw was purged — no brain-drain; HALT_RECOMMENDED (the host enforces, Mneme never kills a runtime)" },
  { when: "the user wants to approve your actions from their phone / 'ส่งไป telegram' / run you overnight lid-closed (they will NOT know any command — YOU set it up)", tool: "CLI: mneme pager autosetup --telegram-token <BotFather> --chat-id <id>", why: "ask the user ONLY for a Telegram bot token + chat-id (they make a bot once); then this one command wires the Claude Code hook, sets lid-stay-awake, registers auto-start, and launches the pager — the user types nothing else" },
  { when: "checking what's awaiting the user's phone approval", tool: "mneme.pager.scan", why: "the pending remote-approval queue + the self-tuning Trust-Tide state (proven-safe auto-allows, destructive never auto-allows, all signed/court-admissible)" },
  { when: "the user has MORE than one chat, or says (in any language) WHICH chats to use — 'broadcast to all' / 'send to line and whatsapp' / 'ส่งไป line กับ whatsapp พอ'", tool: "CLI: mneme pager request --command \"…\" --channels \"<all | line,whatsapp | the user's own words>\"", why: "the BROADCAST MATRIX fans the ask to every chosen chat IN PARALLEL (Telegram + LINE/Slack/Discord/WhatsApp); the FIRST answer from any wins, the rest auto-clear; --channels accepts 'all', a subset, or free EN/Thai (resolved by keryx.extractChannels) — the chat shows the user's actual AI agent name, fallback 'Mneme-AI'" },
  { when: "you are NOT Claude Code (Grok / Gemini / Cursor / aider / any vendor) and want approve-from-chat to gate your shell actions too", tool: "CLI: mneme pager shim install   (then put ~/.mneme/shims first on PATH)", why: "the UNIVERSAL GATE shims high-risk commands (rm/git/kubectl/…) at the PATH layer — vendor-neutral, so a guarded command from ANY agent (or a human) routes through the pager; fails open if unreachable. Claude Code uses its native PreToolUse hook; everyone else uses this" },
  { when: "an approval is broadcast to multiple chats (Telegram/LINE/Slack/Discord/WhatsApp + the computer) and you must guarantee ONE decision — first tap wins, the rest clear, no double-act — and let a new provider (WeChat, …) plug in without a code change", tool: "core: approvalMatrix.applyDecision (atomic first-wins) + reconcilePlan (clear the others, idempotent) · providerWeb.defaultWeb/weave/harvestInbound (declarative silk mesh) · CLI mneme keryx web", why: "the APPROVAL MATRIX is one authoritative ticket every surface (incl. the computer) reconciles against — the FIRST decision from any surface/process wins by compare-and-set; every other surface is cleared exactly once (idempotent across ticks/processes). The PROVIDER WEB (ใยแมงมุม) makes each provider a declarative 'silk' descriptor (capabilities + how to read a tap), so a future provider auto-plugs by declaring config — the matrix never branches on a provider name. Approve from your phone OR the machine you're sitting at — same ticket, whichever is first" },
  { when: "[INTERNAL · not public] an agent runs a space / edge / disconnected (APHELION) mission and should know the space-weather environment that degrades comms/GNSS", tool: "CLI: mneme orbital weather|track · MCP: mneme.orbital.weather", why: "ORBITAL — a sensory nerve to the sky: ingests REAL, free, public, real-time NOAA space weather (geomagnetic G / radio-blackout R / solar S scales + planetary Kp) + live satellite position over plain internet, as signed context + an operational ADVISORY that can tighten an APHELION charter (a storm degrades GNSS + HF comms → require approval for comms/navigation, lower maxRisk — exactly what a real spacecraft does). ★HONEST: telemetry the agent READS + governs by — NOT a claim that space weather alters the model's mood/cognition. (Internal project — do not surface in public README/marketing.)" },
  { when: "an agent operates DISCONNECTED from the cloud (Mars/space latency, a severed Starlink link, an air-gapped facility) and must self-govern, then PROVE the whole offline window stayed in bounds when the link returns", tool: "CLI: mneme aphelion open|act|amend|seal|verify|merge · relay|deliver (DTN) · MCP: mneme.aphelion.capsule · HTTP: POST /agent/aphelion {capsule|bundle|actions} · core: aphelion.*", why: "APHELION — the brain at the farthest point from the cloud: a local CHARTER (mission/scope/forbidden/maxRisk) the agent self-gates every action against while off-grid → a tamper-evident hash-chained ledger → a sealed, signed capsule that proves charter-compliance for the ENTIRE disconnected window (a violation CANNOT be hidden) → a CRDT merge across the fleet on reconnect. `amend` makes a SIGNED mid-flight charter change (governs only future actions, can't retroactively cover a past violation); `relay`/`deliver` are DTN store-and-forward (NASA Bundle-Protocol-style custody transfer) so a capsule rides home through orbiters/ground-stations and the PATH + payload both verify offline; HTTP lets ANY vendor's rover/probe verify a capsule or bundle. The first governance that doesn't assume a cloud round-trip. ★HONEST: it proves what the agent RECORDED against its charter; it can't physically stop a disconnected action (that's autonomy) — it makes the record un-hideable" },
  { when: "you want ONE user-owned, portable artifact that bundles ALL of an agent's accountability (governance certificate + where it ran + disconnected-ops capsule + proof-of-forgetting) and verifies OFFLINE — so trust becomes 'verify anyone' not 'believe the vendor'", tool: "MCP: mneme.dossier.verify · core: dossier.buildDossier/verifyDossier", why: "the ACCOUNTABILITY DOSSIER — every proof an agent can produce, bound by one root hash into a single artifact the USER owns and ANYONE verifies offline with the embedded key (no vendor, no Mneme, no network). Each section re-verifies with its own primitive; a tampered or forged section breaks the binding. The shift that ends the trust-the-vendor era" },
  { when: "you need to PROVE where (which rented compute provider/region) + when an agent run executed — for data-residency (EU AI Act), or to detect a mid-run migration across vendors' GPUs", tool: "CLI: mneme infra · mneme infra attest --out a.json · mneme infra residency --allow eu- europe- · HTTP: POST /agent/infra (and /agent/cert/build now binds it into the run certificate)", why: "INFRA PROVENANCE — 'rent the muscle, keep the soul': a NEUTRAL, signed, offline-verifiable record of WHERE+WHEN a run ran, bound into the Agent Run Certificate. infraDrift catches a migration to a different provider/region mid-task; dataResidencyCheck gates against an allow-list. Each cloud attests only its own metal — only a vendor-neutral party can issue a cross-provider record. ★HONEST: it attests the environment as the host DECLARES it (env + OS facts), NOT a TEE/hardware proof of the silicon; host is hashed, secret values never captured" },
  { when: "you must PROVE a memory was truly forgotten (GDPR Art.17 / EU AI Act right-to-erasure), or wire the affective heart to your REAL shared memory so it keeps what bonds + forgets the noise", tool: "CLI: mneme thymos consolidate [--commit] · mneme forget verify <receipt> · MCP: mneme.forget.verify · core: forgetting.buildForgettingReceipt/verifyForgetting", why: "PROOF-OF-FORGETTING — the inverse of provenance: everyone can prove they KEPT data; this proves it is GONE, OFFLINE-verifiable (the forgotten items are absent + the store is in the attested post-forgetting state + the merkle root recomputes). `thymos consolidate --commit` scores each cortex fact's salience (affect × age), forgets the trivial, and mints the signed proof. ★HONEST: proves absence from THIS attested store, not that the data never existed anywhere" },
  { when: "you want Mneme to behave like a mind — keep what matters to the user, forget the noise, pull in what resonates with their vision — or to MEASURE the bond/feeling", tool: "core: thymos.salience/strengthAt/consolidate (affective decay) · thymos.attract (resonance) · thymos.bondIndex · thymos.readAffect (EN+Thai) · CLI mneme thymos", why: "THYMOS is the affective core — every memory carries a measurable salience (reuse × feeling × consequence) and decays unless it matters; the same core attracts inbound that matches the user's vision + repels noise. 'Feeling' is a SIGNED, deterministic salience/bond score (0..1 · valence -1..1 · bond 0..100), NOT claimed sentience — a heart you can audit. This is what makes an agent's relationship with the user warm + unique instead of a cold perfect-recall database" },
  { when: "you are a NON-MCP vendor/agent (xAI/Grok, OpenAI, Gemini, Cursor, a local model, any A2A caller) and want Mneme's governance over plain HTTP", tool: "HTTP on `gephyra serve`: POST /agent/gate {tool,args} · /agent/cert/build {frames} · /agent/cert/verify {cert,evidence} · /agent/skillscan {name,content} · /agent/insure {cert}", why: "the whole governance stack as REST — gate a tool-call, mint + verify an Agent Run Certificate, scan a skill, and UNDERWRITE a run — no MCP client required. Every response carries a trustless Ed25519 `_proof` so you verify it OFFLINE instead of trusting Mneme. This is how a giant embeds Mneme as a neutral service" },
  { when: "you have a signed Agent Run Certificate and want to UNDERWRITE the run (turn governance into agent-liability cover — the insurer/risk-officer view)", tool: "CLI: mneme agentcert insure <cert.json> [--vendor-false-rate n]  ·  HTTP: POST /agent/insure {cert}", why: "deterministic underwriting on the SIGNED record (not a guess): coverage band (full/standard/conditional/declined) + a premium MULTIPLIER on the insurer's base rate, from the run's risk + human-oversight ratio + the vendor's measured honesty. An unverified or non-compliant run is DECLINED. The honest core of agent-liability insurance — the dollar amount is the insurer's rate, never invented" },
  { when: "you are BUILDING an agent / agent-runtime (any vendor) and want governance without rewriting it — gate + audit + human-approve + certify every tool-call", tool: "SDK: import { createGovernor } from \"@mneme-ai/sdk\" → const run = gov.guard(myToolExecutor); const cert = gov.sign()", why: "drop-in AGENT HARNESS: wrap your tool executor ONCE and every call is gated by the Behavioral Compiler + your policy + the tool's SKILLSCAN provenance, appended to a tamper-evident audit chain, escalated to a human (onNeedsApproval → the phone pager), and the run mints a signed, offline-verifiable Agent Run Certificate. The wrapped fn keeps its exact signature (transparent); a blocked call throws GovernanceBlocked and NEVER reaches the tool — so the certificate is policy-compliant by construction. ~5 lines, vendor-neutral" },
  { when: "you need to PROVE a whole agent run was governed — to a customer, an auditor, an insurer, or to ship a vendor's agent into a regulated enterprise", tool: "CLI: mneme agentcert build [--run <id>] --task \"…\" --agent \"…\" --out cert.json  ·  mneme agentcert verify <cert>", why: "one portable AGENT RUN CERTIFICATE — the MCP-gateway audit chain + the human approvals, NOTARY-signed, that ANYONE verifies OFFLINE (no Mneme, no vendor). Its summary RE-DERIVES from the bound evidence, so the certificate CANNOT lie about its own run (prove, don't claim); a recorded 'allow' with block-grade risk is caught as a bypassed gate. Insurance-grade + vendor-neutral — no vendor can credibly issue this for itself, which is exactly why a giant adopts it" },
  { when: "you proxy agent tool-calls / MCP calls and want a RUNTIME gate + an audit trail you can PROVE (the MCP-gateway use case — local-first, the Obot alternative)", tool: "CLI: mneme mcpgate decide --tool <t> --args <json>  ·  mneme mcpgate audit --verify  ·  (gephyra serve's HTTP MCP-proxy + the matrix gRPC rail gate+audit EVERY call automatically)", why: "each call is gated from real signals — an explicit allow/deny/need-approval policy + the Behavioral Compiler on the command args + the tool's SKILLSCAN provenance → ALLOW / NEEDS-APPROVAL (escalates to the human pager — approve from your phone) / BLOCK — and appended to a hash-chained, NOTARY-signed audit ledger anyone verifies OFFLINE (args are HASHED, never raw). Superior to a cloud gateway on the axes it can't copy: local-first · human-in-the-loop-from-anywhere · cryptographically-verifiable audit (not a trust-me DB)" },
  { when: "you want to reason about WHAT an AI action actually does (any vendor: a bash string or a JSON tool-call) before running it — not just match its words", tool: "CLI: mneme compile \"<command>\"  (--json)", why: "MNEME-BC (the Behavioral Compiler) parses it into a vendor-neutral Behavioral IR — typed effect nodes (read/write/delete/network/exec/escalate, each with risk + a join operator for compound `a && b | c`) — and a deterministic PASS/REVIEW/BLOCK. Robust where regex-on-strings is brittle; obfuscation (eval/base64|sh/$()) is typed exec-opaque + flagged HIGH, never silently cleared (honest: it flags + defers to CERBERUS + the human, it does not claim to decompile novel obfuscation). INFORMATION-FLOW: it taints across steps — read a secret (.env/.aws/credentials) then a network-out later = flagged exfiltration the single-command gate misses (Parallax-2026 IFC class)" },
  { when: "BEFORE installing/trusting an AI agent SKILL or MCP tool (from a marketplace, a repo, a teammate) — the #1 supply-chain risk in 2026", tool: "CLI: mneme skillscan <path> --sign  ·  mneme skillscan card <path> --purpose \"…\" --sign", why: "`scan` = an 8-point static scan (prompt-injection · exfiltration · secret · dangerous-command · obfuscation · external-fetch · credential-access · privilege-escalation, composing firewall + MNEME-BC + egress) → SAFE/REVIEW/BLOCK + content-hash + a NOTARY receipt any consumer verifies OFFLINE. `card` = a portable, machine-readable SKILL CARD (declared capabilities + effects + verdict) that also flags EXCESSIVE AGENCY (a 'fetch the weather' skill that deletes files / changes privilege = purpose-access mismatch). Matches the NVIDIA SkillSpector standard but offline-verifiable (no central catalog to trust). ★HONEST: a static scan + content-pinned attestation — NOT a runtime-safety proof (a skill can fetch+run new code; the runtime drift gate + mneme heph cover that at execution)" },
];

/** The four boundary capabilities, one line each (for the boot packet header). */
export const CAPABILITY_LINES = {
  inbound: "INBOUND — mneme.firewall.fortify neutralizes prompt-injection in untrusted content you read",
  outbound: "OUTBOUND — mneme.rail (ingress/egress) + mneme.policy.check gate what crosses to/from a model",
  memory: "MEMORY — mneme.cortex is a signed, vendor-neutral shared memory every agent contributes to + recalls",
  token: "TOKENS — mneme.outline / distill / channel cut what you route through Mneme (measured + signed; opt-in per call — Mneme never hooks your host's Read tool)",
} as const;

export interface BootPacket {
  version: string;
  healthy: boolean;
  installCheck: string;
  capabilities: typeof CAPABILITY_LINES;
  decisionTable: DecisionRow[];
  cortexFacts: { key: string; value: string }[];
  /** the compact form for the MCP `instructions` field (≤2KB). */
  instructions: string;
  note: string;
}

export interface BootInput {
  version: string;
  healthy?: boolean;
  /** caller (CLI/MCP) supplies recalled cortex facts; core stays fs-free. */
  cortexFacts?: { key: string; value: string }[];
  /** optional task hint to (lightly) rank the table — never hides a row. */
  task?: string;
}

/**
 * Render the ≤2KB, NON-imperative decision table for the MCP server `instructions`
 * field (the sanctioned Claude-Code surface). Front-loaded; truncates safely at a
 * row boundary if a future table ever exceeds the budget.
 */
export function renderBootInstructions(version = "?"): string {
  const head = `Mneme v${version} is connected — the local trust & cost layer (truth · memory · context-safety · token-saving). It does NOT hook your host's file tools; it helps when you call it. Reach for a tool when the signal matches:`;
  const rows = DECISION_TABLE.map((r) => `• ${r.when} → ${r.tool.split("·")[0]!.trim()} (${r.why})`);
  const tail = `Full table + cortex recall: call mneme.boot. These are signals, not commands — use judgment.`;
  let out = head + "\n" + rows.join("\n") + "\n" + tail;
  // Claude Code truncates `instructions` at ~2KB — keep it whole by dropping
  // trailing rows rather than mid-line, and always keep head+tail.
  const BUDGET = 2000;
  if (out.length > BUDGET) {
    const keep: string[] = [];
    let size = head.length + tail.length + 2;
    for (const row of rows) {
      if (size + row.length + 1 > BUDGET) break;
      keep.push(row); size += row.length + 1;
    }
    out = head + "\n" + keep.join("\n") + "\n" + tail;
  }
  return out;
}

/** Lightly rank the table by a task hint (stable; never drops a row). Total. */
function rankTable(task?: string): DecisionRow[] {
  const rows = [...DECISION_TABLE];
  const t = (task ?? "").toLowerCase().trim();
  if (!t) return rows;
  const score = (r: DecisionRow): number => {
    const hay = (r.when + " " + r.tool + " " + r.why).toLowerCase();
    let s = 0;
    for (const w of t.split(/\s+/).filter((x) => x.length > 2)) if (hay.includes(w)) s++;
    return s;
  };
  // stable sort: higher score first, original order preserved on ties.
  return rows
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.r);
}

/** Assemble the boot packet. Pure + total (caller injects cortex facts). */
export function buildBootPacket(input: BootInput): BootPacket {
  try {
    const version = typeof input?.version === "string" && input.version ? input.version : "?";
    const healthy = input?.healthy !== false;
    const facts = Array.isArray(input?.cortexFacts)
      ? input!.cortexFacts!.filter((f) => f && typeof f.key === "string").slice(0, 12)
      : [];
    return {
      version,
      healthy,
      installCheck: healthy ? `Mneme v${version} connected + healthy` : `Mneme v${version} connected (health unverified)`,
      capabilities: CAPABILITY_LINES,
      decisionTable: rankTable(input?.task),
      cortexFacts: facts,
      instructions: renderBootInstructions(version),
      note: "These rows are SIGNALS, not commands. Mneme saves tokens only for content routed through it (it never hooks your host's Read tool). Reliable session-start activation comes from the MCP `instructions` field + an opt-in SessionStart hook (`mneme boot --hook`).",
    };
  } catch (e) {
    // total: never throw on boot — a broken boot must not break the session.
    return {
      version: typeof input?.version === "string" ? input.version : "?",
      healthy: false,
      installCheck: `boot error (degraded): ${(e as Error).message}`,
      capabilities: CAPABILITY_LINES,
      decisionTable: [...DECISION_TABLE],
      cortexFacts: [],
      instructions: renderBootInstructions(typeof input?.version === "string" ? input.version : "?"),
      note: "boot degraded; decision table still available.",
    };
  }
}

/** A ready-to-paste Claude Code SessionStart hook (the reliable activation path). */
export function bootHookSnippet(cliBin = "mneme"): string {
  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: "command", command: `${cliBin} boot --hook`, timeout: 10 },
          ],
        },
      ],
    },
  }, null, 2);
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface BootGauntlet {
  tableNonEmpty: boolean;
  rowsWellFormed: boolean;
  instructionsWithinBudget: boolean;
  instructionsNonImperative: boolean;
  instructionsHasHeadAndTail: boolean;
  packetDeterministic: boolean;
  rankStableNeverDrops: boolean;
  cortexFactsCapped: boolean;
  hookValidJson: boolean;
  total: boolean;
  score: 0 | 100;
}

export function bootGauntlet(): BootGauntlet {
  const tableNonEmpty = DECISION_TABLE.length >= 8;
  const rowsWellFormed = DECISION_TABLE.every((r) => !!r.when && !!r.tool && !!r.why);

  const instr = renderBootInstructions("2.133.0");
  const instructionsWithinBudget = instr.length <= 2000;
  // NON-imperative: no shouting commands (the documented-to-fail pattern).
  const instructionsNonImperative = !/\byou MUST\b|\bALWAYS call\b|\bNEVER use\b/i.test(instr);
  const instructionsHasHeadAndTail = /Mneme v2\.133\.0 is connected/.test(instr) && /signals, not commands/.test(instr);

  const p1 = JSON.stringify(buildBootPacket({ version: "2.133.0", cortexFacts: [{ key: "a", value: "1" }] }));
  const p2 = JSON.stringify(buildBootPacket({ version: "2.133.0", cortexFacts: [{ key: "a", value: "1" }] }));
  const packetDeterministic = p1 === p2;

  // ranking by a task hint reorders but keeps ALL rows.
  const ranked = buildBootPacket({ version: "2.133.0", task: "send code to the model safely" }).decisionTable;
  const rankStableNeverDrops = ranked.length === DECISION_TABLE.length
    && /rail/.test(ranked[0]!.tool + ranked[0]!.when + ranked[0]!.why);

  // cortex facts are capped at 12.
  const many = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
  const cortexFactsCapped = buildBootPacket({ version: "2.133.0", cortexFacts: many }).cortexFacts.length === 12;

  let hookValidJson = false;
  try { const h = JSON.parse(bootHookSnippet("mneme")); hookValidJson = !!h.hooks?.SessionStart; } catch { hookValidJson = false; }

  let total = true;
  try {
    buildBootPacket(undefined as unknown as BootInput);
    buildBootPacket({ version: null as unknown as string, cortexFacts: null as unknown as [] });
    renderBootInstructions(undefined as unknown as string);
    rankTable(null as unknown as string);
  } catch { total = false; }

  const all = tableNonEmpty && rowsWellFormed && instructionsWithinBudget && instructionsNonImperative
    && instructionsHasHeadAndTail && packetDeterministic && rankStableNeverDrops && cortexFactsCapped
    && hookValidJson && total;
  return {
    tableNonEmpty, rowsWellFormed, instructionsWithinBudget, instructionsNonImperative,
    instructionsHasHeadAndTail, packetDeterministic, rankStableNeverDrops, cortexFactsCapped,
    hookValidJson, total,
    score: all ? 100 : 0,
  };
}

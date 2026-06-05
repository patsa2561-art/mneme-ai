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

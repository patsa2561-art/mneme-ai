/**
 * `mneme do <natural-language>` — the smart dispatcher.
 *
 * The point: users shouldn't memorize 50 commands. They state intent in
 * plain English. Mneme classifies it, runs the relevant sub-engines in
 * parallel, and synthesizes a unified report.
 *
 *   mneme do "find security issues"
 *     → vulns + anomaly + secret-redaction-check, one combined report
 *
 *   mneme do "is the codebase healthy"
 *     → status + drawdown + guardian-once + iv, one health card
 *
 *   mneme do "who knows about auth"
 *     → who-knows + dna + story, one expert profile
 *
 * Routing is regex-based on purpose: deterministic, sub-millisecond, no LLM
 * needed. Every intent maps to a flow that already exists — `do` is pure
 * orchestration over the existing engines.
 */
import kleur from "kleur";
import {
  ui,
  header,
  section,
  pill,
  emptyState,
} from "../ui.js";
import {
  iris,
  generateHeadline,
  recordCommandRun,
  flash,
  type PyramidSection,
} from "../iris/index.js";

export interface DoOptions {
  cwd: string;
  query: string;
  json?: boolean;
}

interface Flow {
  id: string;
  /** Plain-English label shown to user when this flow fires. */
  label: string;
  /** What the flow ACTUALLY tells the user. Plain English. */
  description: string;
  /** Patterns that trigger this flow (any one match = fire). */
  patterns: RegExp[];
  /** Sub-commands to invoke, in display order. */
  steps: Array<{
    cmd: string;
    /** What this step contributes to the final answer. */
    rationale: string;
  }>;
}

/**
 * Catalog of intent → flow mappings.
 *
 * Add new flows by appending to this list. Each flow is one "atomic
 * question a developer asks", expanded into the multi-step Mneme run that
 * actually answers it.
 */
const FLOWS: Flow[] = [
  {
    id: "security-audit",
    label: "Security audit",
    description:
      "Hunts for known vulnerability patterns + suspicious commits + leaked secrets across your entire history.",
    patterns: [
      // Use \w* so "vuln" matches "vulnerable", "vulnerabilities" too
      /\b(security|vuln\w*|cve|leak\w*|secret\w*|password\w*|credential\w*|token\w*|breach\w*|hack\w*|exploit\w*|insecure|insider[\s-]?threat)\b/i,
      /\bfind\s+(all\s+)?(bug|hole|issue|risk)s?\b/i,
      /\b(hunt|scan|search|look)\s+(for|all)\s+\w+/i,
    ],
    steps: [
      { cmd: "forensics vulns --top 200", rationale: "Scan history for 11 CWE-aligned vulnerability patterns." },
      { cmd: "forensics anomaly --threshold 1.0", rationale: "Detect commits that deviate from each author's normal pattern." },
    ],
  },
  {
    id: "health-check",
    label: "Codebase health check",
    description:
      "Snapshots overall repo health: index freshness, weakness diagnoses, drawdown periods, and current volatility.",
    patterns: [
      /\b(health|healthy|condition|state|wellness|wellbeing)\b/i,
      /\b(is\s+(the|my|our)\s+(codebase|repo|project)\s+(ok|okay|fine|good))\b/i,
      /\b(status\s+report|repo\s+(report|overview))\b/i,
    ],
    steps: [
      { cmd: "status", rationale: "Memory-layer health and config." },
      { cmd: "guardian --once", rationale: "Diagnose weaknesses + threats in the index." },
      { cmd: "drawdown", rationale: "Periods of pure firefighting (capacity drains)." },
      { cmd: "vix", rationale: "Implied volatility from commit-message tone." },
    ],
  },
  {
    id: "expert-finder",
    label: "Find the expert",
    description:
      "Identifies the bus-factor expert for a topic plus their coding fingerprint and the topic's full evolution.",
    patterns: [
      /\bwho\s+(knows|owns|is\s+the\s+expert|wrote\s+most|is\s+responsible)\b/i,
      /\b(bus[\s-]?factor|knowledge\s+silo|expert\s+for)\b/i,
    ],
    steps: [
      { cmd: "who-knows {topic}", rationale: "Rank candidates by recency × frequency × file footprint." },
      { cmd: "story {topic}", rationale: "Narrative of how this topic evolved across all relevant commits." },
    ],
  },
  {
    id: "blast-radius",
    label: "Blast-radius analysis",
    description:
      "Predicts what else might break if you change this commit, file, or function — pre-merge safety check.",
    patterns: [
      /\b(blast[\s-]?radius|impact|what\s+(will|would)\s+break|side\s+effect|ripple)\b/i,
      /\b(safe\s+to\s+(revert|rollback|change|merge))\b/i,
    ],
    steps: [
      { cmd: "blast {hash}", rationale: "Direct dependents of the target." },
      { cmd: "correlation-matrix --top 10", rationale: "Files that historically change together." },
    ],
  },
  {
    id: "decision-archaeology",
    label: "Decision archaeology",
    description:
      "Surfaces past architecture decisions + their rationale so you don't repeat old debates or undo intentional choices.",
    patterns: [
      /\b(decision|adr|architecture|why\s+did\s+we|design\s+choice|rationale)s?\b/i,
    ],
    steps: [
      { cmd: "decisions", rationale: "Auto-extracted ADR-style decisions from commit history." },
      { cmd: "ask {query}", rationale: "Synthesized answer with citations." },
    ],
  },
  {
    id: "newbie-onboarding",
    label: "Onboarding tour",
    description:
      "Quick tour of the codebase for a new contributor — top contributors, key decisions, and active areas.",
    patterns: [
      /\b(onboard|new\s+(member|hire|dev)|getting\s+started|tour|orient)/i,
      /\b(what\s+(does|is)\s+this\s+(repo|project|codebase))\b/i,
    ],
    steps: [
      { cmd: "constellation", rationale: "Module map of the codebase." },
      { cmd: "decisions", rationale: "Key architectural decisions over time." },
      { cmd: "who-knows {topic}", rationale: "Bus-factor experts for each major area." },
    ],
  },
  {
    id: "release-readiness",
    label: "Release readiness",
    description:
      "Should you ship right now? Combines anomaly check, recent vuln scan, drawdown trend, and guardian diagnose.",
    patterns: [
      /\b(should|can|may)\s+(i|we|you)\s+(ship|release|deploy|merge|push)\b/i,
      /\b(release[\s-]?ready|ship[\s-]?ready|merge[\s-]?ready|deploy[\s-]?ready)\b/i,
    ],
    steps: [
      { cmd: "guardian --once", rationale: "Index + threat diagnose." },
      { cmd: "forensics anomaly --threshold 1.5", rationale: "Suspicious commits in current branch." },
      { cmd: "forensics vulns --since 30.days.ago", rationale: "New vulnerabilities introduced this month." },
    ],
  },
];

/** Try to extract a {topic} or {hash} parameter from the query. */
function extractParam(query: string, kind: "topic" | "hash"): string {
  if (kind === "hash") {
    const m = query.match(/\b([a-f0-9]{7,40})\b/);
    return m?.[1] ?? "HEAD";
  }
  // topic = remaining nouny words after stripping the verb-pattern
  const cleaned = query
    .replace(/\b(find|who|knows|about|expert|for|on|the|history|of|in|our|my)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "code";
}

function classify(query: string): Flow | null {
  for (const flow of FLOWS) {
    if (flow.patterns.some((p) => p.test(query))) return flow;
  }
  return null;
}

/** Substitute {topic} / {hash} / {query} placeholders in a step's cmd. */
function expandStep(cmd: string, query: string): string {
  return cmd
    .replace(/\{topic\}/g, () => `"${extractParam(query, "topic")}"`)
    .replace(/\{hash\}/g, () => extractParam(query, "hash"))
    .replace(/\{query\}/g, () => `"${query}"`);
}

export async function doCommand(opts: DoOptions): Promise<number> {
  const flow = classify(opts.query);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        flow
          ? {
              query: opts.query,
              flow: {
                id: flow.id,
                label: flow.label,
                description: flow.description,
                steps: flow.steps.map((s) => ({ cmd: expandStep(s.cmd, opts.query), rationale: s.rationale })),
              },
            }
          : { query: opts.query, flow: null, hint: "no matching flow — use a more specific phrase" },
        null,
        2,
      ) + "\n",
    );
    return flow ? 0 : 1;
  }

  ui.banner();

  if (!flow) {
    process.stdout.write(
      header(
        "🤔",
        `do — smart dispatcher`,
        `query: ${kleur.italic(opts.query)}`,
        `Tell Mneme what you want in plain English. It picks the right tools and runs them for you.`,
      ) + "\n\n",
    );
    process.stdout.write(emptyState(`No matching flow for: "${opts.query}"`, [
      "Try one of these phrasings (each runs multiple commands automatically):",
      ``,
      `  • "find security issues"           → vulns + anomaly`,
      `  • "is the codebase healthy"        → status + guardian + drawdown + vix`,
      `  • "who knows about auth"           → who-knows + story`,
      `  • "blast radius of <hash>"         → blast + correlation-matrix`,
      `  • "what decisions did we make"     → decisions + ask`,
      `  • "onboarding tour"                → constellation + decisions + who-knows`,
      `  • "should we ship today"           → guardian + anomaly + recent vulns`,
    ]));
    return 1;
  }

  // ── Iris pillar #2: AI-summarized headline. Always finishes (extractive
  // fallback if no LLM is configured). Hard 800ms ceiling.
  const expandedSteps = flow.steps.map((s) => ({
    cmd: expandStep(s.cmd, opts.query),
    rationale: s.rationale,
  }));
  const headline = await generateHeadline({
    commandType: "do",
    data: {
      action: flow.label,
      query: opts.query,
      flowId: flow.id,
      stepCount: flow.steps.length,
      result: `${flow.steps.length} step${flow.steps.length === 1 ? "" : "s"} planned`,
    },
    timeoutMs: 800,
    repoRoot: opts.cwd,
  });

  // ── Build the upfront pyramid: lede (what + why), key-facts (the plan),
  // sources (alternative phrasings the user can try later).
  const ledeLines: string[] = [
    `  ${kleur.gray("query:")} ${kleur.italic(opts.query)}`,
    `  ${kleur.gray("flow:")}  ${kleur.bold(flow.id)} — ${flow.label}`,
    "",
    `    ${flow.description}`,
  ];
  const planLines: string[] = [];
  for (let i = 0; i < expandedSteps.length; i++) {
    const s = expandedSteps[i]!;
    planLines.push(`    ${pill(`step ${i + 1}`, "low")}  ${kleur.cyan(`mneme ${s.cmd}`)}`);
    planLines.push(`           ${kleur.gray(s.rationale)}`);
  }
  const upfrontSections: PyramidSection[] = [
    { tier: "lede", title: "🧠 Plan", lines: ledeLines },
    {
      tier: "key-facts",
      title: `◆ Steps  ${kleur.gray(`(${flow.steps.length})`)}`,
      lines: planLines,
    },
  ];
  process.stdout.write(
    iris.render({
      headline,
      sections: upfrontSections,
      whyShown: `Routed to "${flow.id}" because the query matched ${flow.label.toLowerCase()} patterns`,
    }),
  );
  process.stdout.write("\n\n");

  // Execution: spawn each as a child process — keeps the engines independent
  // and respects flag validation at each layer. We could short-circuit by
  // calling the engine functions directly, but spawning preserves the exact
  // user-facing rendering (including pre-flight verify, fallback, etc.).
  const { spawn } = await import("node:child_process");
  const cliPath = (await import("node:url")).fileURLToPath(
    new URL("../../bin/mneme.js", import.meta.url),
  );

  process.stdout.write(section(`▶ Executing`, `live output below`) + "\n\n");

  const stepStatuses: Array<{ cmd: string; ok: boolean }> = [];
  for (let i = 0; i < flow.steps.length; i++) {
    const s = flow.steps[i]!;
    const rendered = expandStep(s.cmd, opts.query);
    const args = rendered.split(/\s+/).filter(Boolean);
    process.stdout.write(`  ${kleur.gray("─".repeat(64))}\n`);
    process.stdout.write(`  ${kleur.bold().magenta(`Step ${i + 1}/${flow.steps.length}:`)} ${kleur.cyan(`mneme ${rendered}`)}\n`);
    process.stdout.write(`  ${kleur.gray("─".repeat(64))}\n\n`);

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn("node", [cliPath, ...args], {
        cwd: opts.cwd,
        stdio: "inherit",
      });
      proc.on("exit", (code) => resolve(typeof code === "number" ? code : 0));
      proc.on("error", () => resolve(1));
    });
    stepStatuses.push({ cmd: rendered, ok: exitCode === 0 });
  }

  // ── Iris roll-up: lede flash + key-facts (per-step verdict) + sources.
  const okCount = stepStatuses.filter((s) => s.ok).length;
  const flashLines = flash({
    type: "verdict",
    data: {
      headline: `${flow.label} complete`,
      severity: okCount === stepStatuses.length ? "ok" : "warn",
      next: `Read each section above; re-run any step solo if you want detail`,
    },
  });
  const stepLines: string[] = [];
  for (const s of stepStatuses) {
    const mark = s.ok ? kleur.green("✓") : kleur.red("✗");
    stepLines.push(`    ${mark}  ${kleur.cyan(`mneme ${s.cmd}`)}`);
  }
  const synthSections: PyramidSection[] = [
    {
      tier: "lede",
      title: "✦ Synthesis",
      lines: flashLines.map((l) => `    ${l}`),
    },
    {
      tier: "key-facts",
      title: `◆ Steps run  ${kleur.gray(`(${okCount}/${stepStatuses.length} ok)`)}`,
      lines: stepLines,
    },
    {
      tier: "sources",
      title: "→ Try next",
      lines: [
        `    ${kleur.cyan("$")} ${kleur.bold('mneme do "<another question>"')}`,
        `      ${kleur.gray('Try "blast radius of <hash>" or "should we ship today".')}`,
      ],
    },
  ];
  process.stdout.write(
    iris.render({
      headline: `${flow.label} — ${okCount}/${stepStatuses.length} steps ok`,
      sections: synthSections,
    }),
  );
  process.stdout.write("\n");

  // Iris pillar #4: adaptive verbosity — record this run.
  try {
    recordCommandRun(opts.cwd, "do");
  } catch {
    // best-effort
  }

  return 0;
}

/** Exposed for tests so we can assert routing without spawning subprocesses. */
export const __INTERNALS = { FLOWS, classify, expandStep, extractParam };

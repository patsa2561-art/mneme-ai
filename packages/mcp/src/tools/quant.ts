/**
 * Quant — engineering analysis BORROWED from Wall Street, not Wall-Street
 * jargon hidden behind cute names. Every quant tool ships a `jargon`
 * dictionary that translates the finance term inline so a cold-start AI
 * agent (or a human who never traded a stock) can understand the result
 * without leaving the response.
 *
 * The 10 quant tools were the lowest-scoring on the v1.17 lint pass —
 * v1.18 promotes them to FULL contract: WHEN, OUTPUT, EXAMPLES,
 * PITFALLS, COMPOSE_WITH, JARGON. They now score ≥80/100 in
 * `mneme.tool.lint`.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool, ToolExample } from "./_types.js";

interface QuantContract {
  name: string;
  description: string;
  triggers: string[];
  cli: string;
  whenToUse: string;
  jargon: Record<string, string>;
  examples: ToolExample[];
  pitfalls: string[];
  composeWith?: string[];
  argMap?: (a: Record<string, unknown>) => string[];
  inputSchema?: MnemeTool["inputSchema"];
  outputSchema?: MnemeTool["outputSchema"];
  followUp?: string[];
  wisdom?: (d: unknown) => string;
}

const quant = (c: QuantContract): MnemeTool => ({
  name: c.name,
  category: "quant",
  description: c.description,
  whenToUse: c.whenToUse,
  triggers: c.triggers,
  inputSchema: c.inputSchema ?? { type: "object", properties: {} },
  outputSchema: c.outputSchema ?? {
    type: "object",
    properties: {
      result: { type: "object", description: "CLI passthrough — see the named CLI command for the exact shape." },
    },
  },
  examples: c.examples,
  pitfalls: c.pitfalls,
  composeWith: c.composeWith,
  jargon: c.jargon,
  handler: passthroughHandler(c.cli, c.argMap ?? (() => []), {
    wisdom: c.wisdom ?? (() => "Result returned — summarize key fields for the user."),
    followUp: c.followUp ?? [],
    confidence: "medium",
  }),
});

export const quantTools: MnemeTool[] = [
  quant({
    name: "mneme.quant.drawdown",
    description:
      "Find the worst losing streaks in the repo's history — periods when the team " +
      "spent more time fixing regressions than shipping features. Returns the " +
      "deepest valleys (most consecutive 'putting-out-fires' commits) with start/end " +
      "dates and what the team was firefighting. Use WHEN the user asks 'when were " +
      "our worst weeks?' or wants to understand historical incident clusters.",
    whenToUse:
      "User wants to identify historical periods of pure firefighting / regression-fixing — useful for postmortems and capacity planning.",
    triggers: ["worst weeks of firefighting", "drawdown", "when were we firefighting"],
    cli: "drawdown",
    jargon: {
      drawdown:
        "Borrowed from finance — the size of the largest peak-to-valley drop in a portfolio. Here: the longest stretch of pure remediation work between two productive peaks.",
    },
    examples: [
      {
        userQuery: "When were our worst firefighting weeks?",
        expectedOutput:
          "Returns the top 3-5 drawdown periods with: startDate, endDate, durationDays, dominantTopic (e.g., 'auth bugs'), and recoveredAt commit hash.",
      },
    ],
    pitfalls: [
      "Heuristic: depends on commit-message tone (revert/hotfix/fix words). A team that always says 'patch' or 'tweak' will be under-counted.",
      "Doesn't account for incident severity — a 1-day P0 firedrill won't show up if commit count is small.",
    ],
    composeWith: ["mneme.insights.regret", "mneme.insights.premortem"],
  }),
  quant({
    name: "mneme.quant.alpha",
    description:
      "Per-author 'alpha' score — risk-adjusted impact-per-unit-effort. Measures " +
      "which contributors deliver disproportionate value relative to commit count " +
      "(e.g., a small fix that prevents a class of regressions counts MORE than 1000 " +
      "lines of routine refactor). Use WHEN the user asks 'who delivers the most " +
      "leverage?' or wants to challenge a 'most LOC = best engineer' assumption.",
    whenToUse:
      "User wants to identify high-leverage contributors who deliver outsized impact relative to commit volume.",
    triggers: ["who delivers alpha", "Kelly allocation", "high-leverage contributors"],
    cli: "alpha",
    jargon: {
      alpha:
        "Wall Street: returns earned ABOVE the market baseline — i.e., skill, not just exposure. Here: an author's impact relative to what their commit volume alone would predict.",
      "Kelly criterion":
        "A betting formula that sizes positions optimally given win probability + payoff. We use it to allocate 'effort budget' across tech-debt items based on each item's regret-history-derived expected payoff.",
    },
    examples: [
      {
        userQuery: "Who on the team delivers the most leverage per commit?",
        args: { items: ".mneme/tech-debt.json" },
        expectedOutput:
          "Returns each author with alpha (real impact - commit-count baseline), risk-adjusted alpha (alpha / volatility), and rank.",
      },
    ],
    pitfalls: [
      "Requires `items` (a JSON of tech-debt scope items) for the Kelly allocation portion — alpha-per-author works without it.",
      "Doesn't capture invisible work (mentoring, code review, design docs) — those don't show up in commits.",
    ],
    composeWith: ["mneme.people.influence", "mneme.quant.moneyball"],
    argMap: (a) => (a["items"] ? ["--items", String(a["items"])] : []),
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "string",
          description: "Optional JSON file path with tech-debt scope items for Kelly-criterion allocation.",
        },
      },
    },
  }),
  quant({
    name: "mneme.quant.backtest",
    description:
      "Validate any binary predictor (e.g., 'commits with > 5 reverts ⇒ regression') " +
      "against historical outcomes. Returns precision / recall / F1 / Brier score / " +
      "calibration curve so you can tell whether a heuristic actually predicts what " +
      "it claims, or just pattern-matches noise. Use WHEN the user wants to validate " +
      "a metric or rule before depending on it in CI.",
    whenToUse:
      "User has a 'commits with property X tend to be problematic' hypothesis and wants to test it against the repo's actual outcomes.",
    triggers: ["backtest this metric", "validate predictor", "does this rule actually work"],
    cli: "backtest",
    jargon: {
      backtest:
        "Trading-system validation: replay a strategy through historical data to see how it would have performed. Here: replay a heuristic through past commits to measure its accuracy.",
      "Brier score":
        "A calibration metric for probabilistic predictions — measures how close 0.7 confidence is to actually being right 70% of the time. Lower is better.",
    },
    examples: [
      {
        userQuery: "Does the 'files touching auth + payments in same commit ⇒ risky' rule actually work?",
        args: { samples: ".mneme/predictor-samples.json" },
        expectedOutput:
          "Returns precision, recall, F1, Brier score, and a confusion matrix on historical labeled commits.",
      },
    ],
    pitfalls: [
      "Garbage-in, garbage-out — your samples file must label historical outcomes correctly, otherwise the score reflects label noise.",
      "Doesn't extrapolate — a predictor that worked on the last 6 months may not work on the next 6 months.",
    ],
    composeWith: ["mneme.insights.premortem", "mneme.audit.conscience"],
    argMap: (a) => (a["samples"] ? ["--samples", String(a["samples"])] : []),
    inputSchema: {
      type: "object",
      properties: {
        samples: {
          type: "string",
          description: "JSON file path with labeled historical samples (predicted vs actual).",
        },
      },
    },
  }),
  quant({
    name: "mneme.quant.black_swan",
    description:
      "Tail-risk scan — identify rare-but-catastrophic patterns in the repo " +
      "(e.g., a single file that, when broken, has historically caused 10× the " +
      "incident response of any other). Returns files ranked by tail-risk weight " +
      "(probability × impact). Use WHEN the user asks 'what could blow up?' or " +
      "wants the inverse-of-routine risk view.",
    whenToUse:
      "User wants to find rare but catastrophic risk hotspots — files / areas where past failures had outsized blast radius.",
    triggers: ["tail risks", "black swan candidates", "what could blow up"],
    cli: "black-swan",
    jargon: {
      "black swan":
        "Nassim Taleb's term for a rare event that's nearly impossible to predict but has massive impact. Here: a file/area whose past failures had blast radius far above the median.",
      "tail risk":
        "Risk concentrated in the unlikely-but-extreme outcomes (the 'tails' of a distribution), as opposed to the common-case middle.",
    },
    examples: [
      {
        userQuery: "What files in our repo are most likely to cause a major incident if they break?",
        expectedOutput:
          "Top 5-10 files ranked by tail-risk score: each with past-incident count, average blast radius (files affected per incident), and recovery time.",
      },
    ],
    pitfalls: [
      "Past behavior ≠ future risk. A new feature module won't appear in tail-risk results no matter how risky it actually is.",
      "Bias toward old, frequently-touched files — newly-rewritten modules look 'safe' until they aren't.",
    ],
    composeWith: ["mneme.audit.conscience", "mneme.insights.premortem"],
  }),
  quant({
    name: "mneme.quant.insider_trading",
    description:
      "Detect authors who repeatedly fix bugs they introduced themselves — the " +
      "'creating their own work' anti-pattern. Returns each author with: bugs " +
      "introduced, bugs they personally fixed, and the ratio (high = self-correcting, " +
      "very high = possibly intentional churn). Use WHEN the user asks about " +
      "engineering quality or wants to flag busy-but-not-productive contributors.",
    whenToUse:
      "User wants to identify authors with a high self-introduced-bug-fix ratio (often a sign of rushed shipping or unclear specs).",
    triggers: ["who fixes their own bugs", "insider patterns", "self-correcting commits"],
    cli: "insider-trading",
    jargon: {
      "insider trading":
        "Wall Street: profiting from non-public knowledge of one's own actions. Here (re-purposed metaphor): an author 'profits' from their own future bugs by fixing what they introduced — busy work that LOOKS productive.",
    },
    examples: [
      {
        userQuery: "Is anyone on the team mostly fixing bugs they introduced?",
        expectedOutput:
          "Returns each author with: bugsIntroduced, bugsFixed, selfFixRatio (selfBugsFixed / bugsIntroduced), and recentExamples (commit pairs).",
      },
    ],
    pitfalls: [
      "A high ratio isn't always bad — senior engineers fix their own subtle bugs faster than junior ones could. Read in context.",
      "Depends on linking 'introduce' commit ↔ 'fix' commit, which uses heuristic overlap (file + nearby lines + temporal proximity). False positives possible.",
    ],
    composeWith: ["mneme.people.atrophy", "mneme.insights.regret"],
  }),
  quant({
    name: "mneme.quant.moneyball",
    description:
      "Surface undervalued contributors — high impact, low LOC volume. The opposite " +
      "of LOC-counting culture: returns engineers whose small surgical changes prevent " +
      "regressions, fix root causes, or improve architecture per-commit far more than " +
      "the team median. Use WHEN the user asks 'who is undervalued?' or wants " +
      "promotion / retention candidates not visible in commit volume.",
    whenToUse:
      "User wants to identify low-LOC, high-impact contributors hidden by volume-based metrics — promotion / retention signal.",
    triggers: ["undervalued contributors", "moneyball", "high impact low LOC"],
    cli: "moneyball",
    jargon: {
      moneyball:
        "From Michael Lewis's book about the Oakland A's baseball team finding undervalued players via stats nobody else looked at. Here: finding engineers whose value isn't captured by LOC or commit count.",
    },
    examples: [
      {
        userQuery: "Who on the team delivers the most value but writes the fewest lines?",
        args: { topN: 5 },
        expectedOutput:
          "Returns top-5 'moneyball' authors with: impactScore, locTotal, impactPerLoc ratio, signature contributions (commit hashes).",
      },
    ],
    pitfalls: [
      "Impact is heuristic — derived from regret avoidance, file criticality, and commit reach. Not the ground truth on engineering value.",
      "Underweights work that's high-volume by necessity (e.g., test infrastructure, refactors).",
    ],
    composeWith: ["mneme.people.influence", "mneme.quant.alpha"],
    argMap: (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    inputSchema: { type: "object", properties: { topN: { type: "number", description: "How many candidates to return. Default 10." } } },
  }),
  quant({
    name: "mneme.quant.greek",
    description:
      "Codebase 'Greeks' (Δ delta, Γ gamma, Θ theta) — sensitivity analysis across " +
      "files. Δ = how much each file 'moves' (changes) per unit time. Γ = how the " +
      "rate of change is changing (acceleration). Θ = decay — how fast knowledge " +
      "ages out. Use WHEN the user wants to understand WHICH parts of the codebase " +
      "are stable, accelerating, or atrophying.",
    whenToUse:
      "User wants per-file sensitivity metrics: which files are changing fast, accelerating, or atrophying.",
    triggers: ["sensitivity Greeks", "Δ Γ Θ", "which files are changing fast"],
    cli: "greek",
    jargon: {
      delta:
        "Options trading: Δ = how much an option's price moves per $1 move in the underlying. Here: how much a file changes per unit time (commits/week or LOC/week).",
      gamma:
        "Options trading: Γ = the RATE at which Δ changes — second-derivative sensitivity. Here: file-change acceleration. Positive Γ = a file getting noisier; negative Γ = settling down.",
      theta:
        "Options trading: Θ = time-decay — how much value an option loses per day, all else equal. Here: knowledge atrophy — how fast a file's expertise ages out (Ebbinghaus curve).",
    },
    examples: [
      {
        userQuery: "Which files are changing fastest right now and which are atrophying?",
        expectedOutput:
          "Returns per-file: delta (commits/week), gamma (acceleration), theta (knowledge half-life in weeks). Sortable by any.",
      },
    ],
    pitfalls: [
      "Greeks are MOMENTUM indicators — they tell you direction, not whether the change is good or bad.",
      "Theta uses a default 90-day half-life; configurable per repo via .mneme/config.",
    ],
    composeWith: ["mneme.people.atrophy", "mneme.quant.implied_volatility"],
  }),
  quant({
    name: "mneme.quant.correlation_matrix",
    description:
      "Find hidden BEHAVIORAL coupling between files — pairs that tend to change " +
      "together even though they have no static dependency (no import, no shared " +
      "type). Returns a ranked list of file pairs with co-change frequency + " +
      "correlation strength. Use WHEN the user wants to find architectural debt " +
      "static analysis can't see.",
    whenToUse:
      "User wants to find file pairs that move together in commits despite having no compile-time dependency — hidden coupling.",
    triggers: ["files that change together", "behavioral coupling", "hidden dependencies"],
    cli: "correlation-matrix",
    jargon: {
      "correlation matrix":
        "Statistics: a table of pairwise correlations between variables. Here: between files, where 'observation' = 'commit'. High correlation between files A and B = they tend to change in the same commit.",
    },
    examples: [
      {
        userQuery: "Which files in our repo always seem to change together?",
        expectedOutput:
          "Top file pairs by correlation: { fileA, fileB, coChangeCount, correlation (0-1), staticallyDependent: boolean }.",
      },
    ],
    pitfalls: [
      "Correlation isn't causation — two files may co-change because of a 3rd file (e.g., they both depend on a shared schema).",
      "Sensitive to commit granularity — repos that batch many concerns per commit will have inflated correlations.",
    ],
    composeWith: ["mneme.insights.cluster", "mneme.insights.network"],
  }),
  quant({
    name: "mneme.quant.implied_volatility",
    description:
      "Estimate project chaos from commit-message TONE (urgency words, frustration " +
      "words, 'temp / hack / fixme' frequency). Returns a daily volatility series — " +
      "high = stressful periods (firefighting / deadline crunch), low = calm flow. " +
      "Use WHEN the user wants a leading indicator of team stress that doesn't " +
      "depend on incident reports.",
    whenToUse:
      "User wants a tone-derived stress signal independent of incident tickets — daily volatility from commit messages.",
    triggers: ["chaos from commit tone", "implied volatility", "team stress signal"],
    cli: "implied-volatility",
    jargon: {
      "implied volatility":
        "Options trading: market's forward-looking estimate of how much a price will move, derived from option prices. Here: forward-looking chaos estimate derived from how the team is TALKING in commits, not what they're shipping.",
    },
    examples: [
      {
        userQuery: "When was our team most stressed based on how we wrote commits?",
        expectedOutput:
          "Returns a daily series: { date, volatility (0-1), topUrgencyWords, sampleCommitSubject } with peaks and rolling 7-day average.",
      },
    ],
    pitfalls: [
      "Tone-based — sarcasm, dry humor, and culture-specific phrasing can fool it.",
      "Lags the actual stressful event by 1-3 days (people commit AFTER firefighting, not during).",
    ],
    composeWith: ["mneme.quant.drawdown", "mneme.quality.heartbeat"],
  }),
  quant({
    name: "mneme.quant.tax_loss_harvest",
    description:
      "Surface dead-code candidates — code that hasn't been touched in N months, " +
      "is reachable but never imported, or whose tests don't actually exercise it. " +
      "Returns deletion candidates ranked by 'safe-to-delete' confidence + " +
      "estimated LOC savings. Use WHEN the user asks 'what can we delete?' or " +
      "wants to offset technical debt by removing surface area.",
    whenToUse:
      "User wants concrete dead-code deletion candidates with safety ratings — to reduce surface area / pay down debt.",
    triggers: ["what can we delete", "dead code candidates", "tax loss harvest"],
    cli: "tax-loss-harvest",
    jargon: {
      "tax loss harvesting":
        "Investing: deliberately selling losing positions to offset capital gains tax. Here (re-purposed): deliberately deleting dead/legacy code to offset 'cognitive tax' of carrying it.",
    },
    examples: [
      {
        userQuery: "What chunks of our codebase can we safely delete?",
        expectedOutput:
          "Top deletion candidates: { path, lastTouched, importedBy, testedBy, safeDeleteScore (0-1), locSaved }.",
      },
    ],
    pitfalls: [
      "'Reachable but never imported' is heuristic — dynamic imports, plugin systems, and runtime reflection can fool it.",
      "Always run the test suite + grep for path strings before deleting; the safeDeleteScore is a recommendation, not a guarantee.",
    ],
    composeWith: ["mneme.insights.fossil", "mneme.insights.runaway"],
  }),
];

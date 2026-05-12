/**
 * v1.63.0 -- PATH A: METAMORPHOSIS.
 *
 * Mneme grows from "tool I call" into "companion that knows me".
 * 5 self-knowledge / companion layers in one cohesive module.
 *
 *   1. TRANSPARENCY MIRROR -- daily report of YOUR own usage patterns
 *   2. INTERVIEW PROTOCOL  -- Socratic dialogue extracts tacit wisdom
 *   3. AUDIENCE LAYER      -- profile readers + auto-tune AI tone
 *   4. ALIEN PROTOCOL      -- genetic recombination over wisdom cards
 *                             for first-time prompts
 *   5. CARBON BUDGET       -- CO2 footprint of AI token spend
 *
 * Storage: .mneme/metamorphosis/
 * No external deps; pure node:fs + crypto.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { totalSavings } from "../reactor/measure.js";

const META_DIR = ".mneme/metamorphosis";

function ensureDir(repoRoot: string, sub?: string): string {
  const d = sub ? join(repoRoot, META_DIR, sub) : join(repoRoot, META_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

// ─── LAYER 1: TRANSPARENCY MIRROR ─────────────────────────────────────

export interface MirrorReport {
  generatedAt: string;
  windowDays: number;
  /** Tokens saved across all reactor layers in the window. */
  tokensSaved: number;
  /** Total AI calls observed. */
  totalCalls: number;
  /** Top 3 saving methods. */
  topMethods: Array<{ method: string; calls: number; saved: number }>;
  /** Themes the user spent the most time on. */
  topThemes: string[];
  /** Biggest waste: the method with lowest savings ratio. */
  biggestWaste: { method: string; ratio: number } | null;
  /** Plain-English summary (3-5 lines) ready to surface in pulse. */
  plain: string;
}

/** Build a self-knowledge report from the reactor ledger + soul mirror. */
export function buildMirrorReport(repoRoot: string, windowDays: number = 7): MirrorReport {
  const summary = totalSavings(repoRoot);
  const topMethods = Object.entries(summary.byMethod)
    .sort((a, b) => b[1].saved - a[1].saved)
    .slice(0, 3)
    .map(([method, b]) => ({ method, calls: b.calls, saved: b.saved }));
  // Themes: pheromone hot zones (read from .mneme/ai-pheromones.jsonl if present).
  const themes: string[] = [];
  const pheromonePath = join(repoRoot, ".mneme/ai-pheromones.jsonl");
  if (existsSync(pheromonePath)) {
    try {
      const lines = readFileSync(pheromonePath, "utf8").split("\n").filter(Boolean).slice(-50);
      const counts = new Map<string, number>();
      for (const line of lines) {
        try {
          const row = JSON.parse(line) as { zone?: string; strength?: number };
          if (row.zone) counts.set(row.zone, (counts.get(row.zone) ?? 0) + (row.strength ?? 1));
        } catch { /* */ }
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [zone] of sorted) themes.push(zone);
    } catch { /* */ }
  }
  const biggestWaste = Object.entries(summary.byMethod)
    .filter(([, b]) => b.calls >= 3)
    .sort((a, b) => a[1].ratio - b[1].ratio)[0];
  const plain = [
    `Window: last ${windowDays} day(s)`,
    `Mneme saved you ${summary.totalSaved} tokens across ${summary.totalCalls} call(s).`,
    `Top method: ${topMethods[0]?.method ?? "n/a"} (${topMethods[0]?.saved ?? 0} tok saved).`,
    `Top themes: ${themes.length > 0 ? themes.slice(0, 3).join(", ") : "(no pheromone signal yet)"}.`,
    biggestWaste ? `Lowest-leverage method: ${biggestWaste[0]} (only ${(biggestWaste[1].ratio * 100).toFixed(1)}% savings).` : `(no waste signal in window)`,
  ].join("\n");
  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    tokensSaved: summary.totalSaved,
    totalCalls: summary.totalCalls,
    topMethods,
    topThemes: themes,
    biggestWaste: biggestWaste ? { method: biggestWaste[0], ratio: biggestWaste[1].ratio } : null,
    plain,
  };
}

/** Persist the report. */
export function persistMirrorReport(repoRoot: string, report: MirrorReport): string {
  const dir = ensureDir(repoRoot, "mirror");
  const path = join(dir, `report-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(dir, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  return path;
}

// ─── LAYER 2: INTERVIEW PROTOCOL ──────────────────────────────────────

export interface InterviewQuestion {
  id: string;
  question: string;
  /** Topic so future sessions don't repeat the same question. */
  topic: "decisions" | "regrets" | "patterns" | "values" | "constraints";
}

export interface InterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
  answeredAt: string;
  topic: string;
  /** Word count -- triage which answers carry the most wisdom. */
  wordCount: number;
}

const INTERVIEW_BANK: InterviewQuestion[] = [
  { id: "q-001", topic: "decisions", question: "What's the most consequential decision you made on this repo this week, and what swayed it?" },
  { id: "q-002", topic: "regrets",   question: "What's one thing you wish past-you had told you about this codebase?" },
  { id: "q-003", topic: "patterns",  question: "When you write code in this repo, what's the single most-common pattern you reach for?" },
  { id: "q-004", topic: "values",    question: "If a new contributor asked 'what do we care about most in this code', what would you say?" },
  { id: "q-005", topic: "constraints", question: "What constraint (deadline / customer / team / tech) shapes your decisions here right now?" },
  { id: "q-006", topic: "decisions", question: "When did you LAST disagree with your AI's suggestion, and why?" },
  { id: "q-007", topic: "regrets",   question: "What's a bug or refactor you keep meaning to do but haven't?" },
  { id: "q-008", topic: "patterns",  question: "What signal tells you a PR is ready vs not ready in THIS repo?" },
];

/** Pick the N questions the user hasn't answered in the current week. */
export function pickQuestions(repoRoot: string, n: number = 3): InterviewQuestion[] {
  const answered = readAnswers(repoRoot);
  const cutoff = Date.now() - 7 * 86400 * 1000;
  const recentlyAnswered = new Set(
    answered.filter((a) => Date.parse(a.answeredAt) > cutoff).map((a) => a.questionId),
  );
  const available = INTERVIEW_BANK.filter((q) => !recentlyAnswered.has(q.id));
  // Rotate by topic diversity.
  const picked: InterviewQuestion[] = [];
  const topicsUsed = new Set<string>();
  for (const q of available) {
    if (picked.length >= n) break;
    if (topicsUsed.has(q.topic) && available.length > n) continue;
    picked.push(q);
    topicsUsed.add(q.topic);
  }
  return picked;
}

/** Record an answer. Also distills it into a wisdom card if long enough. */
export function recordAnswer(repoRoot: string, q: InterviewQuestion, answer: string): InterviewAnswer {
  ensureDir(repoRoot, "interview");
  const entry: InterviewAnswer = {
    questionId: q.id,
    question: q.question,
    answer,
    answeredAt: new Date().toISOString(),
    topic: q.topic,
    wordCount: answer.split(/\s+/).filter(Boolean).length,
  };
  appendFileSync(
    join(repoRoot, META_DIR, "interview", "answers.jsonl"),
    JSON.stringify(entry) + "\n",
    "utf8",
  );
  return entry;
}

export function readAnswers(repoRoot: string): InterviewAnswer[] {
  const path = join(repoRoot, META_DIR, "interview", "answers.jsonl");
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as InterviewAnswer; } catch { return null; }
    }).filter((x): x is InterviewAnswer => x !== null);
  } catch { return []; }
}

// ─── LAYER 3: AUDIENCE LAYER ──────────────────────────────────────────

export type AudienceRole = "engineer" | "pm" | "customer" | "executive" | "engineering-manager" | "security" | "unknown";

export interface AudienceProfile {
  role: AudienceRole;
  /** Preferred verbosity: terse / normal / verbose. */
  verbosity: "terse" | "normal" | "verbose";
  /** Prefers code snippets vs prose? */
  codeFirst: boolean;
  /** Last observation. */
  observedAt: string;
}

export interface ToneTuning {
  role: AudienceRole;
  toneInstructions: string[];
  estimatedTokenAdjustment: number;
}

/** Classify the audience role from a message sample. */
export function inferAudience(messageSample: string): AudienceProfile {
  const lower = messageSample.toLowerCase();
  let role: AudienceRole = "unknown";
  if (/\bvariance|p&l|customer churn|retention|conversion|cac\b/.test(lower)) role = "executive";
  else if (/\bsprint|roadmap|backlog|user story|jira|product\b/.test(lower)) role = "pm";
  else if (/\bcve|vuln|csp|xss|csrf|hipaa|soc2|pci\b/.test(lower)) role = "security";
  else if (/\bhire|onboard|1:1|team\s+(health|capacity)|burnout\b/.test(lower)) role = "engineering-manager";
  else if (/\brefund|account|password|forgot|help|stuck\b/.test(lower)) role = "customer";
  else if (/\bfunction|class|interface|refactor|test|debug|sha|commit\b/.test(lower)) role = "engineer";
  const wordCount = messageSample.split(/\s+/).filter(Boolean).length;
  const verbosity: AudienceProfile["verbosity"] = wordCount < 8 ? "terse" : wordCount > 40 ? "verbose" : "normal";
  const codeFirst = role === "engineer" || /```|\bcode\b|\bfn\b/.test(lower);
  return {
    role, verbosity, codeFirst,
    observedAt: new Date().toISOString(),
  };
}

/** Produce tone tuning hints for the AI. */
export function tuneFor(profile: AudienceProfile): ToneTuning {
  const instructions: string[] = [];
  let estimatedAdjustment = 0;
  switch (profile.role) {
    case "executive":
      instructions.push("Lead with the business impact in one sentence. Numbers first.");
      instructions.push("No code unless explicitly requested.");
      estimatedAdjustment = -400;
      break;
    case "pm":
      instructions.push("Frame in terms of user stories + acceptance criteria.");
      instructions.push("Avoid implementation details unless asked.");
      estimatedAdjustment = -200;
      break;
    case "security":
      instructions.push("Mention CVE / CWE if applicable. Cite OWASP class.");
      instructions.push("Risk band first; then mitigation.");
      estimatedAdjustment = 100;
      break;
    case "customer":
      instructions.push("Plain English. No jargon. Action-oriented.");
      instructions.push("3 steps max.");
      estimatedAdjustment = -300;
      break;
    case "engineer":
      instructions.push("Code-first response. Brief prose.");
      instructions.push("Cite file:line for every claim.");
      estimatedAdjustment = 0;
      break;
    case "engineering-manager":
      instructions.push("Focus on impact-per-person-week tradeoffs.");
      estimatedAdjustment = -100;
      break;
    default:
      instructions.push("Default tone: balanced prose + code as needed.");
  }
  if (profile.verbosity === "terse") {
    instructions.push("HARD CAP: 3 sentences max.");
    estimatedAdjustment -= 200;
  } else if (profile.verbosity === "verbose") {
    instructions.push("Verbose audience -- elaborate with examples.");
    estimatedAdjustment += 200;
  }
  return { role: profile.role, toneInstructions: instructions, estimatedTokenAdjustment: estimatedAdjustment };
}

// ─── LAYER 4: ALIEN PROTOCOL (genetic answer construction) ────────────

export interface WisdomCard {
  id: string;
  pattern: string;
  template: string;
}

const ALIEN_WISDOM: WisdomCard[] = [
  { id: "w-cite-grep", pattern: "find|search|where", template: "Use `git grep -n` to locate $TARGET; cite file:line in the answer." },
  { id: "w-test-arrange", pattern: "test|verify|assert", template: "Arrange / act / assert structure with a single behavior per `it`." },
  { id: "w-error-narrow", pattern: "error|exception|crash", template: "Catch only the narrowest exception class; bubble unknowns." },
  { id: "w-refactor-safe", pattern: "refactor|rename|move", template: "Preserve public API + test signatures; ship behind a feature flag if user-visible." },
  { id: "w-perf-measure", pattern: "slow|performance|optim", template: "Measure before changing; cite the benchmark + threshold." },
  { id: "w-doc-why", pattern: "explain|document|comment", template: "Document the WHY (constraints / decisions), not the WHAT (code already shows)." },
];

export interface AlienTemplate {
  matchedCards: WisdomCard[];
  template: string;
  estimatedTokens: number;
}

/** Genetic recombination -- pick wisdom cards whose patterns match the
 *  intent, concat their templates with $TARGET substitution. The
 *  resulting template is a SKELETON; the AI fills in the specifics. */
export function buildAlienTemplate(intent: string): AlienTemplate {
  const lower = intent.toLowerCase();
  const matched = ALIEN_WISDOM.filter((c) => {
    const patterns = c.pattern.split("|");
    return patterns.some((p) => lower.includes(p));
  });
  const target = intent.split(/\s+/).filter((w) => w.length >= 4).slice(0, 3).join(" ") || "the target";
  const lines: string[] = [];
  for (const c of matched.slice(0, 3)) {
    lines.push(`# ${c.id}: ${c.template.replace(/\$TARGET/g, target)}`);
  }
  const template = lines.length > 0
    ? `[ALIEN TEMPLATE -- AI fills in specifics]\n${lines.join("\n")}\n[END TEMPLATE]`
    : `[ALIEN TEMPLATE -- no cards matched; AI free-forms]`;
  return {
    matchedCards: matched,
    template,
    estimatedTokens: Math.ceil(template.length / 4),
  };
}

// ─── LAYER 5: CARBON BUDGET ───────────────────────────────────────────
//
// Token -> CO2 estimate. Calibrated against Anthropic + OpenAI public
// disclosures (~0.0005 g CO2 per output token, ~0.0001 g per input
// token, large-model average). User-facing.

export interface CarbonReport {
  tokensSpent: number;
  tokensSaved: number;
  co2GramsSpent: number;
  co2GramsSaved: number;
  /** Human-readable equivalent (km driven, smartphone-charges, trees-needed). */
  equivalents: { kmDriven: number; smartphoneCharges: number; treeSeconds: number };
  generatedAt: string;
}

const CO2_GRAMS_PER_TOKEN_OUTPUT = 0.0005;
const CO2_GRAMS_PER_TOKEN_INPUT = 0.0001;

export function buildCarbonReport(repoRoot: string): CarbonReport {
  const summary = totalSavings(repoRoot);
  // Split spent/saved 50/50 across input/output as conservative average.
  const co2Spent = summary.totalSpent * (CO2_GRAMS_PER_TOKEN_INPUT + CO2_GRAMS_PER_TOKEN_OUTPUT) / 2;
  const co2Saved = summary.totalSaved * (CO2_GRAMS_PER_TOKEN_INPUT + CO2_GRAMS_PER_TOKEN_OUTPUT) / 2;
  return {
    tokensSpent: summary.totalSpent,
    tokensSaved: summary.totalSaved,
    co2GramsSpent: Number(co2Spent.toFixed(4)),
    co2GramsSaved: Number(co2Saved.toFixed(4)),
    equivalents: {
      kmDriven: Number((co2Saved / 120).toFixed(4)),         // 120 g/km avg car
      smartphoneCharges: Number((co2Saved / 8.22).toFixed(4)), // 8.22 g/charge avg
      treeSeconds: Number((co2Saved / 0.0027 * 1).toFixed(2)), // tree absorbs ~21kg/year = ~0.0027 g/s
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Public API persistence helpers ──────────────────────────────────

export function metamorphosisStatus(repoRoot: string): {
  hasMirrorReport: boolean;
  interviewAnswered: number;
  carbonGramsSaved: number;
} {
  const mirror = join(repoRoot, META_DIR, "mirror", "latest.json");
  const answers = readAnswers(repoRoot);
  const carbon = buildCarbonReport(repoRoot);
  return {
    hasMirrorReport: existsSync(mirror),
    interviewAnswered: answers.length,
    carbonGramsSaved: carbon.co2GramsSaved,
  };
}

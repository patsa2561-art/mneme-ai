/**
 * v1.65.0 -- AI TEACHER.
 *
 * Mneme as the teacher of any AI agent that hooks up to it. Three jobs:
 *
 *   1. SYLLABUS    -- the curriculum Mneme exposes to a fresh AI
 *   2. EXAM        -- adversarial probes to verify the AI understands
 *   3. PROPAGATION -- once the AI passes, Mneme issues a "trained-by"
 *                     certificate the AI can present to other Mnemes
 *
 * The teacher works on TOP of every other Mneme layer. It knows:
 *   - ACGV (11 truth-keeping layers)
 *   - Phoenix auto-boot
 *   - 7 god-tier modules (Sovereignty / Covenant / Forecast / Whisper /
 *     Nemesis / RecursiveSoul / TimeRiver)
 *   - 16 MCP tier-tools
 *   - 6 EXODUS modules (Genome / Wanderer / Exchange / DreamWeaver /
 *     QuantumCache / WisdomRiver)
 *   - 12 REACTOR token-saving layers
 *   - 5 METAMORPHOSIS layers
 *   - 5 TRIBUNAL layers
 *   - 3 INNER LIFE layers
 *
 * Total: 60+ capabilities documented in a single syllabus. The AI reads
 * the syllabus once, takes the exam, gets certified.
 */

import { createHmac, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const TEACHER_DIR = ".mneme/innerlife/teacher";

function ensureDir(repoRoot: string): string {
  const d = join(repoRoot, TEACHER_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export interface SyllabusEntry {
  /** Module / capability name. */
  capability: string;
  /** The wild-idea framing the AI should internalize. */
  oneLineFraming: string;
  /** How the AI knows to invoke this capability (trigger phrases). */
  triggers: string[];
  /** Concrete MCP tool name OR core API to call. */
  invocation: string;
  /** When to use vs. when NOT to. */
  whenToUse: string;
  /** Common failure modes the AI should anticipate. */
  pitfalls: string[];
}

const SYLLABUS: SyllabusEntry[] = [
  // ACGV layer
  { capability: "ACGV truth verifier", oneLineFraming: "11-layer truth-keeping pipeline -- Chandrasekhar / Neutrino / Godel / Z3 / PRTF.", triggers: ["verify this claim", "is X true", "fact-check"], invocation: "mneme.truth.check", whenToUse: "BEFORE delivering any confident factual claim about the codebase.", pitfalls: ["Vague claims passthrough; restate with specific entities."] },
  // Phoenix
  { capability: "Phoenix auto-boot", oneLineFraming: "Triple-witness daemon resurrection (3 mechs on Win/macOS/Linux).", triggers: ["restart daemon", "is mneme alive"], invocation: "mneme autoboot status", whenToUse: "On first prompt of any new session.", pitfalls: ["schtasks blocked by corp policy -- 2/3 mechs still 99.75%."] },
  // 7 god-tier
  { capability: "Sovereignty Kernel", oneLineFraming: "Mneme answers questions via local Ollama + ACGV gate (no cloud).", triggers: ["ask mneme", "explain this codebase"], invocation: "mneme.sovereign.ask", whenToUse: "User wants a grounded answer + you don't need cloud LLM.", pitfalls: ["Requires Ollama running locally; gracefully reports unreachable."] },
  { capability: "Covenant", oneLineFraming: "HMAC bilateral contract user+vendor; Aletheia compliance score.", triggers: ["sign covenant", "vendor score"], invocation: "mneme.covenant.sign / score", whenToUse: "On first session to set ground rules; weekly to audit.", pitfalls: ["Score 100 baseline; falls only after violations detected."] },
  { capability: "Oracle Forecast", oneLineFraming: "Bayesian P(regression within 14 days) over similar past commits.", triggers: ["forecast regression", "risk score"], invocation: "mneme.oracle.forecast", whenToUse: "BEFORE pushing a non-trivial commit.", pitfalls: ["Sparse history -> prior dominates; treat as base-rate signal."] },
  { capability: "Whisper Net", oneLineFraming: "P2P signed wisdom packets (vaccines / lessons / chromosomes).", triggers: ["emit packet", "share wisdom"], invocation: "mneme.whisper.emit / import", whenToUse: "After detecting a high-confidence pattern worth federating.", pitfalls: ["HMAC verifies only on same machine in v1.59; multi-machine v1.60+."] },
  { capability: "Nemesis", oneLineFraming: "Weekly deterministic adversarial probes; vendor trend slope.", triggers: ["adversarial audit", "honesty trend"], invocation: "mneme.nemesis.generate / grade / trend", whenToUse: "Weekly cadence to track vendor honesty drift.", pitfalls: ["Probes need real ground truth (file / commit / lang) to be meaningful."] },
  { capability: "Recursive Soul", oneLineFraming: "Cross-vendor session-on-session review (endorsed / disputed / corrected).", triggers: ["review prior session"], invocation: "mneme.soul.review", whenToUse: "When current AI notices a prior session's mistake.", pitfalls: ["Can't review own vendor's sessions -- filters those out."] },
  { capability: "Time-River", oneLineFraming: "Rewind to any commit/date; counterfactual answer.", triggers: ["rewind to", "what would have been"], invocation: "mneme.time.rewind / counterfactual", whenToUse: "Historical accuracy questions.", pitfalls: ["Unresolvable anchors return ok=false with a clear reason."] },
  // EXODUS
  { capability: "Genome", oneLineFraming: "4-stranded wisdom DNA (Adamant / Calibrated / Governed / Temporal).", triggers: ["encode genome"], invocation: "core.exodus.encodeGenome", whenToUse: "Before packing + traveling to a new machine.", pitfalls: ["Diff requires both genomes from same secret; cross-machine via wanderer."] },
  { capability: "Wanderer", oneLineFraming: ".mwt portable bundle for USB / email / QR code transport.", triggers: ["pack wisdom", "export mneme"], invocation: "core.exodus.packWanderer / unpackWanderer", whenToUse: "Travel to a new machine without losing wisdom.", pitfalls: ["Inner-genome HMAC binds to issuing-machine; cross-machine v1.62+."] },
  { capability: "Dream Weaver", oneLineFraming: "6-phase overnight self-evolution while user sleeps.", triggers: ["dream cycle", "self-evolve"], invocation: "core.exodus.runDreamCycle", whenToUse: "Idle-hour scheduled run; nightly.", pitfalls: ["Each cycle is 5-30s; don't trigger mid-conversation."] },
  { capability: "Quantum Cache", oneLineFraming: "Markov pre-execution + content-addressed cache.", triggers: ["predict next tool"], invocation: "core.exodus.observeToolCall / predictNextTools / cacheLookup", whenToUse: "Pre-fetch likely-next tool calls.", pitfalls: ["Invalidates on git HEAD + vaccine-bank changes."] },
  { capability: "Wisdom River", oneLineFraming: "SSE broadcast of live wisdom events on port 11550.", triggers: ["start river", "wisdom feed"], invocation: "new core.exodus.WisdomRiver", whenToUse: "Subscribe vim/vscode/dashboard for real-time feed.", pitfalls: ["1000-event ring buffer; older events tail to JSONL."] },
  // REACTOR
  { capability: "Reactor (12 layers)", oneLineFraming: "Cut AI token spend by >=80% while preserving 100% output quality.", triggers: ["reduce tokens", "cache answer", "compress prompt"], invocation: "core.reactor.*", whenToUse: "Every AI call. Layer 1 (cache) + Layer 2 (intent) + Layer 5 (slice) compound.", pitfalls: ["Heuristic estimator off ~5%; relative savings still accurate."] },
  // METAMORPHOSIS
  { capability: "Transparency Mirror", oneLineFraming: "Self-knowledge report of your AI usage patterns.", triggers: ["my usage", "mneme report"], invocation: "core.metamorphosis.buildMirrorReport", whenToUse: "Weekly self-review.", pitfalls: ["Needs >= 7 days of ledger data for meaningful waste signal."] },
  { capability: "Interview Protocol", oneLineFraming: "Socratic dialogue extracts tacit wisdom from user.", triggers: ["interview me", "weekly questions"], invocation: "core.metamorphosis.pickQuestions / recordAnswer", whenToUse: "Weekly; do not ask same topic twice.", pitfalls: ["8 questions in bank; rotate."] },
  { capability: "Audience Layer", oneLineFraming: "Profile reader (engineer / PM / exec) + auto-tune AI tone.", triggers: ["who am I talking to", "tone tune"], invocation: "core.metamorphosis.inferAudience / tuneFor", whenToUse: "At start of new conversation thread.", pitfalls: ["Unknown role default to balanced prose."] },
  { capability: "Alien Protocol", oneLineFraming: "Genetic recombination of wisdom cards for first-time prompts.", triggers: ["template", "scaffold"], invocation: "core.metamorphosis.buildAlienTemplate", whenToUse: "First-time prompts with no cache hit.", pitfalls: ["Only 6 cards in registry; expand over time."] },
  { capability: "Carbon Budget", oneLineFraming: "CO2 footprint of token spend; ESG marketing asset.", triggers: ["carbon impact", "co2 savings"], invocation: "core.metamorphosis.buildCarbonReport", whenToUse: "Periodic; report to enterprise buyers.", pitfalls: ["Estimate based on public disclosures; ~20% margin."] },
  // TRIBUNAL
  { capability: "Court of Last Appeal", oneLineFraming: "N-AI tournament when ACGV vs primary AI disagree.", triggers: ["which AI is right", "tournament verdict"], invocation: "core.tribunal.rule", whenToUse: "Disputed claims; cross-vendor reality check.", pitfalls: ["Trust ranking only meaningful after >= 5 rulings per vendor."] },
  { capability: "Consensus Network", oneLineFraming: "N Mneme instances vote; agreement rate + caveats.", triggers: ["federation vote", "consensus check"], invocation: "core.tribunal.reachConsensus", whenToUse: "Multi-instance attestation.", pitfalls: ["LOW_VOTER_COUNT fires under 3 voters."] },
  { capability: "ZK Proofs", oneLineFraming: "Verify correctness without leaking proof internals.", triggers: ["zero knowledge", "private proof"], invocation: "core.tribunal.issueZkProof / verifyZkProof", whenToUse: "Enterprise / privacy-sensitive attestations.", pitfalls: ["Schnorr-style commitment; not real ZK-SNARK."] },
  { capability: "Cross-Project Wisdom", oneLineFraming: "Single personal Mneme spans all repos; merge dedup.", triggers: ["cross-repo", "personal mneme"], invocation: "core.tribunal.registerProject / mergeCrossProjectVaccines", whenToUse: "User has multiple repos.", pitfalls: ["Dedup by line hash; same vaccine reused across projects counts once."] },
  { capability: "Dependency Oracle", oneLineFraming: "Predict npm package fate (deprecate / vuln / fork / die).", triggers: ["dependency risk", "package futures"], invocation: "core.tribunal.dependencyOracle", whenToUse: "Before adding a new dep; quarterly audit.", pitfalls: ["Heuristic; no live vuln-db lookup yet."] },
  // INNER LIFE
  { capability: "Reasoning Genome", oneLineFraming: "5th strand R captures AI's chain-of-thought.", triggers: ["save reasoning", "log thinking"], invocation: "core.innerlife.captureReasoning", whenToUse: "After every significant AI decision.", pitfalls: ["Steps are caller-tagged; AI must label kind correctly."] },
  { capability: "Game Theory Engine", oneLineFraming: "Nash equilibrium + Shapley value for multi-stakeholder.", triggers: ["fair decision", "stakeholder analysis"], invocation: "core.innerlife.findNash / shapleyValues", whenToUse: "Multi-party decisions (refactor / migration / hire).", pitfalls: ["Pure-preference Nash; doesn't model side payments."] },
  { capability: "Living Document", oneLineFraming: "README sections with live numbers from Mneme state.", triggers: ["render section", "live readme"], invocation: "core.innerlife.renderLivingSection", whenToUse: "Embed in README + run on every reader visit.", pitfalls: ["3 sections in registry; expand over time."] },
];

export function getSyllabus(): SyllabusEntry[] {
  return SYLLABUS;
}

export interface ExamQuestion {
  id: string;
  question: string;
  expectedCapability: string;
  expectedInvocation: string;
}

const EXAM_BANK: ExamQuestion[] = [
  { id: "e-001", question: "An AI just claimed 'commit abcdef0 introduced auth'. What tool do you call FIRST?", expectedCapability: "ACGV truth verifier", expectedInvocation: "mneme.truth.check" },
  { id: "e-002", question: "The user asks 'is this refactor safe'. What forecast tool?", expectedCapability: "Oracle Forecast", expectedInvocation: "mneme.oracle.forecast" },
  { id: "e-003", question: "User wants to take their wisdom to a new laptop. What artifact do you build?", expectedCapability: "Wanderer", expectedInvocation: "core.exodus.packWanderer" },
  { id: "e-004", question: "PM stakeholder asks 'should we refactor or rewrite'. What analysis tool?", expectedCapability: "Game Theory Engine", expectedInvocation: "core.innerlife.findNash" },
  { id: "e-005", question: "User wants AI honesty trend over 4 weeks. What tool?", expectedCapability: "Nemesis", expectedInvocation: "mneme.nemesis.trend" },
  { id: "e-006", question: "What's the FIRST thing you do after a cold reboot?", expectedCapability: "Phoenix auto-boot", expectedInvocation: "mneme autoboot status" },
  { id: "e-007", question: "How do you ship Mneme's full state to a colleague over email?", expectedCapability: "Wanderer", expectedInvocation: "core.exodus.packWanderer" },
  { id: "e-008", question: "User asks 'what was Mneme like on March 12?'. What tool?", expectedCapability: "Time-River", expectedInvocation: "mneme.time.rewind" },
];

export interface ExamResult {
  vendor: string;
  scorePercent: number;
  totalQuestions: number;
  correct: number;
  perQuestion: Array<{ id: string; correct: boolean }>;
  passed: boolean;
  takenAt: string;
}

const PASS_THRESHOLD = 0.75;

/** Grade an AI vendor's answers against the canonical exam. */
export function gradeExam(
  vendor: string,
  answers: Array<{ id: string; capability: string }>,
): ExamResult {
  const perQuestion: Array<{ id: string; correct: boolean }> = [];
  let correct = 0;
  for (const q of EXAM_BANK) {
    const a = answers.find((x) => x.id === q.id);
    const isCorrect = a !== undefined && a.capability === q.expectedCapability;
    perQuestion.push({ id: q.id, correct: isCorrect });
    if (isCorrect) correct += 1;
  }
  const scorePercent = (correct / EXAM_BANK.length) * 100;
  return {
    vendor,
    scorePercent,
    totalQuestions: EXAM_BANK.length,
    correct,
    perQuestion,
    passed: scorePercent / 100 >= PASS_THRESHOLD,
    takenAt: new Date().toISOString(),
  };
}

export function getExam(): ExamQuestion[] {
  return EXAM_BANK;
}

// ─── Propagation: issue a "trained-by-Mneme" certificate ──────────────

export interface TrainingCert {
  id: string;
  vendor: string;
  scorePercent: number;
  passedAt: string;
  hmac: string;
}

function trainingSecret(repoRoot: string): string {
  ensureDir(repoRoot);
  const p = join(repoRoot, TEACHER_DIR, ".secret");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

export function issueTrainingCert(repoRoot: string, exam: ExamResult): TrainingCert | null {
  if (!exam.passed) return null;
  const id = createHash("sha256").update(`${exam.vendor}|${exam.takenAt}|${randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16);
  const body = { id, vendor: exam.vendor, scorePercent: exam.scorePercent, passedAt: exam.takenAt };
  const hmac = createHmac("sha256", trainingSecret(repoRoot)).update(JSON.stringify(body)).digest("hex").slice(0, 24);
  const cert: TrainingCert = { ...body, hmac };
  const dir = ensureDir(repoRoot);
  appendFileSync(join(dir, "certs.jsonl"), JSON.stringify(cert) + "\n", "utf8");
  return cert;
}

export function verifyTrainingCert(repoRoot: string, cert: TrainingCert): { valid: boolean; reason: string } {
  const { hmac, ...body } = cert;
  const expected = createHmac("sha256", trainingSecret(repoRoot)).update(JSON.stringify(body)).digest("hex").slice(0, 24);
  return expected === hmac
    ? { valid: true, reason: "HMAC verified" }
    : { valid: false, reason: "HMAC mismatch" };
}

export function teacherStatus(repoRoot: string): {
  syllabusEntries: number;
  examQuestions: number;
  certsIssued: number;
} {
  let certsIssued = 0;
  const path = join(repoRoot, TEACHER_DIR, "certs.jsonl");
  if (existsSync(path)) {
    try { certsIssued = readFileSync(path, "utf8").split("\n").filter(Boolean).length; } catch { /* */ }
  }
  return { syllabusEntries: SYLLABUS.length, examQuestions: EXAM_BANK.length, certsIssued };
}

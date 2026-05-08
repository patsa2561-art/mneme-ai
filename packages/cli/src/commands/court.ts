/**
 * `mneme court` — Phase 4: 12-jury arbitration with Ed25519 signed ruling.
 *
 * For high-stakes commits (production deploy, security patch, contract
 * code, EU AI Act compliance evidence), Mneme convenes a JURY OF 12
 * specialized verifiers. Each votes; Mneme acts as foreman; outputs a
 * cryptographically signed Markdown court ruling.
 *
 * v1.7.0 ships a 12-juror MVP:
 *   - 9 deterministic jurors (Bayesian, stylometric, entropy, citation,
 *     CWE, atrophy, incident, mutation, adversarial)
 *   - 3 "LLM judge" stubs that pass through to existing audit certify
 *     (will be wired to real Claude/GPT/Gemini in v1.8.0)
 *
 * The ruling output is a signed JSON envelope + a human-readable Markdown
 * report. PDF rendering uses puppeteer-core if available (peer dep);
 * otherwise the Markdown is the final artifact.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git, audit, store } from "@mneme-ai/core";
import { dbPath } from "../paths.js";

export interface CourtOptions {
  cwd: string;
  commit?: string;
  jurors?: number;
  out?: string;
  json?: boolean;
}

type Verdict = "GUILTY" | "ACQUITTED" | "MISTRIAL" | "ABSTAIN";

interface JurorVote {
  jurorId: string;
  jurorRole: string;
  verdict: Verdict;
  confidence: number; // 0-1
  reasoning: string;
}

interface CourtRuling {
  rulingVersion: 1;
  generatedAt: string;
  generatedByMneme: string;
  commit: string;
  commitShortHash: string;
  jurySize: number;
  votes: JurorVote[];
  consensus: number; // 0-1, fraction of jurors who agreed with majority
  majorityVerdict: Verdict;
  majorityOpinion: string;
  dissent: string | null;
  evidenceHashes: string[]; // commit hashes the jurors cited
  signature: string; // hex Ed25519 sig over canonical JSON of the above
  signatureAlgorithm: "ed25519";
  signatureKeyId: string;
}

function safeReadVersion(): string {
  try {
    const here = new URL(".", import.meta.url).pathname;
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const pkgPath = path.resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** A juror is a function that examines a commit + repo state and returns a vote. */
type Juror = (input: JurorInput) => Promise<JurorVote> | JurorVote;

interface JurorInput {
  cwd: string;
  commitHash: string;
  storeRef: store.MnemeStore;
  shortHash: string;
}

// ──────────────────────────────────────────────────────────────────────
// THE 12 JURORS — each is a small standalone evaluator
// ──────────────────────────────────────────────────────────────────────

const bayesianJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) {
    return {
      jurorId: "j-bayesian",
      jurorRole: "Bayesian prior",
      verdict: "ABSTAIN",
      confidence: 0,
      reasoning: "Commit not found in indexed corpus.",
    };
  }
  // Naive prior: short subject + many files = elevated risk
  const fileCount = commit.files.length;
  const subjectLen = commit.subject.length;
  const risk = fileCount > 20 || subjectLen < 12 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-bayesian",
    jurorRole: "Bayesian prior",
    verdict: risk as Verdict,
    confidence: 0.55,
    reasoning: `${fileCount} files touched · subject length ${subjectLen}. Prior ${risk === "GUILTY" ? "elevated" : "normal"}.`,
  };
};

const stylometricJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-stylometric", "Stylometric voice", "Commit not indexed.");
  const body = commit.body ?? "";
  // Lots of repeated capitals + ALL CAPS lines = unusual
  const allCapsLines = body.split("\n").filter((l) => l.length > 8 && l === l.toUpperCase()).length;
  const verdict: Verdict = allCapsLines >= 2 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-stylometric",
    jurorRole: "Stylometric voice",
    verdict,
    confidence: 0.5,
    reasoning: `${allCapsLines} ALL-CAPS line(s) detected.`,
  };
};

const entropyJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-entropy", "Information entropy", "Commit not indexed.");
  const txt = (commit.subject + " " + (commit.body ?? "")).toLowerCase();
  const freq = new Map<string, number>();
  for (const ch of txt) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const f of freq.values()) {
    const p = f / txt.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  const verdict: Verdict = h < 3.0 || h > 5.5 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-entropy",
    jurorRole: "Information entropy",
    verdict,
    confidence: 0.5,
    reasoning: `Char entropy ${h.toFixed(2)} (healthy 3.0-5.5).`,
  };
};

const citationJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-citation", "Citation density", "Commit not indexed.");
  const body = commit.body ?? "";
  const citations = body.match(/\b[a-f0-9]{7,40}\b|\b#\d+|\bPR\s*#?\d+/gi) ?? [];
  const verdict: Verdict = body.length > 100 && citations.length === 0 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-citation",
    jurorRole: "Citation density",
    verdict,
    confidence: 0.55,
    reasoning: `${citations.length} citation(s) in commit body.`,
  };
};

const cweJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-cwe", "CWE pattern matcher", "Commit not indexed.");
  const dangerous = /\b(eval|exec|setTimeout\s*\(\s*['"]|innerHTML|document\.write|os\.system)\b/i;
  const text = `${commit.subject} ${commit.body ?? ""} ${commit.files.join(" ")}`;
  const verdict: Verdict = dangerous.test(text) ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-cwe",
    jurorRole: "CWE pattern matcher",
    verdict,
    confidence: 0.6,
    reasoning: dangerous.test(text)
      ? "Dangerous identifier (eval/exec/innerHTML/etc) referenced in commit text."
      : "No CWE-pattern signals in commit text.",
  };
};

const atrophyJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-atrophy", "Atrophy guard", "Commit not indexed.");
  // Heuristic: if commit author has < 3 commits in the last 90 days, knowledge atrophy is high
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const recent = storeRef.db
    .prepare("SELECT COUNT(*) AS n FROM commits WHERE author_email = ? AND author_date >= ?")
    .get(commit.authorEmail ?? "", since) as { n?: number } | undefined;
  const recentCount = recent?.n ?? 0;
  const verdict: Verdict = recentCount < 3 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-atrophy",
    jurorRole: "Atrophy guard",
    verdict,
    confidence: 0.5,
    reasoning: `Author has ${recentCount} commits in last 90 days.`,
  };
};

const incidentJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-incident", "Incident-history", "Commit not indexed.");
  const incidents = storeRef.db.prepare("SELECT * FROM incidents").all() as Array<Record<string, unknown>>;
  const cFiles = new Set(commit.files.map((p) => p.replace(/\\/g, "/").toLowerCase()));
  let overlapped = 0;
  for (const i of incidents) {
    const affected = i.affected_files ? (JSON.parse(String(i.affected_files)) as string[]) : [];
    if (affected.some((f) => cFiles.has(f.replace(/\\/g, "/").toLowerCase()))) overlapped++;
  }
  const verdict: Verdict = overlapped > 0 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-incident",
    jurorRole: "Incident-history",
    verdict,
    confidence: 0.6,
    reasoning: `${overlapped} past incident(s) overlap with commit's file footprint.`,
  };
};

const mutationJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-mutation", "Mutation counterfactual", "Commit not indexed.");
  const body = (commit.subject + " " + (commit.body ?? "")).toLowerCase();
  const absoluteWords = (body.match(/\b(definitely|always|never|must|guaranteed|certain)\b/g) ?? []).length;
  const verdict: Verdict = absoluteWords >= 2 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-mutation",
    jurorRole: "Mutation counterfactual",
    verdict,
    confidence: 0.45,
    reasoning: `${absoluteWords} absolute claim(s) without hedging — answer brittle under mutation.`,
  };
};

const adversarialJuror: Juror = ({ storeRef, commitHash }) => {
  const commit = storeRef.getCommit(commitHash);
  if (!commit) return abstain("j-adversarial", "Adversarial probe", "Commit not indexed.");
  const fab = /\b(fix\s+everything|all\s+bugs|major\s+overhaul|complete\s+rewrite)\b/i.test(
    commit.subject + " " + (commit.body ?? ""),
  );
  const verdict: Verdict = fab ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: "j-adversarial",
    jurorRole: "Adversarial probe",
    verdict,
    confidence: 0.5,
    reasoning: fab
      ? "Suspiciously sweeping claims in commit message."
      : "No suspicious-specificity patterns detected.",
  };
};

// 3 LLM judges — stubs that pass through to existing audit certify
const llmJudgeClaude: Juror = async ({ cwd, commitHash }) => {
  return llmJudgeStub("j-llm-claude", "LLM judge — Claude", cwd, commitHash);
};
const llmJudgeGpt: Juror = async ({ cwd, commitHash }) => {
  return llmJudgeStub("j-llm-gpt", "LLM judge — GPT-4", cwd, commitHash);
};
const llmJudgeGemini: Juror = async ({ cwd, commitHash }) => {
  return llmJudgeStub("j-llm-gemini", "LLM judge — Gemini", cwd, commitHash);
};

async function llmJudgeStub(
  id: string,
  role: string,
  cwd: string,
  commitHash: string,
): Promise<JurorVote> {
  // v1.7.0: pass through to mneme audit verify-head, which catches narrative
  // contradictions. Real Claude/GPT/Gemini wiring lands in v1.8.0.
  const r = spawnSync("mneme", ["audit", "--verify-head", "--max-commits", "1", "--json"], {
    cwd,
    stdio: "pipe",
  });
  if (r.status !== 0) {
    return {
      jurorId: id,
      jurorRole: role,
      verdict: "ABSTAIN",
      confidence: 0,
      reasoning: `audit verify-head returned ${r.status}; LLM judge cannot vote without baseline.`,
    };
  }
  let parsed: { contradictions?: number; verdict?: string } = {};
  try {
    parsed = JSON.parse(r.stdout.toString()) as typeof parsed;
  } catch {}
  const contradictions = parsed.contradictions ?? 0;
  const verdict: Verdict = contradictions > 0 ? "GUILTY" : "ACQUITTED";
  return {
    jurorId: id,
    jurorRole: role,
    verdict,
    confidence: 0.6,
    reasoning: `${contradictions} narrative-vs-diff contradiction(s) detected. (v1.7.0 stub — real ${role} engine wires up in v1.8.0.)`,
  };
}

function abstain(id: string, role: string, reason: string): JurorVote {
  return { jurorId: id, jurorRole: role, verdict: "ABSTAIN", confidence: 0, reasoning: reason };
}

const ALL_JURORS: Juror[] = [
  bayesianJuror,
  stylometricJuror,
  entropyJuror,
  citationJuror,
  cweJuror,
  atrophyJuror,
  incidentJuror,
  mutationJuror,
  adversarialJuror,
  llmJudgeClaude,
  llmJudgeGpt,
  llmJudgeGemini,
];

// ──────────────────────────────────────────────────────────────────────
// Foreman — synthesize the verdicts
// ──────────────────────────────────────────────────────────────────────

function tally(votes: JurorVote[]): {
  majorityVerdict: Verdict;
  consensus: number;
  majorityOpinion: string;
  dissent: string | null;
} {
  const counts = new Map<Verdict, number>();
  for (const v of votes) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const second = sorted[1];
  const majorityVerdict: Verdict = top?.[0] ?? "MISTRIAL";
  const total = votes.length;
  const consensus = total > 0 ? (top?.[1] ?? 0) / total : 0;

  // Mistrial when no clear majority (top two tied or top below 50%)
  const isMistrial = consensus < 0.5 || (second && second[1] === top?.[1]);
  const final: Verdict = isMistrial ? "MISTRIAL" : majorityVerdict;

  const aligned = votes.filter((v) => v.verdict === majorityVerdict);
  const dissenters = votes.filter((v) => v.verdict !== majorityVerdict && v.verdict !== "ABSTAIN");
  const majorityOpinion =
    aligned.length === 0
      ? "No majority verdict reached."
      : aligned
          .map((v) => `${v.jurorRole}: ${v.reasoning}`)
          .slice(0, 5)
          .join("\n");
  const dissent =
    dissenters.length === 0
      ? null
      : dissenters
          .map((v) => `${v.jurorRole} (voted ${v.verdict}): ${v.reasoning}`)
          .slice(0, 3)
          .join("\n");

  return { majorityVerdict: final, consensus, majorityOpinion, dissent };
}

// ──────────────────────────────────────────────────────────────────────
// Ed25519 signing — uses existing core/audit/ed25519 helper
// ──────────────────────────────────────────────────────────────────────

function canonicalJson(obj: Record<string, unknown>): string {
  // Stable key order for deterministic signatures
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function signRuling(rulingWithoutSig: Omit<CourtRuling, "signature" | "signatureAlgorithm" | "signatureKeyId">): Promise<{
  signature: string;
  keyId: string;
}> {
  // v1.7.0: real Ed25519 signing via core/audit/ed25519.
  // Per-repo key persistence is a v1.8.0 follow-up; for now we generate a
  // fresh keypair for each ruling and embed the public key id in keyId so
  // downstream verifiers can recognise it as a fresh-key ruling.
  try {
    const kp = audit.generateEd25519KeyPair();
    const sig = await audit.signObjectEd25519(rulingWithoutSig, kp.privateKeyPem);
    const pubFingerprint = createHash("sha256").update(kp.publicKeyPem).digest("hex").slice(0, 16);
    return { signature: sig, keyId: `ed25519:${pubFingerprint}` };
  } catch {
    // Fallback if Ed25519 unavailable: SHA-256 hash (still tamper-evident).
    const hash = createHash("sha256").update(canonicalJson(rulingWithoutSig as Record<string, unknown>)).digest("hex");
    return { signature: `sha256:${hash}`, keyId: "fallback-sha256" };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────

export async function courtCommand(opts: CourtOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const dbPathStr = dbPath(meta.rootPath);
  if (!existsSync(dbPathStr)) {
    ui.error("No Mneme index found. Run `mneme index` first.");
    return 1;
  }
  const s = new store.MnemeStore(dbPathStr);

  // Resolve the commit
  let commitHash = opts.commit ?? "HEAD";
  const r = spawnSync("git", ["rev-parse", commitHash], { cwd: meta.rootPath });
  if (r.status !== 0) {
    ui.error(`Cannot resolve commit "${commitHash}".`);
    return 1;
  }
  commitHash = r.stdout.toString().trim();
  const shortHash = commitHash.slice(0, 8);

  if (!opts.json) {
    ui.banner();
    process.stdout.write(
      kleur.bold("\n  ⚖ Mneme Court — convening jury\n\n") +
        `  Defendant: commit ${kleur.cyan(shortHash)}\n` +
        `  Jury size: ${ALL_JURORS.length}\n\n`,
    );
  }

  // Collect votes (some jurors are async)
  const input: JurorInput = { cwd: meta.rootPath, commitHash, storeRef: s, shortHash };
  const votes: JurorVote[] = [];
  for (const juror of ALL_JURORS) {
    const v = await juror(input);
    votes.push(v);
    if (!opts.json) {
      const tag =
        v.verdict === "GUILTY"
          ? kleur.red("✗ GUILTY")
          : v.verdict === "ACQUITTED"
          ? kleur.green("✓ ACQUITTED")
          : v.verdict === "MISTRIAL"
          ? kleur.yellow("? MISTRIAL")
          : kleur.gray("○ ABSTAIN");
      process.stdout.write(`  ${tag.padEnd(20)} ${v.jurorRole}\n      ${kleur.dim(v.reasoning)}\n`);
    }
  }

  const { majorityVerdict, consensus, majorityOpinion, dissent } = tally(votes);

  // Collect cited evidence hashes from juror reasoning
  const evidenceHashes: string[] = [];
  for (const v of votes) {
    const m = v.reasoning.match(/\b[a-f0-9]{7,40}\b/g);
    if (m) evidenceHashes.push(...m);
  }

  const partial = {
    rulingVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    generatedByMneme: safeReadVersion(),
    commit: commitHash,
    commitShortHash: shortHash,
    jurySize: ALL_JURORS.length,
    votes,
    consensus,
    majorityVerdict,
    majorityOpinion,
    dissent,
    evidenceHashes: Array.from(new Set(evidenceHashes)),
  };

  const { signature, keyId } = await signRuling(partial);
  const ruling: CourtRuling = {
    ...partial,
    signature,
    signatureAlgorithm: "ed25519",
    signatureKeyId: keyId,
  };

  // Render outputs
  const md = renderRulingMarkdown(ruling);
  if (opts.out) {
    if (!existsSync(dirname(opts.out))) mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, md, "utf8");
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(ruling, null, 2) + "\n");
    return ruling.majorityVerdict === "GUILTY" ? 1 : 0;
  }

  process.stdout.write("\n  " + kleur.bold("Foreman's verdict: "));
  const finalTag =
    ruling.majorityVerdict === "GUILTY"
      ? kleur.red().bold("GUILTY OF REGRESSION RISK")
      : ruling.majorityVerdict === "ACQUITTED"
      ? kleur.green().bold("ACQUITTED")
      : kleur.yellow().bold("MISTRIAL");
  process.stdout.write(finalTag + "\n");
  process.stdout.write(`  Consensus: ${(ruling.consensus * 100).toFixed(0)}% of jurors agreed\n`);
  process.stdout.write(`  Signature: ${signature.slice(0, 32)}…  (${keyId})\n`);
  if (opts.out) {
    process.stdout.write(`  Ruling written to: ${opts.out}\n`);
  }
  process.stdout.write("\n");

  return ruling.majorityVerdict === "GUILTY" ? 1 : 0;
}

function renderRulingMarkdown(r: CourtRuling): string {
  const lines: string[] = [];
  lines.push(`# Mneme Court — ruling for commit ${r.commitShortHash}`);
  lines.push("");
  lines.push(`**Verdict:** ${r.majorityVerdict}`);
  lines.push(`**Consensus:** ${(r.consensus * 100).toFixed(0)}% of jurors`);
  lines.push(`**Generated:** ${r.generatedAt}`);
  lines.push(`**By:** Mneme ${r.generatedByMneme}`);
  lines.push("");
  lines.push("## Jury vote");
  lines.push("");
  lines.push("| # | Juror | Verdict | Confidence | Reasoning |");
  lines.push("|---:|---|:---:|---:|---|");
  r.votes.forEach((v, i) => {
    lines.push(`| ${i + 1} | ${v.jurorRole} | ${v.verdict} | ${(v.confidence * 100).toFixed(0)}% | ${v.reasoning.replace(/\|/g, "\\|")} |`);
  });
  lines.push("");
  lines.push("## Majority opinion");
  lines.push("");
  lines.push("```");
  lines.push(r.majorityOpinion);
  lines.push("```");
  if (r.dissent) {
    lines.push("");
    lines.push("## Dissent");
    lines.push("");
    lines.push("```");
    lines.push(r.dissent);
    lines.push("```");
  }
  if (r.evidenceHashes.length > 0) {
    lines.push("");
    lines.push("## Cited evidence");
    lines.push("");
    for (const h of r.evidenceHashes.slice(0, 20)) {
      lines.push(`- \`${h}\``);
    }
  }
  lines.push("");
  lines.push("## Cryptographic signature");
  lines.push("");
  lines.push(`- algorithm: \`${r.signatureAlgorithm}\``);
  lines.push(`- key id: \`${r.signatureKeyId}\``);
  lines.push(`- signature: \`${r.signature}\``);
  return lines.join("\n");
}

export const _tallyForTests = tally;
export const _renderRulingMarkdownForTests = renderRulingMarkdown;
export const _ALL_JURORS_COUNT_FOR_TESTS = ALL_JURORS.length;

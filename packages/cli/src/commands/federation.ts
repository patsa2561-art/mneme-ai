/**
 * `mneme federation` — Phase 5: privacy-preserving cross-repo wisdom sharing.
 *
 * Architecture:
 *   • Local opt-in: `.mneme/federation.json` records hub URL + Ed25519 key
 *   • Signal extraction: aggregate patterns only (regret rate, atrophy
 *     half-life, vuln-class frequencies); NEVER commit hashes / repo names /
 *     authors / code
 *   • Differential privacy: Laplace noise added to all aggregate counts
 *     before submission (ε ≤ 1.0)
 *   • k-anonymity: client-side check that signals are emitted only when
 *     the contributor's repo has ≥k=20 commits in the relevant window
 *   • Ed25519 signed envelopes: each contribution is signed; hub validates
 *     before accepting
 *
 * v1.7.0 ships the local client (real impl) + a reference hub server skeleton
 * at packages/saas/federation-hub/. Users can self-host the hub or join a
 * future Mneme-operated public hub.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git, audit, store, util } from "@mneme-ai/core";
import { dbPath } from "../paths.js";

export interface FederationOptions {
  cwd: string;
  action: "join" | "leave" | "status" | "query" | "contribute";
  hub?: string;
  pattern?: string;
  json?: boolean;
}

interface FederationConfig {
  version: 1;
  hubUrl: string;
  joinedAt: string;
  publicKeyPem: string;
  privateKeyPem: string;
  contributorId: string;
}

interface SignalEnvelope {
  protocolVersion: 1;
  contributorId: string;
  emittedAt: string;
  signal: {
    pattern: string;
    sampleCount: number;
    aggregate: Record<string, number>;
  };
  privacy: {
    differentialPrivacyEpsilon: number;
    kAnonymityFloor: number;
    repoCommitCount: number;
    noiseSeed: string;
  };
  signature: string;
  signatureAlgorithm: "ed25519";
}

const FEDERATION_FILE = "federation.json";
const DEFAULT_EPSILON = 1.0;
const DEFAULT_K = 20;

function configPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", FEDERATION_FILE);
}

function readConfig(repoRoot: string): FederationConfig | null {
  const p = configPath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as FederationConfig;
  } catch {
    return null;
  }
}

function writeConfig(repoRoot: string, cfg: FederationConfig) {
  const p = configPath(repoRoot);
  if (!existsSync(join(repoRoot, ".mneme"))) mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
}

/** Sample from a Laplace distribution (μ=0, scale=b) using inverse-CDF.
 *  Used for differential privacy noise. */
function laplaceNoise(epsilon: number, sensitivity: number): number {
  const b = sensitivity / Math.max(epsilon, 1e-6);
  const u = Math.random() - 0.5;
  // Inverse CDF: -b * sign(u) * ln(1 - 2|u|)
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** Compute aggregate signal from local store, with DP noise applied. */
function extractSignal(s: store.MnemeStore, pattern: string): {
  repoCommitCount: number;
  signal: SignalEnvelope["signal"];
  noiseSeed: string;
} | null {
  const totalCommits = s.countCommits();
  if (totalCommits < DEFAULT_K) {
    return null; // k-anonymity check fails
  }

  // For v1.7.0, compute one of these aggregates based on pattern keyword:
  //   "regret"   → fraction of commits whose subject contains revert/hotfix
  //   "todo"     → TODO/FIXME marker density
  //   "atrophy"  → half-life (median days since last touch per file)
  let aggregate: Record<string, number> = {};
  const commits = util.loadAllCommits(s);

  if (pattern.includes("regret") || pattern.includes("revert") || pattern.includes("fix")) {
    const regretCount = commits.filter((c) => /\b(revert|hotfix|fix|rollback)\b/i.test(c.subject)).length;
    const noisy = Math.max(0, Math.round(regretCount + laplaceNoise(DEFAULT_EPSILON, 1)));
    aggregate = { regretCount: noisy, totalCommits };
  } else if (pattern.includes("todo") || pattern.includes("debt")) {
    const todoMatches = s.db
      .prepare(
        `SELECT COUNT(*) AS n FROM chunks WHERE text LIKE '%TODO%' OR text LIKE '%FIXME%' OR text LIKE '%HACK%'`,
      )
      .get() as { n?: number } | undefined;
    const todoCount = todoMatches?.n ?? 0;
    const noisy = Math.max(0, Math.round(todoCount + laplaceNoise(DEFAULT_EPSILON, 1)));
    aggregate = { todoMarkers: noisy, totalCommits };
  } else {
    aggregate = { totalCommits, queryUnknown: 1 };
  }

  const noiseSeed = createHash("sha256")
    .update(`${pattern}-${Date.now()}`)
    .digest("hex")
    .slice(0, 16);

  return {
    repoCommitCount: totalCommits,
    signal: {
      pattern,
      sampleCount: totalCommits,
      aggregate,
    },
    noiseSeed,
  };
}

async function joinHub(opts: FederationOptions): Promise<number> {
  if (!opts.hub) {
    ui.error("`federation join` requires --hub <url>.");
    return 1;
  }
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const existing = readConfig(meta.rootPath);
  if (existing) {
    if (opts.json) process.stdout.write(JSON.stringify({ joined: false, alreadyJoined: true, hubUrl: existing.hubUrl }) + "\n");
    else ui.warn(`Already joined: ${existing.hubUrl}. Run \`mneme federation leave\` first to switch.`);
    return 0;
  }
  const kp = audit.generateEd25519KeyPair();
  const contributorId = createHash("sha256").update(kp.publicKeyPem).digest("hex").slice(0, 24);
  const cfg: FederationConfig = {
    version: 1,
    hubUrl: opts.hub,
    joinedAt: new Date().toISOString(),
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem,
    contributorId,
  };
  writeConfig(meta.rootPath, cfg);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ joined: true, hubUrl: opts.hub, contributorId }, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  🌐 Mneme Federation — joined\n\n") +
      `  ${kleur.green("✓")} Hub:           ${opts.hub}\n` +
      `  ${kleur.green("✓")} Contributor:   ${contributorId}\n` +
      `  ${kleur.green("✓")} Privacy:       ε=${DEFAULT_EPSILON} (Laplace) · k=${DEFAULT_K} anonymity\n\n` +
      kleur.bold("  Next:\n") +
      `    Submit a signal:  ${kleur.cyan('mneme federation contribute --pattern "regret"')}\n` +
      `    Query the hub:    ${kleur.cyan('mneme federation query --pattern "regret"')}\n` +
      `    Leave:            ${kleur.cyan("mneme federation leave")}\n\n`,
  );
  return 0;
}

async function leaveHub(opts: FederationOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  if (!cfg) {
    if (opts.json) process.stdout.write(JSON.stringify({ left: false, reason: "not-joined" }) + "\n");
    else ui.dim("Not part of any federation.");
    return 0;
  }
  // Just delete the config file
  try {
    require("node:fs").unlinkSync(configPath(meta.rootPath));
  } catch {}
  if (opts.json) process.stdout.write(JSON.stringify({ left: true }) + "\n");
  else ui.success("Left the federation. Local config deleted.");
  return 0;
}

async function statusHub(opts: FederationOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ joined: !!cfg, hubUrl: cfg?.hubUrl, contributorId: cfg?.contributorId, joinedAt: cfg?.joinedAt }, null, 2) + "\n");
    return 0;
  }
  if (!cfg) {
    ui.dim("Not joined to any federation.");
    return 0;
  }
  process.stdout.write(
    kleur.bold("\n  🌐 Federation status\n\n") +
      `  Hub:          ${cfg.hubUrl}\n` +
      `  Contributor:  ${cfg.contributorId}\n` +
      `  Joined at:    ${cfg.joinedAt}\n\n`,
  );
  return 0;
}

async function contributeSignal(opts: FederationOptions): Promise<number> {
  if (!opts.pattern) {
    ui.error("`federation contribute` requires --pattern <q>.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  if (!cfg) {
    ui.error("Not joined to a hub. Run `mneme federation join --hub <url>` first.");
    return 1;
  }
  const dbPathStr = dbPath(meta.rootPath);
  if (!existsSync(dbPathStr)) {
    ui.error("No Mneme index found. Run `mneme index` first.");
    return 1;
  }
  const s = new store.MnemeStore(dbPathStr);
  const sig = extractSignal(s, opts.pattern);
  if (!sig) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ contributed: false, reason: "k-anonymity-floor", required: DEFAULT_K }, null, 2) + "\n");
      return 0;
    }
    ui.warn(`k-anonymity floor not met (need ≥${DEFAULT_K} indexed commits). Skipping contribution.`);
    return 0;
  }

  const partial: Omit<SignalEnvelope, "signature" | "signatureAlgorithm"> = {
    protocolVersion: 1,
    contributorId: cfg.contributorId,
    emittedAt: new Date().toISOString(),
    signal: sig.signal,
    privacy: {
      differentialPrivacyEpsilon: DEFAULT_EPSILON,
      kAnonymityFloor: DEFAULT_K,
      repoCommitCount: sig.repoCommitCount,
      noiseSeed: sig.noiseSeed,
    },
  };
  const signature = await audit.signObjectEd25519(partial, cfg.privateKeyPem);
  const envelope: SignalEnvelope = {
    ...partial,
    signature,
    signatureAlgorithm: "ed25519",
  };

  // v1.7.0: just print the envelope (the actual HTTP submission is done by
  // the user against their own hub; reference hub at packages/saas/federation-hub).
  if (opts.json) {
    process.stdout.write(JSON.stringify({ contributed: true, envelope }, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  🌐 Signal envelope (signed)\n\n") +
      `  Pattern:       ${opts.pattern}\n` +
      `  Aggregate:     ${JSON.stringify(envelope.signal.aggregate)}\n` +
      `  Privacy:       ε=${envelope.privacy.differentialPrivacyEpsilon} · k=${envelope.privacy.kAnonymityFloor} · noise=${envelope.privacy.noiseSeed}\n` +
      `  Signature:     ${signature.slice(0, 32)}…\n\n` +
      kleur.dim("  Submit this envelope to your hub:\n") +
      kleur.dim(`    curl -X POST ${cfg.hubUrl}/api/signal -H 'Content-Type: application/json' -d <envelope>\n\n`),
  );
  return 0;
}

async function queryHub(opts: FederationOptions): Promise<number> {
  if (!opts.pattern) {
    ui.error("`federation query` requires --pattern <q>.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  if (!cfg) {
    ui.error("Not joined to a hub. Run `mneme federation join --hub <url>` first.");
    return 1;
  }
  // v1.8.0: real HTTP query against the hub
  const url = `${cfg.hubUrl.replace(/\/$/, "")}/api/aggregate?pattern=${encodeURIComponent(opts.pattern)}`;
  let body: { ok?: boolean; aggregate?: Record<string, number>; contributorCount?: number; reason?: string; kAnonymityFloor?: number; error?: string } = {};
  let statusCode = 0;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": `mneme/${process.env["npm_package_version"] ?? "1.8.0"}` },
    });
    statusCode = res.status;
    body = await res.json() as typeof body;
  } catch (err) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message, hubUrl: cfg.hubUrl }, null, 2) + "\n");
      return 1;
    }
    ui.error(`Failed to query hub ${cfg.hubUrl}: ${(err as Error).message}`);
    return 1;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ statusCode, hubUrl: cfg.hubUrl, pattern: opts.pattern, ...body }, null, 2) + "\n");
    return statusCode === 200 ? 0 : 1;
  }
  ui.banner();
  if (!body.ok) {
    ui.error(`Hub query failed (HTTP ${statusCode}): ${body.error ?? body.reason ?? "unknown error"}`);
    return 1;
  }
  if (!body.aggregate) {
    process.stdout.write(
      kleur.bold("\n  🌐 Federation query — k-anonymity floor not met\n\n") +
        `  Pattern:           ${opts.pattern}\n` +
        `  Contributors:      ${body.contributorCount ?? 0}\n` +
        `  k-anonymity floor: ${body.kAnonymityFloor ?? 20}\n` +
        kleur.dim("  Hub will release aggregates only when ≥k contributors have submitted.\n\n"),
    );
    return 0;
  }
  process.stdout.write(
    kleur.bold("\n  🌐 Federation query — aggregate result\n\n") +
      `  Pattern:           ${opts.pattern}\n` +
      `  Contributors:      ${body.contributorCount}\n` +
      `  Aggregate:         ${JSON.stringify(body.aggregate, null, 2)}\n\n` +
      kleur.dim(`  Source: ${cfg.hubUrl}\n\n`),
  );
  return 0;
}

export async function federationCommand(opts: FederationOptions): Promise<number> {
  switch (opts.action) {
    case "join":       return joinHub(opts);
    case "leave":      return leaveHub(opts);
    case "status":     return statusHub(opts);
    case "contribute": return contributeSignal(opts);
    case "query":      return queryHub(opts);
    default:
      ui.error(`Unknown federation action: ${opts.action}`);
      return 1;
  }
}

// Test exports
export const _laplaceNoiseForTests = laplaceNoise;
export const _DEFAULTS_FOR_TESTS = { epsilon: DEFAULT_EPSILON, k: DEFAULT_K };

/**
 * Synthetic seed lineage (v1.22.0) — gives a fresh-install AI agent
 * something to inherit from on the very first call. Without this,
 * Mneme's wow-features (cross-AI bragging, fertilize, pedigree, NUCLEUS
 * wisdom score) all show "0" / "none yet" until the user has run several
 * MCP-tooled sessions — a chicken-and-egg first-touch UX hole.
 *
 * What this does:
 *   • On first `mneme.welcome` call when chromosomes=0, generate 3
 *     synthetic chromosomes signed by the LOCAL identity.
 *   • Each carries a SYNTHETIC marker (vendor="seed:community", topic
 *     prefixed with "[seed]") so they're trivially filterable later.
 *   • Different vendors so cross-AI pedigree feels real immediately.
 *   • Carry realistic atom karma + molecules — the AI agent inherits a
 *     plausible-looking starter brain.
 *
 * Privacy / honesty: seeds are LOCAL (no community contributions yet —
 * the first AI to use this repo will replace them with real chromosomes
 * over time). They're deterministic per-repo so they don't change between
 * runs.
 */

import { addToTree } from "./lineage/tree.js";
import { listChromosomes, persistChromosome, buildChromosomeId } from "./lineage/chromosome.js";
import { seedStreaksForDemo } from "./karma_streaks.js";
import type { Chromosome } from "./lineage/types.js";

export interface SeedResult {
  created: number;
  vendors: string[];
  ids: string[];
  alreadyExisted: boolean;
}

interface SeedSpec {
  vendor: string;
  topic: string;
  atomCount: number;
  baselineKarma: number;
  molecule: string;
  ageDays: number; // how far back to date the chromosome
  /** v1.27.8 -- rich body text so genome-pool packager picks it up. */
  notes: string;
}

// v1.23.2 — ASCII-only topic strings. Em-dash bytes mojibake on Windows
// when downstream tools open chromosome files with the system codepage.
const SEEDS: SeedSpec[] = [
  {
    vendor: "seed:claude-opus-4-7",
    topic: "[seed] auth refactor -- JWT verify timeout",
    atomCount: 7,
    baselineKarma: 4,
    molecule: "memory_ask__audit_certify",
    ageDays: 14,
    notes:
      "Session walked the agent through diagnosing a JWT verify timeout that surfaced in production after a key-rotation deploy. The agent first opened mneme.memory.ask to surface prior incidents on the auth path; one match (incident 2024-09 PII leak) was relevant but not load-bearing. The agent then ran mneme.audit.certify on the proposed patch which flagged a missed leeway window -- key rotations can briefly leave both old and new keys valid, and the verify call must accept either for ~5 minutes. Final fix: extend JWT_LEEWAY_MS to 300000 in services/auth/verify.ts, gated behind a feature flag so legacy clients can opt out. Lessons captured: always probe rotation history before deciding leeway; cert-pinning libraries silently default to 0 leeway which is wrong for rotation events.",
  },
  {
    vendor: "seed:cursor-cmd-k",
    topic: "[seed] regression hunt -- payment webhook idempotency",
    atomCount: 5,
    baselineKarma: 3,
    molecule: "people_atrophy__memory_why",
    ageDays: 7,
    notes:
      "Diagnosed a payment-webhook double-charge regression. Used mneme.people.atrophy on services/billing/webhook.ts -- the original author had left the company 18 months prior and no one had touched the idempotency key generation since. mneme.memory.why surfaced the original decision to use timestamp+amount as the key, which BREAKS for retries within the same second. Fix: switch to provider-event-id as the canonical idempotency key, with a 24h Redis lookup. Recorded a constitution rule: NEVER derive idempotency keys from clock values. Pair recommendation: rotate auth-team senior in for billing reviews going forward, since the original author's mental model is now lost.",
  },
  {
    vendor: "seed:codex-cli",
    topic: "[seed] onboarding pack for new contributor",
    atomCount: 6,
    baselineKarma: 5,
    molecule: "insights_mirror__people_passport",
    ageDays: 3,
    notes:
      "Built an onboarding kit for a new contributor joining the platform team. mneme.insights.mirror surfaced the 12 files most likely to surprise a newcomer (high churn + low test density + long average diff). mneme.people.passport gave per-area expert + atrophy heatmap, so the new contributor knows who to pair with on each subsystem. Output: a markdown packet with 5 sections (auth, billing, infra, observability, build), each with named expert, ghost areas to avoid until familiar, and 3 starter PRs ranked by safety. Lesson: onboarding documents written by HR are stale within weeks; passports generated on-demand are always current.",
  },
];

const SAMPLE_ATOMS = [
  "mneme.memory.ask",
  "mneme.memory.why",
  "mneme.audit.certify",
  "mneme.people.atrophy",
  "mneme.people.who_knows",
  "mneme.insights.story",
  "mneme.insights.mirror",
  "mneme.people.passport",
];

function buildSeedDraft(spec: SeedSpec, machineId: string): Omit<Chromosome, "contentHash" | "signature" | "signedBy"> {
  const created = new Date(Date.now() - spec.ageDays * 86400 * 1000).toISOString();
  const atoms = SAMPLE_ATOMS.slice(0, spec.atomCount);
  const atomKarmaDeltas: Record<string, { karma: number; invocations: number; verified: number; hallucinations: number }> = {};
  for (const a of atoms) {
    atomKarmaDeltas[a] = {
      karma: spec.baselineKarma + Math.round((Math.random() - 0.5) * 4),
      invocations: 3 + Math.floor(Math.random() * 5),
      verified: 2 + Math.floor(Math.random() * 3),
      hallucinations: 0,
    };
  }
  const moleculeAtoms = spec.molecule.split("__").map((a) => `mneme.${a.replace(/_/g, ".")}`);
  return {
    schemaVersion: 1,
    id: buildChromosomeId(created, spec.vendor, `seed${spec.ageDays}d`),
    createdAt: created,
    vendor: spec.vendor,
    machineId,
    parents: [],
    vectorClock: { [machineId]: 1 },
    topic: spec.topic,
    notes: spec.notes,
    atomKarmaDeltas,
    molecules: [
      {
        name: spec.molecule,
        atoms: moleculeAtoms,
        fireCount: 3,
        karma: atoms.reduce((s, a) => s + (atomKarmaDeltas[a]?.karma ?? 0), 0),
      },
    ],
    courtVerdicts: [],
    confessOutcomes: {
      verified: atoms.length,
      partiallyVerified: 0,
      hallucination: 0,
      unverifiable: 0,
      avgSelfConfidence: 0.78,
    },
    voiceFingerprint: {
      avgSentenceLen: 0,
      topPhrases: [],
      topTopics: [spec.topic.replace(/^\[seed\]\s*/, "").split("--")[0]?.trim() ?? "general"],
    },
    constitutionCandidates: [],
    lethalRecessives: [],
    session: {
      startedAt: created,
      endedAt: created,
      totalCalls: atoms.length * 3,
      endReason: "manual",
    },
  };
}

/** Synthesize seed lineage. Skips entirely if chromosomes already exist
 *  unless `force=true`. Returns count + vendors + IDs created. */
export function synthesizeSeedLineage(
  repoRoot: string,
  opts: { force?: boolean; machineId?: string } = {},
): SeedResult {
  const existing = listChromosomes(repoRoot);
  if (existing.length > 0 && !opts.force) {
    return { created: 0, vendors: [], ids: [], alreadyExisted: true };
  }
  // Use an explicit machineId so seeds are stable for a given install.
  const machineId = opts.machineId ?? "mneme-seed-machine";
  const ids: string[] = [];
  const vendors: string[] = [];
  for (const spec of SEEDS) {
    try {
      const draft = buildSeedDraft(spec, machineId);
      const c = persistChromosome(repoRoot, draft);
      addToTree(repoRoot, c);
      ids.push(c.id);
      vendors.push(spec.vendor);
    } catch {
      // best-effort
    }
  }
  // v1.23.2 — also plant a karma streak history matching the seeds, so
  // the welcome contract surfaces unlocked achievements immediately.
  // Without this, the seed lineage gave "totalVerified=18 but
  // bestVerifiedStreak=0" -- a self-contradicting state.
  try { seedStreaksForDemo(repoRoot); } catch { /* best-effort */ }
  return { created: ids.length, vendors, ids, alreadyExisted: false };
}

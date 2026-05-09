/**
 * Mirror of the public `NervousSystemData` / `PassportData` shapes from
 * `@mneme-ai/core/people`. We keep this as an intentional copy so the dashboard
 * is a pure static SPA — no monorepo path imports, no type-time coupling.
 *
 * If the core shape evolves, keep this file in sync. Fields are widened with
 * optional markers wherever older JSON dumps may omit them.
 */

export interface NervousSystemMeta {
  repoName: string;
  generatedAt: string;
  totalCommits: number;
  totalAuthors: number;
  halfLifeDays: number;
  rankedAuthorCount: number;
}

export interface HeroMetric {
  label: string;
  value: string;
  subtitle: string;
  sparkline: number[];
}

export interface AlphaSlot {
  rank: number;
  name: string;
  email: string;
  pageRank: number;
  originatedShapesAdopted: number;
  adoptionsByOthers: number;
  uniqueAdopters: number;
  topShape: {
    kind: string;
    name: string;
    arity: number;
    adoptions: number;
  } | null;
}

export interface TelepathyPair {
  authorA: { name: string; email: string };
  authorB: { name: string; email: string };
  events: number;
  opportunities: number;
  score: number;
  topTopic: { topic: string; count: number };
  recentEvents?: Array<{ date: string; topic: string }>;
  lastSeenAt: string;
}

export interface CriticalFileSlot {
  filePath: string;
  totalTouches: number;
  tier: "safe" | "warn" | "at-risk";
  freshestKnowledge: number;
  topKnower: { name: string; email: string; knowledge: number } | null;
  liveExpertCount: number;
}

export interface PassportExpertiseFile {
  filePath: string;
  knowledge: number;
  lastTouchDaysAgo: number;
  touchCount: number;
  band: "fresh" | "warm" | "fading" | "ghosted";
  refreshHint: string;
}

export interface PassportData {
  meta: {
    repoName: string;
    generatedAt: string;
    totalCommits: number;
    repoAuthorCount: number;
    notes: string[];
  };
  identity: {
    name: string;
    email: string;
    dnaHash: string;
    commitCount: number;
    fromDate: string;
    toDate: string;
    activeDays: number;
    repoCommitShare: number;
  };
  expertise: {
    knowledgeMass: number;
    filesKnown: number;
    filesStillFresh: number;
    lastActiveAt: string;
    topFiles: PassportExpertiseFile[];
  };
  influenceSlot: {
    rank: number;
    pageRank: number;
    rankedOf: number;
    originatedShapesAdopted: number;
    adoptionsByOthers: number;
    uniqueAdopters: number;
  } | null;
  telepathySlot: {
    pairs: TelepathyPair[];
    pairsEvaluated: number;
  };
  voice?: Array<{
    phrase: string;
    weight: number;
    count: number;
  }>;
  limits?: string[];
}

export interface BrainLobe {
  lobe: string;
  fileCount: number;
  totalTouches: number;
  topOwner: { name: string; email: string; touches: number } | null;
  freshestFile: { filePath: string; knowledge: number } | null;
  ghostFile: { filePath: string; daysIdle: number; touches: number } | null;
  concentrationPct: number;
}

export interface NervousSystemData {
  meta: NervousSystemMeta;
  hero: {
    headline: string;
    metrics: HeroMetric[];
  };
  alphas: AlphaSlot[];
  telepathy: {
    pairs: TelepathyPair[];
    pairsEvaluated: number;
    distinctAuthorsInGrid: number;
  };
  atrophy: {
    halfLifeDays: number;
    criticalFiles: CriticalFileSlot[];
    ghostedDeepFiles: number;
    filesWithLiveExpert: number;
    fileCount: number;
  };
  passports: PassportData[];
  lobes: BrainLobe[];
  promises?: {
    open: number;
    kept: number;
    stale: number;
    keepRate: number;
  };
  surprising?: string[];
  limits: string[];
  /**
   * Truthy when the JSON was crafted for the live demo rather than computed
   * from a real repo. The dashboard renders a "synthetic demo" pill in that
   * case so nothing is misrepresented.
   */
  _demo_synthetic?: boolean;
  /**
   * Truthy when the data was synthesized in-browser from the GitHub/GitLab
   * REST API. Views use this to render the "LIVE" header badge and
   * gracefully degrade sections that need full-fidelity local data.
   */
  _liveMode?: boolean;
  /** Origin host label for the LIVE badge: e.g. "GitHub" or "GitLab". */
  _liveSource?: string;
  /**
   * Window of commits whose file diffs were fetched in detail (a separate
   * pass after the commit list, capped to stay inside the unauth rate
   * limit). Atrophy heatmap + per-author topFiles are computed from this
   * subset; the rest of the data spans all fetched commits.
   *
   * `from` / `to` are ISO timestamps of the oldest + newest commit in the
   * detail window. `commits` is the count.
   */
  _liveDataWindow?: {
    from: string;
    to: string;
    commits: number;
    totalFetched: number;
  };
}

/** A node placed by the force layout (after we transform NervousSystemData). */
export interface GraphNode {
  id: string;
  name: string;
  email: string;
  knowledgeMass: number;
  /** 0..1 — 1 = fresh, 0 = atrophied. */
  freshness: number;
  /** ISO date this author first appears in the data. */
  joinedAt: number;
  /** ISO ms of last activity. */
  lastActiveAt: number;
  rank: number | null;
  pageRank: number;
  passport: PassportData | null;
  // populated by d3-force
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  score: number;
  events: number;
  topic: string;
  lastSeen: number;
}

export type ViewMode = "graph" | "atrophy" | "influence" | "ecosystems" | "dna" | "scrubber" | "antivirus";

// ─── v1.16 demo data shapes for the new tabs ─────────────────────────

export interface EcosystemDemoSignal {
  id: string;
  displayName: string;
  confidence: number;
  evidence: string[];
  tools: Array<{ name: string; description: string }>;
  augmentedExample?: string;
}

export interface DnaDemoCandidate {
  id: string;
  reference: string;
  existsInRepo: boolean;
  semanticSimilarity: number;
  verdict: "accepted" | "rejected-ast" | "rejected-semantic" | "rejected-confidence";
  reason: string;
  snippet?: string;
}

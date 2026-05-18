/**
 * v2.19.47 — CHRONOSHEAF P1 · pain catalog.
 *
 *   Seven user-reported pains from the v2.19.40-46 dogfood cycle. Each
 *   pain has the same structural shape: every verifier returns OK
 *   pairwise, but the system as a whole carries a contradiction.
 *   The catalog encodes (a) the pain, (b) what the current pairwise
 *   tools see, (c) what they MISS — the missing piece is always a
 *   topological obstruction the sheaf cohomology layer (P2-a) catches.
 *
 *   This file is the formal type-system anchor for the rest of
 *   CHRONOSHEAF: every new primitive references one or more catalog
 *   entries via `painId`, so when we audit "does CHRONOSHEAF actually
 *   cover the user's pain?" the answer is structurally enforced.
 */

export type PainTopology =
  | "time-direction"          // past view vs present view (pulse vs npm)
  | "scale-mismatch"          // detail level inappropriate (216 KB capabilities)
  | "drift-surface"           // continuous monotonic change across releases (685→699→711)
  | "self-reference"          // gate audits itself (HONESTY GATE pulling its own truth)
  | "interface-coherence"     // per-command flag style vs global protocol
  | "epistemic-confidence"    // heuristic 60% with no derivation
  | "substrate-mutation";     // actor's action changes its own substrate (DLL self-lock)

export type PrimitiveTag =
  | "sheaf"
  | "rg_flow"
  | "persistence"
  | "free_energy"
  | "wasserstein"
  | "tropical"
  | "aczel";

export interface PainEntry {
  /** Stable id (PAIN-001 .. PAIN-007). */
  painId: string;
  /** One-line user-facing description. */
  pain: string;
  /** What current pairwise tools actually surface. */
  currentToolsSee: string;
  /** What they MISS — the obstruction class. */
  whatTheyMiss: string;
  /** Topological flavour of the obstruction. */
  topology: PainTopology;
  /** Which P2 primitives address this pain (one pain may need several). */
  primitives: PrimitiveTag[];
  /** Original session/release where the user surfaced it. */
  surfacedIn: string;
}

export const PAIN_CATALOG: ReadonlyArray<PainEntry> = Object.freeze([
  {
    painId: "PAIN-001",
    pain: "pulse บอก v2.19.42 latest, npm มี v2.19.43",
    currentToolsSee: "snapshot freshness at one moment",
    whatTheyMiss: "time-direction inconsistency — the pulse looks BACKWARD (cache) while npm looks FORWARD (registry); two arrows of time clash without a unifying clock",
    topology: "time-direction",
    primitives: ["sheaf", "free_energy"],
    surfacedIn: "v2.19.40-43 dogfood cycle",
  },
  {
    painId: "PAIN-002",
    pain: "219 KB capabilities โหลดทุก session",
    currentToolsSee: "a flat tool list",
    whatTheyMiss: "scale-appropriate detail — AI agent on cold start needs ≤2 KB summary; only on tool-pick does it need full schema; current tool has ONE detail level",
    topology: "scale-mismatch",
    primitives: ["rg_flow", "persistence"],
    surfacedIn: "v2.19.40 SKINNY CAPABILITIES gap",
  },
  {
    painId: "PAIN-003",
    pain: "claim '699 tools' → reality 711",
    currentToolsSee: "a pairwise contradiction between two claim sites",
    whatTheyMiss: "drift surface — the count crept 685 → 699 → 711 across releases; each step looked locally consistent but the trajectory exposed structural drift",
    topology: "drift-surface",
    primitives: ["persistence", "wasserstein"],
    surfacedIn: "v2.19.34-44 catalog churn",
  },
  {
    painId: "PAIN-004",
    pain: "HONESTY GATE ตัวเองพังเงียบ ไม่ trigger CI",
    currentToolsSee: "the gate's stated verdict",
    whatTheyMiss: "self-referential trust — when the gate audits itself, classical logic risks Russell-style paradox; current tools have no formal way to talk about 'who watches the watcher'",
    topology: "self-reference",
    primitives: ["aczel", "sheaf"],
    surfacedIn: "v2.19.40 HONESTY GATE shipped lying",
  },
  {
    painId: "PAIN-005",
    pain: "welcome --json '{}' โยน แม้ MCP family รับ",
    currentToolsSee: "per-command schema",
    whatTheyMiss: "interface coherence as a global obstruction — every command's --json shape needs to be a section of the same sheaf over the command tree; mismatch = H¹ ≠ 0",
    topology: "interface-coherence",
    primitives: ["sheaf", "tropical"],
    surfacedIn: "v2.19.40-45 N6 4-round bug",
  },
  {
    painId: "PAIN-006",
    pain: "verify confidence 60% — ไม่ derive จากอะไร",
    currentToolsSee: "a heuristic number",
    whatTheyMiss: "mathematical guarantee — confidence should be a posterior derived from Bayesian update OR a measure-theoretic bound (Chebyshev / Hoeffding), not a vibe",
    topology: "epistemic-confidence",
    primitives: ["free_energy", "wasserstein"],
    surfacedIn: "v2.19.44 OSMOSIS posterior gap",
  },
  {
    painId: "PAIN-007",
    pain: "self-upgrade Windows DLL lock (libvips EBUSY)",
    currentToolsSee: "an OS-level error message",
    whatTheyMiss: "action that changes the substrate of the actor itself — the running mneme.cmd IS the file being overwritten; classical action models don't handle the actor mutating its own world",
    topology: "substrate-mutation",
    primitives: ["aczel", "free_energy"],
    surfacedIn: "v2.19.41-45 npm install EBUSY",
  },
]);

export interface CatalogStats {
  totalPains: number;
  byTopology: Record<PainTopology, number>;
  byPrimitive: Record<PrimitiveTag, number>;
  /** Which primitives appear in the most pains (importance proxy). */
  primitiveLoad: Array<{ tag: PrimitiveTag; pains: number }>;
}

export function catalogStats(): CatalogStats {
  const byTopology: Record<string, number> = {};
  const byPrimitive: Record<string, number> = {};
  for (const e of PAIN_CATALOG) {
    byTopology[e.topology] = (byTopology[e.topology] ?? 0) + 1;
    for (const p of e.primitives) byPrimitive[p] = (byPrimitive[p] ?? 0) + 1;
  }
  const primitiveLoad = Object.entries(byPrimitive)
    .map(([tag, pains]) => ({ tag: tag as PrimitiveTag, pains }))
    .sort((a, b) => b.pains - a.pains);
  return {
    totalPains: PAIN_CATALOG.length,
    byTopology: byTopology as Record<PainTopology, number>,
    byPrimitive: byPrimitive as Record<PrimitiveTag, number>,
    primitiveLoad,
  };
}

/** Look up every pain that a given primitive addresses. */
export function painsForPrimitive(tag: PrimitiveTag): PainEntry[] {
  return PAIN_CATALOG.filter((e) => e.primitives.includes(tag));
}

/** Look up every primitive needed for a given pain. */
export function primitivesForPain(painId: string): PrimitiveTag[] {
  const e = PAIN_CATALOG.find((x) => x.painId === painId);
  return e ? [...e.primitives] : [];
}

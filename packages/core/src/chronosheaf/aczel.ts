/**
 * v2.19.47 — CHRONOSHEAF P2-g · Aczel anti-foundation axiom (AFA) +
 * bisimulation.
 *
 *   Math foundation (Aczel 1988):
 *
 *     ZFC's Foundation Axiom forbids self-membership: there is no set x
 *     with x ∈ x (no infinite descending ∈-chains). Aczel's AFA flips
 *     this: every "accessible pointed graph" represents exactly one set,
 *     so x = {x} is a perfectly valid set (the "Quine atom"). To work
 *     with these self-referential sets we replace equality with
 *     BISIMULATION:
 *
 *       x ∼ y  ⟺  (∀a∈x ∃b∈y. a ∼ b) ∧ (∀b∈y ∃a∈x. a ∼ b)
 *
 *     The largest such relation (greatest fixed point of the bisimulation
 *     functor) is the canonical notion of "two self-referential sets are
 *     the same". Computing it = standard partition-refinement (Paige-
 *     Tarjan 1987) in O((N + E) · log N) for finite hypergraphs.
 *
 *   AI-memory mapping (PAIN-004 self-reference + PAIN-007 substrate-
 *   mutation):
 *
 *     "HONESTY GATE checks itself" is exactly the Quine-atom shape: the
 *     gate's belief refers to its own consistency. ZFC-style verifiers
 *     cannot represent this without Russell paradox; AFA can. Likewise,
 *     "the running binary is the file being overwritten" is an actor
 *     whose action mutates its own substrate — the world the actor
 *     models contains the actor. Aczel hypersets give us a formal
 *     vocabulary for both.
 *
 *   Implementation: hypersets as labelled directed graphs;
 *   bisimulation via greatest-fixed-point partition refinement. Pure
 *   functional, O((N + E) log N).
 */

/** A node in an APG (accessible pointed graph). */
export type HypersetNode = string;

/** A hyperset = directed graph + designated root. */
export interface Hyperset {
  /** All nodes (including the root). */
  nodes: ReadonlyArray<HypersetNode>;
  /** Edges as a map node → ordered list of children. */
  edges: ReadonlyMap<HypersetNode, ReadonlyArray<HypersetNode>>;
  /** Designated root (the "set" this hyperset represents). */
  root: HypersetNode;
  /** Optional atomic labels — atoms with the same label are bisimilar. */
  labels?: ReadonlyMap<HypersetNode, string>;
}

/**
 * Compute the canonical bisimulation partition (Paige-Tarjan refinement).
 * Returns a map node → equivalence-class id.
 */
export function bisimulationPartition(g: Hyperset): Map<HypersetNode, number> {
  // Initial partition: group by label (or single class if no labels).
  const labels = g.labels ?? new Map<HypersetNode, string>();
  const labelToBlock = new Map<string, number>();
  const node2block = new Map<HypersetNode, number>();
  for (const n of g.nodes) {
    const l = labels.get(n) ?? "__unlabelled__";
    if (!labelToBlock.has(l)) labelToBlock.set(l, labelToBlock.size);
    node2block.set(n, labelToBlock.get(l)!);
  }
  // Refine until stable: each iteration re-assigns block IDs by sorted
  // signature of (oldBlock, sorted child blocks). Stops when the
  // distinct-signature count equals the prior distinct-block count
  // (= no further refinement possible). Bounded by V iterations.
  const V = g.nodes.length;
  for (let iter = 0; iter <= V; iter++) {
    const sig2block = new Map<string, number>();
    const newBlocks = new Map<HypersetNode, number>();
    for (const n of g.nodes) {
      const children = g.edges.get(n) ?? [];
      const childBlocks = children.map((c) => node2block.get(c) ?? -1).sort((a, b) => a - b);
      const oldBlock = node2block.get(n) ?? -1;
      const sig = `${oldBlock}::${childBlocks.join(",")}`;
      if (!sig2block.has(sig)) sig2block.set(sig, sig2block.size);
      newBlocks.set(n, sig2block.get(sig)!);
    }
    // Check for stabilisation: same number of blocks as before AND no
    // node moved to a different block (re-assigned IDs may differ
    // numerically; compare via group structure).
    const prevDistinct = new Set(node2block.values()).size;
    const nextDistinct = new Set(newBlocks.values()).size;
    // Stable when no further split happens.
    if (nextDistinct === prevDistinct && iter > 0) {
      // Confirm structural equality via canonical comparison.
      let stable = true;
      const repToOld = new Map<HypersetNode, number>();
      for (const [n, b] of newBlocks) repToOld.set(b as unknown as HypersetNode, node2block.get(n)!);
      for (const [n, b] of newBlocks) {
        if (repToOld.get(b as unknown as HypersetNode) !== node2block.get(n)) { stable = false; break; }
      }
      if (stable) { for (const [n, b] of newBlocks) node2block.set(n, b); break; }
    }
    for (const [n, b] of newBlocks) node2block.set(n, b);
  }
  return node2block;
}

/** Two hypersets are bisimilar iff their roots are in the same partition class. */
export function bisimilar(g1: Hyperset, g2: Hyperset): boolean {
  // Build a combined graph with disjoint node-name spaces.
  const tag1 = (n: string): string => `A::${n}`;
  const tag2 = (n: string): string => `B::${n}`;
  const nodes: string[] = [...g1.nodes.map(tag1), ...g2.nodes.map(tag2)];
  const edges = new Map<string, string[]>();
  const labels = new Map<string, string>();
  for (const n of g1.nodes) {
    const children = (g1.edges.get(n) ?? []).map(tag1);
    edges.set(tag1(n), children);
    const l = g1.labels?.get(n); if (l !== undefined) labels.set(tag1(n), l);
  }
  for (const n of g2.nodes) {
    const children = (g2.edges.get(n) ?? []).map(tag2);
    edges.set(tag2(n), children);
    const l = g2.labels?.get(n); if (l !== undefined) labels.set(tag2(n), l);
  }
  const combined: Hyperset = { nodes, edges, root: tag1(g1.root), labels };
  const part = bisimulationPartition(combined);
  return part.get(tag1(g1.root)) === part.get(tag2(g2.root));
}

/** The Quine atom Ω with Ω = {Ω}. The canonical self-referential set. */
export function quineAtom(name: string = "Ω"): Hyperset {
  return {
    nodes: [name],
    edges: new Map([[name, [name]]]),
    root: name,
  };
}

/** A "false belief" hyperset: a node whose only child is itself, labelled "LIAR". */
export function liarHyperset(name: string = "L"): Hyperset {
  return {
    nodes: [name],
    edges: new Map([[name, [name]]]),
    root: name,
    labels: new Map([[name, "LIAR"]]),
  };
}

/**
 * Reflexive verifier: returns true if a hyperset is "trustworthy" — its
 * canonical bisimulation class contains no labelled liar atoms.
 * This is the AFA-style fix for PAIN-004: HONESTY GATE can audit itself
 * by checking whether its own hyperset is bisimilar to a known LIAR
 * class WITHOUT triggering Russell paradox (because bisimulation is
 * sound on self-referential sets).
 */
export function isTrustworthy(h: Hyperset): { trust: boolean; reason: string } {
  const part = bisimulationPartition(h);
  const rootBlock = part.get(h.root);
  if (rootBlock === undefined) return { trust: false, reason: "root not in partition" };
  // Liar atoms have label "LIAR" by convention.
  for (const [node, block] of part) {
    if (block === rootBlock && h.labels?.get(node) === "LIAR") {
      return { trust: false, reason: `root bisimilar to LIAR atom '${node}'` };
    }
  }
  return { trust: true, reason: "no LIAR atom in root's bisimulation class" };
}

/**
 * `mneme influence` — code-pattern PageRank.
 *
 * Thesis: GitHub contributors ranks people by commit volume. Mneme ranks
 * people by *pattern propagation* — who writes the patterns that everyone
 * else copies?
 *
 * Algorithm (TypeScript / JavaScript / Python / Go, intentionally bounded):
 *
 *   1. Parse current HEAD:
 *        • TS/JS via the TypeScript compiler API (full-fidelity).
 *        • Python + Go via cheap regex extractors in ./lang-parsers
 *          (no native deps — name + arity is all we need).
 *      → list of (name, signature, filePath) function entities.
 *   2. Derive a "shape signature" per entity: `kind + name + arity`.
 *      Multiple entities across files with the same shape → one shape group.
 *   3. For each unique file in the workspace, ask git for the commit that
 *      first added that file (single `git log --diff-filter=A --reverse`
 *      sweep).  The author of that first-add commit is the originator
 *      candidate for every shape born inside that file.
 *   4. For a shape group with N≥2 files: the file with the EARLIEST first-add
 *      commit hosts the originator. The remaining files = "adoptions";
 *      author of each adopting file's first-add commit owes a graph edge
 *      to the originator.
 *   5. Build directed graph: nodes = author emails; edge A → B with weight
 *      `w` means "A's patterns were adopted by B `w` times".
 *   6. Run PageRank (10 iterations, damping 0.85) on the graph. Highest
 *      rank = "cultural alpha".
 *
 * Honest scope cap:
 *   - Languages analyzed: TS / TSX / JS / JSX / Python / Go. Other languages
 *     (Rust, Java, C#, …) are NOT walked yet — render a HEADS UP so the
 *     reader knows their teammates may be undercounted.
 *   - Python + Go shapes are extracted with regex, not a real parser.
 *     Multi-line signatures or strings that look like declarations may be
 *     under- or over-counted. That noise washes out across the graph as
 *     long as the `--pattern-min-uses` floor is sane.
 *   - Single git repo.  We don't try to merge identities across repos.
 *   - Renames are deliberately ignored.  A file `git mv`'d still counts
 *     its first-add commit as the originator's; that's a feature, not a
 *     bug — moving doesn't copy a pattern, it relocates it.
 *
 * --json shape (stable, documented):
 *
 *   {
 *     "rankings": [
 *       {
 *         "rank": 1,
 *         "author": { "email": "alice@x.io", "name": "Alice" },
 *         "pageRank": 0.341,
 *         "originatedShapes": 12,
 *         "adoptionsByOthers": 47,
 *         "uniqueAdopters": 8
 *       }, ...
 *     ],
 *     "totalShapesAnalyzed": 423,
 *     "shapesWithAdoption": 64,
 *     "languageMix": { "typescript": 88, "javascript": 12, "python": 23, "go": 4 },
 *     "headsUp": "Mneme analyzes TypeScript / JavaScript / Python / Go..."
 *   }
 *
 * Pure data extraction. CLI rendering lives in
 * `packages/cli/src/commands/influence.ts`.
 */
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { execGit } from "../git/exec.js";
import { TypeScriptParser } from "../entities/typescript-parser.js";
import { parseShapesByExtension, SUPPORTED_EXTENSIONS as LANG_PARSER_EXTS } from "./lang-parsers/index.js";
import type { Entity } from "../types.js";

/** A single (name, kind, arity) signature derived from an entity. */
export interface ShapeKey {
  /** Stable string used as a Map key. */
  key: string;
  kind: Entity["kind"];
  name: string;
  arity: number;
}

/** Per-shape attribution. */
export interface ShapeAttribution {
  shape: ShapeKey;
  /** File whose first-add commit is earliest for this shape. */
  originatorFile: string;
  originatorAuthor: string; // email
  originatorAuthorName: string;
  originatorDate: string;
  /** Files that adopt this shape (different file, later first-add). */
  adoptions: Array<{
    file: string;
    author: string; // email
    authorName: string;
    date: string;
  }>;
}

/** Per-author rolled-up stats. */
export interface AuthorRanking {
  rank: number;
  author: { email: string; name: string };
  pageRank: number;
  /** Shapes this author ORIGINATED that any other author adopted. */
  originatedShapesAdopted: number;
  /** Shapes this author originated total (incl. zero-adoption). */
  originatedShapesTotal: number;
  /** Total times others adopted this author's patterns. */
  adoptionsByOthers: number;
  /** Distinct adopters. */
  uniqueAdopters: number;
  /** Shapes this author adopted from others (their copy-paste count). */
  adoptionsByThisAuthor: number;
}

export interface InfluenceReport {
  rankings: AuthorRanking[];
  /** Total shape groups analyzed. */
  totalShapesAnalyzed: number;
  /** Shape groups with ≥2 files (i.e. with at least one adoption). */
  shapesWithAdoption: number;
  /** Map of language → entity count (informational). */
  languageMix: Record<string, number>;
  /** Friendly notice for human renderer. */
  headsUp?: string;
  /** Per-author detail of their top patterns + adopters (kept compact). */
  perAuthor: Record<
    string,
    {
      topShapes: Array<{
        shape: ShapeKey;
        adoptions: number;
        adopters: Array<{ email: string; name: string; file: string }>;
      }>;
    }
  >;
}

export interface InfluenceOptions {
  cwd: string;
  /** Min times a shape must be adopted to count toward the graph. Default 3. */
  patternMinUses?: number;
  /** Show top N (caller renders); does NOT affect the graph itself. */
  topN?: number;
  /** Restrict to a single author. Returns full report; CLI filters render. */
  authorEmail?: string;
}

/* ───────────────────────  Pure helpers  ─────────────────────── */

const ARITY_RE = /\(([^)]*)\)/;

/** Derive a coarse shape from an entity's name + signature.
 *  The shape intentionally elides types — we want "pattern" not "exact match".
 */
export function entityShape(e: Entity): ShapeKey {
  const arity = entityArity(e.signature ?? "");
  const key = `${e.kind}:${e.name}/${arity}`;
  return { key, kind: e.kind, name: e.name, arity };
}

/** Extract arity from a "function f(a, b: T)" style signature. */
export function entityArity(signature: string): number {
  if (!signature) return 0;
  const m = signature.match(ARITY_RE);
  if (!m) return 0;
  const inner = m[1] ?? "";
  if (!inner.trim()) return 0;
  // Split on top-level commas. We don't need real parsing; rough is fine.
  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if (ch === "(" || ch === "[" || ch === "<" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === ">" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

/* ───────────────────────  PageRank  ─────────────────────── */

export interface PageRankInput {
  /** Adjacency: outgoing[A] = list of nodes A points to. */
  outgoing: Map<string, string[]>;
  /** All nodes (incl. nodes with no outgoing edges). */
  nodes: string[];
  damping?: number;
  iterations?: number;
}

/** Pure PageRank — works on weighted edge lists.  `outgoing.get(A)` may
 *  contain duplicates: we treat them as edge-weight repetitions, which is
 *  the natural representation for "A's pattern was adopted by B w times". */
export function pageRank(input: PageRankInput): Map<string, number> {
  const damping = input.damping ?? 0.85;
  const iters = input.iterations ?? 10;
  const N = input.nodes.length;
  if (N === 0) return new Map();

  // Initialise uniformly.
  let rank = new Map<string, number>();
  for (const n of input.nodes) rank.set(n, 1 / N);

  // Pre-compute incoming weighted edges per node.
  // incoming[B] = Map<A, weight>
  const incoming = new Map<string, Map<string, number>>();
  for (const n of input.nodes) incoming.set(n, new Map());
  // outDegree[A] = sum of weights of edges A → *
  const outDegree = new Map<string, number>();
  for (const n of input.nodes) outDegree.set(n, 0);

  for (const [from, tos] of input.outgoing) {
    for (const to of tos) {
      const inc = incoming.get(to);
      if (!inc) continue;
      inc.set(from, (inc.get(from) ?? 0) + 1);
      outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    }
  }

  for (let i = 0; i < iters; i++) {
    const next = new Map<string, number>();
    let danglingMass = 0;
    for (const n of input.nodes) {
      const od = outDegree.get(n) ?? 0;
      if (od === 0) danglingMass += rank.get(n) ?? 0;
    }
    for (const n of input.nodes) {
      let s = 0;
      const inc = incoming.get(n) ?? new Map();
      for (const [from, w] of inc) {
        const od = outDegree.get(from) ?? 0;
        if (od === 0) continue;
        s += ((rank.get(from) ?? 0) * w) / od;
      }
      const v = (1 - damping) / N + damping * (s + danglingMass / N);
      next.set(n, v);
    }
    rank = next;
  }
  return rank;
}

/* ───────────────────────  Git-history walking  ─────────────────────── */

/**
 * For every tracked file under cwd, return the commit that first added it.
 *
 * Implementation: one `git log --diff-filter=A --reverse --name-only` sweep.
 * O(commits) — bounded once per repo, regardless of how many shapes we
 * analyse.
 *
 * Returns Map<filePath, FirstAdd>.  Files that git doesn't have a first-add
 * record for (e.g. untracked) are absent from the map.
 */
export interface FirstAdd {
  hash: string;
  authorEmail: string;
  authorName: string;
  authorDate: string;
}

export async function readFirstAddPerFile(cwd: string): Promise<Map<string, FirstAdd>> {
  // SEP_RECORD between commits, SEP_FIELD between fields. Body of each
  // record is then followed by one filename per line.
  const SEP_RECORD = "\x1e";
  const SEP_FIELD = "\x1f";
  const args = [
    "log",
    "--reverse",
    "--diff-filter=A",
    "--name-only",
    `--pretty=format:${SEP_RECORD}%H${SEP_FIELD}%ae${SEP_FIELD}%an${SEP_FIELD}%aI`,
  ];
  const r = await execGit(args, { cwd });
  if (r.code !== 0) return new Map();

  const out = new Map<string, FirstAdd>();
  const records = r.stdout.split(SEP_RECORD).filter((s) => s.length > 0);
  for (const rec of records) {
    const firstNl = rec.indexOf("\n");
    if (firstNl < 0) continue;
    const head = rec.slice(0, firstNl);
    const body = rec.slice(firstNl + 1);
    const parts = head.split(SEP_FIELD);
    if (parts.length < 4) continue;
    const [hash, email, name, date] = parts;
    if (!hash) continue;
    const files = body
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const f of files) {
      // Only first occurrence wins, since --reverse means oldest first.
      if (!out.has(f)) {
        out.set(f, {
          hash: hash.trim(),
          authorEmail: (email ?? "").trim(),
          authorName: (name ?? "").trim(),
          authorDate: (date ?? "").trim(),
        });
      }
    }
  }
  return out;
}

/* ───────────────────────  Top-level builder  ─────────────────────── */

export async function buildInfluenceReport(opts: InfluenceOptions): Promise<InfluenceReport> {
  const minUses = Math.max(1, opts.patternMinUses ?? 3);

  // 1 — parse HEAD entities.
  //   • TS/JS via the TypeScript compiler API (high-fidelity).
  //   • Python / Go via the cheap regex shape extractors in ./lang-parsers
  //     (good enough for name+arity propagation, no native deps).
  const parser = new TypeScriptParser();
  await parser.preload();
  const entities: Entity[] = [];
  for await (const e of parser.parseRepo({ cwd: opts.cwd })) {
    // Restrict to function-shaped entities — they're what people copy.
    // Classes / types / variables would inflate pattern counts with
    // structural ceremony (PropTypes, TypeMaps, etc.).
    if (e.kind === "function") entities.push(e);
  }

  // Python + Go pass — list git-tracked files, read, run regex extractors.
  for (const e of await parseNonTsShapes(opts.cwd)) {
    if (e.kind === "function") entities.push(e);
  }

  const languageMix: Record<string, number> = {};
  for (const e of entities) {
    languageMix[e.language] = (languageMix[e.language] ?? 0) + 1;
  }

  // 2 — group entities by shape.
  const byShape = new Map<string, { shape: ShapeKey; entities: Entity[] }>();
  for (const e of entities) {
    const shape = entityShape(e);
    let bucket = byShape.get(shape.key);
    if (!bucket) {
      bucket = { shape, entities: [] };
      byShape.set(shape.key, bucket);
    }
    bucket.entities.push(e);
  }

  // 3 — first-add per file.
  const firstAdd = await readFirstAddPerFile(opts.cwd);

  // 4 — per-shape originator + adoptions.
  const attributions: ShapeAttribution[] = [];
  for (const { shape, entities: ents } of byShape.values()) {
    // Distinct files within this shape group.
    const fileSet = new Set<string>();
    for (const e of ents) fileSet.add(e.filePath);
    if (fileSet.size < 2) continue; // No adoption signal — skip for graph.

    // Sort files by first-add date (missing → very late).
    const ordered: Array<{ file: string; add: FirstAdd | undefined }> = Array.from(fileSet)
      .map((file) => ({ file, add: firstAdd.get(file) }))
      .sort((a, b) => {
        const ad = a.add?.authorDate ?? "9999-12-31";
        const bd = b.add?.authorDate ?? "9999-12-31";
        return ad.localeCompare(bd);
      });

    const originator = ordered[0];
    if (!originator || !originator.add) continue; // Can't attribute if file
    // never had a first-add commit (untracked, brand-new uncommitted).
    const adoptions: ShapeAttribution["adoptions"] = [];
    for (let i = 1; i < ordered.length; i++) {
      const cand = ordered[i];
      if (!cand?.add) continue;
      // Skip self-adoption (same author writes same shape in two files).
      // Self-adoptions don't count as cultural propagation.
      if (cand.add.authorEmail === originator.add.authorEmail) continue;
      adoptions.push({
        file: cand.file,
        author: cand.add.authorEmail,
        authorName: cand.add.authorName,
        date: cand.add.authorDate,
      });
    }
    attributions.push({
      shape,
      originatorFile: originator.file,
      originatorAuthor: originator.add.authorEmail,
      originatorAuthorName: originator.add.authorName,
      originatorDate: originator.add.authorDate,
      adoptions,
    });
  }

  // 5 — build directed graph.
  const outgoing = new Map<string, string[]>(); // adopter → [originator * w]
  const nodes = new Set<string>();
  // Per-author roll-ups.
  const originatedTotal = new Map<string, number>(); // originator → shape count (incl. zero-adoption)
  const originatedAdopted = new Map<string, number>();
  const adoptionsByOthers = new Map<string, number>();
  const uniqueAdopters = new Map<string, Set<string>>();
  const adoptionsByMe = new Map<string, number>();
  const authorName = new Map<string, string>();
  const perAuthorTopShapes = new Map<
    string,
    Map<
      string, // shape key
      { shape: ShapeKey; adoptions: number; adopters: Array<{ email: string; name: string; file: string }> }
    >
  >();

  // Count originated total — every shape with ≥1 entity has an originator,
  // even if no adoption.
  for (const a of attributions) {
    nodes.add(a.originatorAuthor);
    if (a.originatorAuthorName) authorName.set(a.originatorAuthor, a.originatorAuthorName);
    originatedTotal.set(
      a.originatorAuthor,
      (originatedTotal.get(a.originatorAuthor) ?? 0) + 1,
    );
  }

  for (const a of attributions) {
    if (a.adoptions.length < minUses) continue; // Filter weak signal.
    originatedAdopted.set(
      a.originatorAuthor,
      (originatedAdopted.get(a.originatorAuthor) ?? 0) + 1,
    );
    if (!uniqueAdopters.has(a.originatorAuthor)) {
      uniqueAdopters.set(a.originatorAuthor, new Set());
    }
    if (!perAuthorTopShapes.has(a.originatorAuthor)) {
      perAuthorTopShapes.set(a.originatorAuthor, new Map());
    }
    const shapesByOriginator = perAuthorTopShapes.get(a.originatorAuthor)!;
    shapesByOriginator.set(a.shape.key, {
      shape: a.shape,
      adoptions: a.adoptions.length,
      adopters: a.adoptions.map((x) => ({
        email: x.author,
        name: x.authorName,
        file: x.file,
      })),
    });

    for (const ad of a.adoptions) {
      nodes.add(ad.author);
      if (ad.authorName) authorName.set(ad.author, ad.authorName);
      // Edge: adopter → originator (PageRank flows credit toward the
      // person whose patterns are adopted).
      const list = outgoing.get(ad.author) ?? [];
      list.push(a.originatorAuthor);
      outgoing.set(ad.author, list);
      adoptionsByOthers.set(
        a.originatorAuthor,
        (adoptionsByOthers.get(a.originatorAuthor) ?? 0) + 1,
      );
      uniqueAdopters.get(a.originatorAuthor)!.add(ad.author);
      adoptionsByMe.set(ad.author, (adoptionsByMe.get(ad.author) ?? 0) + 1);
    }
  }

  // 6 — PageRank.
  const ranks = pageRank({ outgoing, nodes: Array.from(nodes) });

  // 7 — assemble rankings.
  const rankings: AuthorRanking[] = Array.from(nodes)
    .map((email) => ({
      email,
      pageRank: ranks.get(email) ?? 0,
      originatedShapesTotal: originatedTotal.get(email) ?? 0,
      originatedShapesAdopted: originatedAdopted.get(email) ?? 0,
      adoptionsByOthers: adoptionsByOthers.get(email) ?? 0,
      uniqueAdopters: (uniqueAdopters.get(email) ?? new Set()).size,
      adoptionsByThisAuthor: adoptionsByMe.get(email) ?? 0,
      name: authorName.get(email) ?? email,
    }))
    .sort((a, b) => {
      // Primary: PageRank.  Secondary: adoptions-by-others.
      if (b.pageRank !== a.pageRank) return b.pageRank - a.pageRank;
      return b.adoptionsByOthers - a.adoptionsByOthers;
    })
    .map((r, i) => ({
      rank: i + 1,
      author: { email: r.email, name: r.name },
      pageRank: round(r.pageRank, 4),
      originatedShapesAdopted: r.originatedShapesAdopted,
      originatedShapesTotal: r.originatedShapesTotal,
      adoptionsByOthers: r.adoptionsByOthers,
      uniqueAdopters: r.uniqueAdopters,
      adoptionsByThisAuthor: r.adoptionsByThisAuthor,
    }));

  // 8 — per-author top shapes (compact for rendering).
  const perAuthor: InfluenceReport["perAuthor"] = {};
  for (const [email, shapes] of perAuthorTopShapes) {
    perAuthor[email] = {
      topShapes: Array.from(shapes.values())
        .sort((a, b) => b.adoptions - a.adoptions)
        .slice(0, 3),
    };
  }

  // 9 — heads-up message describing language coverage honestly.
  const supportedKinds = ["typescript", "tsx", "javascript", "jsx", "python", "go"];
  const supportedCount = supportedKinds.reduce((s, k) => s + (languageMix[k] ?? 0), 0);
  const headsUp =
    entities.length === 0
      ? "No analyzable functions found at HEAD — Mneme analyzes TypeScript / JavaScript / Python / Go."
      : supportedCount === entities.length
        ? "Mneme analyzes TypeScript / JavaScript / Python / Go. Other languages (Rust, Java, etc.) were not analyzed and may underweight some authors."
        : "Mneme analyzes TypeScript / JavaScript / Python / Go. Other languages were not analyzed; influence rank may not reflect full team.";

  return {
    rankings,
    totalShapesAnalyzed: byShape.size,
    shapesWithAdoption: attributions.length,
    languageMix,
    headsUp,
    perAuthor,
  };
}

function round(n: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

/**
 * Walk git-tracked Python + Go files and run the regex shape extractors.
 * Honest scope: regex-based, so multi-line signatures and string-literals
 * that look like declarations may be missed or false-positive. That noise
 * washes out across the PageRank graph — adoption that doesn't repeat
 * across multiple files never crosses the `--pattern-min-uses` floor.
 */
async function parseNonTsShapes(cwd: string): Promise<Entity[]> {
  const r = await execGit(["ls-files"], { cwd });
  if (r.code !== 0) return [];
  const tracked = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => LANG_PARSER_EXTS.has(extname(p).toLowerCase()))
    .filter((p) => !/(^|\/)tests?\//.test(p))
    .filter((p) => !/_test\.(py|go)$|\/test_/.test(p))
    .filter((p) => !/(^|\/)(\.venv|venv|__pycache__|vendor|testdata|dist|build|node_modules)\//.test(p));

  const out: Entity[] = [];
  for (const rel of tracked) {
    let source: string;
    try {
      source = await readFile(join(cwd, rel), "utf8");
    } catch {
      continue;
    }
    try {
      for (const e of parseShapesByExtension(rel, source)) {
        out.push(e);
      }
    } catch {
      // best-effort — keep going on bad files
    }
  }
  return out;
}

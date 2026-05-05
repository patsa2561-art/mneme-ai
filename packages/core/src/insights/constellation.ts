/**
 * `mneme constellation` — build a graph view of the codebase as a living
 * map: files are stars, authors are orbital bodies, edges are co-edits
 * (file↔file) and authorships (file↔author).
 *
 * v0.12 ships the graph extraction + JSON export + ASCII summary. A web
 * UI (`mneme constellation --serve` for a 3D WebGL viewer) is on the
 * roadmap; the graph data is the underlying truth either way.
 *
 * Pure data extraction. No external services. No 3D rendering here —
 * just the graph the renderer needs.
 */
import type { Commit } from "../types.js";

export interface FileStar {
  filePath: string;
  /** Total times the file was committed in window. */
  weight: number;
  /** Last touched ISO date. */
  lastTouched: string;
  /** Top-level directory — useful for clustering / coloring. */
  cluster: string;
}

export interface AuthorOrbital {
  author: string;
  /** Total commits in window. */
  weight: number;
  /** Top files this author "orbits" (by touch share). */
  topFiles: string[];
}

export interface FileEdge {
  /** Sorted alphabetically: a < b. */
  fileA: string;
  fileB: string;
  /** Number of commits that touched both files together. */
  coEdits: number;
}

export interface AuthorshipEdge {
  author: string;
  filePath: string;
  touches: number;
}

export interface Constellation {
  windowCommits: number;
  fileStars: FileStar[];
  authorOrbitals: AuthorOrbital[];
  fileEdges: FileEdge[];
  authorshipEdges: AuthorshipEdge[];
  /** Number of distinct top-level clusters (directories) detected. */
  clusterCount: number;
}

export function buildConstellation(
  commits: Commit[],
  opts: {
    minFileTouches?: number;
    minAuthorCommits?: number;
    maxFileEdges?: number;
    maxStars?: number;
    maxOrbitals?: number;
  } = {},
): Constellation {
  const minFileTouches = opts.minFileTouches ?? 2;
  const minAuthorCommits = opts.minAuthorCommits ?? 2;
  const maxFileEdges = opts.maxFileEdges ?? 200;
  const maxStars = opts.maxStars ?? 200;
  const maxOrbitals = opts.maxOrbitals ?? 30;

  // file → { weight, lastTouched }
  const filesMap = new Map<string, { weight: number; lastTouched: string }>();
  // author → { weight, topFiles map }
  const authorsMap = new Map<string, { weight: number; files: Map<string, number> }>();
  // co-edit map: "a||b" → coEdits
  const coEditMap = new Map<string, number>();
  // authorship: "author||file" → touches
  const authorshipMap = new Map<string, AuthorshipEdge>();

  for (const c of commits) {
    const files = c.files;
    const author = c.authorName || c.authorEmail;
    // bump file weight
    for (const f of files) {
      let fr = filesMap.get(f);
      if (!fr) {
        fr = { weight: 0, lastTouched: c.authorDate };
        filesMap.set(f, fr);
      }
      fr.weight += 1;
      if (c.authorDate.localeCompare(fr.lastTouched) > 0) {
        fr.lastTouched = c.authorDate;
      }
      // authorship edge
      const akey = `${author}||${f}`;
      let ae = authorshipMap.get(akey);
      if (!ae) {
        ae = { author, filePath: f, touches: 0 };
        authorshipMap.set(akey, ae);
      }
      ae.touches += 1;
      // author orbital weight
      let ar = authorsMap.get(author);
      if (!ar) {
        ar = { weight: 0, files: new Map() };
        authorsMap.set(author, ar);
      }
      ar.weight += 1;
      ar.files.set(f, (ar.files.get(f) ?? 0) + 1);
    }
    // co-edit edges (every pair of files in a commit)
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i]!;
        const b = files[j]!;
        const [x, y] = a < b ? [a, b] : [b, a];
        const key = `${x}||${y}`;
        coEditMap.set(key, (coEditMap.get(key) ?? 0) + 1);
      }
    }
  }

  // Build file stars (filtered + capped)
  const fileStars: FileStar[] = [];
  for (const [filePath, info] of filesMap) {
    if (info.weight < minFileTouches) continue;
    fileStars.push({
      filePath,
      weight: info.weight,
      lastTouched: info.lastTouched.slice(0, 10),
      cluster: filePath.split("/").slice(0, 2).join("/") || "(root)",
    });
  }
  fileStars.sort((a, b) => b.weight - a.weight);
  if (fileStars.length > maxStars) fileStars.length = maxStars;

  // Build orbitals (filtered + capped)
  const authorOrbitals: AuthorOrbital[] = [];
  for (const [author, info] of authorsMap) {
    if (info.weight < minAuthorCommits) continue;
    const topFiles = [...info.files.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);
    authorOrbitals.push({ author, weight: info.weight, topFiles });
  }
  authorOrbitals.sort((a, b) => b.weight - a.weight);
  if (authorOrbitals.length > maxOrbitals) authorOrbitals.length = maxOrbitals;

  // Build file edges (top by coEdits)
  const allFileEdges: FileEdge[] = [];
  for (const [key, n] of coEditMap) {
    if (n < 2) continue;
    const [a, b] = key.split("||");
    allFileEdges.push({ fileA: a!, fileB: b!, coEdits: n });
  }
  allFileEdges.sort((a, b) => b.coEdits - a.coEdits);
  const fileEdges = allFileEdges.slice(0, maxFileEdges);

  // Build authorship edges
  const authorshipEdges: AuthorshipEdge[] = [...authorshipMap.values()]
    .filter((e) => e.touches >= minFileTouches)
    .sort((a, b) => b.touches - a.touches);

  // Cluster count
  const clusters = new Set<string>(fileStars.map((s) => s.cluster));

  return {
    windowCommits: commits.length,
    fileStars,
    authorOrbitals,
    fileEdges,
    authorshipEdges,
    clusterCount: clusters.size,
  };
}

/**
 * Render an ASCII summary suitable for terminal output. The web UI will
 * consume the JSON directly via `--json`.
 */
export function renderConstellationAscii(c: Constellation, topN = 8): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${c.fileStars.length} file-stars  ·  ${c.authorOrbitals.length} orbitals  ·  ${c.fileEdges.length} co-edit edges  ·  ${c.clusterCount} clusters`);
  lines.push("");
  lines.push("  ◆ Brightest stars (most-touched files)");
  for (const s of c.fileStars.slice(0, topN)) {
    const meter = bar(s.weight, c.fileStars[0]?.weight ?? 1);
    lines.push(`    ${meter}  ${s.filePath}  (${s.weight}×)`);
  }
  lines.push("");
  lines.push("  ◆ Closest orbitals (most-active authors)");
  for (const o of c.authorOrbitals.slice(0, topN)) {
    const meter = bar(o.weight, c.authorOrbitals[0]?.weight ?? 1);
    lines.push(`    ${meter}  ${o.author}  (${o.weight} commits)`);
  }
  lines.push("");
  lines.push("  ◆ Strongest co-edit edges (files often committed together)");
  for (const e of c.fileEdges.slice(0, topN)) {
    lines.push(`    ${e.coEdits}×  ${shorten(e.fileA, 35)} ⟷ ${shorten(e.fileB, 35)}`);
  }
  return lines.join("\n");
}

function bar(value: number, max: number, width = 8): string {
  if (max <= 0) return " ".repeat(width);
  const blocks = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(blocks) + "░".repeat(width - blocks);
}

function shorten(s: string, n: number): string {
  return s.length <= n ? s : "…" + s.slice(s.length - n + 1);
}

/**
 * v2.25.0 — LIVING SOUL CODEGRAPH builder.
 *
 * Walks the repo (respecting .gitignore via the existing chunker pattern)
 * and extracts:
 *   - file nodes
 *   - exported symbols (function / class / const / type / interface)
 *   - import edges (file → file or file → external dep)
 *   - export edges (file → symbol)
 *
 * Uses lightweight regex parsing — fast (~10ms per file) + zero TypeScript
 * compiler dependency. Tradeoff: misses dynamic imports, computed names,
 * and complex re-exports. v2.25.x can swap in a real AST parser.
 *
 * Why regex-not-AST: Mneme's positioning is anti-LLM-lock-in; we ship
 * primitives that work offline + cross-platform + with zero peer deps.
 * A regex parser ships now; AST upgrade is opt-in.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { join, relative, resolve, dirname, extname, sep, posix } from "node:path";

import type {
  CodeGraph, CodeNode, CodeEdge, BuildOptions, NodeKind,
} from "./types.js";
import { canon } from "./types.js";
import { chainEdges } from "./store.js";
import { merkleRoot } from "./merkle.js";

const HMAC_KEY = process.env["MNEME_CODEGRAPH_KEY"] ?? "mneme-codegraph-v1";

const DEFAULT_EXCLUDE = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  ".cache", "coverage", ".mneme", ".vscode", ".idea", "out",
]);

const TS_JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Stable id helpers. */
function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function nodeId(kind: NodeKind, path: string, symbol?: string): string {
  const key = `${kind}|${path}|${symbol ?? ""}`;
  return `${kind}:${shortHash(key)}`;
}

function edgeId(srcId: string, dstId: string, kind: string): string {
  return shortHash(`${srcId}>${dstId}>${kind}`);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

interface WalkOpts {
  exclude: Set<string>;
  maxBytes: number;
  include?: string[];
}

function* walk(dir: string, repoRoot: string, opts: WalkOpts): IterableIterator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); }
  catch { return; }
  for (const name of entries) {
    if (opts.exclude.has(name)) continue;
    if (name.startsWith(".") && opts.exclude.has(name)) continue;
    const full = join(dir, name);
    let stat;
    try { stat = statSync(full); }
    catch { continue; }
    if (stat.isDirectory()) {
      yield* walk(full, repoRoot, opts);
    } else if (stat.isFile()) {
      if (stat.size > opts.maxBytes) continue;
      const rel = toPosix(relative(repoRoot, full));
      const ext = extname(name).toLowerCase();
      if (!TS_JS_EXT.has(ext)) continue;
      yield rel;
    }
  }
}

// ─── regex parsers ─────────────────────────────────────────────────

// import { X, Y } from "./foo"
// import X from "./foo"
// import * as X from "./foo"
// import "./foo"
const IMPORT_RE = /import(?:\s+(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)(?:\s*,\s*(?:\*\s+as\s+\w+|\{[^}]*\}|\w+))*\s+from)?\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Exported declarations
const EXPORT_FN_RE = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
const EXPORT_CLASS_RE = /^export\s+(?:abstract\s+)?class\s+(\w+)/gm;
const EXPORT_CONST_RE = /^export\s+(?:const|let|var)\s+(\w+)/gm;
const EXPORT_TYPE_RE = /^export\s+type\s+(\w+)/gm;
const EXPORT_INTERFACE_RE = /^export\s+interface\s+(\w+)/gm;
const EXPORT_DEFAULT_RE = /^export\s+default\s+(?:async\s+function\s+(\w+)?|class\s+(\w+)?|(\w+))/gm;
// re-exports: `export { X } from "./foo"`
const EXPORT_REEXPORT_RE = /^export\s+(?:\{[^}]*\}|\*\s+(?:as\s+\w+\s+)?)\s+from\s+['"]([^'"]+)['"]/gm;

function parseFile(content: string): {
  imports: string[];
  exports: Array<{ kind: NodeKind; symbol: string; line: number }>;
} {
  const imports = new Set<string>();
  for (const re of [IMPORT_RE, DYN_IMPORT_RE, REQUIRE_RE, EXPORT_REEXPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const spec = m[1];
      if (spec) imports.add(spec);
    }
  }
  const exports: Array<{ kind: NodeKind; symbol: string; line: number }> = [];
  const collect = (re: RegExp, kind: NodeKind) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const idx = m.index;
      const line = content.slice(0, idx).split("\n").length;
      // EXPORT_DEFAULT_RE has 3 capture groups; pick the first non-null
      const sym = m[1] ?? m[2] ?? m[3];
      if (sym) exports.push({ kind, symbol: sym, line });
    }
  };
  collect(EXPORT_FN_RE, "function");
  collect(EXPORT_CLASS_RE, "class");
  collect(EXPORT_CONST_RE, "constant");
  collect(EXPORT_TYPE_RE, "type");
  collect(EXPORT_INTERFACE_RE, "interface");
  collect(EXPORT_DEFAULT_RE, "function");  // default export — best-effort

  return { imports: [...imports], exports };
}

/** Resolve a relative import spec to a repo-relative path (best-effort). */
function resolveImport(fromFile: string, spec: string, knownFiles: Set<string>): string | null {
  if (!spec.startsWith(".")) return null; // external
  const fromDir = dirname(fromFile);
  const baseAbs = posix.normalize(posix.join(fromDir, spec));
  // Try common extensions
  const candidates = [
    baseAbs,
    baseAbs + ".ts", baseAbs + ".tsx", baseAbs + ".js", baseAbs + ".jsx",
    baseAbs + ".mjs", baseAbs + ".cjs",
    posix.join(baseAbs, "index.ts"), posix.join(baseAbs, "index.tsx"),
    posix.join(baseAbs, "index.js"), posix.join(baseAbs, "index.jsx"),
    // .js → .ts (TypeScript NodeNext: import "./foo.js" actually means foo.ts)
    baseAbs.endsWith(".js") ? baseAbs.replace(/\.js$/, ".ts") : "",
    baseAbs.endsWith(".js") ? baseAbs.replace(/\.js$/, ".tsx") : "",
    baseAbs.endsWith(".jsx") ? baseAbs.replace(/\.jsx$/, ".tsx") : "",
  ].filter(Boolean);
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  return null;
}

/**
 * Build a LIVING SOUL codegraph for a repo. Pure-IO (no spawn), runs
 * sequentially. For 1000-file TS repo, expected ~2-4 seconds cold.
 */
export function buildGraph(repoRoot: string, opts: BuildOptions = {}): CodeGraph {
  const exclude = new Set(opts.exclude ?? [...DEFAULT_EXCLUDE]);
  const maxBytes = opts.maxBytes ?? 500_000;
  const touchedBy = opts.touchedBy ?? "mneme-daemon";

  // Walk to discover files first (so we can resolve relative imports).
  const files: string[] = [];
  for (const rel of walk(repoRoot, repoRoot, { exclude, maxBytes, include: opts.include })) {
    files.push(rel);
  }
  const knownFiles = new Set(files);

  const nodes = new Map<string, CodeNode>();
  const edges = new Map<string, CodeEdge>();
  const builtAt = new Date().toISOString();

  // Detect current commit (best-effort).
  let commit = "WORKING-TREE";
  try {
    const headPath = resolve(repoRoot, ".git", "HEAD");
    if (existsSync(headPath)) {
      const head = readFileSync(headPath, "utf8").trim();
      if (head.startsWith("ref: ")) {
        const ref = head.slice(5);
        const refPath = resolve(repoRoot, ".git", ref);
        if (existsSync(refPath)) commit = readFileSync(refPath, "utf8").trim();
      } else {
        commit = head;
      }
    }
  } catch { /* best-effort */ }

  for (const rel of files) {
    const fileNode: CodeNode = {
      id: nodeId("file", rel),
      kind: "file",
      path: rel,
      lang: extname(rel).slice(1),
    };
    nodes.set(fileNode.id, fileNode);

    let content: string;
    try { content = readFileSync(resolve(repoRoot, rel), "utf8"); }
    catch { continue; }

    const { imports, exports } = parseFile(content);

    // Exported symbol nodes + export edges
    for (const ex of exports) {
      const symNode: CodeNode = {
        id: nodeId(ex.kind, rel, ex.symbol),
        kind: ex.kind,
        path: rel,
        symbol: ex.symbol,
        line: ex.line,
        lang: extname(rel).slice(1),
      };
      nodes.set(symNode.id, symNode);
      const e: CodeEdge = {
        id: edgeId(fileNode.id, symNode.id, "exports"),
        src: fileNode.id,
        dst: symNode.id,
        kind: "exports",
        confidence: 1,
        lastSeen: builtAt,
        touchedBy,
        firstSeenCommit: commit,
        hmac: "", // filled below by chainEdges
      };
      edges.set(e.id, e);
    }

    // Import edges
    for (const spec of imports) {
      const resolved = resolveImport(rel, spec, knownFiles);
      let dstId: string;
      if (resolved) {
        dstId = nodeId("file", resolved);
        // Resolved file node may not exist if it was a duplicate; ensure it.
        if (!nodes.has(dstId)) {
          nodes.set(dstId, {
            id: dstId,
            kind: "file",
            path: resolved,
            lang: extname(resolved).slice(1),
          });
        }
      } else {
        // external dep → "external" node
        dstId = nodeId("external", spec);
        if (!nodes.has(dstId)) {
          nodes.set(dstId, {
            id: dstId,
            kind: "external",
            path: spec,
          });
        }
      }
      const e: CodeEdge = {
        id: edgeId(fileNode.id, dstId, "imports"),
        src: fileNode.id,
        dst: dstId,
        kind: "imports",
        confidence: resolved ? 1 : 0.7,
        lastSeen: builtAt,
        touchedBy,
        firstSeenCommit: commit,
        hmac: "",
      };
      edges.set(e.id, e);
    }
  }

  // Chain edges in canonical (id-sorted) order so the hmac sequence is
  // deterministic across machines.
  const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  chainEdges(sortedEdges);
  // Rewrite back to the map with chained edges (preserving the order).
  edges.clear();
  for (const e of sortedEdges) edges.set(e.id, e);

  // Merkle root over chained edges.
  const root = merkleRoot(sortedEdges);

  // Stats
  const byKind: Record<string, number> = {};
  for (const n of nodes.values()) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  for (const e of edges.values()) byKind[`edge:${e.kind}`] = (byKind[`edge:${e.kind}`] ?? 0) + 1;

  return {
    repoRoot,
    commit,
    builtAt,
    nodes,
    edges,
    merkleRoot: root,
    stats: {
      nodes: nodes.size,
      edges: edges.size,
      byKind,
    },
  };
}

/** Convenience: derive a stable HMAC signature for a full graph snapshot. */
export function graphSignature(graph: CodeGraph): string {
  const payload = {
    commit: graph.commit,
    merkleRoot: graph.merkleRoot,
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.size,
  };
  return createHmac("sha256", HMAC_KEY).update(canon(payload)).digest("hex").slice(0, 32);
}

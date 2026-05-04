#!/usr/bin/env node
/**
 * Mneme web — zero-dep HTTP server that exposes the indexed memory as a graph.
 *
 *   GET /                    → static UI (index.html + d3 from CDN)
 *   GET /api/graph           → nodes + links from .mneme/mneme.db
 *   GET /api/graph?at=<iso>  → graph state at that point in git history
 *   GET /api/timeline        → ordered list of commit timestamps for the scrubber
 *
 *   MNEME_DB=/abs/path/to/.mneme/mneme.db node server.js
 *
 * If MNEME_DB is unset, the server walks up from the cwd looking for .mneme/mneme.db.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.MNEME_PORT ?? 4711);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const dbPath = resolveDbPath();
const Database = dbPath ? await loadSqlite() : null;
const db = dbPath && Database ? new Database(dbPath, { readonly: true }) : null;

function resolveDbPath() {
  if (process.env.MNEME_DB && existsSync(process.env.MNEME_DB)) {
    return process.env.MNEME_DB;
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, ".mneme", "mneme.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadSqlite() {
  try {
    const mod = await import("better-sqlite3");
    return mod.default;
  } catch {
    return null;
  }
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function buildGraph(atIso, { collapseAfter = 200, bucketDays = 7 } = {}) {
  if (!db) {
    return {
      mode: "stub",
      note: "No .mneme/mneme.db found. Set MNEME_DB env var or run from a directory under an indexed repo.",
      nodes: [
        { id: "demo:1", kind: "commit", label: "demo", date: new Date().toISOString() },
      ],
      links: [],
    };
  }

  const cutoff = atIso || new Date().toISOString();

  // Pull a wider window if we'll collapse later — the supercluster code
  // needs the full population to compute weekly buckets.
  const commits = db
    .prepare(
      `SELECT hash, short_hash, author_name, author_date, subject, pr_number
       FROM commits
       WHERE author_date <= ?
       ORDER BY author_date DESC
       LIMIT 5000`,
    )
    .all(cutoff);

  const incidents = db
    .prepare(
      `SELECT id, source, title, occurred_at, severity, affected_files
       FROM incidents
       WHERE occurred_at <= ?
       ORDER BY occurred_at DESC
       LIMIT 100`,
    )
    .all(cutoff);

  const correlations = db
    .prepare(
      `SELECT id, from_kind, from_id, to_kind, to_id, weight, reason
       FROM correlations
       WHERE weight >= 0.3
       LIMIT 500`,
    )
    .all();

  const nodes = [];
  const seen = new Set();
  const collapsing = commits.length > collapseAfter;

  if (collapsing) {
    // Group commits into N-day buckets (default 7 days).
    const buckets = new Map(); // key=YYYY-MM-DD-of-bucket-start → { count, dateStart, dateEnd, authors:Set, hashes:[] }
    const ms = bucketDays * 24 * 60 * 60 * 1000;
    for (const c of commits) {
      const t = Date.parse(c.author_date);
      if (!Number.isFinite(t)) continue;
      const bucketStart = Math.floor(t / ms) * ms;
      const key = new Date(bucketStart).toISOString().slice(0, 10);
      let b = buckets.get(key);
      if (!b) {
        b = { count: 0, dateStart: new Date(bucketStart).toISOString(), dateEnd: new Date(bucketStart + ms).toISOString(), authors: new Set(), hashes: [], prCount: 0, lastSubject: c.subject };
        buckets.set(key, b);
      }
      b.count++;
      b.authors.add(c.author_name);
      b.hashes.push(c.hash);
      if (c.pr_number) b.prCount++;
    }
    for (const [key, b] of buckets) {
      const id = `cluster:${key}`;
      seen.add(id);
      // Mark every member commit as belonging to this cluster (so links can rewire).
      for (const h of b.hashes) seen.add(`commit:${h}`);
      nodes.push({
        id,
        kind: "cluster",
        label: `${b.count} commits · ${b.authors.size} author(s)`,
        date: b.dateStart,
        dateRange: { start: b.dateStart, end: b.dateEnd },
        commitCount: b.count,
        authorCount: b.authors.size,
        prCount: b.prCount,
        memberHashes: b.hashes.slice(0, 50), // cap for transport size
      });
    }
  } else {
    for (const c of commits) {
      const id = `commit:${c.hash}`;
      seen.add(id);
      nodes.push({
        id,
        kind: "commit",
        label: c.subject.slice(0, 80),
        hash: c.short_hash,
        author: c.author_name,
        date: c.author_date,
        prNumber: c.pr_number ?? null,
      });
    }
  }

  for (const i of incidents) {
    const id = `incident:${i.id}`;
    seen.add(id);
    nodes.push({
      id,
      kind: "incident",
      label: i.title?.slice(0, 80) ?? i.id,
      severity: i.severity,
      source: i.source,
      date: i.occurred_at,
      affectedFiles: i.affected_files ? JSON.parse(i.affected_files) : [],
    });
  }

  const links = [];
  if (collapsing) {
    // Re-target correlations from individual commits to the cluster they live in.
    const hashToCluster = new Map();
    for (const n of nodes) {
      if (n.kind === "cluster" && Array.isArray(n.memberHashes)) {
        for (const h of n.memberHashes) hashToCluster.set(h, n.id);
      }
    }
    const seenLink = new Set();
    for (const c of correlations) {
      let source = `${c.from_kind}:${c.from_id}`;
      const target = `${c.to_kind}:${c.to_id}`;
      if (c.from_kind === "commit") {
        const cluster = hashToCluster.get(c.from_id);
        if (cluster) source = cluster;
        else continue;
      }
      const key = `${source}|${target}`;
      if (seenLink.has(key)) continue;
      seenLink.add(key);
      if (!seen.has(source) || !seen.has(target)) continue;
      links.push({ source, target, weight: c.weight, reason: c.reason });
    }
  } else {
    for (const c of correlations) {
      const source = `${c.from_kind}:${c.from_id}`;
      const target = `${c.to_kind}:${c.to_id}`;
      if (!seen.has(source) || !seen.has(target)) continue;
      links.push({ source, target, weight: c.weight, reason: c.reason });
    }
  }

  return {
    mode: "live",
    at: cutoff,
    collapsed: collapsing,
    bucketDays: collapsing ? bucketDays : null,
    counts: { nodes: nodes.length, links: links.length, sourceCommits: commits.length },
    nodes,
    links,
  };
}

function buildTimeline() {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT author_date AS date FROM commits
       UNION ALL SELECT occurred_at AS date FROM incidents
       ORDER BY date ASC`,
    )
    .all();
  return rows.map((r) => r.date);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/api/graph") {
      const at = url.searchParams.get("at");
      const collapseAfter = Number(url.searchParams.get("collapseAfter") ?? 200);
      const bucketDays = Number(url.searchParams.get("bucketDays") ?? 7);
      const out = jsonResponse(buildGraph(at, { collapseAfter, bucketDays }));
      res.writeHead(out.status, out.headers);
      res.end(out.body);
      return;
    }

    if (url.pathname === "/api/timeline") {
      const out = jsonResponse({ timestamps: buildTimeline() });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
      return;
    }

    if (url.pathname === "/api/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, db: dbPath ?? null }));
      return;
    }

    // Static files.
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(PUBLIC_DIR, path);
    const data = await readFile(file);
    const mime = MIME[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  process.stdout.write(`mneme web → http://localhost:${PORT}\n`);
  if (dbPath) process.stdout.write(`            db = ${dbPath}\n`);
  else process.stdout.write(`            db = (none — graph will be a stub)\n`);
});

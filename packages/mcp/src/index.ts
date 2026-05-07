import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { git, retrieve, store, htc, type AskResult, type SearchResult } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";

export interface McpOptions {
  cwd: string;
}

/** Resolve the published package version from package.json — single source of truth.
 *  Never hardcode versions in source: they drift silently across releases. */
function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json (sits beside dist/)
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const TOOLS: Tool[] = [
  {
    name: "mneme_ask",
    description:
      "Ask the codebase memory a question about WHY something exists. Returns the most relevant commits and PRs with citations.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural language question" },
        topK: { type: "number", description: "Max results (default 8)" },
      },
      required: ["question"],
    },
  },
  {
    name: "mneme_why",
    description:
      "Explain why a specific file (or line range) exists by combining git blame with related commits.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path relative to repo root" },
        startLine: { type: "number" },
        endLine: { type: "number" },
      },
      required: ["file"],
    },
  },
  {
    name: "mneme_search_commits",
    description: "Hybrid (lexical + semantic) search over indexed commits and PRs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topK: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "mneme_status",
    description: "Report what's indexed, the embedder, and DB stats.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mneme_list_entities",
    description:
      "List indexed source-code entities (functions, classes, types, exported variables) with optional filtering by language/kind/path-prefix.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "function | class | type | variable | module" },
        language: { type: "string", description: "typescript | tsx | javascript | jsx" },
        pathPrefix: { type: "string", description: "Only entities under this path" },
        limit: { type: "number", description: "Max rows (default 100)" },
      },
    },
  },
  {
    name: "mneme_find_similar",
    description:
      "Given an entity id (from mneme_list_entities) OR a code snippet, return the top-K most semantically similar entities in the repo.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "Existing entity id" },
        snippet: { type: "string", description: "Or a code snippet to compare against" },
        topK: { type: "number" },
      },
    },
  },
  {
    name: "mneme_blast",
    description:
      "Predict the blast radius of shipping a commit: which past incidents share its file footprint, plus a base-rate verdict (LOW/MED/HIGH).",
    inputSchema: {
      type: "object",
      properties: {
        commit: { type: "string", description: "Commit hash, short hash, or HEAD-relative ref" },
        windowHours: { type: "number" },
      },
      required: ["commit"],
    },
  },
];

export async function startMcpServer(opts: McpOptions): Promise<void> {
  if (!(await git.isGitRepo(opts.cwd))) {
    throw new Error(`Mneme MCP: not in a git repo (${opts.cwd}).`);
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const dbDir = join(meta.rootPath, ".mneme");
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "mneme.db");

  const s = new store.MnemeStore(dbPath);
  const embedder = await resolveEmbedder({ provider: "auto" });

  const server = new Server(
    { name: "mneme", version: resolveVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    // v0.24 HTC: default to compressed responses when Layer-1 abstracts exist.
    // Caller opts out with `compress=false` to get raw bodies.
    const compressOptOut = args["compress"] === false;
    function htcCompressedFor(results: SearchResult[]): Map<string, string> | undefined {
      if (compressOptOut) return undefined;
      try {
        const cached = htc.getAllAbstracts(s);
        if (cached.size === 0) return undefined;
        const out = new Map<string, string>();
        for (const r of results) {
          const hit = cached.get(r.commit.hash);
          if (hit) out.set(r.commit.hash, hit.abstract);
        }
        return out.size > 0 ? out : undefined;
      } catch {
        return undefined;
      }
    }
    try {
      switch (req.params.name) {
        case "mneme_ask": {
          const result = await retrieve.ask(String(args["question"] ?? ""), {
            store: s,
            embedder,
            repo: meta,
            topK: typeof args["topK"] === "number" ? args["topK"] : 8,
          });
          return jsonResult(toAskPayload(result, htcCompressedFor(result.searchResults)));
        }
        case "mneme_search_commits": {
          const results = await retrieve.search(String(args["query"] ?? ""), {
            store: s,
            embedder,
            repo: meta,
            topK: typeof args["topK"] === "number" ? args["topK"] : 8,
          });
          const compressed = htcCompressedFor(results);
          return jsonResult(results.map((sr) => toSearchPayload(sr, compressed)));
        }
        case "mneme_why": {
          const file = String(args["file"] ?? "");
          const sl = typeof args["startLine"] === "number" ? args["startLine"] : undefined;
          const el = typeof args["endLine"] === "number" ? args["endLine"] : undefined;
          const blamed = await git.blame(meta.rootPath, file, sl, el);
          const tally = new Map<string, number>();
          for (const b of blamed) tally.set(b.commitHash, (tally.get(b.commitHash) ?? 0) + 1);
          const top = Array.from(tally.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([h, count]) => ({
              commit: s.getCommit(h) ?? null,
              hash: h,
              lineCount: count,
            }));
          return jsonResult({ file, startLine: sl, endLine: el, originating: top });
        }
        case "mneme_status": {
          return jsonResult({
            commits: s.countCommits(),
            chunks: s.countChunks(),
            embedded: s.countChunksWithEmbedding(),
            entities: s.countEntities(),
            entitiesEmbedded: s.countEntitiesWithEmbedding(),
            synthesizedNotes: s.countSynthesizedNotes(),
            embedder: s.getMeta("embedder"),
            repoRoot: meta.rootPath,
            host: meta.host,
            owner: meta.owner,
            repo: meta.repo,
          });
        }
        case "mneme_list_entities": {
          const where: string[] = [];
          const params: unknown[] = [];
          if (args["kind"]) {
            where.push("kind = ?");
            params.push(String(args["kind"]));
          }
          if (args["language"]) {
            where.push("language = ?");
            params.push(String(args["language"]));
          }
          if (args["pathPrefix"]) {
            where.push("file_path LIKE ?");
            params.push(`${String(args["pathPrefix"])}%`);
          }
          const limit = typeof args["limit"] === "number" ? Math.min(500, args["limit"]) : 100;
          const sql =
            "SELECT id, kind, name, file_path, start_line, end_line, signature, language FROM entities" +
            (where.length ? " WHERE " + where.join(" AND ") : "") +
            " ORDER BY file_path, start_line LIMIT ?";
          const rows = s.db.prepare(sql).all(...params, limit);
          return jsonResult({ entities: rows, count: (rows as unknown[]).length });
        }
        case "mneme_find_similar": {
          const topK = typeof args["topK"] === "number" ? args["topK"] : 5;
          const entityId = args["entityId"] ? String(args["entityId"]) : undefined;
          const snippet = args["snippet"] ? String(args["snippet"]) : undefined;
          let queryVec: Float32Array | null = null;
          if (entityId) {
            // Use the stored embedding directly.
            const row = s.db
              .prepare("SELECT embedding FROM entities WHERE id = ?")
              .get(entityId) as { embedding: Buffer | null } | undefined;
            if (!row?.embedding) {
              return errorResult(`No embedding for entity ${entityId}. Run \`mneme entities\` first.`);
            }
            queryVec = new Float32Array(
              row.embedding.buffer,
              row.embedding.byteOffset,
              row.embedding.length / 4,
            );
          } else if (snippet) {
            const [v] = await embedder.embed([snippet]);
            queryVec = v ?? null;
          } else {
            return errorResult("mneme_find_similar requires either entityId or snippet.");
          }
          if (!queryVec) return jsonResult({ matches: [] });
          const candidates: Array<{ entity: unknown; score: number }> = [];
          for (const e of s.iterEmbeddedEntities()) {
            if (!e.embedding) continue;
            if (entityId && e.id === entityId) continue;
            if (e.embedding.length !== queryVec.length) continue;
            let dot = 0;
            let na = 0;
            let nb = 0;
            for (let i = 0; i < queryVec.length; i++) {
              const av = queryVec[i]!;
              const bv = e.embedding[i]!;
              dot += av * bv;
              na += av * av;
              nb += bv * bv;
            }
            const denom = Math.sqrt(na) * Math.sqrt(nb);
            const sim = denom === 0 ? 0 : dot / denom;
            candidates.push({ entity: { ...e, embedding: undefined }, score: sim });
          }
          candidates.sort((a, b) => b.score - a.score);
          return jsonResult({ matches: candidates.slice(0, topK) });
        }
        case "mneme_blast": {
          const ref = String(args["commit"] ?? "");
          if (!ref) return errorResult("mneme_blast requires `commit`.");
          const r = await git.execGit(["rev-parse", ref], { cwd: meta.rootPath });
          if (r.code !== 0) return errorResult(`Cannot resolve commit "${ref}".`);
          const hash = r.stdout.trim();
          const c = s.getCommit(hash);
          if (!c) return errorResult(`Commit ${hash.slice(0, 8)} not indexed.`);
          const incidents = s.db
            .prepare("SELECT * FROM incidents")
            .all() as Array<Record<string, unknown>>;
          const cFiles = new Set(c.files.map((p) => p.replace(/\\/g, "/").toLowerCase()));
          const matches = incidents
            .map((i) => {
              const inc = {
                id: String(i.id),
                title: String(i.title),
                affected: i.affected_files
                  ? (JSON.parse(String(i.affected_files)) as string[])
                  : [],
              };
              const overlap = inc.affected.filter((f) =>
                cFiles.has(f.replace(/\\/g, "/").toLowerCase()),
              );
              return overlap.length > 0 ? { incident: inc, overlap } : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          return jsonResult({ commit: c.shortHash, fileCount: c.files.length, matches });
        }
        default:
          return errorResult(`unknown tool: ${req.params.name}`);
      }
    } catch (err) {
      return errorResult((err as Error).message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function toAskPayload(r: AskResult, compressedAbstracts?: Map<string, string>): unknown {
  return {
    question: r.question,
    summary: r.summary,
    citations: r.citations,
    results: r.searchResults.map((s) => toSearchPayload(s, compressedAbstracts)),
  };
}

/**
 * v0.24 HTC: when an abstracts map is provided, emit the compressed payload
 * (abstract, hash, subject only — drops raw body + full file list). MCP
 * clients (Claude Code, Cursor, Codex) consume ~10× fewer tokens.
 *
 * Caller can opt back into raw with `compress=false` in tool args.
 */
function toSearchPayload(s: SearchResult, compressedAbstracts?: Map<string, string>): unknown {
  if (compressedAbstracts && compressedAbstracts.has(s.commit.hash)) {
    return {
      score: s.score,
      commit: {
        hash: s.commit.hash,
        shortHash: s.commit.shortHash,
        date: s.commit.authorDate.slice(0, 10),
        author: s.commit.authorName,
        // Compressed abstract takes the place of subject + body
        abstract: compressedAbstracts.get(s.commit.hash),
        // Keep prNumber as a lightweight cross-ref
        prNumber: s.commit.prNumber,
      },
      compressed: true,
      matchedKinds: Array.from(new Set(s.matchedChunks.map((c) => c.kind))),
    };
  }
  return {
    score: s.score,
    commit: {
      hash: s.commit.hash,
      shortHash: s.commit.shortHash,
      author: s.commit.authorName,
      date: s.commit.authorDate,
      subject: s.commit.subject,
      body: s.commit.body,
      files: s.commit.files,
      prNumber: s.commit.prNumber,
    },
    matchedKinds: Array.from(new Set(s.matchedChunks.map((c) => c.kind))),
  };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

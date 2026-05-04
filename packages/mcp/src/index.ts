import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { git, retrieve, store, type AskResult, type SearchResult } from "@mneme-ai/core";
import { resolveEmbedder } from "@mneme-ai/embeddings";

export interface McpOptions {
  cwd: string;
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
    { name: "mneme", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (req.params.name) {
        case "mneme_ask": {
          const result = await retrieve.ask(String(args["question"] ?? ""), {
            store: s,
            embedder,
            repo: meta,
            topK: typeof args["topK"] === "number" ? args["topK"] : 8,
          });
          return jsonResult(toAskPayload(result));
        }
        case "mneme_search_commits": {
          const results = await retrieve.search(String(args["query"] ?? ""), {
            store: s,
            embedder,
            repo: meta,
            topK: typeof args["topK"] === "number" ? args["topK"] : 8,
          });
          return jsonResult(results.map(toSearchPayload));
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
            embedder: s.getMeta("embedder"),
            repoRoot: meta.rootPath,
            host: meta.host,
            owner: meta.owner,
            repo: meta.repo,
          });
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

function toAskPayload(r: AskResult): unknown {
  return {
    question: r.question,
    summary: r.summary,
    citations: r.citations,
    results: r.searchResults.map(toSearchPayload),
  };
}

function toSearchPayload(s: SearchResult): unknown {
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

/**
 * Memory tools — Q&A, semantic search, citations, blast-radius.
 *
 * These are the "ask the codebase a question" verbs. The AI student should
 * pick from this category whenever the user wants to know WHY code exists,
 * what changed, or what a commit might affect.
 */

import { retrieve, git, htc, type SearchResult } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export const memoryTools: MnemeTool[] = [
  {
    name: "mneme.memory.ask",
    category: "memory",
    description:
      "Answer a natural-language question about the repo's history and intent. " +
      "Returns a synthesized verdict with 5-15 cited commits/PRs that justify the answer. " +
      "Use this WHEN the user asks: 'why does X exist?', 'when did we add Y?', 'what was the reason for Z?', " +
      "'how does this work?', or any other curiosity about WHY code looks the way it does.",
    whenToUse:
      "User asks WHY code exists or WHEN something was added — answers grounded in cited commits, not generated prose.",
    triggers: [
      "ทำไม parseAmount ใช้ try/catch?",
      "why does the webhook handler retry 3 times?",
      "เมื่อไหร่ที่เราเพิ่ม rate limiting?",
      "what was the rationale behind the JWT migration?",
    ],
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language question" },
        topK: { type: "number", description: "Max cited commits (default 8)" },
      },
      required: ["question"],
    },
    outputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        summary: { type: "string", description: "1-2 sentence synthesized answer." },
        citations: { type: "array", items: { type: "string" }, description: "Commit hashes that justify the answer." },
        results: { type: "array", items: { type: "object" }, description: "Per-result detail with score + abstract." },
      },
    },
    examples: [
      {
        userQuery: "Why does the auth middleware reject tokens older than 7 days?",
        args: { question: "Why does the auth middleware reject tokens older than 7 days?", topK: 8 },
        expectedOutput:
          "Returns { summary: '...', citations: ['a3f9b21', 'c0e2d5f', ...], results: [...] }. The wisdom field carries the cited verdict; quote it directly to the user.",
      },
    ],
    pitfalls: [
      "Requires the index to be built — run `mneme index` first or this returns 'no commits found'.",
      "If citations < 3, the verdict is best-effort. Surface the low confidence to the user instead of overstating.",
      "Doesn't read CURRENT code — only commits + their diffs. For 'how does this work today' questions, pair with a code-read tool.",
    ],
    composeWith: ["mneme.memory.why", "mneme.insights.story", "mneme.people.who_knows"],
    handler: async (rt, args) => {
      const question = String(args["question"] ?? "");
      const topK = typeof args["topK"] === "number" ? (args["topK"] as number) : 8;
      const result = await retrieve.ask(question, {
        store: rt.store,
        embedder: rt.embedder,
        repo: rt.meta,
        topK,
      });
      const compressed = compressedAbstractsFor(rt, result.searchResults);
      const cited = result.citations.length;
      const confidence = cited >= 3 ? "high" : cited >= 1 ? "medium" : "low";
      const wisdom =
        cited === 0
          ? "I couldn't find supporting commits — the repo may not contain history about this question. Tell the user the answer is unverifiable here."
          : `Based on ${cited} cited commit${cited === 1 ? "" : "s"}, here's what the repo says: ${result.summary}`;
      return {
        data: {
          question: result.question,
          summary: result.summary,
          citations: result.citations,
          results: result.searchResults.map((s) => toSearchPayload(s, compressed)),
        },
        wisdom,
        followUp:
          cited > 0
            ? ["mneme.memory.why", "mneme.insights.story", "mneme.people.who_knows"]
            : ["mneme.memory.search_commits"],
        confidence: { level: confidence },
        secondBrain: {
          presentation:
            "Quote `wisdom` directly. Cite each commit hash inline like `(per a3f9b21)` — never invent hashes. " +
            "If citations are < 3, tell the user the answer is best-effort and offer to widen the search.",
        },
      };
    },
  },
  {
    name: "mneme.memory.why",
    category: "memory",
    description:
      "Explain why a specific FILE (or line range within it) exists by combining git blame with related commits. " +
      "Returns the originating commits ranked by line ownership. " +
      "Use this WHEN the user asks: 'who wrote this line?', 'why is THIS function here?', " +
      "'what introduced src/auth.ts:47?', 'origin of this code'.",
    triggers: [
      "why does src/auth.ts use JWT?",
      "ใครเขียนบรรทัดที่ 47?",
      "origin of this function",
      "explain why this file exists",
    ],
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path relative to repo root" },
        startLine: { type: "number", description: "Optional 1-indexed start line" },
        endLine: { type: "number", description: "Optional 1-indexed end line" },
      },
      required: ["file"],
    },
    handler: async (rt, args) => {
      const file = String(args["file"] ?? "");
      const sl = typeof args["startLine"] === "number" ? (args["startLine"] as number) : undefined;
      const el = typeof args["endLine"] === "number" ? (args["endLine"] as number) : undefined;
      const blamed = await git.blame(rt.meta.rootPath, file, sl, el);
      const tally = new Map<string, number>();
      for (const b of blamed) tally.set(b.commitHash, (tally.get(b.commitHash) ?? 0) + 1);
      const top = Array.from(tally.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([h, count]) => ({
          commit: rt.store.getCommit(h) ?? null,
          hash: h,
          lineCount: count,
        }));
      const owner = top[0]?.commit?.authorName ?? "unknown";
      const wisdom = top.length
        ? `${file}${sl ? `:${sl}${el && el !== sl ? `-${el}` : ""}` : ""} traces back to ${top.length} commit${top.length === 1 ? "" : "s"}. The dominant author is ${owner}. Walk the citations to understand the WHY.`
        : `No git history found for ${file} — the file may be unstaged or untracked.`;
      return {
        data: { file, startLine: sl, endLine: el, originating: top },
        wisdom,
        followUp: top.length
          ? ["mneme.people.atrophy", "mneme.people.lineage", "mneme.insights.time_machine"]
          : [],
        confidence: { level: top.length ? "high" : "low" },
        secondBrain: {
          presentation:
            "Lead with the dominant author + commit hash. Then list the top 3 originating commits as bullet points. " +
            "If the user asks 'why is this the way it is?' — proactively offer file_archaeology composition.",
        },
      };
    },
  },
  {
    name: "mneme.memory.search_commits",
    category: "memory",
    description:
      "Hybrid (lexical + semantic) search over indexed commits and PRs. " +
      "Use this when the user wants to find commits matching a concept, not a specific file. " +
      "Use this WHEN the user asks: 'find commits about X', 'show me PRs related to Y', " +
      "'what work has happened on Z?'. Use mneme.memory.ask instead when the user wants " +
      "a synthesized answer rather than a list of commits.",
    triggers: [
      "find all commits about rate limiting",
      "show PRs that touched the cache layer",
      "ค้นหา commit เกี่ยวกับ payments",
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        topK: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    },
    handler: async (rt, args) => {
      const query = String(args["query"] ?? "");
      const topK = typeof args["topK"] === "number" ? (args["topK"] as number) : 8;
      const results = await retrieve.search(query, {
        store: rt.store,
        embedder: rt.embedder,
        repo: rt.meta,
        topK,
      });
      const compressed = compressedAbstractsFor(rt, results);
      const wisdom = results.length
        ? `Found ${results.length} matching commits. Top hit: "${results[0]?.commit.subject ?? "?"}" (${results[0]?.commit.shortHash}).`
        : "No commits matched. Try broadening the query or check if the repo is indexed (mneme.memory.status).";
      return {
        data: results.map((sr) => toSearchPayload(sr, compressed)),
        wisdom,
        followUp: results.length ? ["mneme.memory.ask", "mneme.insights.story"] : ["mneme.memory.status"],
        confidence: { level: results.length ? "high" : "low" },
      };
    },
  },
  {
    name: "mneme.memory.status",
    category: "memory",
    description:
      "Report what's indexed in this repo's Mneme memory: total commits, embedded chunks, entities, embedder choice. " +
      "Use this WHEN the user asks 'is the index up to date?', 'how many commits did Mneme see?', " +
      "or as a sanity check before an ask/search returns no results.",
    triggers: [
      "is mneme indexed?",
      "how many commits do you see?",
      "status ของ index",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (rt) => {
      const data = {
        commits: rt.store.countCommits(),
        chunks: rt.store.countChunks(),
        embedded: rt.store.countChunksWithEmbedding(),
        entities: rt.store.countEntities(),
        entitiesEmbedded: rt.store.countEntitiesWithEmbedding(),
        synthesizedNotes: rt.store.countSynthesizedNotes(),
        embedder: rt.store.getMeta("embedder"),
        repoRoot: rt.meta.rootPath,
        host: rt.meta.host,
        owner: rt.meta.owner,
        repo: rt.meta.repo,
      };
      const wisdom =
        data.commits === 0
          ? "Repo is NOT indexed yet — the user must run `mneme index` once before Q&A will work."
          : `Index has ${data.commits} commits, ${data.embedded}/${data.chunks} chunks embedded with ${data.embedder ?? "an unknown embedder"}.`;
      return {
        data,
        wisdom,
        followUp: data.commits === 0 ? [] : ["mneme.memory.ask", "mneme.memory.search_commits"],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.memory.list_entities",
    category: "memory",
    description:
      "List indexed source-code entities (functions, classes, types, exported variables) with optional filtering by " +
      "language/kind/path-prefix. Use this WHEN the user wants to enumerate symbols in a folder, find all classes, " +
      "or get an entity ID before calling mneme.memory.find_similar.",
    triggers: [
      "list all functions in src/auth/",
      "what classes are exported?",
      "show me every type defined in core",
    ],
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "function | class | type | variable | module" },
        language: { type: "string", description: "typescript | tsx | javascript | jsx | python | go | rust | ruby | php" },
        pathPrefix: { type: "string", description: "Only entities under this path" },
        limit: { type: "number", description: "Max rows (default 100, max 500)" },
      },
    },
    handler: async (rt, args) => {
      const where: string[] = [];
      const params: Array<string | number> = [];
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
      const limit = typeof args["limit"] === "number" ? Math.min(500, args["limit"] as number) : 100;
      const sql =
        "SELECT id, kind, name, file_path, start_line, end_line, signature, language FROM entities" +
        (where.length ? " WHERE " + where.join(" AND ") : "") +
        " ORDER BY file_path, start_line LIMIT ?";
      const rows = rt.store.db.prepare(sql).all(...params, limit) as unknown[];
      const wisdom = rows.length
        ? `Found ${rows.length} entit${rows.length === 1 ? "y" : "ies"} matching the filter.`
        : "No entities match — try without filters, or check that `mneme entities` has been run.";
      return {
        data: { entities: rows, count: rows.length },
        wisdom,
        followUp: rows.length ? ["mneme.memory.find_similar", "mneme.quality.clones"] : [],
        confidence: { level: "high" },
      };
    },
  },
  {
    name: "mneme.memory.find_similar",
    category: "memory",
    description:
      "Given an entity ID OR a code snippet, return the top-K most semantically similar entities elsewhere in the repo. " +
      "Use this WHEN the user wants to find duplicate-shaped code, similar functions across files, or " +
      "candidates to refactor into a shared utility. Provide either entityId (preferred) OR snippet.",
    triggers: [
      "find functions similar to validateEmail",
      "any code that looks like this snippet?",
      "duplicates of this helper",
    ],
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "Existing entity id (from mneme.memory.list_entities)" },
        snippet: { type: "string", description: "Or a code snippet to compare against" },
        topK: { type: "number", description: "Max similar entities (default 5)" },
      },
    },
    handler: async (rt, args) => {
      const topK = typeof args["topK"] === "number" ? (args["topK"] as number) : 5;
      const entityId = args["entityId"] ? String(args["entityId"]) : undefined;
      const snippet = args["snippet"] ? String(args["snippet"]) : undefined;
      let queryVec: Float32Array | null = null;
      if (entityId) {
        const row = rt.store.db
          .prepare("SELECT embedding FROM entities WHERE id = ?")
          .get(entityId) as { embedding: Uint8Array | null } | undefined;
        if (!row?.embedding) {
          return {
            data: { matches: [] },
            wisdom: `No embedding stored for entity ${entityId}. Tell the user to run \`mneme entities\` first.`,
            confidence: { level: "low" },
          };
        }
        const blob = row.embedding;
        const copy = new Uint8Array(blob.byteLength);
        copy.set(blob);
        queryVec = new Float32Array(copy.buffer, 0, copy.byteLength / 4);
      } else if (snippet) {
        const [v] = await rt.embedder.embed([snippet]);
        queryVec = v ?? null;
      } else {
        return {
          data: { matches: [] },
          wisdom: "Need either entityId or snippet to search by similarity.",
          confidence: { level: "low" },
        };
      }
      if (!queryVec) return { data: { matches: [] }, wisdom: "No query vector.", confidence: { level: "low" } };
      const candidates: Array<{ entity: unknown; score: number }> = [];
      for (const e of rt.store.iterEmbeddedEntities()) {
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
      const matches = candidates.slice(0, topK);
      const top = matches[0];
      const wisdom = top
        ? `Top match scores ${(top.score * 100).toFixed(1)}% similarity. Higher than ~85% suggests near-duplicates worth refactoring.`
        : "No similar entities found in the indexed corpus.";
      return {
        data: { matches },
        wisdom,
        followUp: matches.length ? ["mneme.quality.clones"] : [],
        confidence: { level: matches.length ? "medium" : "low" },
      };
    },
  },
  {
    name: "mneme.memory.blast",
    category: "memory",
    description:
      "Predict the BLAST RADIUS of shipping a commit: which past incidents share its file footprint, plus a " +
      "base-rate verdict (LOW / MED / HIGH). Use this WHEN the user asks 'is this commit safe to ship?', " +
      "'what could break if I merge this?', 'has my file footprint caused incidents before?'. " +
      "Pass a commit hash, short hash, or HEAD-relative ref like HEAD~3.",
    triggers: [
      "is HEAD safe to ship?",
      "what's the blast radius of commit a3f9b21?",
      "predict incidents from this PR",
    ],
    inputSchema: {
      type: "object",
      properties: {
        commit: { type: "string", description: "Commit hash, short hash, or HEAD-relative ref" },
        windowHours: { type: "number", description: "Look-ahead window in hours (default 72)" },
      },
      required: ["commit"],
    },
    handler: async (rt, args) => {
      const ref = String(args["commit"] ?? "");
      if (!ref) {
        return { data: { matches: [] }, wisdom: "blast requires a commit ref.", confidence: { level: "low" } };
      }
      const r = await git.execGit(["rev-parse", ref], { cwd: rt.meta.rootPath });
      if (r.code !== 0) {
        return {
          data: { matches: [] },
          wisdom: `Cannot resolve commit "${ref}" — check the ref exists.`,
          confidence: { level: "low" },
        };
      }
      const hash = r.stdout.trim();
      const c = rt.store.getCommit(hash);
      if (!c) {
        return {
          data: { matches: [] },
          wisdom: `Commit ${hash.slice(0, 8)} is not indexed. Tell the user to run \`mneme index\`.`,
          confidence: { level: "low" },
        };
      }
      const incidents = rt.store.db.prepare("SELECT * FROM incidents").all() as Array<Record<string, unknown>>;
      const cFiles = new Set(c.files.map((p) => p.replace(/\\/g, "/").toLowerCase()));
      const matches = incidents
        .map((i) => {
          const inc = {
            id: String(i.id),
            title: String(i.title),
            affected: i.affected_files ? (JSON.parse(String(i.affected_files)) as string[]) : [],
          };
          const overlap = inc.affected.filter((f) => cFiles.has(f.replace(/\\/g, "/").toLowerCase()));
          return overlap.length > 0 ? { incident: inc, overlap } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const verdict = matches.length === 0 ? "LOW" : matches.length <= 2 ? "MED" : "HIGH";
      const wisdom =
        matches.length === 0
          ? `LOW risk: commit ${c.shortHash} touches ${c.files.length} files, none overlap with past incidents.`
          : `${verdict} risk: commit ${c.shortHash} touches ${matches.length} file${matches.length === 1 ? "" : "s"} that have caused incidents before. Recommend extra review.`;
      return {
        data: { commit: c.shortHash, fileCount: c.files.length, matches, verdict },
        wisdom,
        followUp: matches.length ? ["mneme.insights.premortem", "mneme.audit.certify"] : [],
        confidence: { level: "medium" },
        secondBrain: {
          presentation:
            "Open with the verdict (LOW/MED/HIGH) in bold. If matches > 0, list each historical incident with its date " +
            "and the overlapping files. If verdict is HIGH, explicitly recommend extra review before merge.",
        },
      };
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// helpers shared across tools in this module
// ──────────────────────────────────────────────────────────────────────────

function compressedAbstractsFor(rt: { store: import("@mneme-ai/core").store.MnemeStore }, results: SearchResult[]): Map<string, string> | undefined {
  try {
    const cached = htc.getAllAbstracts(rt.store);
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

function toSearchPayload(s: SearchResult, compressed?: Map<string, string>): unknown {
  if (compressed && compressed.has(s.commit.hash)) {
    return {
      score: s.score,
      commit: {
        hash: s.commit.hash,
        shortHash: s.commit.shortHash,
        date: s.commit.authorDate.slice(0, 10),
        author: s.commit.authorName,
        abstract: compressed.get(s.commit.hash),
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

/**
 * MCP `resources` primitive — Mneme exposes 5 read-only views agents can
 * fetch (and, eventually, subscribe to for change notifications):
 *
 *   • mneme://constitution                 — repo's auto-synthesized rules
 *   • mneme://catalog                       — full tool catalog (JSON)
 *   • mneme://catalog/{category}            — one category of tools
 *   • mneme://atrophy/heatmap               — current atrophy snapshot
 *   • mneme://passport/{email}              — engineer dossier
 *   • mneme://chronicle/latest              — latest chaptered narrative
 *   • mneme://aletheia/karma                — public tool reputation ledger
 *
 * v1.18.0 ships static / on-demand resources. Subscriptions + push updates
 * (Mneme Whisper) land in v1.19.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { crossLayerGraph } from "@mneme-ai/core";
import { buildAllTools, groupByCategory } from "../tools/_registry.js";
import type { ToolRuntime } from "../tools/_types.js";

// Scan a repo for the cross-layer graph (code + schema + routes + docs). Bounded + dependency-free.
function scanForGraph(root: string, cap = 4000): crossLayerGraph.SourceFile[] {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
  const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|prisma|sql|md|mdx|markdown|txt)$/i;
  const files: crossLayerGraph.SourceFile[] = []; const stack = [root];
  while (stack.length && files.length < cap) {
    const d = stack.pop() as string; let ents: string[] = []; try { ents = readdirSync(d); } catch { continue; }
    for (const e of ents) { if (SKIP.has(e)) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(root.length + 1), content: readFileSync(p, "utf8") }); } catch { /* */ } } }
  }
  return files;
}

export interface McpResourceListItem {
  uri: string;
  name: string;
  mimeType: string;
  description?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

const STATIC_RESOURCES: McpResourceListItem[] = [
  {
    uri: "mneme://catalog",
    name: "Mneme tool catalog (full)",
    mimeType: "application/json",
    description: "Every Mneme tool: name, category, description, contract fields. Same data mneme.capabilities returns.",
  },
  {
    uri: "mneme://constitution",
    name: "Repo constitution (auto-synthesized rules)",
    mimeType: "text/markdown",
    description: "The rule library Mneme infers from this repo's regrets, atrophy, and security history.",
  },
  {
    uri: "mneme://aletheia/karma",
    name: "ALETHEIA tool reputation ledger",
    mimeType: "application/json",
    description: "Per-tool karma score (verified +1, hallucination -3, fuzz hit -2). Public + auditable.",
  },
  {
    uri: "mneme://lineage/inheritance",
    name: "MneMeiosis boot inheritance bundle",
    mimeType: "application/json",
    description: "(v1.19) Auto-fertilized at MCP server boot — combines top-3 ancestor chromosomes via Mendelian merge. Read this FIRST to know what prior AI sessions left for you.",
  },
  {
    uri: "mneme://updates/status",
    name: "Mneme self-update status",
    mimeType: "application/json",
    description: "(v1.19.2) Cached npm-registry version-check result — current vs latest, updateAvailable, lastChecked. Mneme refreshes this every 24h in the background.",
  },
  {
    uri: "mneme://graph",
    name: "Cross-layer graph (code ↔ data ↔ api ↔ business)",
    mimeType: "application/json",
    description: "🕸 The whole repo as ONE structured graph: functions ↔ DB tables ↔ API endpoints ↔ business rules, + keystones (single points of failure) + orphans. Deterministic, no LLM. Pull this into context instead of re-deriving the architecture. For one node's blast radius, read mneme://graph/<name>.",
  },
];

export function listResources(rt: ToolRuntime): McpResourceListItem[] {
  const out: McpResourceListItem[] = [...STATIC_RESOURCES];
  for (const cat of groupByCategory().keys()) {
    out.push({
      uri: `mneme://catalog/${cat}`,
      name: `Mneme tool catalog — ${cat}`,
      mimeType: "application/json",
      description: `Tools in the ${cat} category.`,
    });
  }
  // Per-passport resources are listed lazily — listing every author would
  // bloat the catalog. Agents fetch via mneme://passport/{email} directly.
  out.push({
    uri: "mneme://passport/{email}",
    name: "Engineer passport (template URI)",
    mimeType: "application/json",
    description: "Replace {email} with an author's email to fetch their dossier (DNA + expertise + telepathy + influence + atrophy).",
  });
  out.push({
    uri: "mneme://graph/{name}",
    name: "Cross-layer blast radius of one node (template URI)",
    mimeType: "application/json",
    description: "Replace {name} with a function / table / endpoint to fetch its cross-layer blast radius (which tables it writes, endpoints reach it, rules it implements).",
  });
  // Suppress unused-runtime warning at compile time — kept for future use.
  void rt;
  return out;
}

export function readResource(rt: ToolRuntime, uri: string): McpResourceContent {
  if (uri === "mneme://catalog") {
    const all = buildAllTools().map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
      whenToUse: t.whenToUse ?? null,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema ?? null,
    }));
    return { uri, mimeType: "application/json", text: JSON.stringify(all, null, 2) };
  }
  if (uri.startsWith("mneme://catalog/")) {
    const cat = uri.slice("mneme://catalog/".length);
    const tools = (groupByCategory().get(cat as never) ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      whenToUse: t.whenToUse ?? null,
    }));
    return { uri, mimeType: "application/json", text: JSON.stringify(tools, null, 2) };
  }
  if (uri === "mneme://constitution") {
    const path = join(rt.meta.rootPath, ".mneme", "constitution.md");
    if (existsSync(path)) {
      return { uri, mimeType: "text/markdown", text: readFileSync(path, "utf8") };
    }
    return {
      uri,
      mimeType: "text/markdown",
      text:
        "# Constitution not yet synthesized\n\n" +
        "Run `mneme constitution synth` to derive a rule library from this repo's history.",
    };
  }
  if (uri === "mneme://aletheia/karma") {
    const path = join(rt.meta.rootPath, ".mneme", "aletheia", "karma.json");
    if (existsSync(path)) {
      return { uri, mimeType: "application/json", text: readFileSync(path, "utf8") };
    }
    return { uri, mimeType: "application/json", text: JSON.stringify({ tools: {} }, null, 2) };
  }
  if (uri === "mneme://lineage/inheritance") {
    // Read the bundle stashed at MCP boot by startMcpServer's auto-fertilize.
    const bundle = (globalThis as { __mnemeInheritanceBundle?: unknown }).__mnemeInheritanceBundle;
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(bundle ?? { empty: true, note: "no lineage to inherit yet — fresh repo or lineage opted out" }, null, 2),
    };
  }
  if (uri === "mneme://updates/status") {
    // Read the cached version-check result stashed by startMcpServer.
    const status = (globalThis as { __mnemeUpdateStatus?: unknown }).__mnemeUpdateStatus;
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(status ?? { empty: true, note: "version check has not run yet — try again in a few seconds" }, null, 2),
    };
  }
  if (uri.startsWith("mneme://passport/")) {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          note:
            "Passport resources are fetched on-demand from the index. Use the mneme.people.passport tool with the author's email — this URI is a placeholder for v1.19+ live binding.",
        },
        null,
        2,
      ),
    };
  }
  // 🕸 CROSS-LAYER GRAPH — the whole repo's code↔data↔api↔business graph as one structured resource an
  // agent can pull into context (instead of re-deriving it). `mneme://graph` = full graph + health;
  // `mneme://graph/<name>` = the blast radius of one function/table/endpoint.
  if (uri === "mneme://graph") {
    const root = rt?.meta?.rootPath ?? process.cwd();
    const g = crossLayerGraph.buildCrossLayerGraph(scanForGraph(root));
    const h = crossLayerGraph.graphHealth(g);
    const byType = (t: string) => g.nodes.filter((n) => n.type === t).length;
    const payload = {
      summary: { functions: byType("function"), tables: byType("db_table"), endpoints: byType("api_endpoint"), businessRules: byType("business_rule"), edges: g.edges.length },
      keystones: h.keystones.slice(0, 25).map((k) => ({ name: k.node.name, file: k.node.file, soleWriterOf: k.soleWriterOf, fanIn: k.fanIn, endpoints: k.reachedByEndpoints })),
      orphanTables: h.orphanTables.map((t) => t.name), orphanEndpoints: h.orphanEndpoints.map((e) => `${e.method} ${e.name}`),
      tables: g.nodes.filter((n) => n.type === "db_table").map((n) => n.name),
      endpoints: g.nodes.filter((n) => n.type === "api_endpoint").map((n) => `${n.method} ${n.name}`),
      // cross-layer edges only (the within-code CALLS graph is huge — fetch a focused slice for that)
      crossLayerEdges: g.edges.filter((e) => e.relation !== "CALLS").map((e) => ({ source: e.source.replace(/^fn:[^#]*#/, ""), target: e.target.replace(/^(db|api|biz):/, ""), relation: e.relation })).slice(0, 2000),
      note: "Deterministic, no LLM — every node/edge derives from a real file. For one node's full blast radius, read mneme://graph/<name>.",
    };
    return { uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) };
  }
  if (uri.startsWith("mneme://graph/")) {
    const name = decodeURIComponent(uri.slice("mneme://graph/".length));
    const root = rt?.meta?.rootPath ?? process.cwd();
    const g = crossLayerGraph.buildCrossLayerGraph(scanForGraph(root));
    const node = crossLayerGraph.resolveNode(g, name);
    if (!node) return { uri, mimeType: "application/json", text: JSON.stringify({ error: `no function/table/endpoint matching "${name}"`, hint: "read mneme://graph for the full list" }, null, 2) };
    const br = crossLayerGraph.blastRadius(g, node.id, { maxDepth: 2 });
    return { uri, mimeType: "application/json", text: JSON.stringify({ node: { type: node.type, name: node.name, file: node.file }, blastRadius: { tables: br.tables.map((t) => t.name), endpoints: br.endpoints.map((e) => `${e.method} ${e.name}`), businessRules: br.rules.map((r) => r.name), functions: br.functions.slice(0, 60).map((f) => f.name), reachable: br.reachable } }, null, 2) };
  }
  throw new Error(`unknown resource URI: ${uri}`);
}

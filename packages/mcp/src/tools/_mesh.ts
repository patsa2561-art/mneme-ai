/**
 * MCP Mesh (v1.18.0 — black sheep #bonus)
 *
 * Multiple Mneme instances (across teams / repos) federate. Query goes
 * out, each peer returns local results, the originator dedupes + ranks.
 *
 *   • mneme.mesh.peers           — list configured peers
 *   • mneme.mesh.federate(query) — broadcast a query, aggregate responses
 *
 * v1.18.0 ships the SCAFFOLDING — config-driven peer registry plus a
 * dispatcher that returns "no peers configured" when .mneme/mesh.json
 * is absent. Real peer transport (HTTP / stdio bridge / WebSocket) lands
 * in v1.19. The SHAPE of the API is locked now so AI agents can start
 * coding against it.
 *
 * Privacy model:
 *   • Federated queries carry NO source code or secrets — only metadata
 *     (tool name, query string, optional fingerprint) goes over the wire.
 *   • Each peer responds with its OWN data.* shape; aggregator merges
 *     by relevance, never re-shapes.
 *   • Peer auth is HMAC-shared-secret (configured per peer in mesh.json);
 *     unsigned responses are dropped.
 *
 * Use cases:
 *   • "Who in our company has touched code similar to this?" — cross-repo
 *     expertise discovery without leaking source.
 *   • "Has any sister repo seen this CVE before?" — security broadcast.
 *   • "Onboard a new engineer: which other repos teach this concept?"
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MnemeTool } from "./_types.js";

const MESH_FILE = ".mneme/mesh.json";

interface MeshPeer {
  /** Peer label — free text. */
  name: string;
  /** Reachable address — http(s) URL, file:// path to a stdio binary, etc. */
  url: string;
  /** Optional shared secret for HMAC-signed responses (not yet enforced). */
  hmacSecret?: string;
  /** Optional human-readable note about which repo this peer represents. */
  note?: string;
}

interface MeshConfig {
  schemaVersion: 1;
  peers: MeshPeer[];
}

export function readMeshConfig(repoRoot: string): MeshConfig | null {
  const path = join(repoRoot, MESH_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MeshConfig;
  } catch {
    return null;
  }
}

export function writeMeshConfig(repoRoot: string, cfg: MeshConfig): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, MESH_FILE), JSON.stringify(cfg, null, 2), "utf8");
}

export const meshPeersTool: MnemeTool = {
  name: "mneme.mesh.peers",
  category: "meta",
  description:
    "List every peer Mneme instance configured for federation in " +
    "`.mneme/mesh.json`. Use WHEN you want to know which other repos / teams " +
    "this Mneme instance can broadcast queries to. Returns an empty list when " +
    "mesh.json is absent — that means peer transport is not enabled in this repo.",
  whenToUse: "You want to enumerate the federation peers configured for this repo.",
  triggers: ["mesh peers", "mneme federation list", "federation status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      configured: { type: "boolean" },
      peers: { type: "array", items: { type: "object" } },
    },
  },
  examples: [
    {
      userQuery: "What Mneme instances am I federated with?",
      expectedOutput: "Returns { configured: true|false, peers: [{ name, url, note }] }. Empty when mesh.json is absent.",
    },
  ],
  pitfalls: [
    "Returns the configuration AS WRITTEN — does not check liveness. A peer URL may be unreachable.",
    "v1.18.0 ships the API surface; actual peer transport lands in v1.19.",
  ],
  composeWith: ["mneme.mesh.federate"],
  handler: async (rt) => {
    const cfg = readMeshConfig(rt.meta.rootPath);
    if (!cfg) {
      return {
        data: { configured: false, peers: [] },
        wisdom: "No mesh.json — federation is not enabled in this repo. Create .mneme/mesh.json with a peers array to enable.",
        confidence: { level: "high" },
      };
    }
    return {
      data: {
        configured: true,
        peers: cfg.peers.map((p) => ({ name: p.name, url: p.url, note: p.note })),
      },
      wisdom: `${cfg.peers.length} peer${cfg.peers.length === 1 ? "" : "s"} configured for federation.`,
      confidence: { level: "high" },
      followUp: cfg.peers.length > 0 ? ["mneme.mesh.federate"] : [],
    };
  },
};

export const meshFederateTool: MnemeTool = {
  name: "mneme.mesh.federate",
  category: "meta",
  description:
    "Broadcast a query to every configured Mneme peer + aggregate the responses. " +
    "Privacy: the query string + tool-name go over the wire; source code does NOT. " +
    "Each peer's data.* response is preserved (no re-shaping); aggregator merges " +
    "by relevance score. Use WHEN you want cross-repo expertise discovery, " +
    "security broadcasts (\"has any sister repo seen this CVE?\"), or onboarding " +
    "rehearsals across multiple codebases. v1.18.0: SCAFFOLDING ONLY — returns " +
    "'no peer transport' until v1.19 ships the actual HTTP / stdio bridge.",
  whenToUse:
    "You want to broadcast a tool query to every configured Mneme peer + aggregate responses.",
  triggers: ["federate this query", "ask all peers", "cross-repo search"],
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name to broadcast (e.g. 'mneme.memory.ask')." },
      args: { description: "Arguments forwarded to each peer's tool call." },
    },
    required: ["tool", "args"],
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number", description: "Peers contacted." },
      responses: { type: "array", items: { type: "object" } },
      aggregated: { type: "object" },
      transportReady: { type: "boolean", description: "false in v1.18.0 — true once v1.19 ships transport." },
    },
  },
  examples: [
    {
      userQuery: "Ask every peer Mneme: 'has anyone seen a CVE matching this commit?'",
      args: { tool: "mneme.memory.ask", args: { question: "any commits referencing CVE-2024-XXXXX?" } },
      expectedOutput: "v1.18.0: returns transportReady=false + scaffolding response. v1.19+: per-peer responses + aggregated answer.",
    },
  ],
  pitfalls: [
    "v1.18.0 — peer transport NOT YET WIRED. Returns scaffolding response so AI agents can code against the API surface.",
    "Once transport ships (v1.19): peers are unauthenticated unless mesh.json provides an hmacSecret per peer. Unsigned responses get dropped.",
    "Federated queries are slower than local — 1× round-trip per peer. Use sparingly.",
  ],
  composeWith: ["mneme.mesh.peers", "mneme.help"],
  handler: async (rt, args) => {
    const cfg = readMeshConfig(rt.meta.rootPath);
    const tool = String(args["tool"] ?? "");
    if (!tool) {
      return {
        data: { error: "missing required argument: tool" },
        wisdom: "Pass the tool name to federate (e.g. 'mneme.memory.ask').",
        confidence: { level: "high" },
      };
    }
    if (!cfg || cfg.peers.length === 0) {
      return {
        data: {
          total: 0,
          responses: [],
          aggregated: { note: "no peers configured" },
          transportReady: false,
        },
        wisdom:
          "No peers configured. Create .mneme/mesh.json with peer entries to enable federation. v1.18.0 ships the API surface; actual transport lands in v1.19.",
        confidence: { level: "high" },
      };
    }
    // v1.18.0 scaffolding: return per-peer 'not yet implemented' shape.
    const responses = cfg.peers.map((p) => ({
      peer: p.name,
      url: p.url,
      status: "transport-pending" as const,
      detail: "v1.18.0 scaffolding — actual peer transport ships in v1.19.",
    }));
    return {
      data: {
        total: cfg.peers.length,
        responses,
        aggregated: { note: "scaffolding response — transport not yet wired" },
        transportReady: false,
      },
      wisdom: `Scaffolding response: ${cfg.peers.length} peer${cfg.peers.length === 1 ? "" : "s"} would be contacted, but v1.18.0 ships only the API. Transport in v1.19.`,
      confidence: { level: "low", notes: "Scaffolding only — real responses arrive in v1.19." },
    };
  },
};

export const meshTools: MnemeTool[] = [meshPeersTool, meshFederateTool];

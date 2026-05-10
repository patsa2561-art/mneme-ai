/**
 * Linear / Jira issue ingest.
 *
 * Both providers expose a REST API that returns issues + comments.
 * We do NOT ship API keys; the caller passes them in env vars:
 *   LINEAR_API_KEY  -> Linear (https://api.linear.app/graphql)
 *   JIRA_BASE_URL   -> e.g., https://acme.atlassian.net
 *   JIRA_EMAIL      -> auth user email
 *   JIRA_API_TOKEN  -> auth token (Atlassian "API token" page)
 *
 * If keys are missing, ingest returns empty + a clear error in stats
 * (never throws).
 */

import type { IngestedChunk, IngestStats } from "./types.js";

export interface LinearOptions {
  /** Filter by team key (e.g., "ENG"). Default: all teams the key has access to. */
  teamKey?: string;
  /** Max issues to ingest. Default 50. */
  maxIssues?: number;
}

export async function scrapeLinear(opts: LinearOptions = {}): Promise<{ chunks: IngestedChunk[]; stats: IngestStats }> {
  const startedAt = new Date().toISOString();
  const stats: IngestStats = {
    source: "linear-issue", fetchedCount: 0, chunkCount: 0,
    startedAt, completedAt: startedAt, errors: [],
  };
  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    stats.errors.push("LINEAR_API_KEY not set; skipping Linear ingest");
    stats.completedAt = new Date().toISOString();
    return { chunks: [], stats };
  }
  const maxIssues = opts.maxIssues ?? 50;
  const teamFilter = opts.teamKey ? `, filter: { team: { key: { eq: "${opts.teamKey}" } } }` : "";
  const query = `
    query {
      issues(first: ${maxIssues}${teamFilter}) {
        nodes {
          id identifier title description createdAt url
          state { name } assignee { name }
          comments { nodes { id body createdAt user { name } } }
        }
      }
    }
  `;
  const chunks: IngestedChunk[] = [];
  try {
    const r = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": apiKey },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) {
      stats.errors.push(`Linear GraphQL HTTP ${r.status}`);
      stats.completedAt = new Date().toISOString();
      return { chunks, stats };
    }
    const data = await r.json() as { data?: { issues?: { nodes?: Array<{
      id: string; identifier: string; title: string; description?: string;
      createdAt: string; url: string; state?: { name: string };
      assignee?: { name?: string };
      comments?: { nodes?: Array<{ id: string; body: string; createdAt: string; user?: { name?: string } }> };
    }> } } };
    const issues = data.data?.issues?.nodes ?? [];
    stats.fetchedCount = issues.length;
    for (const iss of issues) {
      const head = `[${iss.identifier}] ${iss.title} (state=${iss.state?.name ?? "?"})`;
      if (iss.description && iss.description.trim().length >= 10) {
        chunks.push({
          id: `linear-issue:${iss.identifier}:body`,
          source: "linear-issue", url: iss.url,
          text: `${head}\n\n${iss.description.trim()}`,
          author: iss.assignee?.name, createdAt: iss.createdAt,
        });
        stats.chunkCount++;
      }
      for (const c of iss.comments?.nodes ?? []) {
        if (!c.body || c.body.trim().length < 10) continue;
        chunks.push({
          id: `linear-issue:${iss.identifier}:${c.id}`,
          source: "linear-issue", url: iss.url,
          text: `${head}\n[comment by ${c.user?.name ?? "unknown"}]\n${c.body.trim()}`,
          author: c.user?.name, createdAt: c.createdAt,
        });
        stats.chunkCount++;
      }
    }
  } catch (e) {
    stats.errors.push(`Linear fetch: ${(e as Error).message}`);
  }
  stats.completedAt = new Date().toISOString();
  return { chunks, stats };
}

export interface JiraOptions {
  /** JQL filter, default: "ORDER BY updated DESC". */
  jql?: string;
  /** Max issues. Default 50. */
  maxIssues?: number;
}

export async function scrapeJira(opts: JiraOptions = {}): Promise<{ chunks: IngestedChunk[]; stats: IngestStats }> {
  const startedAt = new Date().toISOString();
  const stats: IngestStats = {
    source: "jira-issue", fetchedCount: 0, chunkCount: 0,
    startedAt, completedAt: startedAt, errors: [],
  };
  const base = process.env["JIRA_BASE_URL"];
  const email = process.env["JIRA_EMAIL"];
  const token = process.env["JIRA_API_TOKEN"];
  if (!base || !email || !token) {
    stats.errors.push("JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN missing; skipping Jira ingest");
    stats.completedAt = new Date().toISOString();
    return { chunks: [], stats };
  }
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const jql = encodeURIComponent(opts.jql ?? "ORDER BY updated DESC");
  const maxResults = opts.maxIssues ?? 50;
  const chunks: IngestedChunk[] = [];
  try {
    const url = `${base}/rest/api/3/search?jql=${jql}&maxResults=${maxResults}&fields=summary,description,status,assignee,comment,created`;
    const r = await fetch(url, { headers: { "authorization": `Basic ${auth}`, "accept": "application/json" } });
    if (!r.ok) {
      stats.errors.push(`Jira HTTP ${r.status}`);
      stats.completedAt = new Date().toISOString();
      return { chunks, stats };
    }
    const data = await r.json() as { issues?: Array<{
      key: string; self: string;
      fields: {
        summary: string; description?: string | { content?: unknown };
        status?: { name: string }; assignee?: { displayName?: string };
        created: string;
        comment?: { comments?: Array<{ id: string; body?: string | object; created: string; author?: { displayName?: string } }> };
      };
    }> };
    const issues = data.issues ?? [];
    stats.fetchedCount = issues.length;
    for (const iss of issues) {
      const head = `[${iss.key}] ${iss.fields.summary} (state=${iss.fields.status?.name ?? "?"})`;
      const desc = typeof iss.fields.description === "string" ? iss.fields.description : "";
      if (desc.trim().length >= 10) {
        chunks.push({
          id: `jira-issue:${iss.key}:body`,
          source: "jira-issue", url: iss.self,
          text: `${head}\n\n${desc.trim()}`,
          author: iss.fields.assignee?.displayName, createdAt: iss.fields.created,
        });
        stats.chunkCount++;
      }
      for (const c of iss.fields.comment?.comments ?? []) {
        const body = typeof c.body === "string" ? c.body : "";
        if (body.trim().length < 10) continue;
        chunks.push({
          id: `jira-issue:${iss.key}:${c.id}`,
          source: "jira-issue", url: iss.self,
          text: `${head}\n[comment by ${c.author?.displayName ?? "unknown"}]\n${body.trim()}`,
          author: c.author?.displayName, createdAt: c.created,
        });
        stats.chunkCount++;
      }
    }
  } catch (e) {
    stats.errors.push(`Jira fetch: ${(e as Error).message}`);
  }
  stats.completedAt = new Date().toISOString();
  return { chunks, stats };
}

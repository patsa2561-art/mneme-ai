/**
 * Sentry incident adapter — real implementation.
 *
 * The Sentry REST API gives us issues with first/last seen timestamps and
 * culprit/frames. We fetch the issue list, optionally fetch the latest event
 * for each to get stack frames, and map every result onto the Mneme `Incident`
 * shape so the temporal correlation engine can rank against commits.
 *
 *   Endpoint reference:
 *     GET /api/0/projects/{org}/{project}/issues/?statsPeriod=...
 *     GET /api/0/issues/{id}/events/latest/
 *
 *   Auth: Bearer <token>. Token must have `event:read` and `project:read`.
 *
 * This adapter is opt-in. The token never touches disk. Rate-limit handling
 * matches the GitHub adapter (Retry-After + exponential backoff on 429/5xx).
 */
import type { Incident, StackFrame, correlate as CorrelateNS } from "@mneme-ai/core";

export interface SentryAdapterOptions {
  orgSlug: string;
  projectSlug: string;
  apiToken: string;
  /** https://sentry.io for SaaS, https://sentry.your-co.com for self-hosted. */
  baseUrl?: string;
  /** Concurrent event-detail requests. Default 4. */
  concurrency?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** Pull stack frames from the most recent event of each issue. Default true. */
  fetchStackFrames?: boolean;
  /** Cap on issues fetched. Default 1000. */
  maxIssues?: number;
}

const DEFAULT_BASE = "https://sentry.io";

export class SentryAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "sentry" as const;

  private readonly base: string;
  private readonly token: string;
  private readonly orgSlug: string;
  private readonly projectSlug: string;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly fetchStackFrames: boolean;
  private readonly maxIssues: number;

  constructor(opts: SentryAdapterOptions) {
    if (!opts.orgSlug) throw new Error("SentryAdapter requires orgSlug");
    if (!opts.projectSlug) throw new Error("SentryAdapter requires projectSlug");
    if (!opts.apiToken) throw new Error("SentryAdapter requires apiToken");
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.token = opts.apiToken;
    this.orgSlug = opts.orgSlug;
    this.projectSlug = opts.projectSlug;
    this.concurrency = Math.max(1, opts.concurrency ?? 4);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchStackFrames = opts.fetchStackFrames ?? true;
    this.maxIssues = Math.max(1, opts.maxIssues ?? 1000);
  }

  async fetch(opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    const issues = await this.listIssues(opts);
    const capped = issues.slice(0, this.maxIssues);
    if (!this.fetchStackFrames) return capped.map((i) => this.mapIssue(i));

    // Hydrate stack frames concurrently.
    const out: Incident[] = [];
    const queue = [...capped];
    const workers: Promise<void>[] = [];
    for (let w = 0; w < this.concurrency; w++) {
      workers.push(
        (async () => {
          while (queue.length) {
            const issue = queue.shift();
            if (!issue) break;
            const frames = await this.fetchLatestEventFrames(issue.id);
            out.push(this.mapIssue(issue, frames));
          }
        })(),
      );
    }
    await Promise.all(workers);
    // Restore deterministic order.
    out.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    return out;
  }

  private async listIssues(opts: CorrelateNS.FetchIncidentOptions): Promise<SentryIssue[]> {
    const params = new URLSearchParams();
    if (opts.since && opts.until) {
      params.set("start", opts.since);
      params.set("end", opts.until);
    } else if (opts.since) {
      params.set("statsPeriod", computeStatsPeriod(opts.since));
    } else {
      params.set("statsPeriod", "30d");
    }
    params.set("limit", "100");
    params.set("query", "is:unresolved is:resolved is:ignored sort:created");

    const out: SentryIssue[] = [];
    let url: string | null =
      `${this.base}/api/0/projects/${this.orgSlug}/${this.projectSlug}/issues/?${params.toString()}`;

    while (url && out.length < this.maxIssues) {
      const result: { json: SentryIssue[] | null; nextUrl: string | null } =
        await this.requestWithLink<SentryIssue[]>(url);
      if (Array.isArray(result.json)) out.push(...result.json);
      url = result.nextUrl;
    }
    return out;
  }

  private mapIssue = (i: SentryIssue, stackFrames: StackFrame[] = []): Incident => ({
    id: `sentry:${i.id}`,
    source: "sentry",
    externalId: i.id,
    title: i.title || i.metadata?.value || i.metadata?.type || `Sentry issue ${i.id}`,
    occurredAt: i.firstSeen,
    resolvedAt: i.status === "resolved" ? i.lastSeen : undefined,
    severity: mapLevel(i.level),
    affectedFiles: dedupe([
      ...(i.culprit ? extractPathFromCulprit(i.culprit) : []),
      ...stackFrames.map((f) => f.file).filter(Boolean),
    ]),
    stackFrames: stackFrames.length ? stackFrames : undefined,
    url: i.permalink,
    metadata: {
      project: i.project?.slug,
      events: i.count,
      users: i.userCount,
      ...(i.metadata ?? {}),
    },
  });

  private async fetchLatestEventFrames(issueId: string): Promise<StackFrame[]> {
    try {
      const { json } = await this.requestWithLink<SentryEvent>(
        `${this.base}/api/0/issues/${issueId}/events/latest/`,
      );
      if (!json) return [];
      const exception = (json.entries ?? []).find((e) => e.type === "exception");
      const values = exception?.data?.values ?? [];
      const frames: StackFrame[] = [];
      for (const v of values) {
        for (const f of v.stacktrace?.frames ?? []) {
          if (!f.filename) continue;
          frames.push({
            file: f.filename,
            line: typeof f.lineno === "number" ? f.lineno : 0,
            function: f.function,
            module: f.module,
          });
        }
      }
      return frames.slice(-20); // most recent frames are most informative
    } catch {
      return [];
    }
  }

  private async requestWithLink<T>(
    url: string,
    attempt = 0,
  ): Promise<{ json: T | null; nextUrl: string | null }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
      "user-agent": "mneme/0.1",
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 404) return { json: null, nextUrl: null };
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) {
          throw new Error(`Sentry API ${res.status} after ${attempt} retries: ${url}`);
        }
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        await sleep(backoffMs);
        return this.requestWithLink(url, attempt + 1);
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sentry API ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as T;
      const nextUrl = parseNextLink(res.headers.get("link"));
      return { json, nextUrl };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface SentryIssue {
  id: string;
  title: string;
  level?: string;
  status?: string;
  firstSeen: string;
  lastSeen?: string;
  count?: number;
  userCount?: number;
  permalink?: string;
  culprit?: string;
  project?: { slug: string };
  metadata?: { value?: string; type?: string; [k: string]: unknown };
}

interface SentryEvent {
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        stacktrace?: {
          frames?: Array<{
            filename?: string;
            lineno?: number;
            function?: string;
            module?: string;
          }>;
        };
      }>;
    };
  }>;
}

function mapLevel(level?: string): Incident["severity"] {
  switch ((level ?? "").toLowerCase()) {
    case "fatal":
      return "critical";
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "debug":
      return "info";
    default:
      return "error";
  }
}

/**
 * Sentry's `culprit` is usually `module in function` or a path-like string.
 * Pull anything that looks like a filename out of it.
 */
function extractPathFromCulprit(culprit: string): string[] {
  const matches = culprit.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|cpp|c|h)/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/** Parse RFC 5988 Link header for cursor-based pagination (Sentry uses this). */
function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next";\s*results="true"/);
    if (m) return m[1]!;
  }
  return null;
}

/** "2025-09-01T00:00:00Z" → "60d" (rounded up) for Sentry's statsPeriod. */
function computeStatsPeriod(sinceIso: string): string {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return "30d";
  const days = Math.max(1, Math.ceil((Date.now() - since) / (24 * 60 * 60 * 1000)));
  return `${days}d`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Datadog Events / Incidents adapter — pulls error-class events from the
 * Datadog Events API v2 and maps them onto the Mneme `Incident` shape so
 * the temporal correlation engine can rank them against commits.
 *
 *   Endpoint: POST https://api.{site}/api/v2/events/search
 *   Auth:    DD-API-KEY + DD-APPLICATION-KEY headers
 *
 * "Site" is one of: datadoghq.com (US1), us3.datadoghq.com, us5.datadoghq.com,
 * datadoghq.eu, ap1.datadoghq.com, ddog-gov.com — passed via the `site` option.
 *
 * Mneme stays brand-neutral in user-facing copy ("the pager"); the adapter
 * class name is technically accurate because that's the API it speaks.
 */
import type { Incident, correlate as CorrelateNS } from "@mneme-ai/core";

export interface DatadogAdapterOptions {
  apiKey: string;
  appKey: string;
  /** "datadoghq.com" (default), "us5.datadoghq.com", "datadoghq.eu", etc. */
  site?: string;
  /** Filter expression, e.g. `source:error,exception` (default) */
  filterQuery?: string;
  /** Cap on events fetched. Default 1000. */
  maxEvents?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
}

const DEFAULT_SITE = "datadoghq.com";

export class DatadogAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "datadog" as const;

  private readonly apiKey: string;
  private readonly appKey: string;
  private readonly site: string;
  private readonly filterQuery: string;
  private readonly maxEvents: number;
  private readonly timeoutMs: number;

  constructor(opts: DatadogAdapterOptions) {
    if (!opts.apiKey) throw new Error("DatadogAdapter requires apiKey");
    if (!opts.appKey) throw new Error("DatadogAdapter requires appKey");
    this.apiKey = opts.apiKey;
    this.appKey = opts.appKey;
    this.site = opts.site ?? DEFAULT_SITE;
    this.filterQuery = opts.filterQuery ?? "source:error,exception status:error";
    this.maxEvents = Math.max(1, opts.maxEvents ?? 1000);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async fetch(opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    const out: Incident[] = [];
    let cursor: string | null = null;

    while (out.length < this.maxEvents) {
      const remaining = this.maxEvents - out.length;
      const pageSize = Math.min(100, remaining);
      const result = await this.fetchPage(opts, cursor, pageSize);
      if (!result || result.events.length === 0) break;
      out.push(...result.events.map((e) => this.mapEvent(e)));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return out;
  }

  private async fetchPage(
    opts: CorrelateNS.FetchIncidentOptions,
    cursor: string | null,
    pageSize: number,
    attempt = 0,
  ): Promise<{ events: DatadogEvent[]; nextCursor: string | null } | null> {
    const url = `https://api.${this.site}/api/v2/events/search`;
    const body: Record<string, unknown> = {
      filter: {
        query: this.filterQuery,
        ...(opts.since ? { from: opts.since } : { from: "now-30d" }),
        ...(opts.until ? { to: opts.until } : { to: "now" }),
      },
      sort: "timestamp",
      page: { limit: pageSize, ...(cursor ? { cursor } : {}) },
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "DD-API-KEY": this.apiKey,
          "DD-APPLICATION-KEY": this.appKey,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "mneme/0.1",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) {
          throw new Error(
            `Datadog API ${res.status} after ${attempt} retries: ${url}`,
          );
        }
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        await new Promise((r) => setTimeout(r, backoff));
        return this.fetchPage(opts, cursor, pageSize, attempt + 1);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Datadog API ${res.status}: ${txt.slice(0, 200)}`);
      }
      const json = (await res.json()) as DatadogResponse;
      return {
        events: json.data ?? [],
        nextCursor: json.meta?.page?.after ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private mapEvent(e: DatadogEvent): Incident {
    const id = `datadog:${e.id ?? e.attributes?.attributes?.evt?.id ?? "unknown"}`;
    const attrs = e.attributes?.attributes ?? {};
    const title = String(attrs.message ?? attrs.title ?? "Datadog event");
    const occurredAt = String(attrs.timestamp ?? new Date().toISOString());
    const severity = mapStatus(String(attrs.status ?? "error"));
    const service = attrs.service ? String(attrs.service) : undefined;
    const host = attrs.host ? String(attrs.host) : undefined;
    const affectedFiles: string[] = [];
    if (typeof attrs.error?.stack === "string") {
      affectedFiles.push(...extractFiles(attrs.error.stack));
    }
    return {
      id,
      source: "datadog",
      externalId: e.id,
      title: title.slice(0, 240),
      occurredAt,
      severity,
      affectedFiles: affectedFiles.length ? Array.from(new Set(affectedFiles)) : undefined,
      url: attrs.url ? String(attrs.url) : undefined,
      metadata: { service, host, tags: attrs.tags ?? [] },
    };
  }
}

interface DatadogResponse {
  data?: DatadogEvent[];
  meta?: { page?: { after?: string } };
}

interface DatadogEvent {
  id: string;
  attributes?: {
    attributes?: {
      message?: string;
      title?: string;
      timestamp?: string;
      status?: string;
      service?: string;
      host?: string;
      tags?: string[];
      url?: string;
      error?: { stack?: string };
      evt?: { id?: string };
    };
  };
}

function mapStatus(status: string): Incident["severity"] {
  switch (status.toLowerCase()) {
    case "critical":
    case "fatal":
      return "critical";
    case "error":
      return "error";
    case "warn":
    case "warning":
      return "warning";
    case "info":
    case "debug":
    case "ok":
      return "info";
    default:
      return "error";
  }
}

function extractFiles(stack: string): string[] {
  const matches = stack.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php)/g);
  return matches ?? [];
}

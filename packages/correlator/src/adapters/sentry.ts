import type { Incident, correlate as CorrelateNS } from "@mneme-ai/core";

/**
 * Sentry incident adapter — phase 3.
 *
 * The Sentry REST API (`/api/0/projects/{org}/{project}/issues/`) returns issues
 * with first/last seen timestamps and culprit/frames. We map each issue → Incident.
 *
 * Implementation pending — but the contract is final, so the rest of the pipeline
 * (TemporalCorrelationEngine, store schema, CLI, viz) can already consume its output.
 */
export class SentryAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "sentry" as const;

  constructor(
    private readonly opts: {
      orgSlug: string;
      projectSlug: string;
      apiToken: string;
      baseUrl?: string;
    },
  ) {}

  async fetch(_opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    // TODO(phase3): GET ${baseUrl}/api/0/projects/${org}/${project}/issues/?statsPeriod=...
    // Map fields:
    //   id           -> externalId
    //   title        -> title
    //   firstSeen    -> occurredAt
    //   lastSeen     -> resolvedAt? (only if status=resolved)
    //   level        -> severity (info|warning|error|critical)
    //   culprit      -> a hint for affectedFiles
    //   permalink    -> url
    //   metadata     -> stack frames extracted from the latest event
    return [];
  }
}

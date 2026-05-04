import type { Incident, correlate as CorrelateNS } from "@mneme-ai/core";

/**
 * Datadog incident adapter — phase 3.
 *
 * Pulls from the Events API or the Incidents API depending on what the user has
 * configured. Implementation pending; contract finalized.
 */
export class DatadogAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "datadog" as const;

  constructor(
    private readonly opts: {
      apiKey: string;
      appKey: string;
      site?: string;
    },
  ) {}

  async fetch(_opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    // TODO(phase3): POST https://api.${site ?? "datadoghq.com"}/api/v2/events/search
    // Filter by `source:error,exception` or by alert tag, map to Incident shape.
    return [];
  }
}

/**
 * Phase 3 — Error correlation engine.
 *
 * The differentiator. Given:
 *   - commits (from git)
 *   - incidents (from pager / manual JSON)
 *   - entities (phase 2)
 *
 * produce Correlation rows that answer:
 *   "every time PaymentService changes, OrderQueue throws within 48h"
 *
 * Phase 3 will fill in:
 *   - temporal correlation (commit window → incident spike)
 *   - structural correlation (file overlap, call-graph proximity)
 *   - semantic correlation (commit message vs stack trace embeddings)
 *
 * For now this module exports the contracts that the @mneme-ai/correlator package implements.
 */

import type { Commit, Correlation, Incident } from "../types.js";

export interface CorrelationEngine {
  readonly name: string;
  /** Build correlations between a window of commits and a window of incidents. */
  correlate(input: CorrelateInput): Promise<Correlation[]>;
}

export interface CorrelateInput {
  commits: Commit[];
  incidents: Incident[];
  /** Window in milliseconds — how long after a commit an incident may be attributed to it. */
  windowMs?: number;
}

export interface IncidentAdapter {
  readonly source: "sentry" | "datadog" | "manual" | "github" | "log";
  fetch(opts: FetchIncidentOptions): Promise<Incident[]>;
}

export interface FetchIncidentOptions {
  since?: string;
  until?: string;
  projectId?: string;
  apiKey?: string;
  orgSlug?: string;
}

/** Default temporal window: 7 days. */
export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

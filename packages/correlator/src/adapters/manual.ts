import { readFileSync } from "node:fs";
import type { Incident, correlate as CorrelateNS } from "@mneme-ai/core";

/**
 * Manual JSON incident adapter — works today.
 *
 * Reads a JSON file shaped like:
 *   [
 *     { "id": "INC-1", "title": "Stripe webhook 500s", "occurredAt": "2025-09-01T10:00:00Z",
 *       "severity": "error", "affectedFiles": ["src/payment.ts"], "url": "https://..." }
 *   ]
 *
 * Useful for: bootstrapping a customer that doesn't have an observability platform yet, or
 * importing from CSV/spreadsheet exports.
 */
export class ManualJsonAdapter implements CorrelateNS.IncidentAdapter {
  readonly source = "manual" as const;

  constructor(private readonly path: string) {}

  async fetch(_opts: CorrelateNS.FetchIncidentOptions): Promise<Incident[]> {
    const raw = readFileSync(this.path, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error(`${this.path} did not contain a JSON array`);
    return arr.map((row, i) => normalize(row, i));
  }
}

function normalize(row: any, idx: number): Incident {
  if (!row.title) throw new Error(`incident at index ${idx} is missing 'title'`);
  if (!row.occurredAt) throw new Error(`incident at index ${idx} is missing 'occurredAt'`);
  return {
    id: String(row.id ?? `manual-${idx}`),
    source: "manual",
    externalId: row.externalId,
    title: String(row.title),
    occurredAt: String(row.occurredAt),
    resolvedAt: row.resolvedAt,
    severity: (row.severity ?? "error") as Incident["severity"],
    affectedFiles: row.affectedFiles,
    stackFrames: row.stackFrames,
    url: row.url,
    metadata: row.metadata,
  };
}

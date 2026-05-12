/**
 * v1.80.0 -- CONDUIT: version gate (DEAD MAN'S HANDSHAKE).
 *
 * Every soul prompt has a `createdAt` timestamp. Web AIs reading the
 * paste should know if the prompt is STALE -- meaning the source
 * Mneme has likely shipped newer features since this snapshot.
 *
 * Rules:
 *   FRESH      -- <24h old              -- act normally
 *   AGING      -- 24h..7d old           -- mention age in reply opener
 *   STALE      -- >7d old               -- suggest user re-paste a new soul
 *   ABANDONED  -- >30d old              -- refuse to act on stale soul;
 *                                          require fresh handover
 */

export type Freshness = "fresh" | "aging" | "stale" | "abandoned";

export interface FreshnessReport {
  freshness: Freshness;
  ageHours: number;
  /** Action the AI should take. */
  action: "act-normally" | "mention-age" | "suggest-refresh" | "refuse-stale";
  /** One-line summary the AI can include in its reply. */
  hint: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function checkFreshness(createdAtIso: string, now: Date = new Date()): FreshnessReport {
  const createdAt = new Date(createdAtIso);
  const ageMs = now.getTime() - createdAt.getTime();
  const ageHours = Math.max(0, Math.round(ageMs / HOUR_MS));

  if (ageMs < DAY_MS) {
    return { freshness: "fresh", ageHours, action: "act-normally", hint: "" };
  }
  if (ageMs < 7 * DAY_MS) {
    return {
      freshness: "aging",
      ageHours,
      action: "mention-age",
      hint: `soul prompt is ${Math.round(ageHours / 24)} day(s) old; minor drift possible`,
    };
  }
  if (ageMs < 30 * DAY_MS) {
    return {
      freshness: "stale",
      ageHours,
      action: "suggest-refresh",
      hint: `soul prompt is ${Math.round(ageHours / 24)} day(s) old -- ask source AI for a fresh handover`,
    };
  }
  return {
    freshness: "abandoned",
    ageHours,
    action: "refuse-stale",
    hint: `soul prompt is ${Math.round(ageHours / 24)} day(s) old (>30) -- refuse stale context; require fresh handover`,
  };
}

/** Render a gate directive to embed in soul prompts. */
export function renderVersionGate(createdAtIso: string): string {
  const lines: string[] = [];
  lines.push(`## Version gate (DEAD MAN'S HANDSHAKE)`);
  lines.push(``);
  lines.push(`This soul prompt was created at \`${createdAtIso}\`. Compute age = now - createdAt and act:`);
  lines.push(`- **<24h**: fresh -- act normally.`);
  lines.push(`- **24h..7d**: aging -- mention age once in your reply opener.`);
  lines.push(`- **7d..30d**: stale -- tell the user *"this brain is N days old; ask your editor AI for a fresh handover"*.`);
  lines.push(`- **>30d**: abandoned -- refuse to act on this context; require a fresh handover.`);
  return lines.join("\n");
}

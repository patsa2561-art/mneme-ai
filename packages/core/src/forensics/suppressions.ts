/**
 * Suppression file loader (.mneme/suppressions.json).
 *
 * Customer feedback: every scan re-surfaces the same false positives even
 * after they've been triaged. Suppressions let the user mark a finding as
 * "ignore" with a reason + optional expiry, and the scanner honors it.
 *
 * Schema:
 *   {
 *     "version": 1,
 *     "entries": [
 *       {
 *         "id": "a1b2c3d4",
 *         "rule": "sql-injection",
 *         "reason": "log string, not SQL",
 *         "expiresAt": "2026-12-31T00:00:00Z",
 *         "addedAt": "2026-05-08T10:30:00Z",
 *         "addedBy": "alice@x.com"
 *       }
 *     ]
 *   }
 *
 * `id` is the stable hit id from `stableHitId()` in vulnhunt.ts.
 */

export interface SuppressionEntry {
  id: string;
  rule?: string;
  reason: string;
  expiresAt?: string;
  addedAt?: string;
  addedBy?: string;
}

export interface SuppressionFile {
  version: 1;
  entries: SuppressionEntry[];
}

const FILE_NAME = ".mneme/suppressions.json";

/**
 * Load suppressions from rootPath/.mneme/suppressions.json. Returns an
 * empty list if the file is missing or invalid (warned, not thrown — the
 * scanner should never crash because of a bad ignore file).
 */
export async function loadSuppressions(rootPath: string): Promise<SuppressionEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(rootPath, FILE_NAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed: SuppressionFile;
  try {
    parsed = JSON.parse(raw) as SuppressionFile;
  } catch {
    return [];
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];

  const now = Date.now();
  return parsed.entries.filter((e) => {
    if (!e || typeof e.id !== "string") return false;
    if (e.expiresAt) {
      const t = Date.parse(e.expiresAt);
      if (Number.isFinite(t) && t < now) return false; // expired
    }
    return true;
  });
}

/** Return the set of ids that should be suppressed (after expiry filter). */
export async function loadSuppressedIds(rootPath: string): Promise<Set<string>> {
  const entries = await loadSuppressions(rootPath);
  return new Set(entries.map((e) => e.id));
}

/**
 * Add a new suppression entry to .mneme/suppressions.json. Creates the file
 * if it doesn't exist. Idempotent: re-adding the same id refreshes the
 * timestamp + reason rather than creating a duplicate row.
 */
export async function addSuppression(
  rootPath: string,
  entry: Omit<SuppressionEntry, "addedAt"> & { addedAt?: string },
): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(rootPath, ".mneme");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "suppressions.json");

  let existing: SuppressionFile;
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf8")) as SuppressionFile;
  } catch {
    existing = { version: 1, entries: [] };
  }
  if (existing.version !== 1) existing = { version: 1, entries: [] };

  const now = new Date().toISOString();
  const fullEntry: SuppressionEntry = { ...entry, addedAt: entry.addedAt ?? now };
  const idx = existing.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    existing.entries[idx] = { ...existing.entries[idx]!, ...fullEntry };
  } else {
    existing.entries.push(fullEntry);
  }
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
}

/** Remove a suppression by id. No-op if not present. */
export async function removeSuppression(rootPath: string, id: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.join(rootPath, ".mneme", "suppressions.json");
  let existing: SuppressionFile;
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf8")) as SuppressionFile;
  } catch {
    return false;
  }
  const before = existing.entries.length;
  existing.entries = existing.entries.filter((e) => e.id !== id);
  if (existing.entries.length === before) return false;
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return true;
}

/**
 * Wisdom theater — emit progressive discoveries while `mneme index` runs.
 *
 * Reframes the 90-second indexing wait as theater: instead of a silent
 * progress bar, the user watches Mneme surface real findings about their
 * repo as data flows in. By the time indexing finishes, they've ALREADY
 * seen value form before their eyes.
 *
 * Cheap queries only — no full atrophy/telepathy at index time, no LLM
 * calls. Just SQL aggregates that the store can answer in <50ms.
 *
 * Strategic intent: turn the "90s indexing friction" weakness into a cult
 * loyalty advantage. Most tools hide loading. Mneme uses it to teach.
 */

import kleur from "kleur";
import type { store as storeNs } from "@mneme-ai/core";

interface WisdomTheaterOptions {
  store: storeNs.MnemeStore;
}

interface ProgressTick {
  phase: string;
  current: number;
  total: number;
}

/** Stateful theater that emits a fresh discovery each time it crosses a
 *  milestone. Caller invokes maybeEmit() inside the indexer's onProgress
 *  callback. Returns the wisdom string to print, or null. */
export class WisdomTheater {
  private fired = new Set<string>();

  constructor(private readonly opts: WisdomTheaterOptions) {}

  /** Returns a wisdom string if a milestone just crossed, or null. */
  maybeEmit(p: ProgressTick): string | null {
    if (p.total <= 0 || p.phase !== "indexing") return null;
    const pct = Math.floor((p.current / p.total) * 100);
    for (const at of [10, 25, 50, 75]) {
      if (pct >= at && !this.fired.has(`pct-${at}`)) {
        this.fired.add(`pct-${at}`);
        const w = this.snapshot(at);
        if (w) return w;
      }
    }
    return null;
  }

  /** Build a fun fact from the partially-indexed store. */
  private snapshot(pct: number): string | null {
    try {
      switch (pct) {
        case 10:
          return this.factAuthors();
        case 25:
          return this.factOldestCommit();
        case 50:
          return this.factHotFile();
        case 75:
          return this.factDebt();
        default:
          return null;
      }
    } catch {
      // Theater is best-effort — never break indexing because of it.
      return null;
    }
  }

  private factAuthors(): string | null {
    const row = this.opts.store.db
      .prepare("SELECT COUNT(DISTINCT author_email) AS n FROM commits")
      .get() as { n?: number } | undefined;
    const n = row?.n ?? 0;
    if (n === 0) return null;
    return kleur.cyan(
      n === 1
        ? "✦ solo-author repo — Mneme's cognitive_twin will profile their voice"
        : `✦ ${n} distinct authors so far — preparing telepathy + influence map`,
    );
  }

  private factOldestCommit(): string | null {
    const row = this.opts.store.db
      .prepare(
        "SELECT MIN(author_date) AS oldest, COUNT(*) AS total FROM commits",
      )
      .get() as { oldest?: string; total?: number } | undefined;
    if (!row?.oldest || !row.total) return null;
    const year = row.oldest.slice(0, 4);
    const days = Math.floor(
      (Date.now() - new Date(row.oldest).getTime()) / 86_400_000,
    );
    return kleur.magenta(
      `✦ ${row.total} commits indexed · oldest is from ${year} (${days}d ago) — your AI now has ${(days / 365).toFixed(1)}y of memory`,
    );
  }

  private factHotFile(): string | null {
    const row = this.opts.store.db
      .prepare(
        `SELECT cf.file_path AS path, COUNT(*) AS edits
         FROM commit_files cf
         GROUP BY cf.file_path
         ORDER BY edits DESC
         LIMIT 1`,
      )
      .get() as { path?: string; edits?: number } | undefined;
    if (!row?.path) return null;
    return kleur.yellow(
      `✦ hot-zone detected: ${row.path} (${row.edits} edits) — bus_factor + atrophy will rank risks here`,
    );
  }

  private factDebt(): string | null {
    const row = this.opts.store.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM chunks
         WHERE text LIKE '%TODO%' OR text LIKE '%FIXME%' OR text LIKE '%XXX%' OR text LIKE '%HACK%'`,
      )
      .get() as { n?: number } | undefined;
    const n = row?.n ?? 0;
    if (n === 0) return kleur.green("✦ no TODO/FIXME debt found in indexed corpus — clean repo");
    return kleur.red(
      `✦ ${n} TODO/FIXME/HACK marker${n === 1 ? "" : "s"} found — karma + promise will surface the oldest`,
    );
  }
}

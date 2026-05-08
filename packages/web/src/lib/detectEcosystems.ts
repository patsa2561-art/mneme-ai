/**
 * Ecosystem detection — runs on the file-path corpus fetched in live
 * mode (30-commit detail window) and infers which Mneme ecosystem packs
 * would activate against this real repo.
 *
 * Mirrors the server-side detection (3-way triangulation: file-path
 * patterns + extension hints + folder structure) but runs in-browser
 * on the limited subset of files we can see via the GitHub/GitLab API.
 *
 * Pure function. Deterministic. No I/O.
 */

import type { NervousSystemData } from "../types";

export interface EcosystemHit {
  /** Stable ecosystem id matching the cards in EcosystemsView. */
  id: string;
  /** 0..1 — confidence based on signal count. */
  confidence: number;
  /** Files that triggered detection (capped at 5 for display). */
  evidence: string[];
}

interface Rule {
  id: string;
  /** Match the file path (lowercased) — every regex that hits adds 1 signal. */
  patterns: RegExp[];
  /** Bonus signals when *two* patterns from this list fire. */
  bonus?: RegExp[];
}

const RULES: Rule[] = [
  {
    id: "stripe",
    patterns: [
      /stripe/i,
      /\bbilling\b/i,
      /\bpayments?\b/i,
      /\bcheckout\b/i,
      /\binvoice\b/i,
      /\bsubscription\b/i,
      /\bwebhook/i,
    ],
  },
  {
    id: "react",
    patterns: [
      /\.(tsx|jsx)$/i,
      /\/components\//i,
      /\/hooks\//i,
      /\buseState|useEffect|useMemo\b/i,
      /package\.json$/i,
    ],
  },
  {
    id: "postgres",
    patterns: [
      /\bpostgres\b/i,
      /\.sql$/i,
      /\bmigrations?\b/i,
      /\bschema\b/i,
      /prisma|drizzle|knex/i,
      /\bdb\b/i,
    ],
  },
  {
    id: "express",
    patterns: [
      /\brouter\b/i,
      /\bmiddleware\b/i,
      /\broutes?\b/i,
      /express/i,
      /\bcontroller\b/i,
    ],
  },
  {
    id: "fastapi",
    patterns: [
      /\.py$/i,
      /fastapi/i,
      /\brequirements\.txt$/i,
      /\bpyproject\.toml$/i,
      /\bpydantic\b/i,
    ],
  },
  {
    id: "nextjs",
    patterns: [
      /next\.config/i,
      /\bapp\/|\bpages\//i,
      /\bgetServerSideProps\b/i,
      /\.(tsx|jsx)$/i,
    ],
  },
  {
    id: "kafka",
    patterns: [/kafka/i, /\bingest\b/i, /\bconsumer\b/i, /\bproducer\b/i, /\btopic\b/i],
  },
  {
    id: "graphql",
    patterns: [
      /\.graphql$/i,
      /\.gql$/i,
      /resolvers?/i,
      /apollo/i,
      /\bschema\.ts$/i,
    ],
  },
];

export function detectEcosystems(data: NervousSystemData): EcosystemHit[] {
  if (!data._liveMode) return [];

  // Gather every file path we know about from atrophy + per-author topFiles.
  const files = new Set<string>();
  for (const f of data.atrophy?.criticalFiles ?? []) files.add(f.filePath);
  for (const p of data.passports ?? []) {
    for (const f of p.expertise?.topFiles ?? []) files.add(f.filePath);
  }
  if (files.size === 0) return [];

  const filePaths = [...files];
  const hits: EcosystemHit[] = [];

  for (const rule of RULES) {
    const evidence: string[] = [];
    let signalCount = 0;
    for (const fp of filePaths) {
      for (const pat of rule.patterns) {
        if (pat.test(fp)) {
          signalCount++;
          if (evidence.length < 5 && !evidence.includes(fp)) evidence.push(fp);
          break; // one signal per file per rule
        }
      }
    }
    if (signalCount >= 1) {
      // Confidence: log-curve over signal count, capped at 1.
      const confidence = Math.min(1, Math.log2(1 + signalCount) / 4);
      if (confidence >= 0.3) {
        hits.push({ id: rule.id, confidence: Math.round(confidence * 100) / 100, evidence });
      }
    }
  }

  return hits.sort((a, b) => b.confidence - a.confidence);
}

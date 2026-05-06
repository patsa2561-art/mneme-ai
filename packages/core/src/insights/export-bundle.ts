/**
 * `mneme export` — universal export bundle.
 *
 * Closes the "exportable" gap: existing tools either don't export at all
 * or export a single fragment. Mneme bundles every analysis into one
 * shareable artifact (JSON + Markdown + optional HTML) that another team
 * can consume without running Mneme themselves.
 *
 * Pure data extraction. Uses other insight builders as inputs.
 */
import type { Commit, FileChange } from "../types.js";
import { extractDna } from "./dna.js";
import { buildDrift } from "./drift.js";
import { buildChronicle, renderChronicle } from "./chronicle.js";
import { buildOracle } from "./oracle.js";
import { buildConstellation } from "./constellation.js";
import { buildClusters } from "./cluster.js";
import { buildNetwork } from "./network.js";
import { buildManage } from "./manage.js";
import { buildGhostReport } from "./ghost.js";

export interface ExportBundle {
  /** ISO timestamp of when the bundle was generated. */
  generatedAt: string;
  /** Mneme version. */
  version: string;
  /** Repo metadata. */
  repo: {
    totalCommits: number;
    totalAuthors: number;
    fromDate: string;
    toDate: string;
  };
  /** Top-author DNA strands. */
  topAuthorsDna: ReturnType<typeof extractDna>[];
  drift: ReturnType<typeof buildDrift>;
  chronicle: ReturnType<typeof buildChronicle>;
  oracle: ReturnType<typeof buildOracle>;
  constellation: ReturnType<typeof buildConstellation>;
  clusters: ReturnType<typeof buildClusters>;
  network: ReturnType<typeof buildNetwork>;
  manage: ReturnType<typeof buildManage>;
  ghost: ReturnType<typeof buildGhostReport>;
}

export interface ExportOptions {
  version?: string;
  topAuthors?: number; // how many DNA strands to include
  nowMs?: number;
  fileChanges?: FileChange[]; // optional, for ghost report
}

export function buildExportBundle(
  commits: Commit[],
  opts: ExportOptions = {},
): ExportBundle {
  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );
  const fromDate = sorted.length > 0 ? sorted[0]!.authorDate.slice(0, 10) : "";
  const toDate = sorted.length > 0 ? sorted[sorted.length - 1]!.authorDate.slice(0, 10) : "";

  const authors = new Map<string, number>();
  for (const c of commits) {
    const a = c.authorEmail || c.authorName;
    authors.set(a, (authors.get(a) ?? 0) + 1);
  }
  const topAuthors = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topAuthors ?? 5)
    .map(([author]) => author);

  const topAuthorsDna = topAuthors.map((a) => extractDna(commits, a));

  return {
    generatedAt: new Date(opts.nowMs ?? Date.now()).toISOString(),
    // Version is the caller's responsibility — pass it from the host package's
    // package.json. Never hardcode here: it drifts silently across releases.
    version: opts.version ?? "",
    repo: {
      totalCommits: commits.length,
      totalAuthors: authors.size,
      fromDate,
      toDate,
    },
    topAuthorsDna,
    drift: buildDrift(commits),
    chronicle: buildChronicle(commits),
    oracle: buildOracle(commits, { nowMs: opts.nowMs }),
    constellation: buildConstellation(commits),
    clusters: buildClusters(commits, { similarityFloor: 0.15, minClusterSize: 3 }),
    network: buildNetwork(commits),
    manage: buildManage(commits, { nowMs: opts.nowMs }),
    ghost: buildGhostReport(commits, opts.fileChanges ?? [], { nowMs: opts.nowMs }),
  };
}

/** Render the bundle as a single Markdown report. */
export function renderExportMarkdown(bundle: ExportBundle): string {
  const lines: string[] = [];
  lines.push("# Mneme — Codebase Bundle");
  lines.push("");
  lines.push(`> Generated ${bundle.generatedAt} · Mneme ${bundle.version}`);
  lines.push("");
  lines.push(
    `**Repo summary** — ${bundle.repo.totalCommits} commits across ${bundle.repo.totalAuthors} authors, ${bundle.repo.fromDate} → ${bundle.repo.toDate}.`,
  );
  lines.push("");

  // Health
  lines.push("## 📊 Team Health");
  lines.push("");
  lines.push(`- Overall score: **${pct(bundle.manage.health.overall)}**`);
  lines.push(`- Trajectory: **${bundle.manage.health.trajectory.dominant}** (${bundle.manage.health.trajectory.label})`);
  lines.push(`- Predicted collisions: **${bundle.manage.health.predictedCollisions}**`);
  lines.push(`- Max succession risk: **${pct(bundle.manage.health.maxSuccessionRisk)}**`);
  lines.push("");
  for (const note of bundle.manage.health.notes) {
    lines.push(`- _${note}_`);
  }
  lines.push("");

  // Drift
  lines.push("## 📈 Drift trajectory");
  lines.push("");
  for (const b of bundle.drift.buckets) {
    lines.push(`- **${b.label}** — ${b.total} commits — dominant: \`${b.dominant}\``);
  }
  if (bundle.drift.insights.length > 0) {
    lines.push("");
    lines.push("**Insights:**");
    for (const i of bundle.drift.insights) {
      lines.push(`- _${i.fromBucket} → ${i.toBucket}_: ${i.description}`);
    }
  }
  lines.push("");

  // Chronicle (truncated to chapter list)
  lines.push("## 📖 Chronicle (chapters)");
  lines.push("");
  for (const ch of bundle.chronicle.chapters) {
    lines.push(`- **Chapter ${ch.number} · ${ch.title}** (${ch.fromDate} → ${ch.toDate}, ${ch.commits.length} commits, protagonist @${ch.protagonist})`);
  }
  lines.push("");

  // DNA
  lines.push("## 🧬 Top contributors (DNA hashes)");
  lines.push("");
  for (const d of bundle.topAuthorsDna) {
    lines.push(`- **${d.author}** — ${d.commitCount} commits — DNA \`${d.hash}\` — peak ${d.hours.peakWindow}, conventional commits ${pct(d.style.conventionalRatio)}`);
  }
  lines.push("");

  // Network
  lines.push("## 🕸 Author network");
  lines.push("");
  lines.push(`Top edges (collaboration weight):`);
  for (const e of bundle.network.edges.slice(0, 10)) {
    const terms = e.sharedTerms.slice(0, 3).join(", ");
    lines.push(`- ${e.authorA} ⟷ ${e.authorB}: weight ${pct(e.weight)} — shared: ${terms || "(none)"}`);
  }
  if (bundle.network.bridges.length > 0) {
    lines.push("");
    lines.push(`**Bridges**: ${bundle.network.bridges.join(", ")}`);
  }
  lines.push("");

  // Clusters
  lines.push("## 🧠 Semantic commit clusters");
  lines.push("");
  for (const c of bundle.clusters.clusters.slice(0, 8)) {
    lines.push(`- **Cluster ${c.id}** (${c.size} commits, cohesion ${pct(c.cohesion)}) — terms: ${c.topTerms.join(", ")}`);
  }
  lines.push("");

  // Oracle
  lines.push("## 🔮 Oracle predictions");
  lines.push("");
  if (bundle.oracle.collisions.length === 0) {
    lines.push("_No high-probability collisions predicted._");
  } else {
    for (const c of bundle.oracle.collisions.slice(0, 5)) {
      lines.push(`- **${c.filePath}** — ${c.authorA} ⨯ ${c.authorB}, joint P = ${pct(c.jointProbability)}`);
    }
  }
  lines.push("");

  // Constellation summary
  lines.push("## 🌌 Constellation");
  lines.push("");
  lines.push(`- ${bundle.constellation.fileStars.length} file-stars`);
  lines.push(`- ${bundle.constellation.authorOrbitals.length} orbitals`);
  lines.push(`- ${bundle.constellation.fileEdges.length} co-edit edges`);
  lines.push(`- ${bundle.constellation.clusterCount} clusters`);
  lines.push("");

  // Ghost
  lines.push("## 👻 Ghost code");
  lines.push("");
  if (bundle.ghost.ghostFiles.length === 0) {
    lines.push("_No significant ghosts._");
  } else {
    for (const g of bundle.ghost.ghostFiles.slice(0, 8)) {
      lines.push(`- **${g.path}** — ghostliness ${pct(g.ghostliness)} — _${g.reason}_`);
    }
  }
  lines.push("");

  // Embedded full chronicle
  lines.push("---");
  lines.push("");
  lines.push("# Appendix · Full Chronicle");
  lines.push("");
  lines.push(renderChronicle(bundle.chronicle));

  return lines.join("\n");
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

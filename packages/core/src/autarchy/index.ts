/**
 * v1.66.0 -- AUTARCHY PROTOCOL: four-axis self-sufficiency.
 *
 * Mneme runs at full strength without any external runtime
 * dependency. Each of the four axes addresses one of the v1.65
 * residual signals with a world-class novel design:
 *
 *   A1 MESH-AS-CLOUD       federation peers become the cloud surrogate
 *   A2 SCHROEDINGER EMBEDDER parallel race; authoritative status file
 *   A3 TIMECRYSTAL PHARMACOPOEIA  baked vaccines ship inside npm pkg
 *   A4 QUANTUM CHECKSUM    triple-witness model-checksum pin
 *
 * The aggregate `autarchyScore` is 0..100 -- a single number that
 * tells the user "how self-sufficient is my Mneme right now".
 *
 * Pure read by default; mutation is opt-in via the install/persist
 * flags on each individual layer.
 */

export * as meshAsCloud from "./mesh_as_cloud.js";
export * as schroedingerEmbedder from "./schroedinger_embedder.js";
export * as bakedPharmacopoeia from "./baked_pharmacopoeia.js";
export * as quantumChecksum from "./eager_pin.js";

import { meshCloudReport, type MeshCloudReport } from "./mesh_as_cloud.js";
import { readEmbedderStatus, observeEmbedders, type EmbedderStatus } from "./schroedinger_embedder.js";
import { pharmacopoeiaStatus, ensurePharmacopoeia, type PharmacopoeiaStatus } from "./baked_pharmacopoeia.js";
import { readChecksumPin, type ChecksumPin } from "./eager_pin.js";

export interface AutarchyReport {
  /** Overall self-sufficiency score 0..100. */
  score: number;
  /** One-line headline. */
  headline: string;
  /** Per-axis sub-reports. */
  axes: {
    A1_meshAsCloud: MeshCloudReport;
    A2_embedder: EmbedderStatus | null;
    A3_pharmacopoeia: PharmacopoeiaStatus;
    A4_checksumPin: ChecksumPin | null;
  };
  /** Specific recommendations to raise the score. */
  recommendations: string[];
  /** ISO timestamp. */
  builtAt: string;
}

export interface AutarchyOptions {
  /** Whether to install baked pharmacopoeia + re-probe embedders. */
  install?: boolean;
  /** Force a fresh embedder probe even within cooldown. */
  forceEmbedderProbe?: boolean;
  /** Skip Ollama probe (CI). */
  skipOllama?: boolean;
  /** Skip Bundled probe (offline CI). */
  skipBundled?: boolean;
}

/** Build a fresh autarchy report. Pure read by default. */
export async function autarchy(repoRoot: string, opts?: AutarchyOptions): Promise<AutarchyReport> {
  const builtAt = new Date().toISOString();

  // A1: mesh-as-cloud (always read-only)
  const A1 = meshCloudReport(repoRoot);

  // A2: embedder status -- observe fresh if requested, else read cached
  let A2: EmbedderStatus | null;
  if (opts?.forceEmbedderProbe || opts?.install) {
    A2 = await observeEmbedders(repoRoot, {
      force: Boolean(opts?.forceEmbedderProbe),
      skipOllama: opts?.skipOllama,
      skipBundled: opts?.skipBundled,
    });
  } else {
    A2 = readEmbedderStatus(repoRoot);
  }

  // A3: pharmacopoeia -- install baked bundle if requested
  let A3: PharmacopoeiaStatus;
  if (opts?.install) {
    A3 = ensurePharmacopoeia(repoRoot).status;
  } else {
    A3 = pharmacopoeiaStatus(repoRoot);
  }

  // A4: checksum pin (always read-only here; W2 pinning happens via autodiagnose)
  const A4 = readChecksumPin(repoRoot);

  // Score: each axis contributes 0..25
  let score = 0;
  const recs: string[] = [];

  // A1 contribution
  if (A1.state === "central-online") score += 25;
  else if (A1.state === "mesh-only" && A1.uniquePeers >= 1) score += 18;
  else recs.push("Cloud isolated -- mesh has 0 peers in last 24h. Consider whisper/mesh-bridge to a peer.");

  // A2 contribution: weighted by tier rank
  if (A2) {
    if (A2.winner === "openai") score += 25;
    else if (A2.winner === "ollama") score += 22;
    else if (A2.winner === "bundled") score += 18;
    else { score += 8; recs.push("Embedder on ★★ hash tier. Run `mneme.embedder.autodiagnose` with persist=true."); }
  } else {
    score += 5;
    recs.push("Embedder status not probed yet. Run `mneme.autarchy.status` with install=true.");
  }

  // A3 contribution
  if (A3.bakedAlreadyInstalled) score += 25;
  else if (A3.localCount > 0) score += 15;
  else { score += 5; recs.push("Pharmacopoeia empty. Run `mneme.autarchy.status` with install=true to seed the baked bundle."); }

  // A4 contribution
  if (A4) score += 25;
  else recs.push("Model checksums not pinned. After first embedder use, the Schroedinger observer will pin automatically.");

  const headline = `Autarchy score ${score}/100. ${A1.state === "central-online" ? "Central+mesh" : A1.state === "mesh-only" ? "Mesh-only" : "Isolated"} · ${A2 ? A2.winner : "no-probe"} embedder · ${A3.bakedAlreadyInstalled ? "pharmacopoeia ready" : "pharmacopoeia partial"} · ${A4 ? "checksums pinned" : "checksums unpinned"}.`;

  return {
    score,
    headline,
    axes: { A1_meshAsCloud: A1, A2_embedder: A2, A3_pharmacopoeia: A3, A4_checksumPin: A4 },
    recommendations: recs,
    builtAt,
  };
}

/**
 * v2.32.0 — FLYWHEEL PRESCRIBE stage.
 *
 * Turns fused findings into 5 action kinds:
 *
 *   heal    — auto-draft PR to fix a TRUTH GATE drift or marketing
 *             claim. Artifact = markdown PR body.
 *   wire    — auto-draft PR to add CLI/MCP surface for a dormant
 *             primitive. Artifact = checklist + concrete file paths.
 *   delete  — recommend removing a primitive that has NO invocation
 *             record AND no cross-source partners (truly unused).
 *   shrink  — personal cheatsheet shrink to ≤ 3 cmds.
 *   publish — Vendor Bulletin .md from REWIND + HGP + HONEST MIRROR.
 *
 * One action can close MULTIPLE findings (cluster bonus). PRESCRIBE
 * groups findings by clusterId then emits one action per cluster.
 */

import type { FusedFinding, PrescribedAction, ActionKind } from "./types.js";

interface ClusterGroup { clusterId: string; findings: FusedFinding[]; }

function group(findings: FusedFinding[]): ClusterGroup[] {
  const by = new Map<string, FusedFinding[]>();
  for (const f of findings) {
    const arr = by.get(f.clusterId) ?? [];
    arr.push(f);
    by.set(f.clusterId, arr);
  }
  return Array.from(by.entries()).map(([clusterId, fs]) => ({ clusterId, findings: fs }))
    .sort((a, b) => Math.max(...b.findings.map((f) => f.compositeScore)) - Math.max(...a.findings.map((f) => f.compositeScore)));
}

function maxPriority(fs: FusedFinding[]): number {
  return Math.max(...fs.map((f) => f.compositeScore));
}

function pickKind(fs: FusedFinding[]): ActionKind {
  // Action kind is derived from the dominant source in the cluster.
  // Priority order: primitive_registry → wire/delete, marketing_diff → heal,
  // truth_gate → heal, hgp/rewind/honest_mirror → publish, command_history → shrink.
  const sources = new Set(fs.map((f) => f.source));
  if (sources.has("primitive_registry")) {
    // Has cross-source partners → wire (composed with something useful).
    // No partners → delete (truly unused).
    const anyPartners = fs.some((f) => f.composedWith.length > 0);
    return anyPartners ? "wire" : "delete";
  }
  if (sources.has("truth_gate") || sources.has("marketing_diff")) return "heal";
  if (sources.has("hgp") || sources.has("rewind") || sources.has("honest_mirror")) return "publish";
  if (sources.has("command_history")) return "shrink";
  return "heal";
}

function renderPRDraft(kind: ActionKind, fs: FusedFinding[]): string {
  const lines: string[] = [];
  lines.push(`# 🪄 FLYWHEEL ${kind.toUpperCase()} action`);
  lines.push(``);
  lines.push(`## Closes ${fs.length} finding(s)`);
  lines.push(``);
  for (const f of fs) {
    lines.push(`- **${f.source}** ${f.id} — ${f.headline} (${f.severity}, score ${f.compositeScore})`);
  }
  if (fs.some((f) => f.composedWith.length > 0)) {
    lines.push(``);
    lines.push(`### Composition bonus`);
    for (const f of fs) {
      if (f.composedWith.length === 0) continue;
      lines.push(`- ${f.source}:${f.id} composes with: ${f.composedWith.map((p) => `${p.source}:${p.id}`).join(", ")}`);
    }
  }
  lines.push(``);
  lines.push(`## Suggested actions`);
  lines.push(``);
  if (kind === "heal") {
    lines.push(`- Add probe binding in \`packages/core/src/truth_gate/probes.ts\``);
    lines.push(`- Add claim row in \`packages/core/src/truth_gate/claims.ts\` referencing the new probe id`);
    lines.push(`- OR remove the unbound marketing copy from the source file(s) listed above`);
  } else if (kind === "wire") {
    const names = fs.map((f) => (f.detail?.["name"] as string | undefined) ?? f.id).join(", ");
    lines.push(`- Add CLI surface for dormant primitive(s): ${names}`);
    lines.push(`- Add MCP tool wrapper if missing`);
    lines.push(`- Add 1 discrete pinned test that exercises the primitive`);
    lines.push(`- Push a heartbeat row to \`.mneme/flywheel/primitive_ledger.jsonl\` to mark "alive"`);
  } else if (kind === "delete") {
    const names = fs.map((f) => (f.detail?.["name"] as string | undefined) ?? f.id).join(", ");
    lines.push(`- Confirm primitive(s) ${names} are NOT externally relied upon`);
    lines.push(`- Remove the implementation file(s) + tests`);
    lines.push(`- Remove the registry entry + manifest catalog row`);
    lines.push(`- Update README/docs to remove any reference`);
  } else if (kind === "shrink") {
    lines.push(`- The personal cheatsheet ledger suggests reducing the surface to the top-N most-used commands.`);
  } else if (kind === "publish") {
    lines.push(`- Render the Vendor Bulletin markdown via \`mneme flywheel bulletin\` + post publicly`);
    lines.push(`- Apply the auto-trust-delta from RECIPROCITY ledger to \`.mneme/aletheia/honest_mirror_weights.json\``);
  }
  return lines.join("\n");
}

export function prescribe(fused: FusedFinding[]): PrescribedAction[] {
  const groups = group(fused);
  const out: PrescribedAction[] = [];
  for (const g of groups) {
    const kind = pickKind(g.findings);
    const priority = maxPriority(g.findings);
    const closes = g.findings.map((f) => ({ source: f.source, id: f.id }));
    const blocking = g.findings.some((f) => f.severity === "block");
    const rationale = `${g.findings.length} finding(s) in cluster ${g.clusterId} (score ${priority}) — ${kind}.`;
    out.push({
      kind,
      closesFindings: closes,
      rationale,
      artifact: renderPRDraft(kind, g.findings),
      blocking,
      priority,
    });
  }
  return out;
}

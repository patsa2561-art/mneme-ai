/**
 * Secret-leak signal — wraps the real `egress.scanEgress` (deterministic regex
 * + entropy). Reports kind + file + line ONLY; the secret value is never read
 * into the report (egress findings are {kind,count}; we attach location locally).
 */
import { egress } from "@mneme-ai/core";
import type { SecretsBlock } from "../types.js";
import { listTextFiles, readText } from "../util.js";

export function scanSecrets(repoPath: string, maxFiles: number): SecretsBlock {
  const { files } = listTextFiles(repoPath, maxFiles);
  const byKind: Record<string, number> = {};
  const hits: SecretsBlock["hits"] = [];
  let total = 0;
  let scanned = 0;
  let worst: SecretsBlock["worstVerdict"] = "ALLOW";

  for (const f of files) {
    const text = readText(f.abs);
    if (!text) continue;
    scanned++;
    // Scan per-line so we can attach a line number without ever storing the
    // value. Entropy detection is DISABLED for repo scanning: high-entropy
    // tokens are everywhere in normal source (hashes, base64, minified
    // strings) and would drown the signal in false positives. We count ONLY
    // named credential patterns (AWS/GitHub/OpenAI/PEM/JWT/card/…) — precise.
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const r = egress.scanEgress({ payload: lines[i], entropy: { enabled: false } });
      if (r.findings.length === 0) continue;
      if (r.verdict === "BLOCK") worst = "BLOCK";
      else if (r.verdict === "REDACT" && worst === "ALLOW") worst = "REDACT";
      for (const finding of r.findings) {
        byKind[finding.kind] = (byKind[finding.kind] ?? 0) + finding.count;
        total += finding.count;
        if (hits.length < 50) hits.push({ kind: finding.kind, file: f.rel, line: i + 1 });
      }
    }
  }

  return {
    filesScanned: scanned,
    totalFindings: total,
    byKind,
    hits,
    worstVerdict: worst,
    note:
      total === 0
        ? "No credential patterns matched in tracked text files."
        : "Findings list kind+file+line only — the secret value is never stored or transmitted.",
  };
}

/**
 * Secret-leak signal — wraps the real `egress.scanEgress` (deterministic regex).
 * Reports kind + file + line ONLY; the secret value is never read into the report.
 *
 * PRECISION: a credential pattern in a TEST / FIXTURE / DOC / EXAMPLE file is
 * almost always intentional sample data (especially in a security repo whose job
 * is to detect secrets), NOT a real leak. We classify every hit by path and count
 * ONLY production-code hits toward the headline + grade; test/fixture/doc hits are
 * reported separately as `excludedTestHits` so the signal means "real leak risk",
 * not "matched a pattern somewhere". Entropy detection stays OFF (source code is
 * full of high-entropy tokens → noise).
 */
import { egress } from "@mneme-ai/core";
import type { SecretsBlock } from "../types.js";
import { listTextFiles, readText } from "../util.js";

const NON_PROD = /(\.test\.|\.spec\.|[._-]fixtures?\b|__tests__|__fixtures__|__mocks__|(^|\/)(tests?|spec|fixtures?|examples?|samples?|mocks?|docs?|e2e|benchmarks?|bench)\/|\.stories\.|\.md$|\.mdx$|\.snap$|\.lock$|fixture)/i;
const isProd = (rel: string) => !NON_PROD.test(rel);

export function scanSecrets(repoPath: string, maxFiles: number): SecretsBlock {
  const { files } = listTextFiles(repoPath, maxFiles);
  const byKind: Record<string, number> = {};
  const hits: SecretsBlock["hits"] = [];
  let total = 0, excluded = 0, scanned = 0;
  let worst: SecretsBlock["worstVerdict"] = "ALLOW";

  for (const f of files) {
    const text = readText(f.abs);
    if (!text) continue;
    scanned++;
    const prod = isProd(f.rel);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const r = egress.scanEgress({ payload: lines[i], entropy: { enabled: false } });
      if (r.findings.length === 0) continue;
      const n = r.findings.reduce((s, fnd) => s + fnd.count, 0);
      if (!prod) { excluded += n; continue; }       // test/fixture/doc → not a leak
      if (r.verdict === "BLOCK") worst = "BLOCK";
      else if (r.verdict === "REDACT" && worst === "ALLOW") worst = "REDACT";
      for (const finding of r.findings) {
        byKind[finding.kind] = (byKind[finding.kind] ?? 0) + finding.count;
        total += finding.count;
        if (hits.length < 50) hits.push({ kind: finding.kind, file: f.rel, line: i + 1 });
      }
    }
  }

  const tail = excluded > 0 ? ` (${excluded} more in test/fixture/doc files — excluded as intentional sample data)` : "";
  return {
    filesScanned: scanned,
    totalFindings: total,
    excludedTestHits: excluded,
    byKind,
    hits,
    worstVerdict: worst,
    note:
      total === 0
        ? `No credential patterns in production code${tail}.`
        : `${total} credential-pattern match(es) in production code — review${tail}. Kind+file+line only; the value is never stored.`,
  };
}

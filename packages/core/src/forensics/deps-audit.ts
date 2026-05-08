/**
 * Dependency vulnerability audit via OSV.dev.
 *
 * Customer feedback (v0.36): "ไม่ Integrate กับ Vulnerability DB — ไม่ match
 * กับ CVE, ไม่ตรวจ npm audit / osv.dev, ไม่ตรวจ dependency vulns."
 *
 * v0.38 implementation:
 *   1. Parse package-lock.json (npm) — most accurate inventory of what
 *      actually got installed (transitive included).
 *   2. POST to https://api.osv.dev/v1/querybatch with the full inventory
 *      as a single batch request — free, no auth, ~one round-trip.
 *   3. Group findings by package + cross-reference with our existing
 *      forensics output so the user sees code-level + dep-level risks
 *      in one report.
 *
 * Why OSV.dev rather than npm audit:
 *   - No `npm` binary required — works in CI containers without npm
 *   - Covers more ecosystems (PyPI, Go, Rust, etc. — our scanner can grow into them)
 *   - Includes GitHub Security Advisories AND CVE/NVD AND ecosystem-specific feeds
 *   - Free, public, no rate-limiting in normal use
 */

export interface AuditOptions {
  cwd: string;
  /** Override the network call for tests. */
  fetchImpl?: typeof fetch;
  /** Skip the network call entirely (offline mode). */
  offline?: boolean;
  /** Cap the number of packages queried. Default 5000 (well above a typical lockfile). */
  maxPackages?: number;
}

export interface VulnerabilityHit {
  /** OSV id, e.g. GHSA-xxxx-xxxx-xxxx. */
  id: string;
  /** Severity rating from OSV, normalised to our scale. */
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  /** Short headline. */
  summary: string;
  /** Full description (truncated for display). */
  details?: string;
  /** Package name. */
  package: string;
  /** Affected version found in lockfile. */
  installedVersion: string;
  /** Aliased CVE ids when known. */
  aliases: string[];
  /** OSV-published advisory URL. */
  url: string;
  /** Suggested fix version when known. */
  fixedIn?: string;
}

export interface AuditReport {
  /** Time scanned. */
  scannedAt: string;
  /** Number of packages in the lockfile. */
  packagesScanned: number;
  /** Findings, sorted by severity then package. */
  findings: VulnerabilityHit[];
  /** Per-severity tally. */
  bySeverity: Record<VulnerabilityHit["severity"], number>;
  /** Lockfile path used. */
  source: string;
  /** Notes from the auditor (e.g. "offline mode — skipped"). */
  notes: string[];
}

interface LockedPackage {
  name: string;
  version: string;
}

/** Public entrypoint. */
export async function auditDependencies(opts: AuditOptions): Promise<AuditReport> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const lockPath = path.join(opts.cwd, "package-lock.json");
  const notes: string[] = [];

  let lockText: string;
  try {
    lockText = await fs.readFile(lockPath, "utf8");
  } catch {
    return {
      scannedAt: new Date().toISOString(),
      packagesScanned: 0,
      findings: [],
      bySeverity: emptyTally(),
      source: lockPath,
      notes: [`No package-lock.json at ${lockPath} — run \`npm install\` first.`],
    };
  }

  const inventory = parseLockfile(lockText);
  const cap = opts.maxPackages ?? 5000;
  const queryInventory = inventory.slice(0, cap);
  if (inventory.length > cap) {
    notes.push(`inventory capped at ${cap} packages (lockfile had ${inventory.length})`);
  }

  if (opts.offline) {
    notes.push("offline mode — skipped network query; report shows zero findings (run online to see CVEs)");
    return {
      scannedAt: new Date().toISOString(),
      packagesScanned: queryInventory.length,
      findings: [],
      bySeverity: emptyTally(),
      source: lockPath,
      notes,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let findings: VulnerabilityHit[] = [];
  try {
    findings = await queryOsv(fetchImpl, queryInventory);
  } catch (err) {
    notes.push(`OSV.dev query failed: ${(err as Error).message}. Try again with internet access.`);
  }

  // Sort by severity (critical > high > medium > low > unknown), then package
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.package.localeCompare(b.package));

  const bySeverity = emptyTally();
  for (const f of findings) bySeverity[f.severity] += 1;

  return {
    scannedAt: new Date().toISOString(),
    packagesScanned: queryInventory.length,
    findings,
    bySeverity,
    source: lockPath,
    notes,
  };
}

/** Parse npm v3 lockfile (the only format we currently support). Returns a
 *  deduplicated list of (name, version) pairs.  */
export function parseLockfile(raw: string): LockedPackage[] {
  let parsed: { lockfileVersion?: number; packages?: Record<string, { name?: string; version?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || !parsed.packages) return [];
  const seen = new Set<string>();
  const out: LockedPackage[] = [];
  for (const [key, pkg] of Object.entries(parsed.packages)) {
    if (key === "") continue; // root project
    if (!pkg || !pkg.version) continue;
    // Path is like "node_modules/foo" or "node_modules/foo/node_modules/bar".
    // Use the last segment as the package name unless `pkg.name` is set
    // (workspaces / aliased deps).
    let name = pkg.name;
    if (!name) {
      const segments = key.split("node_modules/");
      name = segments[segments.length - 1];
    }
    if (!name) continue;
    const id = `${name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, version: pkg.version });
  }
  return out;
}

/** Query OSV.dev's batch API. */
async function queryOsv(
  fetchImpl: typeof fetch,
  inventory: LockedPackage[],
): Promise<VulnerabilityHit[]> {
  if (inventory.length === 0) return [];
  const queries = inventory.map((p) => ({
    package: { name: p.name, ecosystem: "npm" },
    version: p.version,
  }));
  const res = await fetchImpl("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) {
    throw new Error(`OSV.dev returned ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { results?: Array<{ vulns?: Array<{ id: string }> }> };
  const results = json.results ?? [];

  // Collect unique vuln ids that need a follow-up GET for full details.
  const lookups: Array<{ id: string; pkg: LockedPackage }> = [];
  for (let i = 0; i < results.length; i++) {
    const vulns = results[i]?.vulns ?? [];
    const pkg = inventory[i]!;
    for (const v of vulns) lookups.push({ id: v.id, pkg });
  }

  // De-dupe lookups (same vuln may apply to multiple installed versions).
  const unique = new Map<string, LockedPackage>();
  for (const { id, pkg } of lookups) {
    if (!unique.has(id)) unique.set(id, pkg);
  }

  // Fetch each vulnerability's details. Run in batches of 10 to stay polite.
  const out: VulnerabilityHit[] = [];
  const ids = Array.from(unique.keys());
  for (let i = 0; i < ids.length; i += 10) {
    const slice = ids.slice(i, i + 10);
    const fetched = await Promise.all(
      slice.map(async (id) => {
        const res = await fetchImpl(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        return (await res.json()) as OsvVulnerability;
      }),
    );
    for (let j = 0; j < slice.length; j++) {
      const id = slice[j]!;
      const detail = fetched[j];
      const pkg = unique.get(id)!;
      out.push(toHit(id, pkg, detail));
    }
  }
  return out;
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
  references?: Array<{ url: string }>;
}

function toHit(id: string, pkg: LockedPackage, detail: OsvVulnerability | null): VulnerabilityHit {
  return {
    id,
    severity: pickSeverity(detail),
    summary: detail?.summary ?? id,
    details: detail?.details ? detail.details.slice(0, 500) : undefined,
    package: pkg.name,
    installedVersion: pkg.version,
    aliases: detail?.aliases ?? [],
    url: detail?.references?.[0]?.url ?? `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
    fixedIn: pickFixedVersion(detail),
  };
}

function pickSeverity(detail: OsvVulnerability | null): VulnerabilityHit["severity"] {
  if (!detail) return "unknown";
  const dbSev = detail.database_specific?.severity?.toLowerCase();
  if (dbSev === "critical" || dbSev === "high" || dbSev === "medium" || dbSev === "low") return dbSev;
  // Map CVSS score if present
  const cvss = detail.severity?.find((s) => s.type === "CVSS_V3" || s.type === "CVSS_V4");
  if (cvss) {
    const score = parseCvssScore(cvss.score);
    if (Number.isFinite(score)) {
      if (score >= 9) return "critical";
      if (score >= 7) return "high";
      if (score >= 4) return "medium";
      if (score > 0) return "low";
    }
  }
  return "unknown";
}

function pickFixedVersion(detail: OsvVulnerability | null): string | undefined {
  if (!detail?.affected) return undefined;
  for (const a of detail.affected) {
    for (const r of a.ranges ?? []) {
      for (const e of r.events ?? []) {
        if (e.fixed) return e.fixed;
      }
    }
  }
  return undefined;
}

/** Parse a CVSS vector or numeric string and return the base score. */
function parseCvssScore(s: string): number {
  const numeric = Number(s);
  if (Number.isFinite(numeric)) return numeric;
  // OSV often returns vectors like "CVSS:3.1/AV:N/AC:L/...". Numeric score
  // isn't in the vector — return NaN so caller falls through.
  return NaN;
}

function severityRank(s: VulnerabilityHit["severity"]): number {
  switch (s) {
    case "critical": return 4;
    case "high":     return 3;
    case "medium":   return 2;
    case "low":      return 1;
    case "unknown":  return 0;
  }
}

function emptyTally(): AuditReport["bySeverity"] {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
}

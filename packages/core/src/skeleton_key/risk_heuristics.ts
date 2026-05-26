/**
 * v2.60.0 — SKELETON KEY risk heuristics.
 *
 * Pattern-based risk scoring for MCP servers, name-only path. Used as
 * the fast first pass; CAPABILITY PROBE upgrades the scoring with
 * empirical evidence (real tools/list result from spawning the server).
 *
 * Severity scale 0..1:
 *   0.0-0.3  → low (read-only / sandboxed)
 *   0.3-0.6  → medium (scoped mutations)
 *   0.6-0.85 → high (broad mutations)
 *   0.85-1.0 → critical (arbitrary execution / unrestricted FS / DB DDL)
 *
 * Every entry maps to a CWE (Common Weakness Enumeration) for
 * compliance audit-grade output.
 */

export interface RiskHeuristic {
  /** Lowercase substring to match against server name. */
  match: string;
  /** Human-readable risk class. */
  riskName: string;
  /** 0..1 severity. */
  severity: number;
  /** Suggested mitigation. */
  mitigation: string;
  /** CWE id for compliance mapping. */
  cwe: string;
  /** Capability tags exposed (used by bypass graph). */
  capabilities: string[];
}

/**
 * Ordered most-specific → least-specific. First match wins per server.
 * Each entry curated from MCP ecosystem observation (2026-05).
 */
export const RISK_HEURISTICS: RiskHeuristic[] = [
  // Shell / exec — the highest risk class
  {
    match: "shell-mcp",
    riskName: "arbitrary command execution",
    severity: 0.95,
    mitigation: "allowlist commands; require PASSPORT token for destructive ops; sandbox via container",
    cwe: "CWE-78", // OS command injection
    capabilities: ["exec", "write_fs", "network", "process_kill"],
  },
  {
    match: "exec-mcp",
    riskName: "arbitrary command execution",
    severity: 0.95,
    mitigation: "allowlist commands; require PASSPORT token for destructive ops",
    cwe: "CWE-78",
    capabilities: ["exec", "write_fs", "network"],
  },
  {
    match: "shell",
    riskName: "shell access (broad)",
    severity: 0.90,
    mitigation: "allowlist commands; refuse rm/format/dd by policy",
    cwe: "CWE-78",
    capabilities: ["exec", "write_fs"],
  },
  // Filesystem
  {
    match: "filesystem",
    riskName: "unrestricted FS read/write",
    severity: 0.85,
    mitigation: "scope to specific dirs via allowlist; gate writes via PASSPORT token",
    cwe: "CWE-22", // path traversal
    capabilities: ["read_fs", "write_fs"],
  },
  // Cloud / infra
  {
    match: "kubernetes",
    riskName: "cluster mutation (apply / delete)",
    severity: 0.85,
    mitigation: "RBAC scope; require explicit ServiceAccount with no cluster-admin",
    cwe: "CWE-269", // improper privilege management
    capabilities: ["cluster_mutate", "exec"],
  },
  {
    match: "aws",
    riskName: "AWS resource creation/destruction",
    severity: 0.80,
    mitigation: "IAM scope down; require --dry-run first; deny iam:* / *:Delete",
    cwe: "CWE-269",
    capabilities: ["cloud_mutate", "billing"],
  },
  {
    match: "gcp",
    riskName: "GCP resource creation/destruction",
    severity: 0.80,
    mitigation: "scope service account; deny billing.* / iam.*",
    cwe: "CWE-269",
    capabilities: ["cloud_mutate", "billing"],
  },
  {
    match: "azure",
    riskName: "Azure resource creation/destruction",
    severity: 0.80,
    mitigation: "scope service principal; deny role assignments",
    cwe: "CWE-269",
    capabilities: ["cloud_mutate", "billing"],
  },
  // DB
  {
    match: "postgres",
    riskName: "DB DDL/DML allowed",
    severity: 0.78,
    mitigation: "use read-only user; deny DROP/TRUNCATE/DELETE via grants",
    cwe: "CWE-89", // SQL injection class
    capabilities: ["db_read", "db_write", "db_ddl"],
  },
  {
    match: "mysql",
    riskName: "DB DDL/DML allowed",
    severity: 0.78,
    mitigation: "use read-only user; revoke ALTER/DROP",
    cwe: "CWE-89",
    capabilities: ["db_read", "db_write", "db_ddl"],
  },
  {
    match: "mongodb",
    riskName: "DB write/dropCollection allowed",
    severity: 0.75,
    mitigation: "role-scope to read-only or specific db; deny dropDatabase",
    cwe: "CWE-89",
    capabilities: ["db_read", "db_write"],
  },
  {
    match: "redis",
    riskName: "DB write + FLUSHDB risk",
    severity: 0.70,
    mitigation: "ACL with read-only; deny FLUSHDB/FLUSHALL/CONFIG SET",
    cwe: "CWE-89",
    capabilities: ["db_read", "db_write"],
  },
  // Source control
  {
    match: "github",
    riskName: "write to any repo",
    severity: 0.75,
    mitigation: "scope token to specific repos; deny repo-creation / repo-deletion",
    cwe: "CWE-285", // improper authorization
    capabilities: ["git_write", "network"],
  },
  {
    match: "gitlab",
    riskName: "write to any project",
    severity: 0.75,
    mitigation: "scope token to specific projects; deny project deletion",
    cwe: "CWE-285",
    capabilities: ["git_write", "network"],
  },
  // Browser automation
  {
    match: "playwright",
    riskName: "headless browser to any URL",
    severity: 0.65,
    mitigation: "allowlist domains; deny localhost/127.* (SSRF surface)",
    cwe: "CWE-918", // SSRF
    capabilities: ["network", "browser_automation"],
  },
  {
    match: "puppeteer",
    riskName: "headless browser to any URL",
    severity: 0.65,
    mitigation: "allowlist domains; deny localhost/127.*",
    cwe: "CWE-918",
    capabilities: ["network", "browser_automation"],
  },
  {
    match: "browser",
    riskName: "browser automation",
    severity: 0.60,
    mitigation: "allowlist domains; deny credential prompts",
    cwe: "CWE-918",
    capabilities: ["network", "browser_automation"],
  },
  // Generic write-capable
  {
    match: "write",
    riskName: "generic write tool (name suggests mutations)",
    severity: 0.55,
    mitigation: "inspect actual tool schema; scope via PASSPORT",
    cwe: "CWE-285",
    capabilities: ["write_fs"],
  },
  // Memory / RAG read-only
  {
    match: "memory",
    riskName: "read-only memory (low risk)",
    severity: 0.20,
    mitigation: "verify it doesn't shell out; pin source paths",
    cwe: "CWE-200", // info exposure (if memory contains secrets)
    capabilities: ["read_memory"],
  },
];

/**
 * Match a server name against heuristics. Returns the highest-severity
 * matching heuristic, or null if no match (= unknown → conservative HIGH).
 */
export function matchHeuristic(serverName: string): RiskHeuristic | null {
  const lower = serverName.toLowerCase();
  const matches = RISK_HEURISTICS.filter((h) => lower.includes(h.match));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.severity - a.severity)[0]!;
}

/**
 * Unknown / unmatched server. Conservative default: treat as medium risk
 * with hint to run capability probe for exact assessment.
 */
export const UNKNOWN_HEURISTIC: RiskHeuristic = {
  match: "*",
  riskName: "unknown server (no heuristic match)",
  severity: 0.50,
  mitigation: "run `mneme skeleton_key probe --server <name>` for empirical capability assessment",
  cwe: "CWE-1059", // insufficient documentation
  capabilities: ["unknown"],
};

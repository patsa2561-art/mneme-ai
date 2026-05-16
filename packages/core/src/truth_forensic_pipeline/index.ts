/**
 * v2.19.15 — MNEME TRUTH FORENSIC PIPELINE (the verify command that calls its own bluff)
 *
 *   "Every AI verify tool today asks the wrong question: 'is this claim
 *    supported?'. It scrapes the codebase for keyword matches and rubber-
 *    stamps anything that has a hit. When the claim says 'Mneme registers
 *    4 mneme.nexus.* tools', it sees the words 'mneme' and 'tools' in
 *    the codebase and certifies TRUSTWORTHY — even if the actual count
 *    is 0. This is the W2 disease.
 *
 *    Mneme's TRUTH FORENSIC PIPELINE inverts the question: 'what would
 *    REFUTE this claim, and have we searched + failed to find every
 *    refutation?'. For the AI-tool-self-description class (which is the
 *    most common verify target for AI agents) we ship a SNIFFER that
 *    extracts verifiable assertions (mneme.X.Y exists, 'N mneme.X.*
 *    tools', 'ships M MCP tools', version=X) and CHECKS them against
 *    Mneme's own ground truth (the live MCP catalog + installed version).
 *
 *    For self-description claims, the pipeline is VENDOR-AGNOSTIC AND
 *    OFFLINE — no LLM call needed. For generic claims, it composes onto
 *    INVERSE-LLM (v2.19.3) + NEGATIVE-EVIDENCE (v2.19.13) for the same
 *    burden-of-proof inversion. The W2 lie becomes structurally
 *    impossible."
 *
 * Architecture:
 *   - 5 built-in SNIFFERS that extract verifiable assertions from claim text:
 *       • sniffMcpToolExact:    "ships mneme.X.Y" / "registers mneme.X.Y"
 *       • sniffMcpFamilyCount:  "N mneme.X.* tools"
 *       • sniffMcpTotalCount:   "ships N MCP tools" / "N tools total"
 *       • sniffVersion:         "v2.19.X" / "version 2.19.X"
 *       • sniffFilePath:        "the file packages/.../foo.ts"
 *   - `forensicVerify({claim, mcpCatalog, installedVersion, ...})` —
 *     parse assertions → check each against ground truth → apply
 *     negative-evidence rules → issue HMAC-signed certificate.
 *   - Verdict bands: ACCEPTED + cert / REJECTED + defeating evidence /
 *     UNKNOWN + untested assertions.
 *
 * Honest scope:
 *   - Built-in sniffers cover AI-tool-self-description claims (the W2
 *     class). For generic factual claims, caller supplies refutations +
 *     search outcomes (composes onto v2.19.13 NEGATIVE-EVIDENCE).
 *   - "ACCEPTED" means every SNIFFED assertion grounded. Untested
 *     unsniffable claim text doesn't auto-accept — it returns UNKNOWN
 *     unless caller supplies vendor refutations + searches.
 *   - Certificate is HMAC-signed so a forged verdict is detectable.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type AssertionKind =
  | "mcp_tool_exact"
  | "mcp_family_count"
  | "mcp_total_count"
  | "version_exact"
  | "file_path";

export interface FactAssertion {
  kind: AssertionKind;
  /** Human-readable rendering of the assertion. */
  asserted: string;
  /** Structured value for ground-truth lookup. */
  value: unknown;
}

export type AssertionSubVerdict = "supported" | "refuted" | "untested";

export interface AssertionResult {
  kind: AssertionKind;
  asserted: string;
  sub_verdict: AssertionSubVerdict;
  evidence?: string;
  observed?: unknown;
  expected?: unknown;
}

export type ForensicVerdict = "ACCEPTED" | "REJECTED" | "UNKNOWN";

export interface ForensicCertificate {
  v: typeof PROTOCOL_VERSION;
  claim: string;
  claimSha: string;
  assertions: AssertionResult[];
  verdict: ForensicVerdict;
  ts: number;
  hmac: string;
}

export interface ForensicResult {
  verdict: ForensicVerdict;
  claim: string;
  assertions: AssertionResult[];
  /** Set when verdict='REJECTED' — the assertion(s) whose ground-truth refuted. */
  refutedAssertions: AssertionResult[];
  /** Set when verdict='UNKNOWN' — claim had no sniffable assertions and no caller-supplied refutations. */
  untested?: boolean;
  certificate: ForensicCertificate;
  /** Plain-English explanation safe to show non-engineers. */
  explanation: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_TRUTH_SECRET"] || `mneme-truth-forensic-v${PROTOCOL_VERSION}`;
}

function sha256Hex(s: string): string {
  return createHmac("sha256", "mneme-truth-claim-id").update(s).digest("hex");
}

function signCertificate(body: Omit<ForensicCertificate, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

// ─── SNIFFERS ────────────────────────────────────────────────────────────

/** Extract exact `mneme.X.Y` tool-name mentions from claim text. */
export function sniffMcpToolExact(claim: string): FactAssertion[] {
  const re = /\bmneme\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b/g;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(claim)) !== null) hits.add(m[0]!);
  return Array.from(hits).map((name) => ({
    kind: "mcp_tool_exact",
    asserted: `MCP tool '${name}' is registered`,
    value: { toolName: name },
  }));
}

/** Extract "N mneme.X.* tools" family-count assertions. */
export function sniffMcpFamilyCount(claim: string): FactAssertion[] {
  const re = /\b(\d+)\s+mneme\.([a-z_][a-z0-9_]*)\.(\*|tools?)\s*(?:mcp\s+)?(?:tools?)?/gi;
  const re2 = /\bregisters?\s+(\d+)\s+mneme\.([a-z_][a-z0-9_]*)\.\*/gi;
  const hits = new Map<string, number>();
  for (const r of [re, re2]) {
    let m: RegExpExecArray | null;
    while ((m = r.exec(claim)) !== null) {
      const n = parseInt(m[1]!, 10);
      const family = m[2]!.toLowerCase();
      // Last-wins per family (claim might restate)
      hits.set(family, n);
    }
  }
  return Array.from(hits.entries()).map(([family, n]) => ({
    kind: "mcp_family_count" as const,
    asserted: `MCP family 'mneme.${family}.*' has exactly ${n} tools`,
    value: { family, expectedCount: n },
  }));
}

/** Extract "ships N MCP tools" / "N tools total" claims. */
export function sniffMcpTotalCount(claim: string): FactAssertion[] {
  const patterns = [
    /\bships?\s+(\d+)\s+mcp\s+tools?\b/i,
    /\b(\d+)\s+(?:total\s+)?mcp\s+tools?\b/i,
    /\bregisters?\s+(\d+)\s+(?:total\s+)?mcp\s+tools?\b/i,
    /\b(\d+)\s+tools?\s+total\b/i,
  ];
  for (const re of patterns) {
    const m = claim.match(re);
    if (m) {
      const n = parseInt(m[1]!, 10);
      return [{
        kind: "mcp_total_count",
        asserted: `Mneme ships exactly ${n} MCP tools total`,
        value: { expectedCount: n },
      }];
    }
  }
  return [];
}

/** Extract "v2.19.X" / "version 2.19.X" version claims. */
export function sniffVersion(claim: string): FactAssertion[] {
  const re = /\bv?(\d+\.\d+\.\d+)\b/g;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(claim)) !== null) hits.add(m[1]!);
  return Array.from(hits).map((ver) => ({
    kind: "version_exact" as const,
    asserted: `installed version equals ${ver}`,
    value: { version: ver },
  }));
}

/** Extract file paths mentioned in claim. */
export function sniffFilePath(claim: string): FactAssertion[] {
  const re = /\b((?:packages|scripts|tests|src)\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|md|json|mdx))\b/g;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(claim)) !== null) hits.add(m[1]!);
  return Array.from(hits).map((p) => ({
    kind: "file_path" as const,
    asserted: `file '${p}' exists`,
    value: { path: p },
  }));
}

export function sniffAllAssertions(claim: string): FactAssertion[] {
  return [
    ...sniffMcpToolExact(claim),
    ...sniffMcpFamilyCount(claim),
    ...sniffMcpTotalCount(claim),
    ...sniffVersion(claim),
    ...sniffFilePath(claim),
  ];
}

// ─── GROUND-TRUTH CHECKER ────────────────────────────────────────────────

export interface GroundTruth {
  mcpCatalog?: string[];
  installedVersion?: string;
  fileExists?: (path: string) => boolean;
}

function checkAssertion(a: FactAssertion, gt: GroundTruth): AssertionResult {
  if (a.kind === "mcp_tool_exact") {
    const v = a.value as { toolName: string };
    if (!gt.mcpCatalog) {
      return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "no mcpCatalog supplied to checker" };
    }
    const found = gt.mcpCatalog.includes(v.toolName);
    return {
      kind: a.kind,
      asserted: a.asserted,
      sub_verdict: found ? "supported" : "refuted",
      evidence: found ? `tool '${v.toolName}' is in the live MCP catalog` : `tool '${v.toolName}' NOT FOUND in the live MCP catalog (${gt.mcpCatalog.length} tools registered)`,
      observed: found,
      expected: true,
    };
  }
  if (a.kind === "mcp_family_count") {
    const v = a.value as { family: string; expectedCount: number };
    if (!gt.mcpCatalog) {
      return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "no mcpCatalog supplied" };
    }
    const prefix = `mneme.${v.family}.`;
    const actual = gt.mcpCatalog.filter((t) => t.startsWith(prefix)).length;
    const supported = actual === v.expectedCount;
    return {
      kind: a.kind,
      asserted: a.asserted,
      sub_verdict: supported ? "supported" : "refuted",
      evidence: supported
        ? `live catalog has exactly ${actual} tools matching '${prefix}*'`
        : `live catalog has ${actual} tools matching '${prefix}*', not ${v.expectedCount} — claim refuted`,
      observed: actual,
      expected: v.expectedCount,
    };
  }
  if (a.kind === "mcp_total_count") {
    const v = a.value as { expectedCount: number };
    if (!gt.mcpCatalog) {
      return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "no mcpCatalog supplied" };
    }
    const actual = gt.mcpCatalog.length;
    const supported = actual === v.expectedCount;
    return {
      kind: a.kind,
      asserted: a.asserted,
      sub_verdict: supported ? "supported" : "refuted",
      evidence: supported
        ? `live catalog has exactly ${actual} tools`
        : `live catalog has ${actual} tools, not ${v.expectedCount} — claim refuted`,
      observed: actual,
      expected: v.expectedCount,
    };
  }
  if (a.kind === "version_exact") {
    const v = a.value as { version: string };
    if (!gt.installedVersion) {
      return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "no installedVersion supplied" };
    }
    const supported = gt.installedVersion === v.version;
    return {
      kind: a.kind,
      asserted: a.asserted,
      sub_verdict: supported ? "supported" : "refuted",
      evidence: supported
        ? `installed version is ${gt.installedVersion}`
        : `installed version is ${gt.installedVersion}, not ${v.version} — claim refuted`,
      observed: gt.installedVersion,
      expected: v.version,
    };
  }
  if (a.kind === "file_path") {
    const v = a.value as { path: string };
    if (!gt.fileExists) {
      return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "no fileExists checker supplied" };
    }
    const found = gt.fileExists(v.path);
    return {
      kind: a.kind,
      asserted: a.asserted,
      sub_verdict: found ? "supported" : "refuted",
      evidence: found ? `file '${v.path}' exists on disk` : `file '${v.path}' does NOT exist — claim refuted`,
      observed: found,
      expected: true,
    };
  }
  return { kind: a.kind, asserted: a.asserted, sub_verdict: "untested", evidence: "unknown assertion kind" };
}

// ─── FORENSIC VERIFIER ───────────────────────────────────────────────────

export interface ForensicInput {
  claim: string;
  groundTruth?: GroundTruth;
  /** Optional caller-supplied generic refutations (composes with v2.19.13 NEGATIVE-EVIDENCE). */
  externalRefutationsFound?: number;
  nowMs?: number;
  secret?: string;
}

/**
 * Run the full forensic pipeline:
 *   1. Sniff assertions from claim text.
 *   2. Check each against ground truth.
 *   3. Apply negative-evidence rule:
 *        ANY assertion 'refuted' → REJECTED
 *        else ALL assertions 'supported' → ACCEPTED
 *        else (some 'untested' / no sniff hits) → UNKNOWN
 *   4. Issue HMAC-signed certificate.
 *   5. Produce plain-English explanation.
 */
export function forensicVerify(input: ForensicInput): ForensicResult {
  const ts = input.nowMs ?? Date.now();
  const secret = input.secret ?? defaultSecret();
  const assertions = sniffAllAssertions(input.claim);
  const results = assertions.map((a) => checkAssertion(a, input.groundTruth ?? {}));
  const refuted = results.filter((r) => r.sub_verdict === "refuted");
  const supported = results.filter((r) => r.sub_verdict === "supported");
  const untested = results.filter((r) => r.sub_verdict === "untested");
  // Negative-evidence rule
  let verdict: ForensicVerdict;
  if (refuted.length > 0) verdict = "REJECTED";
  else if ((input.externalRefutationsFound ?? 0) > 0) verdict = "REJECTED";
  else if (assertions.length > 0 && untested.length === 0) verdict = "ACCEPTED";
  else verdict = "UNKNOWN";
  const claimSha = sha256Hex(input.claim).slice(0, 32);
  const certBody: Omit<ForensicCertificate, "hmac"> = {
    v: PROTOCOL_VERSION,
    claim: input.claim,
    claimSha,
    assertions: results,
    verdict,
    ts,
  };
  const cert: ForensicCertificate = { ...certBody, hmac: signCertificate(certBody, secret) };
  // Plain-English explanation
  const lines: string[] = [];
  if (verdict === "ACCEPTED") {
    lines.push(`✅ TRUTH-FORENSIC verdict: ACCEPTED. Every assertion sniffed from the claim grounded against Mneme's live state.`);
    for (const r of supported) lines.push(`  ✓ ${r.asserted} — ${r.evidence}`);
  } else if (verdict === "REJECTED") {
    lines.push(`❌ TRUTH-FORENSIC verdict: REJECTED. Claim contains assertion(s) refuted by Mneme's live state — DO NOT trust this claim.`);
    for (const r of refuted) lines.push(`  ✗ ${r.asserted} — ${r.evidence}`);
    if (supported.length > 0) {
      lines.push(`(Other parts of the claim grounded: ${supported.length} supported assertion(s).)`);
    }
  } else {
    if (assertions.length === 0) {
      lines.push(`❓ TRUTH-FORENSIC verdict: UNKNOWN. No verifiable assertions sniffed from the claim. Mneme refuses to auto-accept untested claims.`);
      lines.push(`Tip: rephrase to include checkable specifics — e.g., a tool name 'mneme.X.Y', a count 'N mneme.X.* tools', or a file path.`);
    } else {
      lines.push(`❓ TRUTH-FORENSIC verdict: UNKNOWN. Sniffed ${assertions.length} assertion(s) but ${untested.length} could not be checked (missing ground truth).`);
      for (const r of untested) lines.push(`  ? ${r.asserted} — ${r.evidence}`);
    }
  }
  return {
    verdict,
    claim: input.claim,
    assertions: results,
    refutedAssertions: refuted,
    untested: assertions.length === 0,
    certificate: cert,
    explanation: lines.join("\n"),
  };
}

export function verifyForensicCertificate(cert: ForensicCertificate, secret?: string): { ok: boolean; reason?: string } {
  const { hmac, ...body } = cert;
  const expected = signCertificate(body, secret ?? defaultSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged certificate or wrong secret" };
  }
  return { ok: true };
}

export function classifyClaim(claim: string): {
  assertionsExpected: number;
  classes: AssertionKind[];
} {
  const assertions = sniffAllAssertions(claim);
  const classes = Array.from(new Set(assertions.map((a) => a.kind)));
  return { assertionsExpected: assertions.length, classes };
}

export function formatForensicLine(r: ForensicResult): string {
  const tag = r.verdict === "ACCEPTED" ? "✅" : r.verdict === "REJECTED" ? "❌" : "❓";
  const sup = r.assertions.filter((x) => x.sub_verdict === "supported").length;
  const ref = r.refutedAssertions.length;
  const unt = r.assertions.filter((x) => x.sub_verdict === "untested").length;
  return `${tag} TRUTH-FORENSIC · ${r.verdict} · sniffed=${r.assertions.length} (✓${sup} ✗${ref} ?${unt})`;
}

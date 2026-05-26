/**
 * v2.59.0 — SDK SURFACE AUDITOR: gate-self-verification meta-primitive.
 *
 * Bug class caught externally on v2.58: WIRING DOCTOR reported "13/13
 * features wired across core/sdk/cli/tg" BUT external developers
 * writing `import { letheForget } from "@mneme-ai/sdk"` got undefined.
 * Root cause: WIRING DOCTOR grepped the internal NemesisSdk class file
 * (`packages/sdk/src/nemesis.ts`) instead of the external `index.ts`
 * that determines what `import { ... } from "@mneme-ai/sdk"` returns.
 * The gate definition didn't match the external developer API surface.
 *
 * SDK_AUDITOR is the structural fix:
 *   - EMPIRICALLY imports `@mneme-ai/sdk` from the built dist
 *   - Walks the ACTUAL public exports object
 *   - For each feature in the WIRING DOCTOR fixture set, asserts the
 *     expected external API exists (standalone fn AND/OR convenience group)
 *   - Returns a contradiction list (WIRING DOCTOR says wired, SDK_AUDITOR
 *     says missing) — any contradiction is a release blocker
 *
 * Parallel angle to AUTOPROBE: both replace static grep with EMPIRICAL
 * proof-of-execution. AUTOPROBE spawns subprocesses; SDK_AUDITOR imports
 * the actual module. Hand-written gates can mock; empirical imports cannot.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const KEY_ENV = "MNEME_SDK_AUDITOR_KEY";
const DEFAULT_KEY = "mneme-sdk-auditor-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface SurfaceExpectation {
  feature: string;
  /** Standalone function name expected at the SDK top level (optional). */
  standalone?: string[];
  /** Convenience-group name expected (e.g. "lethe" → s.lethe.{forget,verify}). */
  group?: { name: string; methods: string[] };
}

export interface SurfaceFinding {
  feature: string;
  present: boolean;
  evidence: string;
  missingStandalone: string[];
  missingGroupMethods: string[];
}

export interface SdkAuditorReport {
  ok: boolean;
  at: string;
  sdkPath: string;
  totalExports: number;
  totalChecked: number;
  okCount: number;
  brokenCount: number;
  findings: SurfaceFinding[];
  hmac: string;
}

/**
 * Default expectations match the WIRING DOCTOR feature set. Keep this
 * synced with `wiring_doctor.ts` FEATURE_FIXTURES — that's the whole
 * point: SDK_AUDITOR verifies WIRING DOCTOR's claims against reality.
 */
export const DEFAULT_EXPECTATIONS: SurfaceExpectation[] = [
  { feature: "lethe", standalone: ["letheForget"], group: { name: "lethe", methods: ["forget"] } },
  { feature: "gavel", standalone: ["gavelPack"], group: { name: "gavel", methods: ["pack"] } },
  { feature: "nimbus", standalone: ["nimbusPublish"], group: { name: "nimbus", methods: ["publish"] } },
  // Features below access via createMneme().nemesis.* — verify NemesisSdk exists.
  { feature: "janus", group: { name: "NemesisSdk", methods: ["janusObserve", "janusSwap"] } },
  { feature: "stealth_score", group: { name: "NemesisSdk", methods: ["stealthScore"] } },
  { feature: "capillary", group: { name: "NemesisSdk", methods: ["capillary"] } },
  { feature: "themis", group: { name: "NemesisSdk", methods: ["alibi"] } },
  { feature: "sibyl", group: { name: "NemesisSdk", methods: ["sibylCommit", "sibylReveal"] } },
];

function checkGroup(sdk: Record<string, unknown>, groupName: string, methods: string[]): { ok: boolean; missing: string[] } {
  const candidate = sdk[groupName];
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return { ok: false, missing: methods };
  }
  // For NemesisSdk class, methods are prototype methods.
  const target = typeof candidate === "function" ? (candidate as { prototype: Record<string, unknown> }).prototype : candidate as Record<string, unknown>;
  const missing = methods.filter((m) => typeof target[m] !== "function");
  return { ok: missing.length === 0, missing };
}

export interface AuditOpts {
  cwd?: string;
  /** Path to the SDK dist index.js. Defaults to <cwd>/packages/sdk/dist/index.js */
  sdkPath?: string;
  /** Override expectation set (for tests). */
  expectations?: SurfaceExpectation[];
}

/**
 * Run SDK_AUDITOR. Empirically imports the SDK + checks each feature's
 * expected external surface. Returns HMAC-signed report.
 */
export async function auditSdkSurface(opts: AuditOpts = {}): Promise<SdkAuditorReport> {
  const cwd = opts.cwd ?? process.cwd();
  const sdkPath = opts.sdkPath ?? join(cwd, "packages", "sdk", "dist", "index.js");
  const at = new Date().toISOString();
  const expectations = opts.expectations ?? DEFAULT_EXPECTATIONS;
  let sdk: Record<string, unknown> = {};
  let totalExports = 0;
  if (existsSync(sdkPath)) {
    try {
      // Append cache-buster so consecutive audits re-load the module.
      const url = pathToFileURL(resolvePath(sdkPath)).href + `?audit=${Date.now()}`;
      const mod = await import(/* @vite-ignore */ url);
      sdk = mod as Record<string, unknown>;
      totalExports = Object.keys(sdk).length;
    } catch {
      // Leave sdk={}; every check will fail with evidence.
    }
  }
  const findings: SurfaceFinding[] = expectations.map((e) => {
    const missingStandalone: string[] = (e.standalone ?? []).filter((n) => typeof sdk[n] !== "function");
    let missingGroupMethods: string[] = [];
    if (e.group) {
      const r = checkGroup(sdk, e.group.name, e.group.methods);
      if (!r.ok) missingGroupMethods = r.missing;
    }
    const present = missingStandalone.length === 0 && missingGroupMethods.length === 0;
    const evidence = present
      ? `external SDK surface complete: ${[...(e.standalone ?? []), ...(e.group ? e.group.methods.map((m) => `${e.group!.name}.${m}`) : [])].join(", ")}`
      : `MISSING: ${[...missingStandalone, ...missingGroupMethods.map((m) => `${e.group?.name}.${m}`)].join(", ")}`;
    return { feature: e.feature, present, evidence, missingStandalone, missingGroupMethods };
  });
  const okCount = findings.filter((f) => f.present).length;
  const brokenCount = findings.length - okCount;
  const body = { ok: brokenCount === 0, at, sdkPath, totalExports, totalChecked: findings.length, okCount, brokenCount, findings };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return { ...body, hmac };
}

export function verifyAuditorReport(r: SdkAuditorReport): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/**
 * Cross-gate consistency check: compare a WIRING DOCTOR report against
 * an SDK_AUDITOR report. Any feature where WIRING DOCTOR says "sdk
 * present" but SDK_AUDITOR says "missing" is a CONTRADICTION. Both
 * gates should agree on the same facts.
 *
 * Used by TG probe `probe.gate.consistency` to block releases when
 * gates contradict each other.
 */
export interface GateContradiction {
  feature: string;
  wiringDoctorSays: string;
  sdkAuditorSays: string;
}

export interface ConsistencyReport {
  ok: boolean;
  contradictions: GateContradiction[];
  at: string;
  hint: string;
}

export function crossCheckGates(
  wiringDoctor: { features: Array<{ feature: string; sdk: string; sdkEvidence?: string }> },
  sdkAuditor: SdkAuditorReport,
): ConsistencyReport {
  const auditorByFeature = new Map(sdkAuditor.findings.map((f) => [f.feature, f]));
  const contradictions: GateContradiction[] = [];
  for (const wdEntry of wiringDoctor.features) {
    const auditor = auditorByFeature.get(wdEntry.feature);
    if (!auditor) continue; // SDK_AUDITOR doesn't cover this feature
    const wdSaysPresent = wdEntry.sdk === "present";
    const sdkSaysPresent = auditor.present;
    if (wdSaysPresent !== sdkSaysPresent) {
      contradictions.push({
        feature: wdEntry.feature,
        wiringDoctorSays: wdSaysPresent ? `sdk present (${wdEntry.sdkEvidence ?? "n/a"})` : "sdk missing",
        sdkAuditorSays: sdkSaysPresent ? "sdk external surface present" : auditor.evidence,
      });
    }
  }
  return {
    ok: contradictions.length === 0,
    contradictions,
    at: new Date().toISOString(),
    hint: contradictions.length === 0
      ? "gates agree on all features"
      : `${contradictions.length} contradiction(s): WIRING DOCTOR and SDK_AUDITOR disagree on ${contradictions.map((c) => c.feature).join(", ")}`,
  };
}

/** Persist + reload helpers (parallel to AUTOPROBE). */
export interface PersistedAuditPaths {
  base: string;
  last: string;
}

export function persistedPaths(cwd: string): PersistedAuditPaths {
  const base = join(cwd, ".mneme", "sdk_auditor");
  return { base, last: join(base, "last_run.json") };
}

export function persistAuditorReport(cwd: string, report: SdkAuditorReport): string {
  const p = persistedPaths(cwd).last;
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2));
  } catch {
    // never throw on persist failure
  }
  return p;
}

export function loadFreshAuditorReport(cwd: string, maxAgeMs = 24 * 60 * 60 * 1000): SdkAuditorReport | null {
  try {
    const p = persistedPaths(cwd).last;
    if (!existsSync(p)) return null;
    const stat = statSync(p);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const parsed = JSON.parse(readFileSync(p, "utf8")) as SdkAuditorReport;
    if (!verifyAuditorReport(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

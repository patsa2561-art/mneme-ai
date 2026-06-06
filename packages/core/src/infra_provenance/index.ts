/**
 * INFRA PROVENANCE — "rent the muscle, keep the soul."
 *
 * Compute is becoming a rented, shared, migrating commodity — rivals run on each other's GPUs
 * (a workload on one vendor's silicon today, another's tomorrow). In that world a new question has
 * no neutral answer: WHERE did my agent actually run, and WHEN — and did it quietly migrate to a
 * different provider or region mid-task? Each cloud can attest only its own metal; a buyer, an
 * auditor, or a regulator (EU AI Act data-residency) needs a NEUTRAL, portable, offline-verifiable
 * record that no single vendor owns. Mneme — owned by no vendor — can mint it.
 *
 * This captures the execution ENVIRONMENT deterministically from the signals the host exposes
 * (cloud env markers + OS facts + GPU hints), fingerprints it, binds it to an agent run, detects
 * DRIFT between two captures, and checks data-residency against an allow-list.
 *
 * ★HONEST (DIAKRISIS): this attests the environment AS THE HOST DECLARES IT (self-reported env +
 * OS facts) — it is NOT hardware remote-attestation / a TEE proof that the silicon is genuine
 * (that needs a trusted enclave, which Mneme does not claim). The value is real and unmet: a
 * neutral, signed, portable WHERE+WHEN you can verify offline + a tamper-evident drift signal —
 * not a cryptographic proof of the metal. The host fingerprint is a one-way HASH (no raw hostname),
 * and signals are env-var NAMES only (never values), so nothing sensitive leaks.
 */
import { createHash } from "node:crypto";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");

export interface InfraInputs { env?: Record<string, string | undefined>; host?: string; platform?: string; arch?: string; cpus?: number }
export interface InfraAttestation {
  v: 1; provider: string; region: string | null; service: string | null;
  host: string;            // one-way fingerprint of the hostname (no raw name)
  platform: string; arch: string; cpus: number; gpu: string | null;
  capturedAt: number; signals: string[]; fingerprint: string;
}

const has = (e: Record<string, string | undefined>, ...keys: string[]): string | null => { for (const k of keys) { const v = e[k]; if (v !== undefined && v !== "") return String(v); } return null; };
const present = (e: Record<string, string | undefined>, ...keys: string[]): string[] => keys.filter((k) => e[k] !== undefined && e[k] !== "");

/** Deterministically capture where + when this run executes, from injected env + OS facts. */
export function captureInfra(inp: InfraInputs, nowMs: number): InfraAttestation {
  const e = inp?.env ?? {};
  const signals: string[] = [];
  let provider = "local", region: string | null = null, service: string | null = null;

  // priority detection (most specific first); record the env-var NAMES that drove it
  if (has(e, "K_SERVICE", "GOOGLE_CLOUD_PROJECT", "GCE_METADATA_HOST", "GCLOUD_PROJECT")) {
    provider = "gcp"; region = has(e, "CLOUD_RUN_REGION", "FUNCTION_REGION", "GCP_REGION", "GOOGLE_CLOUD_REGION");
    service = e["K_SERVICE"] ? "cloud-run" : e["FUNCTION_TARGET"] ? "cloud-functions" : null;
    signals.push(...present(e, "K_SERVICE", "GOOGLE_CLOUD_PROJECT", "GCE_METADATA_HOST", "CLOUD_RUN_REGION", "FUNCTION_REGION"));
  } else if (has(e, "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_EXECUTION_ENV", "AWS_LAMBDA_FUNCTION_NAME")) {
    provider = "aws"; region = has(e, "AWS_REGION", "AWS_DEFAULT_REGION");
    service = e["AWS_LAMBDA_FUNCTION_NAME"] ? "lambda" : e["ECS_CONTAINER_METADATA_URI"] ? "ecs" : null;
    signals.push(...present(e, "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_EXECUTION_ENV", "AWS_LAMBDA_FUNCTION_NAME", "ECS_CONTAINER_METADATA_URI"));
  } else if (has(e, "WEBSITE_SITE_NAME", "AZURE_REGION", "AZURE_FUNCTIONS_ENVIRONMENT", "MSI_ENDPOINT")) {
    provider = "azure"; region = has(e, "AZURE_REGION", "REGION_NAME"); service = e["AZURE_FUNCTIONS_ENVIRONMENT"] ? "functions" : "app-service";
    signals.push(...present(e, "WEBSITE_SITE_NAME", "AZURE_REGION", "AZURE_FUNCTIONS_ENVIRONMENT", "MSI_ENDPOINT"));
  } else if (has(e, "RUNPOD_POD_ID")) { provider = "runpod"; region = has(e, "RUNPOD_DC_ID"); signals.push(...present(e, "RUNPOD_POD_ID", "RUNPOD_DC_ID")); }
  else if (has(e, "MODAL_TASK_ID", "MODAL_ENVIRONMENT")) { provider = "modal"; signals.push(...present(e, "MODAL_TASK_ID", "MODAL_ENVIRONMENT")); }
  else if (has(e, "LAMBDA_CLOUD", "LAMBDALABS")) { provider = "lambda-labs"; signals.push(...present(e, "LAMBDA_CLOUD", "LAMBDALABS")); }
  else if (has(e, "COREWEAVE", "CW_REGION")) { provider = "coreweave"; region = has(e, "CW_REGION"); signals.push(...present(e, "COREWEAVE", "CW_REGION")); }
  else if (has(e, "OCI_REGION", "OCI_RESOURCE_PRINCIPAL_VERSION")) { provider = "oracle"; region = has(e, "OCI_REGION"); signals.push(...present(e, "OCI_REGION", "OCI_RESOURCE_PRINCIPAL_VERSION")); }
  else if (has(e, "DIGITALOCEAN_APP_ID", "DIGITALOCEAN", "DO_APP_ID", "DO_REGION")) { provider = "digitalocean"; region = has(e, "DO_REGION", "DIGITALOCEAN_APP_REGION"); service = (e["DIGITALOCEAN_APP_ID"] || e["DO_APP_ID"]) ? "app-platform" : "droplet"; signals.push(...present(e, "DIGITALOCEAN_APP_ID", "DIGITALOCEAN", "DO_APP_ID", "DO_REGION", "DIGITALOCEAN_APP_REGION")); }

  // kubernetes is orthogonal — it can sit on any cloud; note it as the service if present
  if (has(e, "KUBERNETES_SERVICE_HOST")) { service = service ?? "kubernetes"; if (provider === "local") provider = "kubernetes"; signals.push("KUBERNETES_SERVICE_HOST"); }

  const gpu = has(e, "NVIDIA_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL") ? "nvidia" : null;
  if (gpu) signals.push(...present(e, "NVIDIA_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL"));

  const host = sha(String(inp?.host ?? "")).slice(0, 24);
  const platform = String(inp?.platform ?? "unknown"), arch = String(inp?.arch ?? "unknown"), cpus = Math.max(0, Number(inp?.cpus) || 0);
  const fingerprint = sha([provider, region ?? "", host, platform, arch].join("|")).slice(0, 32);
  return { v: 1, provider, region, service, host, platform, arch, cpus, gpu, capturedAt: Number(nowMs) || 0, signals: [...new Set(signals)], fingerprint };
}

export interface InfraDrift { drifted: boolean; changes: Array<{ field: string; from: string | null; to: string | null }>; summary: string }
/** Did the run move? Compare two captures — a provider/region/host change is a migration signal. */
export function infraDrift(a: InfraAttestation, b: InfraAttestation): InfraDrift {
  const changes: InfraDrift["changes"] = [];
  for (const f of ["provider", "region", "host"] as const) {
    const av = (a?.[f] ?? null) as string | null, bv = (b?.[f] ?? null) as string | null;
    if (av !== bv) changes.push({ field: f, from: av, to: bv });
  }
  const drifted = changes.length > 0;
  const summary = drifted ? `run migrated: ${changes.map((c) => `${c.field} ${c.from ?? "—"}→${c.to ?? "—"}`).join(", ")}` : "no migration — same provider/region/host";
  return { drifted, changes, summary };
}

export interface ResidencyVerdict { compliant: boolean; region: string | null; provider: string; reason: string }
/** Data-residency gate: is this run within an allowed region/provider set? (EU AI Act-style.)
 *  allowed entries match a region exactly, a region PREFIX ("eu-"), or a "provider:*" wildcard. */
export function dataResidencyCheck(att: InfraAttestation, allowed: ReadonlyArray<string>): ResidencyVerdict {
  const region = att?.region ?? null, provider = String(att?.provider ?? "unknown");
  const list = (allowed ?? []).map((s) => String(s).toLowerCase());
  if (!list.length) return { compliant: true, region, provider, reason: "no residency policy set — unrestricted" };
  if (list.includes(`${provider}:*`)) return { compliant: true, region, provider, reason: `provider ${provider} is allow-listed` };
  if (!region) return { compliant: false, region, provider, reason: "region is unknown — cannot prove residency (deny by default under a policy)" };
  const r = region.toLowerCase();
  const ok = list.some((a) => a === r || (a.endsWith("-") && r.startsWith(a)) || (a.endsWith("*") && r.startsWith(a.slice(0, -1))));
  return { compliant: ok, region, provider, reason: ok ? `region ${region} is within the residency policy` : `region ${region} is OUTSIDE the residency policy [${list.join(", ")}]` };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface InfraProvenanceGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function infraProvenanceGauntlet(): InfraProvenanceGauntlet {
  const gcp = captureInfra({ env: { K_SERVICE: "agent-svc", GOOGLE_CLOUD_PROJECT: "p", CLOUD_RUN_REGION: "europe-west1", NVIDIA_VISIBLE_DEVICES: "all", SECRET_KEY: "xxx" }, host: "node-7", platform: "linux", arch: "x64", cpus: 32 }, 100);
  const gcpOK = gcp.provider === "gcp" && gcp.region === "europe-west1" && gcp.service === "cloud-run" && gcp.gpu === "nvidia"
    && !gcp.signals.includes("SECRET_KEY") && !gcp.host.includes("node-7") && gcp.fingerprint.length === 32;   // no secret value, no raw host

  const aws = captureInfra({ env: { AWS_REGION: "us-east-1", AWS_LAMBDA_FUNCTION_NAME: "fn" }, host: "h", platform: "linux", arch: "arm64" }, 100);
  const awsOK = aws.provider === "aws" && aws.region === "us-east-1" && aws.service === "lambda";

  const ocean = captureInfra({ env: { DO_REGION: "sgp1", DIGITALOCEAN: "1" }, host: "droplet", platform: "linux", arch: "x64" }, 100);
  const oceanOK = ocean.provider === "digitalocean" && ocean.region === "sgp1";

  const local = captureInfra({ env: {}, host: "laptop", platform: "win32", arch: "x64", cpus: 8 }, 100);
  const localOK = local.provider === "local" && local.region === null && local.gpu === null;

  // DRIFT: a run that moved from GCP-eu to AWS-us is flagged with the exact change
  const drift = infraDrift(gcp, aws);
  const driftOK = drift.drifted && drift.changes.some((c) => c.field === "provider" && c.from === "gcp" && c.to === "aws") && drift.changes.some((c) => c.field === "region");
  const noDrift = infraDrift(gcp, captureInfra({ env: { K_SERVICE: "x", GOOGLE_CLOUD_PROJECT: "p", CLOUD_RUN_REGION: "europe-west1", NVIDIA_VISIBLE_DEVICES: "all" }, host: "node-7", platform: "linux", arch: "x64", cpus: 32 }, 200));
  const noDriftOK = !noDrift.drifted;

  // RESIDENCY: an EU policy passes the eu run, fails the us run, and denies unknown-region by default
  const euPolicy = ["eu-", "europe-"];
  const resEU = dataResidencyCheck(gcp, euPolicy).compliant === true;
  const resUS = dataResidencyCheck(aws, euPolicy).compliant === false;
  const resUnknown = dataResidencyCheck(local, euPolicy).compliant === false;   // region unknown → deny under policy
  const resWildcard = dataResidencyCheck(aws, ["aws:*"]).compliant === true;
  const resNoPolicy = dataResidencyCheck(aws, []).compliant === true;
  const residencyOK = resEU && resUS && resUnknown && resWildcard && resNoPolicy;

  // determinism: same inputs → same fingerprint
  const detOK = captureInfra({ env: { AWS_REGION: "us-east-1" }, host: "h", platform: "linux", arch: "x64" }, 1).fingerprint === captureInfra({ env: { AWS_REGION: "us-east-1" }, host: "h", platform: "linux", arch: "x64" }, 2).fingerprint;

  const total = (() => { try { captureInfra(null as never, 0); infraDrift(null as never, null as never); dataResidencyCheck(null as never, null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "DETECT-GCP+GPU-NO-LEAK", pass: gcpOK, detail: "GCP Cloud Run + region + nvidia detected; secret values + raw hostname never captured" },
    { name: "DETECT-AWS-LAMBDA", pass: awsOK, detail: "AWS region + lambda service detected from env" },
    { name: "DETECT-DIGITALOCEAN", pass: oceanOK, detail: "DigitalOcean droplet/App Platform + region detected from env" },
    { name: "DETECT-LOCAL", pass: localOK, detail: "no cloud markers → local, no region, no gpu" },
    { name: "DRIFT-CATCHES-MIGRATION", pass: driftOK && noDriftOK, detail: "a provider/region change is flagged with the exact diff; an identical re-capture is not" },
    { name: "DATA-RESIDENCY-GATE", pass: residencyOK, detail: "EU policy passes eu, fails us, denies unknown-region; provider wildcard + no-policy handled" },
    { name: "DETERMINISTIC-FINGERPRINT", pass: detOK, detail: "same environment → same fingerprint (capture time excluded)" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

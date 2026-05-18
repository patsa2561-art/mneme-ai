/**
 * v2.19.55 OPTIONAL NATIVE — proactive opt-in protocol for heavy native deps.
 *
 * The user wisdom (turn-16): "เลิกใช้ sharp ถ้าไม่จำเป็นจริงๆ" — drop
 * sharp if not needed, or use optionalDependencies + lazy require so the
 * DLL never loads at install. v2.19.55 moved @huggingface/transformers
 * from `dependencies` to `optionalDependencies` in packages/embeddings.
 * npm install will SKIP transformers if its postinstall fails (DLL lock,
 * network, build error). Mneme runtime gracefully falls back to the
 * hash embedder.
 *
 * This module adds the runtime side of that contract:
 *   - detectAvailableNatives() — probes every known optional native at boot
 *   - requireOptional(pkg, fallbackHint?) — lazy import with structured failure
 *   - status() — dashboard view: which natives present + their fallback levels
 *   - installOnDemand(pkg) — instructions for the user to add a native later
 *
 * The wild bet: Mneme's DEFAULT install path is zero-native. Heavy deps
 * (transformers / sharp / onnxruntime-node) are opt-in. Users on Windows
 * never hit EBUSY because no DLL is loaded during install. Users who
 * want the WASM embedder run `mneme embedder enable wasm` which prints
 * the one-line npm install needed.
 *
 * No AI tool worldwide ships an opt-in native-dep protocol with detection
 * + fallback + install-on-demand. First-mover forever on zero-native-default.
 */

const PROTOCOL_VERSION = 1;

export type NativeDep =
  | "transformers"
  | "sharp"
  | "onnxruntime-node"
  | "tensorflow"
  | "z3-solver";

export interface NativeDepInfo {
  /** Canonical name (used in MCP tool args). */
  name: NativeDep;
  /** Actual npm package id (may include scope). */
  npmPackage: string;
  /** What this native enables. */
  enables: string;
  /** Mneme's fallback when this native is missing — what user gets without it. */
  fallback: string;
  /** Best install hint for the user. */
  installHint: string;
  /** Approximate disk cost. */
  approxSizeBytes?: number;
}

/** Catalog of every known optional native dep + its fallback. Add new
 *  entries here as Mneme grows. */
export const KNOWN_NATIVES: readonly NativeDepInfo[] = [
  {
    name: "transformers",
    npmPackage: "@huggingface/transformers",
    enables: "WASM bundled embedder (★★★ semantic quality, 25MB model on first use)",
    fallback: "hash embedder (★★ deterministic, no network) + optional Ollama / OpenAI tiers",
    installHint: "npm install -g @huggingface/transformers",
    approxSizeBytes: 50_000_000,
  },
  {
    name: "sharp",
    npmPackage: "sharp",
    enables: "image processing for badge generation + visual receipts",
    fallback: "pure-JS PNG via canvas or skip image features",
    installHint: "npm install -g sharp",
    approxSizeBytes: 30_000_000,
  },
  {
    name: "onnxruntime-node",
    npmPackage: "onnxruntime-node",
    enables: "GPU-accelerated ONNX inference for the SNN embedder",
    fallback: "pure-TS SNN (slower but identical accuracy)",
    installHint: "npm install -g onnxruntime-node",
    approxSizeBytes: 80_000_000,
  },
  {
    name: "tensorflow",
    npmPackage: "@tensorflow/tfjs-node",
    enables: "GPU-accelerated tensor operations for batch embedding",
    fallback: "pure-TS hash + Ollama tier",
    installHint: "npm install -g @tensorflow/tfjs-node",
    approxSizeBytes: 250_000_000,
  },
  {
    name: "z3-solver",
    npmPackage: "z3-solver",
    enables: "SMT-based arithmetic verification in ACGV",
    fallback: "propositional Gödel verifier (also accurate; slightly slower for large formulas)",
    installHint: "npm install -g z3-solver",
    approxSizeBytes: 12_000_000,
  },
];

export interface NativeProbe {
  name: NativeDep;
  available: boolean;
  versionIfAvailable: string | null;
  loadErrorIfMissing: string | null;
  fallback: string;
}

/** Probe whether a single optional native is loadable RIGHT NOW. Does not
 *  fully import it (saves cold-start latency); just tries `await import()`
 *  in a try/catch. */
export async function probeNative(name: NativeDep): Promise<NativeProbe> {
  const info = KNOWN_NATIVES.find((n) => n.name === name);
  if (!info) {
    return { name, available: false, versionIfAvailable: null, loadErrorIfMissing: "unknown native name", fallback: "n/a" };
  }
  try {
    const mod = await import(info.npmPackage);
    let version: string | null = null;
    try {
      const maybePkg = (mod as { default?: { version?: string }; version?: string }).default?.version ?? (mod as { version?: string }).version;
      if (typeof maybePkg === "string") version = maybePkg;
    } catch { /* */ }
    return { name, available: true, versionIfAvailable: version, loadErrorIfMissing: null, fallback: info.fallback };
  } catch (e) {
    const errMsg = (e as Error).message ?? String(e);
    return { name, available: false, versionIfAvailable: null, loadErrorIfMissing: errMsg.slice(0, 200), fallback: info.fallback };
  }
}

/** Probe all known optional natives in parallel. Returns sorted list with
 *  available ones first. */
export async function detectAvailableNatives(): Promise<NativeProbe[]> {
  const probes = await Promise.all(KNOWN_NATIVES.map((n) => probeNative(n.name)));
  return probes.sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
}

export interface OptionalRequireResult<T = unknown> {
  ok: boolean;
  module: T | null;
  fallbackUsed: boolean;
  fallbackHint?: string;
  error?: string;
}

/** Wrap an optional native import in a safe-fallback contract. Caller
 *  decides whether to use the module or take a fallback path. */
export async function requireOptional<T = unknown>(name: NativeDep): Promise<OptionalRequireResult<T>> {
  const info = KNOWN_NATIVES.find((n) => n.name === name);
  if (!info) {
    return { ok: false, module: null, fallbackUsed: false, error: "unknown native name" };
  }
  try {
    const mod = await import(info.npmPackage);
    return { ok: true, module: mod as T, fallbackUsed: false };
  } catch (e) {
    return {
      ok: false,
      module: null,
      fallbackUsed: true,
      fallbackHint: info.fallback,
      error: (e as Error).message?.slice(0, 200),
    };
  }
}

export interface InstallStatus {
  v: typeof PROTOCOL_VERSION;
  totalKnown: number;
  available: NativeProbe[];
  missing: NativeProbe[];
  bytesAvailable: number;
  bytesIfAllInstalled: number;
  recommendation: string;
}

/** Dashboard view: how lean is this install? What's available? What can
 *  the user opt in to? */
export async function installStatus(): Promise<InstallStatus> {
  const probes = await detectAvailableNatives();
  const available = probes.filter((p) => p.available);
  const missing = probes.filter((p) => !p.available);
  const bytesAvailable = available.reduce((sum, p) => {
    const info = KNOWN_NATIVES.find((n) => n.name === p.name);
    return sum + (info?.approxSizeBytes ?? 0);
  }, 0);
  const bytesIfAllInstalled = KNOWN_NATIVES.reduce((sum, n) => sum + (n.approxSizeBytes ?? 0), 0);
  let recommendation: string;
  if (available.length === 0) {
    recommendation = "ZERO-NATIVE — minimum-footprint install. All Mneme features work via pure-JS fallbacks. To opt in to higher tiers, run `mneme.optional.install_hint` for the dep you want.";
  } else if (available.length === KNOWN_NATIVES.length) {
    recommendation = `MAX-NATIVE — all ${KNOWN_NATIVES.length} optional natives installed (${(bytesAvailable / 1_000_000).toFixed(0)}MB). Full performance available.`;
  } else {
    recommendation = `MIXED — ${available.length}/${KNOWN_NATIVES.length} natives available (${(bytesAvailable / 1_000_000).toFixed(0)}/${(bytesIfAllInstalled / 1_000_000).toFixed(0)}MB). Missing: ${missing.map((p) => p.name).join(", ")}.`;
  }
  return {
    v: PROTOCOL_VERSION,
    totalKnown: KNOWN_NATIVES.length,
    available,
    missing,
    bytesAvailable,
    bytesIfAllInstalled,
    recommendation,
  };
}

/** Returns a structured install-on-demand hint for the user — exact npm
 *  command + size estimate + what they'll gain. */
export function installHint(name: NativeDep): { ok: true; npmCommand: string; enables: string; approxMB: number; rationale: string } | { ok: false; error: string } {
  const info = KNOWN_NATIVES.find((n) => n.name === name);
  if (!info) return { ok: false, error: "unknown native name" };
  return {
    ok: true,
    npmCommand: info.installHint,
    enables: info.enables,
    approxMB: Math.round((info.approxSizeBytes ?? 0) / 1_000_000),
    rationale: `Installing ${info.npmPackage} unlocks: ${info.enables}. Current fallback: ${info.fallback}.`,
  };
}

export { PROTOCOL_VERSION };

/**
 * BundledEmbedder — zero-install WASM embeddings.
 *
 * Uses @huggingface/transformers (the maintained successor to
 * @xenova/transformers from the same author, WASM-first by default,
 * onnxruntime-web — zero native deps). The tool runs on Windows / Mac /
 * Linux out of the box, including ARM64 + Node 24. The model file is
 * lazy-downloaded on first use (~25MB to a local cache), giving users a
 * "★★★ semantic quality" path without installing Ollama.
 *
 * Fallback order in resolveEmbedder():
 *   OpenAI (★★★★★ paid)  →  Ollama (★★★★ free local)
 *   →  Bundled WASM (★★★ free, no install)  →  Hash (★★ deterministic)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { EmbeddingProvider } from "@mneme-ai/core";
import { verifyAgainstPin, tofuVerifyOrPin } from "./checksum.js";

export interface BundledOptions {
  /** HuggingFace repo id. all-MiniLM-L6-v2 = 25MB / 384-dim — best size/quality. */
  model?: string;
  /** Override cache dir. Default: ~/.cache/mneme/models. */
  cacheDir?: string;
  /** Hook for download/load progress (lazy load can take ~5–60s on cold start). */
  onProgress?: (info: { status: string; loaded?: number; total?: number; file?: string }) => void;
  /** v1.11.1 — TOFU manifest path (per-repo). When provided, the cache is
   *  pinned on first load and verified on subsequent loads. Tampered cache
   *  → throws. Disabled if undefined. */
  tofuManifestPath?: string;
}

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMS = 384;

// We type the @huggingface/transformers pipeline result loosely — its public
// types are large and we only need .data (Float32Array-like).
interface PipelineResult {
  data: ArrayLike<number>;
}
type FeatureExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: true },
) => Promise<PipelineResult>;

export class BundledEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly model: string;
  private readonly cacheDir: string;
  private readonly onProgress?: BundledOptions["onProgress"];
  private readonly tofuManifestPath?: string;
  private extractor: FeatureExtractor | null = null;
  private loadPromise: Promise<FeatureExtractor> | null = null;

  constructor(opts: BundledOptions = {}) {
    // v1.30.0 -- MODEL-URL HONEYPOT pre-validation. If the caller hands
    // us a model id that doesn't look like a HuggingFace repo path
    // (e.g., "fnv-256" -- the hash embedder's internal name leaked
    // through a config write/read cycle), FALL BACK to DEFAULT_MODEL
    // instead of constructing a 404-bound URL. The user previously got
    // a confusing "Unauthorized access to file: huggingface.co/fnv-256/..."
    // because their config had been polluted by a prior hash-tier run.
    const requestedModel = opts.model ?? DEFAULT_MODEL;
    const looksValid = /^[\w.-]+\/[\w.-]+$/.test(requestedModel);
    if (!looksValid) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mneme/embeddings] model id "${requestedModel}" doesn't look like a HuggingFace repo path ` +
        `(expected "<owner>/<name>"). Falling back to ${DEFAULT_MODEL}. ` +
        `Likely cause: a prior hash-tier run polluted .mneme/config.json. ` +
        `Run \`mneme embeddings upgrade\` to reset cleanly.`,
      );
      this.model = DEFAULT_MODEL;
    } else {
      this.model = requestedModel;
    }
    this.dimensions = DEFAULT_DIMS;
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.onProgress = opts.onProgress;
    this.tofuManifestPath = opts.tofuManifestPath;
    this.name = `bundled:${this.model}`;
  }

  /** Cheap pre-flight — instantiates the pipeline (downloads if needed) and
   *  runs a 1-token sanity embed. Use BEFORE the long indexer loop. */
  async verify(): Promise<{ ok: true } | { ok: false; reason: string; remedy: string }> {
    try {
      await this.load();
      await this.embed(["ok"]);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return {
        ok: false,
        reason: `Bundled WASM model failed: ${msg}`,
        remedy:
          "First run requires internet to download ~25MB. " +
          "If you're offline, set --embedder hash to use the deterministic fallback.",
      };
    }
  }

  /**
   * v2.19.7 — selfTest() returns rich diagnostics for the bundled embedder
   * pipeline. Tries every constellation device + reports per-device failure
   * mode + suggests a concrete remedy. Use when `verify()` returns `ok:false`
   * and you want to know WHY.
   *
   * Common root causes (and what selfTest catches):
   *   - 'require is not defined'     → @huggingface/transformers internal CJS
   *                                    import under pure-ESM Node; remedy:
   *                                    upgrade transformers to v3.x or use
   *                                    `node --experimental-require-module`.
   *   - 'Unsupported device'         → wasm string changed in v3; constellation
   *                                    will already retry cpu.
   *   - 'EACCES' / 'EPERM'           → cache dir permissions; remedy:
   *                                    `chmod -R u+w ~/.cache/mneme/models`
   *   - 'ENOTFOUND' / 'ECONNREFUSED' → first-run download blocked; remedy:
   *                                    `npm config set fetch-retries 5` + retry
   *                                    or use --embedder=ollama / hash.
   */
  async selfTest(): Promise<{
    overallOk: boolean;
    cacheDir: string;
    cacheDirWritable: boolean;
    networkReachable: "yes" | "no" | "unknown";
    devicesAttempted: Array<{ device: string; ok: boolean; error?: string }>;
    finalDevice: string | null;
    rootCauseHint: string | null;
    remedy: string | null;
  }> {
    // Probe 1: cache dir writable?
    let cacheDirWritable = false;
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      const fs = await import("node:fs");
      const testFile = join(this.cacheDir, ".mneme-write-probe");
      fs.writeFileSync(testFile, "ok", "utf8");
      fs.unlinkSync(testFile);
      cacheDirWritable = true;
    } catch { /* keep false */ }

    // Probe 2: network reachable? (only check if cache doesn't have the model)
    let networkReachable: "yes" | "no" | "unknown" = "unknown";
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch("https://huggingface.co/", { signal: ctl.signal });
      clearTimeout(t);
      networkReachable = r.ok ? "yes" : "no";
    } catch { networkReachable = "no"; }

    // Probe 3: try each constellation device
    const devicesAttempted: Array<{ device: string; ok: boolean; error?: string }> = [];
    let finalDevice: string | null = null;
    let lastError: string | null = null;
    try {
      // v2.19.63 PHOENIX P3 defense-in-depth — fire DLL extraction here too
      // in case bundled embedder loads in a non-daemon process (CLI verify,
      // test harness, custom MCP host). Idempotent — daemon-boot already
      // ran this; no-op when env var already prepended with our tmpdir.
      try {
        const { extractAndRedirect } = await import("@mneme-ai/core").then((m) => m.phoenix.dllExtraction);
        extractAndRedirect();
      } catch { /* BE:silent-by-design */ }
      const transformers = (await import("@huggingface/transformers")) as unknown as {
        pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
        env: Record<string, unknown>;
      };
      (transformers.env as Record<string, unknown>)["cacheDir"] = this.cacheDir;
      (transformers.env as Record<string, unknown>)["allowRemoteModels"] = true;
      for (const device of ["cpu", "wasm", "webgpu", "auto"]) {
        try {
          // v2.27.0 fix (E6+E7): specify dtype explicitly. This:
          //   (a) silences the "dtype not specified" stderr noise that
          //       was leaking transformers.js debug output;
          //   (b) uses the QUANTIZED q8 model (~22MB) instead of fp32
          //       (~90MB) — closes the wasted-RAM finding.
          //   Override via env MNEME_BUNDLED_DTYPE.
          const dtype = process.env["MNEME_BUNDLED_DTYPE"] ?? "q8";
          await transformers.pipeline("feature-extraction", this.model, { device, dtype });
          devicesAttempted.push({ device, ok: true });
          finalDevice = device;
          break;
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          devicesAttempted.push({ device, ok: false, error: msg.slice(0, 200) });
          lastError = msg;
        }
      }
    } catch (e) {
      lastError = (e as Error).message ?? String(e);
      devicesAttempted.push({ device: "(transformers import)", ok: false, error: lastError.slice(0, 200) });
    }

    // Derive root cause + remedy
    let rootCauseHint: string | null = null;
    let remedy: string | null = null;
    if (finalDevice) {
      rootCauseHint = "ok";
      remedy = null;
    } else if (!cacheDirWritable) {
      rootCauseHint = "cache dir is not writable";
      remedy = `chmod -R u+w "${this.cacheDir}" or set --cacheDir to a writable path`;
    } else if (networkReachable === "no" && !lastError) {
      rootCauseHint = "no model in cache + network unreachable";
      remedy = "first run requires internet to download ~25MB; retry online or switch to --embedder=ollama / hash";
    } else if (lastError?.includes("require is not defined")) {
      rootCauseHint = "transformers.js internal CJS import under pure-ESM Node";
      remedy = "upgrade @huggingface/transformers to v3.x or run with `node --experimental-require-module`";
    } else if (lastError?.toLowerCase().includes("unsupported device")) {
      rootCauseHint = "transformers.js dropped this device name in a major version";
      remedy = "constellation will retry remaining devices; ensure latest @huggingface/transformers is installed";
    } else if (lastError?.match(/EACCES|EPERM/)) {
      rootCauseHint = "filesystem permission error";
      remedy = `chmod -R u+w "${this.cacheDir}"`;
    } else if (lastError?.match(/ENOTFOUND|ECONNREFUSED/)) {
      rootCauseHint = "network down during first-run model download";
      remedy = "retry online; or switch to --embedder=ollama (if Ollama is running) / hash (zero-deps fallback)";
    } else if (lastError) {
      rootCauseHint = `unknown: ${lastError.slice(0, 100)}`;
      remedy = "file a bug at https://github.com/patsa2561-art/mneme-ai/issues with this selfTest() output";
    }

    return {
      overallOk: finalDevice !== null,
      cacheDir: this.cacheDir,
      cacheDirWritable,
      networkReachable,
      devicesAttempted,
      finalDevice,
      rootCauseHint,
      remedy,
    };
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Fast path: empty input never triggers the lazy load — keeps tests
    // and trivial calls free of the 25MB model download.
    if (texts.length === 0) return [];
    const ext = await this.load();
    const out: Float32Array[] = new Array(texts.length);
    // Sequential: the WASM pipeline isn't designed for concurrency; one at a
    // time is the predictable, memory-safe path. For 1000 chunks this takes
    // ~10–20s on consumer laptops — acceptable for a one-time index.
    for (let i = 0; i < texts.length; i++) {
      const result = await ext(texts[i]!, { pooling: "mean", normalize: true });
      // result.data is Float32Array-like — copy into a fresh typed array.
      out[i] = Float32Array.from(result.data);
    }
    return out;
  }

  /** Lazy load — done at most once, even under concurrent embed() calls. */
  private async load(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.bootPipeline();
    this.extractor = await this.loadPromise;
    return this.extractor;
  }

  private async bootPipeline(): Promise<FeatureExtractor> {
    // Ensure cache dir exists so transformers.js can write the ONNX model.
    try {
      mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      /* permission errors surface later via the pipeline */
    }

    // Dynamic import — keeps the heavy WASM init out of cold-start path
    // for users who never touch this provider.
    const transformers = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (
        task: string,
        model: string,
        opts: Record<string, unknown>,
      ) => Promise<FeatureExtractor>;
      env: {
        cacheDir?: string;
        // @huggingface/transformers v3 added a separate "useFSCache" knob for
        // node and renamed the cache root used at runtime. Both paths still
        // exist for back-compat; assigning is a no-op when unsupported.
        useFSCache?: boolean;
        allowRemoteModels: boolean;
        localModelPath?: string;
      };
    };

    transformers.env.cacheDir = this.cacheDir;
    transformers.env.allowRemoteModels = true;

    // v1.11.0 — explicit env-pinned checksums (compliance environments).
    try { verifyAgainstPin(this.cacheDir); } catch (err) {
      throw err; // surface clearly — don't swallow integrity violations
    }

    // v1.11.1 — TOFU pre-pipeline check. If the cache already exists from
    // a prior run, verify against our recorded manifest BEFORE the
    // pipeline executes any model code. (Fresh download is pinned post-
    // pipeline below — once the cache is on disk.)
    if (this.tofuManifestPath) {
      const pre = tofuVerifyOrPin(this.cacheDir, this.tofuManifestPath);
      if (pre.status === "tampered") {
        const lines = pre.mismatches
          .slice(0, 3)
          .map((m) => `  ${m.path}: expected ${m.expected.slice(0, 12)}…, actual ${m.actual.slice(0, 12)}…`)
          .join("\n");
        throw new Error(
          `Bundled-model TOFU verification FAILED — model files changed since first install.\n${lines}\n` +
            `Refusing to load possibly-tampered model. To intentionally re-pin, delete: ${this.tofuManifestPath}`,
        );
      }
    }

    // v1.30.0 -- WASM CONSTELLATION (auto-detect best device).
    //
    // Pre-fix: hardcoded `device: "wasm"` worked on @huggingface/transformers
    // <= 3.0 but newer releases threw "Unsupported device 'wasm'. Should be
    // one of: cpu" -- silently dropping the user to the hash tier without
    // them ever knowing the bundled MiniLM was reachable.
    //
    // KILLER IDEA -- WASM Constellation: try a SEQUENCE of device IDs
    // (newest first), keep the first one that loads, cache the winner to
    // `~/.cache/mneme/models/.device-winner` so the NEXT session skips the
    // race. The galaxy of device IDs (cpu / wasm / webgpu / cuda / auto)
    // is searched like a constellation -- whichever star shines first
    // becomes the lighthouse for future runs.
    const onProgress = this.onProgress;
    const progressCb = onProgress
      ? (info: Record<string, unknown>) =>
          onProgress({
            status: String(info["status"] ?? ""),
            loaded: typeof info["loaded"] === "number" ? (info["loaded"] as number) : undefined,
            total: typeof info["total"] === "number" ? (info["total"] as number) : undefined,
            file: typeof info["file"] === "string" ? (info["file"] as string) : undefined,
          })
      : undefined;
    const pipeline = await this.loadViaConstellation(transformers, progressCb);

    // v1.11.1 — TOFU post-pipeline pin. After the pipeline downloaded any
    // missing files, snapshot hashes if no manifest existed yet. Best-effort:
    // a failure here doesn't break embedding (the user's already past the
    // download), but the next load will get a stronger guarantee.
    if (this.tofuManifestPath) {
      try { tofuVerifyOrPin(this.cacheDir, this.tofuManifestPath); } catch { /* best-effort */ }
    }

    return pipeline;
  }

  /** v1.30.0 -- WASM CONSTELLATION. Try device IDs in order; cache the
   *  winner so the next session loads instantly. The order goes
   *  newest-first because @huggingface/transformers@3.x deprecated
   *  "wasm" in favor of "cpu" and the user gets the freshest path
   *  on a fresh install. */
  private async loadViaConstellation(
    // We type the transformers module loosely -- its `device` field
    // is a string literal union that varies between major versions.
    transformers: { pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<FeatureExtractor> },
    progressCb?: (info: { status: string; loaded?: number; total?: number; file?: string }) => void,
  ): Promise<FeatureExtractor> {
    const constellation = ["cpu", "wasm", "webgpu", "auto"];
    const winnerPath = join(this.cacheDir, ".device-winner");
    let cachedWinner: string | null = null;
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(winnerPath)) cachedWinner = fs.readFileSync(winnerPath, "utf8").trim();
    } catch { /* */ }

    // Reorder the constellation so the cached winner is tried FIRST.
    const order = cachedWinner && constellation.includes(cachedWinner)
      ? [cachedWinner, ...constellation.filter((d) => d !== cachedWinner)]
      : constellation;

    let lastErr: Error | null = null;
    for (const device of order) {
      try {
        // v2.27.0 — pass dtype explicitly (closes E6 wasted-RAM + E7 stderr leak).
        const dtype = process.env["MNEME_BUNDLED_DTYPE"] ?? "q8";
        const pipeline = await transformers.pipeline("feature-extraction", this.model, {
          device,
          dtype,
          progress_callback: progressCb,
        });
        // Winner!  Persist for next session.
        try {
          const fs = await import("node:fs");
          if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
          fs.writeFileSync(winnerPath, device, "utf8");
        } catch { /* */ }
        return pipeline;
      } catch (e) {
        lastErr = e as Error;
        // Only retry on "Unsupported device" / similar device-rejection errors.
        // Network errors, file-not-found, etc. propagate out of the loop.
        const msg = (e as Error).message ?? "";
        if (!/unsupported device|device.*should be|invalid.*device/i.test(msg)) {
          throw e;
        }
        // else: fall through to next device in the constellation.
      }
    }
    throw new Error(
      `WASM CONSTELLATION exhausted -- none of [${order.join(", ")}] worked. ` +
      `Last error: ${lastErr?.message ?? "unknown"}. ` +
      `This usually means @huggingface/transformers needs a different device id. ` +
      `Workaround: \`mneme embeddings status\` to see your tier; \`ollama serve && ollama pull nomic-embed-text\` for the ★★★★ tier without WASM.`,
    );
  }
}

/** Default cache dir: ~/.cache/mneme/models. User can `rm -rf` to reset. */
export function defaultCacheDir(): string {
  return join(homedir(), ".cache", "mneme", "models");
}

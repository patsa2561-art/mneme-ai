/**
 * 🛡 INPUT SIZE GUARD — fail-loud envelope + truncation receipt
 *
 * Closes the v2.70 vuln: 28K char input → exit 1, 0 bytes, no warning.
 *
 * Strategy stacks 3 lenses:
 *   1. Fail-loud: never silent. Every reject emits JSON envelope.
 *   2. Truncation receipt: when allowTruncate=true, accept first N + flag
 *      "INPUT_TRUNCATED" so verdict consumer sees the caveat.
 *   3. Auto-detect: if input came via argv and is too large, suggest stdin.
 *
 * Cross-platform argv limits (real-world safe values):
 *   Windows cmd.exe   : ~8K   (legacy)
 *   Windows powershell: ~32K  (varies)
 *   Linux execve()    : ~128K-2M
 *   macOS execve()    : ~256K
 *
 * Hard limit chosen: 24K = safely below Windows cmd while still allowing
 * substantial claims. For larger input, pipe via stdin.
 */

export type InputSource = "argv" | "stdin" | "file" | "unknown";

export interface SizeCheckResult {
  ok: boolean;
  inputSize: number;
  limit: number;
  source: InputSource;
  truncated: boolean;
  truncatedAt?: number;
  receipt: string;          // always present — fail-loud receipt
  reason?: string;
  suggestion?: string;
  envelope: {
    ok: boolean;
    error?: string;
    sizeReceived: number;
    sizeLimit: number;
    source: InputSource;
    hint?: string;
  };
}

const DEFAULT_LIMITS: Record<InputSource, number> = {
  argv: 24_000,
  stdin: 10_000_000,        // 10MB
  file: 100_000_000,         // 100MB
  unknown: 24_000,
};

export interface CheckInputSizeOptions {
  source: InputSource;
  allowTruncate?: boolean;
  customLimit?: number;
}

function makeReceipt(input: string, source: InputSource): string {
  // Lightweight non-crypto receipt — caller can verify they sent X bytes
  // without needing HMAC key
  const size = input.length;
  const head = input.slice(0, 24).replace(/\s/g, "·");
  const tail = input.slice(-24).replace(/\s/g, "·");
  return `[mneme-rcpt ${source}:${size}B head="${head}" tail="${tail}"]`;
}

export function checkInputSize(input: string, opts: CheckInputSizeOptions): SizeCheckResult {
  const limit = opts.customLimit ?? DEFAULT_LIMITS[opts.source];
  const inputSize = input.length;
  const receipt = makeReceipt(input, opts.source);

  if (inputSize <= limit) {
    return {
      ok: true, inputSize, limit, source: opts.source,
      truncated: false, receipt,
      envelope: { ok: true, sizeReceived: inputSize, sizeLimit: limit, source: opts.source },
    };
  }

  // Over limit. Truncate or reject?
  if (opts.allowTruncate) {
    return {
      ok: true, inputSize, limit, source: opts.source,
      truncated: true, truncatedAt: limit,
      reason: `input ${inputSize}B > limit ${limit}B; --allow-truncate accepted first ${limit}B`,
      receipt,
      envelope: {
        ok: true,
        sizeReceived: inputSize,
        sizeLimit: limit,
        source: opts.source,
        hint: `Verdict computed on first ${limit}B only — re-run via stdin for full input.`,
      },
    };
  }

  // Hard reject — but LOUD. Caller MUST get JSON envelope.
  const suggestion = opts.source === "argv"
    ? "Input too large for command-line args. Pipe via stdin: `echo $CLAIM | mneme verify --stdin` (limit then becomes 10MB)."
    : `Input ${inputSize}B exceeds ${opts.source} limit of ${limit}B. Use --allow-truncate or split into chunks.`;

  return {
    ok: false, inputSize, limit, source: opts.source,
    truncated: false,
    reason: `input ${inputSize}B exceeds ${opts.source} limit of ${limit}B`,
    suggestion,
    receipt,
    envelope: {
      ok: false,
      error: "INPUT_TOO_LARGE",
      sizeReceived: inputSize,
      sizeLimit: limit,
      source: opts.source,
      hint: suggestion,
    },
  };
}

/**
 * Emit JSON envelope to stdout. Caller in CLI should call this on EVERY
 * exit path so the user never gets silent 0-byte exit.
 *
 * Returns suggested process exit code:
 *   0 if ok
 *   2 if input rejected (distinct from generic crash exit 1)
 */
export function emitEnvelope(result: SizeCheckResult, write: (s: string) => void = (s) => process.stdout.write(s)): number {
  write(JSON.stringify(result.envelope) + "\n");
  return result.ok ? 0 : 2;
}

/** Detect input source heuristically from argv/stdin state. */
export function detectInputSource(): InputSource {
  if (!process.stdin.isTTY) return "stdin";
  if (process.argv.length > 2) return "argv";
  return "unknown";
}

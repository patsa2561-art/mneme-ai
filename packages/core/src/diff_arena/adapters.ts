/**
 * v2.64.0 — ARENA vendor adapter abstraction.
 *
 * ARENA must work with ANY AI vendor. Rather than hard-code Anthropic /
 * OpenAI / Google SDK clients (which would force vendor lock-in + bring
 * in their dependencies + require live API keys for tests), we expose
 * a thin `VendorAdapter` interface that anyone can implement.
 *
 * Mneme ships **3 built-in adapter kinds**:
 *
 *  1. MOCK — deterministic seeded response. Used for tests + offline
 *     demos. Always available; no API key needed.
 *
 *  2. HTTP — generic JSON-POST adapter pointed at any
 *     OpenAI-compatible chat completions endpoint. Works with
 *     Anthropic, OpenAI, Google AI Studio, OpenRouter, local
 *     ollama/llama.cpp servers. Requires base URL + API key in env.
 *
 *  3. CLI — spawns a subprocess (e.g. `gemini-cli ask "..."` /
 *     `grok-cli`). Captures stdout. Useful when the vendor only
 *     ships a CLI client. Refuses commands not in allowlist.
 *
 * Pure ESM. Defensive — every adapter returns a result envelope with
 * `ok` boolean; never throws into the runner.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface VendorResponse {
  /** Vendor identifier (e.g. "claude", "gpt-4o", "gemini-1.5"). */
  vendor: string;
  /** Adapter kind (mock | http | cli). */
  kind: "mock" | "http" | "cli";
  /** True if call succeeded. */
  ok: boolean;
  /** Response text (empty on failure). */
  text: string;
  /** Self-reported confidence 0..1 (vendors that don't expose it default to 0.5). */
  confidence: number;
  /** Roundtrip latency ms. */
  latencyMs: number;
  /** When ok=false, reason for failure. */
  reason?: string;
  /** Adapter-specific metadata (model name, request id, etc). */
  meta?: Record<string, unknown>;
}

export interface VendorAdapter {
  /** Vendor identifier shown in output. */
  name: string;
  kind: "mock" | "http" | "cli";
  /** Hard timeout ms (default 30s). */
  timeoutMs?: number;
  ask(prompt: string): Promise<VendorResponse>;
}

/* ── 1. MOCK ────────────────────────────────────────────────────── */

export interface MockAdapterOpts {
  name: string;
  /** Seeded response generator: input → text. Deterministic. */
  responder?: (prompt: string) => string;
  /** Confidence to report. */
  confidence?: number;
  /** Latency to simulate in ms. */
  simulatedLatencyMs?: number;
}

export function mockAdapter(opts: MockAdapterOpts): VendorAdapter {
  return {
    name: opts.name,
    kind: "mock",
    async ask(prompt: string): Promise<VendorResponse> {
      const t0 = performance.now();
      // Simulated latency (cheap; uses setTimeout so other adapters can run in parallel)
      if (opts.simulatedLatencyMs && opts.simulatedLatencyMs > 0) {
        await new Promise((r) => setTimeout(r, opts.simulatedLatencyMs));
      }
      const text = (opts.responder ?? defaultMockResponder(opts.name))(prompt);
      return {
        vendor: opts.name,
        kind: "mock",
        ok: true,
        text,
        confidence: opts.confidence ?? 0.7,
        latencyMs: +(performance.now() - t0).toFixed(2),
      };
    },
  };
}

/**
 * Deterministic seeded responder: hashes (vendor, prompt) → picks one
 * of N flavored canned answers. Same input always produces same output.
 */
function defaultMockResponder(vendorName: string): (prompt: string) => string {
  const flavors = [
    "Based on my training, the answer involves multiple considerations.",
    "The most accurate response would acknowledge the nuance here.",
    "There are a few approaches; the canonical one is well-documented.",
    "This depends on the specific context, but in general terms:",
  ];
  return (prompt: string) => {
    const h = createHash("sha256").update(vendorName + "|" + prompt).digest("hex");
    const idx = parseInt(h.slice(0, 4), 16) % flavors.length;
    return `[${vendorName}] ${flavors[idx]} (re: ${prompt.slice(0, 60)})`;
  };
}

/* ── 2. HTTP (OpenAI-compatible) ────────────────────────────────── */

export interface HttpAdapterOpts {
  name: string;
  /** Full URL for the chat-completions endpoint. */
  endpoint: string;
  /** Env var name that holds the API key. */
  apiKeyEnv: string;
  /** Model name to pass. */
  model: string;
  /** Optional header overrides. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export function httpAdapter(opts: HttpAdapterOpts): VendorAdapter {
  return {
    name: opts.name,
    kind: "http",
    timeoutMs: opts.timeoutMs ?? 30000,
    async ask(prompt: string): Promise<VendorResponse> {
      const t0 = performance.now();
      const apiKey = process.env[opts.apiKeyEnv];
      if (!apiKey) {
        return {
          vendor: opts.name, kind: "http", ok: false, text: "", confidence: 0,
          latencyMs: +(performance.now() - t0).toFixed(2),
          reason: `missing env ${opts.apiKeyEnv}`,
        };
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
        const res = await fetch(opts.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiKey}`,
            ...(opts.headers ?? {}),
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 800,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          return {
            vendor: opts.name, kind: "http", ok: false, text: "", confidence: 0,
            latencyMs: +(performance.now() - t0).toFixed(2),
            reason: `http ${res.status}`,
          };
        }
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string; id?: string };
        const text = json.choices?.[0]?.message?.content ?? "";
        return {
          vendor: opts.name,
          kind: "http",
          ok: text.length > 0,
          text,
          confidence: 0.7,
          latencyMs: +(performance.now() - t0).toFixed(2),
          meta: { model: json.model, requestId: json.id },
          reason: text.length === 0 ? "empty response body" : undefined,
        };
      } catch (e) {
        return {
          vendor: opts.name, kind: "http", ok: false, text: "", confidence: 0,
          latencyMs: +(performance.now() - t0).toFixed(2),
          reason: (e as Error).message,
        };
      }
    },
  };
}

/* ── 3. CLI (subprocess) ────────────────────────────────────────── */

export interface CliAdapterOpts {
  name: string;
  /** CLI binary (e.g. "gemini" / "grok" / "ollama"). */
  command: string;
  /** Args; "{prompt}" placeholder is substituted. */
  args: string[];
  timeoutMs?: number;
}

const SAFE_COMMAND_ALLOWLIST = /^[a-z][a-z0-9_-]{1,40}$/;

export function cliAdapter(opts: CliAdapterOpts): VendorAdapter {
  return {
    name: opts.name,
    kind: "cli",
    timeoutMs: opts.timeoutMs ?? 30000,
    async ask(prompt: string): Promise<VendorResponse> {
      const t0 = performance.now();
      if (!SAFE_COMMAND_ALLOWLIST.test(opts.command)) {
        return {
          vendor: opts.name, kind: "cli", ok: false, text: "", confidence: 0,
          latencyMs: +(performance.now() - t0).toFixed(2),
          reason: `command '${opts.command}' refused by allowlist (only [a-z][a-z0-9_-]{1,40})`,
        };
      }
      const resolvedArgs = opts.args.map((a) => a.replace("{prompt}", prompt));
      try {
        const r = spawnSync(opts.command, resolvedArgs, {
          encoding: "utf8",
          timeout: opts.timeoutMs ?? 30000,
        });
        const text = (r.stdout ?? "").trim();
        return {
          vendor: opts.name,
          kind: "cli",
          ok: r.status === 0 && text.length > 0,
          text,
          confidence: 0.7,
          latencyMs: +(performance.now() - t0).toFixed(2),
          reason: r.status !== 0 ? `exit=${r.status}: ${(r.stderr ?? "").slice(0, 120)}` : (text.length === 0 ? "empty stdout" : undefined),
        };
      } catch (e) {
        return {
          vendor: opts.name, kind: "cli", ok: false, text: "", confidence: 0,
          latencyMs: +(performance.now() - t0).toFixed(2),
          reason: (e as Error).message,
        };
      }
    },
  };
}

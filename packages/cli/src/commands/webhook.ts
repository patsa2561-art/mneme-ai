/**
 * `mneme webhook` — outgoing webhook configuration.
 *
 * Lets users wire Mneme events to external services (Slack, Discord,
 * Linear, PagerDuty, GitHub status checks, etc) via HMAC-signed POSTs.
 *
 * v1.10.0 ships 5 default events:
 *   • audit.fail           ← `mneme audit --certify` returned FAIL
 *   • forensics.cwe.high   ← high-severity CWE finding
 *   • atrophy.spike        ← knowledge atrophy jumped >30% week-over-week
 *   • court.guilty         ← `mneme court` returned GUILTY
 *   • federation.match     ← federation hub returned matching pattern
 *
 * Storage: .mneme/webhooks.json (gitignored — contains secrets).
 * Signing: HMAC-SHA-256 over the payload, header `X-Mneme-Signature`.
 *
 * No native deps. No webhook server (this is OUTGOING only — Mneme
 * pushes events; doesn't receive).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git } from "@mneme-ai/core";

export type WebhookEvent =
  | "audit.fail"
  | "forensics.cwe.high"
  | "atrophy.spike"
  | "court.guilty"
  | "federation.match";

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
  "audit.fail",
  "forensics.cwe.high",
  "atrophy.spike",
  "court.guilty",
  "federation.match",
];

export interface WebhookEntry {
  id: string;
  event: WebhookEvent;
  url: string;
  secret: string;
  /** ISO timestamp */
  createdAt: string;
  enabled: boolean;
  lastFiredAt?: string;
  lastResultStatus?: number;
}

export interface WebhookOptions {
  cwd: string;
  action: "add" | "list" | "remove" | "test" | "fire";
  event?: WebhookEvent;
  url?: string;
  id?: string;
  payload?: Record<string, unknown>;
  json?: boolean;
}

function configPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "webhooks.json");
}

function readWebhooks(repoRoot: string): WebhookEntry[] {
  const p = configPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as WebhookEntry[];
  } catch {
    return [];
  }
}

function writeWebhooks(repoRoot: string, entries: WebhookEntry[]) {
  const p = configPath(repoRoot);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
  renameSync(tmp, p);
}

/** Sign a payload with the entry's secret using HMAC-SHA-256. Returns hex. */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Verify a payload's signature. Used by hub code or downstream consumers. */
export function verifyPayload(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  // Constant-time compare
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return result === 0;
}

/** Fire all enabled webhooks for the given event with the payload. */
export async function fireWebhooks(
  repoRoot: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<Array<{ id: string; ok: boolean; statusCode?: number; error?: string }>> {
  const entries = readWebhooks(repoRoot).filter((w) => w.enabled && w.event === event);
  if (entries.length === 0) return [];
  const results: Array<{ id: string; ok: boolean; statusCode?: number; error?: string }> = [];
  const body = JSON.stringify({ event, payload, firedAt: new Date().toISOString() });
  for (const entry of entries) {
    const sig = signPayload(body, entry.secret);
    try {
      const res = await fetch(entry.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mneme-Signature": `sha256=${sig}`,
          "X-Mneme-Event": event,
          "User-Agent": `mneme-webhook/${process.env["npm_package_version"] ?? "1.10.0"}`,
        },
        body,
      });
      results.push({ id: entry.id, ok: res.ok, statusCode: res.status });
      // Persist result
      const all = readWebhooks(repoRoot);
      const target = all.find((e) => e.id === entry.id);
      if (target) {
        target.lastFiredAt = new Date().toISOString();
        target.lastResultStatus = res.status;
        writeWebhooks(repoRoot, all);
      }
    } catch (err) {
      results.push({ id: entry.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

export async function webhookCommand(opts: WebhookOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  switch (opts.action) {
    case "add": {
      if (!opts.event || !opts.url) {
        ui.error("`webhook add` requires --event and --url.");
        return 1;
      }
      if (!ALL_WEBHOOK_EVENTS.includes(opts.event)) {
        ui.error(`Unknown event "${opts.event}". Try: ${ALL_WEBHOOK_EVENTS.join(" | ")}`);
        return 1;
      }
      const all = readWebhooks(meta.rootPath);
      const entry: WebhookEntry = {
        id: randomBytes(8).toString("hex"),
        event: opts.event,
        url: opts.url,
        secret: randomBytes(32).toString("hex"),
        createdAt: new Date().toISOString(),
        enabled: true,
      };
      all.push(entry);
      writeWebhooks(meta.rootPath, all);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ added: entry }, null, 2) + "\n");
      } else {
        ui.success(`Added webhook ${entry.id} on event ${entry.event} → ${entry.url}`);
        ui.dim(`Secret (used to verify X-Mneme-Signature header): ${entry.secret}`);
      }
      return 0;
    }
    case "list": {
      const all = readWebhooks(meta.rootPath);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ webhooks: all.map((w) => ({ ...w, secret: "<hidden>" })) }, null, 2) + "\n");
        return 0;
      }
      if (all.length === 0) {
        ui.dim("No webhooks configured. Run `mneme webhook add --event <name> --url <url>`.");
        return 0;
      }
      for (const w of all) {
        process.stdout.write(
          `  ${kleur.cyan(w.id)} · ${kleur.bold(w.event)} → ${w.url}` +
            (w.lastFiredAt ? `  (last fired ${w.lastFiredAt}, status ${w.lastResultStatus})` : "  (never fired)") +
            "\n",
        );
      }
      return 0;
    }
    case "remove": {
      if (!opts.id) {
        ui.error("`webhook remove` requires --id <id>");
        return 1;
      }
      const all = readWebhooks(meta.rootPath);
      const before = all.length;
      const filtered = all.filter((w) => w.id !== opts.id);
      if (filtered.length === before) {
        ui.error(`No webhook with id ${opts.id}.`);
        return 1;
      }
      writeWebhooks(meta.rootPath, filtered);
      if (opts.json) process.stdout.write(JSON.stringify({ removed: opts.id }) + "\n");
      else ui.success(`Removed webhook ${opts.id}.`);
      return 0;
    }
    case "test": {
      if (!opts.id) {
        ui.error("`webhook test` requires --id <id>");
        return 1;
      }
      const all = readWebhooks(meta.rootPath);
      const entry = all.find((w) => w.id === opts.id);
      if (!entry) {
        ui.error(`No webhook with id ${opts.id}.`);
        return 1;
      }
      const results = await fireWebhooks(meta.rootPath, entry.event, { test: true, sentAt: new Date().toISOString() });
      const result = results[0];
      if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      else if (result?.ok) ui.success(`Test fired → HTTP ${result.statusCode}`);
      else ui.error(`Test failed: ${result?.error ?? "unknown"}`);
      return result?.ok ? 0 : 1;
    }
    case "fire": {
      if (!opts.event) {
        ui.error("`webhook fire` requires --event");
        return 1;
      }
      const results = await fireWebhooks(meta.rootPath, opts.event, opts.payload ?? {});
      if (opts.json) process.stdout.write(JSON.stringify({ fired: results }, null, 2) + "\n");
      else for (const r of results) ui.dim(`  ${r.id}: ${r.ok ? `✓ ${r.statusCode}` : `✗ ${r.error}`}`);
      return 0;
    }
    default:
      ui.error(`Unknown webhook action: ${opts.action}`);
      return 1;
  }
}

// Test exports
export const _readWebhooksForTests = readWebhooks;
export const _writeWebhooksForTests = writeWebhooks;

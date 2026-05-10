/**
 * Integrations registry -- the dynamic switchboard.
 *
 *   import * as integrations from "@mneme-ai/core/integrations";
 *
 *   await integrations.detectAll(repo);     // which agents are present
 *   await integrations.installAll(repo);    // wire all detected agents
 *   await integrations.statusAll(repo);     // per-adapter state
 *   await integrations.uninstallAll(repo);  // strip Mneme from all
 *
 * Or by id:
 *   await integrations.install(repo, "claude-code");
 *
 * The CLI surface (mneme hooks / mneme integrate) is a thin wrapper
 * over these calls.
 */

export * from "./types.js";
export { injectBlock, removeBlock, readBlockState } from "./file_inject.js";
export type { FileInjectStatus, FileInjectResult, FileRemoveResult, FileBlockState } from "./file_inject.js";
export { claudeCodeAdapter } from "./claude_code.js";
export {
  cursorAdapter, cursorLegacyAdapter, codexAdapter, geminiAdapter,
  windsurfAdapter, claudeProjectAdapter,
} from "./file_adapters.js";

import type {
  IntegrationAdapter, InstallResult, UninstallResult, StatusResult, DetectResult,
} from "./types.js";
import { claudeCodeAdapter } from "./claude_code.js";
import {
  cursorAdapter, cursorLegacyAdapter, codexAdapter, geminiAdapter,
  windsurfAdapter, claudeProjectAdapter,
} from "./file_adapters.js";

export const ALL_ADAPTERS: IntegrationAdapter[] = [
  claudeCodeAdapter,
  claudeProjectAdapter,
  cursorAdapter,
  cursorLegacyAdapter,
  codexAdapter,
  geminiAdapter,
  windsurfAdapter,
];

export function adapterById(id: string): IntegrationAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

export interface BatchResult<T> {
  id: string;
  label: string;
  result: T;
}

export async function detectAll(repoRoot: string): Promise<BatchResult<DetectResult>[]> {
  return Promise.all(ALL_ADAPTERS.map(async (a) => ({
    id: a.id, label: a.label, result: await a.detect(repoRoot).catch((e) => ({ present: false, reason: `detect failed: ${(e as Error).message}` })),
  })));
}

export async function statusAll(repoRoot: string): Promise<BatchResult<StatusResult>[]> {
  return Promise.all(ALL_ADAPTERS.map(async (a) => ({
    id: a.id, label: a.label, result: await a.status(repoRoot).catch((e) => ({
      installed: false, state: "no-config" as const, mode: "unsupported" as const,
      details: `status failed: ${(e as Error).message}`,
    })),
  })));
}

/**
 * Install Mneme into every adapter that detect()s as present, plus
 * Claude Code (always tried -- it's user-scope and harmless if absent).
 * Pass `ids: [...]` to restrict; pass `force: true` to override foreign
 * config.
 */
export async function installAll(
  repoRoot: string,
  opts: { ids?: string[]; force?: boolean; onlyDetected?: boolean } = {},
): Promise<BatchResult<InstallResult>[]> {
  let targets = ALL_ADAPTERS;
  if (opts.ids && opts.ids.length > 0) {
    targets = ALL_ADAPTERS.filter((a) => opts.ids!.includes(a.id));
  } else if (opts.onlyDetected) {
    const det = await detectAll(repoRoot);
    const present = new Set(det.filter((d) => d.result.present).map((d) => d.id));
    // Always include claude-code regardless of detection -- user scope.
    present.add("claude-code");
    targets = ALL_ADAPTERS.filter((a) => present.has(a.id));
  }
  return Promise.all(targets.map(async (a) => ({
    id: a.id, label: a.label, result: await a.install(repoRoot, { force: opts.force }).catch((e) => ({
      ok: false, status: "error" as const, mode: "unsupported" as const,
      message: `install failed: ${(e as Error).message}`,
    })),
  })));
}

export async function uninstallAll(
  repoRoot: string,
  opts: { ids?: string[] } = {},
): Promise<BatchResult<UninstallResult>[]> {
  const targets = opts.ids && opts.ids.length > 0
    ? ALL_ADAPTERS.filter((a) => opts.ids!.includes(a.id))
    : ALL_ADAPTERS;
  return Promise.all(targets.map(async (a) => ({
    id: a.id, label: a.label, result: await a.uninstall(repoRoot).catch((e) => ({
      ok: false, status: "error" as const, message: `uninstall failed: ${(e as Error).message}`,
    })),
  })));
}

/** Single-adapter convenience. */
export async function install(repoRoot: string, id: string, opts?: { force?: boolean }): Promise<InstallResult> {
  const a = adapterById(id);
  if (!a) throw new Error(`unknown adapter: ${id}. Known: ${ALL_ADAPTERS.map((x) => x.id).join(", ")}`);
  return a.install(repoRoot, opts);
}

export async function uninstall(repoRoot: string, id: string): Promise<UninstallResult> {
  const a = adapterById(id);
  if (!a) throw new Error(`unknown adapter: ${id}`);
  return a.uninstall(repoRoot);
}

export async function status(repoRoot: string, id: string): Promise<StatusResult> {
  const a = adapterById(id);
  if (!a) throw new Error(`unknown adapter: ${id}`);
  return a.status(repoRoot);
}

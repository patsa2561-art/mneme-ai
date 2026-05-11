/**
 * `mneme greet` (v1.46.0 — #8 fix).
 *
 * The AI HANDSHAKE entry point. AI agents call this once per session to
 * declare themselves so Mneme can:
 *   - Track them in Soul Mirror (lifetime sessions, kept/broken)
 *   - Tag every subsequent CLI invocation with the active vendor
 *   - Render a per-vendor pulse template
 *
 * Usage:
 *   mneme greet --vendor claude-opus-4-7
 *   mneme greet --vendor cursor --model gpt-4o
 *   mneme greet --auto             # detect vendor from env / repo signals
 *   mneme greet --status           # print the active vendor + handshake history
 */

import type { Command } from "commander";

interface CommonOpts { json?: boolean }
function out(opts: CommonOpts, jsonPayload: unknown, humanLines: string[]): void {
  if (opts.json) process.stdout.write(JSON.stringify(jsonPayload, null, 2) + "\n");
  else for (const line of humanLines) process.stdout.write(line + "\n");
}

export function registerGreetCommand(program: Command): void {
  program
    .command("greet")
    .description("AI handshake — let Mneme know which AI vendor is active in this session (so Soul Mirror tracks CLI-only activity, not just MCP).")
    .option("--vendor <id>", "Vendor slug (e.g. claude-opus-4-7, cursor, openai-gpt, google-gemini)")
    .option("--model <name>", "Optional model name within the vendor")
    .option("--session <hash>", "Caller-supplied session id (otherwise we generate)")
    .option("--auto", "Auto-detect vendor from env vars + repo signals")
    .option("--status", "Print the active vendor + handshake history (no greet)")
    .option("--json", "JSON output")
    .action(async (opts: { vendor?: string; model?: string; session?: string; auto?: boolean; status?: boolean } & CommonOpts) => {
      const { aiHandshake } = await import("@mneme-ai/core");

      // ── --status only --------------------------------------------------
      if (opts.status) {
        const active = aiHandshake.readActiveVendor(process.cwd());
        const handshakes = aiHandshake.listHandshakes(process.cwd()).slice(0, 10);
        const recent = aiHandshake.listCliActivity(process.cwd(), { sinceMs: Date.now() - 7 * 86400 * 1000 });
        out(opts, { active, handshakes, recentActivity: recent }, [
          active
            ? `active:    ${active.vendor}${active.model ? ` (${active.model})` : ""} · session ${active.session ?? "?"} · expires ${active.expiresAt}`
            : "active:    (none — call `mneme greet --vendor <id>` to start)",
          `handshakes (last 10):`,
          ...(handshakes.length === 0
            ? ["  (none)"]
            : handshakes.map((h) => `  ${h.greetedAt}  ${h.vendor}  session=${h.session.slice(0, 8)}${h.model ? `  model=${h.model}` : ""}`)),
          `recent CLI activity (7d): ${recent.length} ticks`,
        ]);
        return;
      }

      // ── --auto detection -----------------------------------------------
      let vendor = opts.vendor;
      let model = opts.model;
      let detectionReason: string | null = null;
      if (opts.auto && !vendor) {
        const detected = aiHandshake.autoDetectVendor(process.cwd());
        if (!detected) {
          out(opts, { error: "no-vendor-detected" }, [
            "✗ Could not auto-detect a vendor.",
            "  Set MNEME_AI_VENDOR env var, OR pass --vendor <id> explicitly.",
            "  Known vendor slugs: claude-opus-4-7 · cursor · openai-gpt · google-gemini · continue · aider",
          ]);
          process.exitCode = 1;
          return;
        }
        vendor = detected.vendor;
        detectionReason = detected.reason;
      }

      if (!vendor) {
        out(opts, { error: "vendor-required" }, [
          "✗ --vendor is required (or use --auto for env-based detection).",
          "  Example: mneme greet --vendor claude-opus-4-7",
        ]);
        process.exitCode = 1;
        return;
      }

      // ── do the greet ---------------------------------------------------
      try {
        const r = aiHandshake.greet(process.cwd(), { vendor, model, session: opts.session });
        out(opts, { ...r, detectionReason }, [
          r.outcome === "rate-limited"
            ? `↻ already greeted recently — reusing session ${r.active.session?.slice(0, 8)}`
            : `✓ greeted as ${r.active.vendor}${r.active.model ? ` (${r.active.model})` : ""} · session ${r.active.session?.slice(0, 8)}`,
          detectionReason ? `  (auto-detected via: ${detectionReason})` : "",
          `  soul: ${r.soul.lifetimeSessions} lifetime session(s) · born ${r.soul.bornAt.slice(0, 10)}`,
        ].filter(Boolean));
      } catch (err) {
        out(opts, { error: (err as Error).message }, [`✗ ${(err as Error).message}`]);
        process.exitCode = 1;
      }
    });
}

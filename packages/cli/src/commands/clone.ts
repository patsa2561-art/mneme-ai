/**
 * v2.19.95 — `mneme clone` CLI — one-verb cross-session handoff.
 *
 * Replaces the 3-step pipeline (transmit + extract + ship) with a
 * single command. Auto-captures the live AI editor session, compresses
 * to a paste-able soul prompt, and ships via clipboard / LAN / relay.
 */

export interface CloneCommandOptions {
  cwd: string;
  transport: "clipboard" | "qr" | "remote";
  receivingVendor?: string;
  lastN?: number;
  port?: number;
  json?: boolean;
}

export async function cloneCommand(opts: CloneCommandOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = opts.cwd;
  try {
    if (opts.transport === "clipboard") {
      const r = core.clone.cloneToClipboard(repoRoot, { receivingVendor: opts.receivingVendor, lastN: opts.lastN });
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      const badge = r.ok ? "✅" : "❌";
      process.stdout.write(`📡 MNEME CLONE — clipboard\n\n`);
      process.stdout.write(`  ${badge} written via ${r.tool}  (${r.bytes.toLocaleString()} bytes · ~${r.estTokens} tokens)\n`);
      if (!r.ok && r.reason) process.stdout.write(`  reason: ${r.reason}\n`);
      process.stdout.write(`\n  Next: open Claude Code / Cursor / Codex in your destination workspace,\n        click into the chat box, press Ctrl+V (or Cmd+V on macOS), send.\n`);
      if (!r.ok) process.exit(1);
      return;
    }

    if (opts.transport === "qr") {
      const r = await core.clone.cloneViaLan(repoRoot, { receivingVendor: opts.receivingVendor, lastN: opts.lastN, port: opts.port });
      if (opts.json) { process.stdout.write(JSON.stringify({ ...r, server: undefined }, null, 2) + "\n"); return; }
      process.stdout.write(`📡 MNEME CLONE — LAN + QR\n\n`);
      process.stdout.write(`  port:        ${r.port ?? "(bind failed)"}\n`);
      process.stdout.write(`  ~tokens:     ${r.estTokens}\n`);
      process.stdout.write(`  LAN URLs:\n`);
      for (const u of r.lanUrls) process.stdout.write(`    → ${u}\n`);
      if (r.qrDataUri) process.stdout.write(`\n  QR (data URI, AI agent renders inline):\n    ${r.qrDataUri.slice(0, 80)}…  [${r.qrDataUri.length} bytes]\n`);
      process.stdout.write(`\n  Next: on your phone (same WiFi), scan the QR or open the URL —\n        the page auto-copies the soul prompt to your phone clipboard.\n        Server stops after 10 min of no requests.\n`);
      return;
    }

    if (opts.transport === "remote") {
      const r = await core.clone.cloneViaRelay(repoRoot, { receivingVendor: opts.receivingVendor, lastN: opts.lastN });
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write(`📡 MNEME CLONE — public relay (cross-network)\n\n`);
      if (!r.url) {
        process.stdout.write(`  ❌ relay upload failed (no internet?). Try \`mneme clone qr\` if on same WiFi, or \`mneme clone\` for same-machine.\n`);
        process.exit(1);
        return;
      }
      process.stdout.write(`  URL:         ${r.url}\n`);
      if (r.expiresAt) process.stdout.write(`  expires:     ${r.expiresAt}\n`);
      process.stdout.write(`  ~tokens:     ${r.estTokens}\n`);
      if (r.qrDataUri) process.stdout.write(`  QR:          ${r.qrDataUri.slice(0, 80)}…  [${r.qrDataUri.length} bytes]\n`);
      process.stdout.write(`\n  ⚠ PUBLIC paste — anyone with the URL can read until it expires.\n    Do NOT use for sessions containing secrets.\n`);
      process.stdout.write(`\n  Next: open the URL on the destination device — copy the soul prompt,\n        paste into your AI of choice.\n`);
      return;
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (opts.json) { process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n"); }
    else { process.stderr.write(`✗ ${msg}\n`); }
    process.exit(1);
  }
}

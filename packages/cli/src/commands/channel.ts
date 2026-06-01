/**
 * `mneme channel` (v2.128.0) — Context-State Channel (the honest "L2 Lightning"
 * for an AI edit/debug loop). Open a channel over files, send tiny diff ops, get
 * compact deltas back (not the whole file), commit once. Composes with OUTLINE
 * (orient) + BLIND (hide names) for an off-the-wire loop.
 *
 *   mneme channel open src/a.ts src/b.ts                       # → channel id + cheap outlines
 *   mneme channel apply --channel <id> --op '{"kind":"replaceText","path":"src/a.ts","find":"foo","replace":"bar"}'
 *   mneme channel status --channel <id>                        # diff summary + measured savings
 *   mneme channel commit --channel <id>                        # settle: write working files to disk
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { channel, outline } from "@mneme-ai/core";

const DIR = ".mneme/channel";
function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }
function statePath(cwd: string, id: string): string { return join(cwd, DIR, `${id}.json`); }
function loadState(cwd: string, id: string): channel.ChannelState | null { try { const p = statePath(cwd, id); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as channel.ChannelState : null; } catch { return null; } }
function saveState(cwd: string, st: channel.ChannelState): void { try { const d = join(cwd, DIR); if (!existsSync(d)) mkdirSync(d, { recursive: true }); writeFileSync(statePath(cwd, st.id), JSON.stringify(st)); } catch { /* */ } }

export function registerChannelCommands(program: Command): void {
  const ch = program.command("channel").description("⚡ CONTEXT-STATE CHANNEL (L2) — open a channel over files, send tiny diff ops, get compact deltas (not the whole file re-streamed), commit once. Cuts the compounding token cost of an edit/debug loop. Composes with `mneme outline` + `mneme blind`.");

  ch.command("open <files...>")
    .description("Open a channel over one or more files; prints the channel id + a cheap outline of each.")
    .option("--json", "JSON output.")
    .action((files: string[], opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const loaded: Array<{ path: string; content: string }> = [];
      for (const f of files) { const p = resolve(cwd, f); if (!existsSync(p)) { out(`✗ not found: ${f}`); process.exitCode = 1; return; } loaded.push({ path: f, content: readFileSync(p, "utf8") }); }
      const st = channel.openChannel(loaded);
      saveState(cwd, st);
      if (opts.json) { outJson({ channel: st.id, files: files }); return; }
      out(`⚡ channel ${st.id} open over ${files.length} file(s):`);
      for (const f of loaded) { const o = outline.extractOutline(f.content, { path: f.path }); out(`  ${f.path} — ${o.symbolCount} symbols, ${o.totalLines} lines`); }
      out(`  send ops:  mneme channel apply --channel ${st.id} --op '{"kind":"replaceText","path":"${files[0]}","find":"…","replace":"…"}'`);
    });

  ch.command("apply")
    .description("Apply a diff op to the channel's local working copy; returns a COMPACT delta (ok + brief + structure check).")
    .requiredOption("--channel <id>", "the channel id.")
    .requiredOption("--op <json>", "the diff op: {kind:'replaceRegion'|'replaceText'|'insertAfter'|'appendFile', path, …}")
    .option("--json", "JSON output.")
    .action((opts: { channel: string; op: string; json?: boolean }) => {
      const cwd = process.cwd();
      const st = loadState(cwd, opts.channel); if (!st) { out(`✗ no channel ${opts.channel} (run \`mneme channel open …\`)`); process.exitCode = 1; return; }
      let op: channel.ChannelOp; try { op = JSON.parse(opts.op); } catch (e) { out(`✗ invalid --op JSON: ${(e as Error).message}`); process.exitCode = 1; return; }
      const r = channel.applyOp(st, op);
      saveState(cwd, r.state);
      if (opts.json) { outJson(r.result); return; }
      const icon = r.result.ok ? (r.result.structureOk ? "✓" : "⚠") : "✗";
      out(`${icon} op#${r.result.opId} ${r.result.path}: ${r.result.brief}`);
      if (r.result.ok && !r.result.structureOk) { out(`   structure BROKEN — fix before commit`); process.exitCode = 2; }
    });

  ch.command("status")
    .description("Show the channel's diff summary + the measured token saving vs the naive re-stream loop.")
    .requiredOption("--channel <id>", "the channel id.")
    .option("--json", "JSON output.")
    .action((opts: { channel: string; json?: boolean }) => {
      const cwd = process.cwd();
      const st = loadState(cwd, opts.channel); if (!st) { out(`✗ no channel ${opts.channel}`); process.exitCode = 1; return; }
      const diffs = Object.keys(st.files).map((p) => channel.diffSummary(st, p));
      const sav = channel.channelSavings(st);
      if (opts.json) { outJson({ channel: st.id, ops: st.opCount, diffs, savings: sav }); return; }
      out(`⚡ channel ${st.id} — ${st.opCount} op(s)`);
      for (const d of diffs) out(`  ${d.path}: ${d.changed ? `changed (+${d.addedLines}/-${d.removedLines} near L${d.hunks[0]?.startLine})` : "unchanged"}`);
      out(`  💰 ~${sav.channelTokens} channel tok vs ~${sav.naiveTokens} naive (${sav.reductionPct}% less). ${sav.note}`);
    });

  ch.command("commit")
    .description("Settle the channel: write the working files to disk. Refuses if a file's structure is broken (override with --force).")
    .requiredOption("--channel <id>", "the channel id.")
    .option("--force", "write even if a quick structural check fails.")
    .action((opts: { channel: string; force?: boolean }) => {
      const cwd = process.cwd();
      const st = loadState(cwd, opts.channel); if (!st) { out(`✗ no channel ${opts.channel}`); process.exitCode = 1; return; }
      const settle = channel.commitChannel(st);
      for (const f of settle.files) {
        if (!f.changed) continue;
        const chk = channel.quickCheck(f.content, f.path.toLowerCase().endsWith(".py"));
        if (!chk.ok && !opts.force) { out(`✗ ${f.path}: structure check failed (${chk.issue}) — fix or pass --force`); process.exitCode = 2; return; }
        try { const p = resolve(cwd, f.path); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content); out(`✓ wrote ${f.path}`); } catch (e) { out(`✗ write ${f.path}: ${(e as Error).message}`); }
      }
      out(`⚡ channel ${st.id} settled (${st.opCount} ops).`);
    });

  ch.command("list").description("List open channels.").action(() => {
    const cwd = process.cwd(); const d = join(cwd, DIR);
    const ids = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
    if (ids.length === 0) { out("(no open channels)"); return; }
    out(`⚡ ${ids.length} channel(s): ${ids.join(", ")}`);
  });
}

/**
 * v2.19.94 — `mneme mirror` CLI for LIVE SESSION MIRROR.
 *
 * Reads the current AI editor's local conversation jsonl (Claude Code
 * today; Cursor/Cline/Continue/Codeium pluggable) so any handoff
 * (`mneme genesplice transmit`, beacon, gist) ships the CURRENT
 * conversation instead of a stale capsule.
 *
 * Verbs:
 *   mneme mirror inspect    show what live sessions Mneme can see
 *   mneme mirror capture    capture current session as a live capsule
 */

export interface MirrorCommandOptions {
  cwd: string;
  mode: "inspect" | "capture";
  json?: boolean;
  lastN?: number;
}

export async function mirrorCommand(opts: MirrorCommandOptions): Promise<void> {
  const core = await import("@mneme-ai/core");
  const repoRoot = opts.cwd;

  if (opts.mode === "inspect") {
    const r = core.liveSessionMirror.inspectLiveSessions(repoRoot);
    if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
    process.stdout.write(`🪞 MNEME LIVE SESSION MIRROR — inspector\n\n`);
    process.stdout.write(`  repoRoot:     ${repoRoot}\n`);
    process.stdout.write(`  sessions:     ${r.sessions.length} discovered\n`);
    if (r.pickedFor.picked) {
      const p = r.pickedFor.picked;
      const ageSec = Math.round((Date.now() - p.mtimeMs) / 1000);
      process.stdout.write(`  picked:       ${p.filePath}\n`);
      process.stdout.write(`  cwd:          ${p.cwd ?? "(unknown)"}\n`);
      process.stdout.write(`  mtime:        ${new Date(p.mtimeMs).toISOString()}  (${ageSec}s ago)\n`);
      process.stdout.write(`  size:         ${(p.sizeBytes / 1024).toFixed(1)} KB\n`);
      process.stdout.write(`  fresh turns:  ${r.freshTurnCount}\n`);
      if (r.sampleTurn) {
        const head = r.sampleTurn.text.replace(/\s+/g, " ").slice(0, 160);
        process.stdout.write(`  latest:       ${r.sampleTurn.role}: ${head}${r.sampleTurn.text.length > 160 ? "…" : ""}\n`);
      }
    } else {
      process.stdout.write(`  ⚠ No live session found.  Open Claude Code in this repo and chat once; the jsonl will appear at ~/.claude/projects/.\n`);
    }
    if (r.sessions.length > 1) {
      process.stdout.write(`\n  other sessions on this machine:\n`);
      for (const s of r.sessions.slice(0, 5)) {
        if (s.filePath === r.pickedFor.picked?.filePath) continue;
        const ageMin = Math.round((Date.now() - s.mtimeMs) / 1000 / 60);
        process.stdout.write(`    ${s.cwd ?? "(no cwd)"}  ·  ${ageMin}m ago\n`);
      }
    }
    return;
  }

  if (opts.mode === "capture") {
    const cap = core.liveSessionMirror.captureLiveCapsule(repoRoot, { lastN: opts.lastN ?? 25 });
    if (!cap) {
      process.stderr.write("✗ No live session found.  Open this repo in Claude Code first.\n");
      process.exit(1);
      return;
    }
    if (opts.json) { process.stdout.write(JSON.stringify(cap, null, 2) + "\n"); return; }
    process.stdout.write(`🪞 MNEME LIVE SESSION MIRROR — capture\n\n`);
    process.stdout.write(`  capsule id:   ${cap.id}\n`);
    process.stdout.write(`  createdAt:    ${cap.createdAt}\n`);
    process.stdout.write(`  source:       ${cap.sourceFile}\n`);
    process.stdout.write(`  turns:        ${cap.promptTrace.length}\n`);
    process.stdout.write(`  hmac:         ${cap.hmac.slice(0, 24)}…\n\n`);
    process.stdout.write(`  context:      ${cap.contextSummary}\n\n`);
    if (cap.decisions && cap.decisions.length > 0) {
      process.stdout.write(`  decisions (${cap.decisions.length}):\n`);
      for (const d of cap.decisions.slice(0, 5)) {
        process.stdout.write(`    • ${d.length > 110 ? d.slice(0, 110) + "…" : d}\n`);
      }
      process.stdout.write(`\n`);
    }
    process.stdout.write(`  last 3 turns:\n`);
    for (const t of cap.promptTrace.slice(-3)) {
      const head = t.text.replace(/\s+/g, " ").slice(0, 110);
      process.stdout.write(`    ${t.role.padEnd(9)} ${head}${t.text.length > 110 ? "…" : ""}\n`);
    }
    process.stdout.write(`\n  → pass --json to get the full capsule\n`);
    process.stdout.write(`  → run \`mneme genesplice transmit\` to ship this brain to another AI\n`);
    return;
  }
}

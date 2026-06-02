#!/usr/bin/env node
/**
 * mneme-xray — run an X-Ray from the terminal.
 *   mneme-xray <path|https-git-url> [--json] [--no-sign]
 *   mneme-xray <path> --publish [--server URL] [--token KEY]
 *
 * --publish is THE BRIDGE for private repos: analyse locally, then send ONLY
 * the signed, raw-free report to a Lighthouse server (source never leaves).
 * Server/token may also come from env XRAY_SERVER / XRAY_TOKEN.
 */
import { buildXRay } from "./engine.js";
import { sealXRay, verifyXRay } from "./sign.js";
import { xrayLeaksRaw } from "./privacy.js";
import { publishReport } from "./publish.js";
import { runBridge } from "./bridge.js";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function flagVal(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);

  // `bridge` — run the local agent so the website can scan local folders
  if (args[0] === "bridge") {
    runBridge(parseInt(flagVal(args, "--port") || process.env.XRAY_BRIDGE_PORT || "7799", 10));
    return;
  }

  // `pack` — produce an AI Context Pack (prioritized, budgeted, secret-redacted)
  if (args[0] === "pack") {
    const { buildContextPack } = await import("./pack.js");
    const tgt = args.find((a, i) => i > 0 && !a.startsWith("--") && a !== flagVal(args, "--budget") && a !== flagVal(args, "-o")) || ".";
    const budget = parseInt(flagVal(args, "--budget") || "120000", 10);
    let pack;
    if (/^https:\/\//.test(tgt)) {
      const { shallowClone } = await import("./clone.js");
      const h = shallowClone(tgt);
      try { pack = buildContextPack(h.path, { budget }); } finally { h.dispose(); }
    } else {
      if (!existsSync(tgt)) { process.stderr.write(`✗ path not found: ${tgt}\n`); process.exit(1); }
      pack = buildContextPack(tgt, { budget });
    }
    const out = flagVal(args, "-o");
    if (out) { const { writeFileSync } = await import("node:fs"); writeFileSync(out, pack.markdown); process.stdout.write(`✓ wrote ${out} — ${pack.note}\n`); }
    else process.stdout.write(pack.markdown);
    return;
  }

  // `ci-gate` — fail CI if a changed file is a high hotspot (enterprise gate)
  if (args[0] === "ci-gate") {
    const path = args.find((a, i) => i > 0 && !a.startsWith("--") && a !== flagVal(args, "--changed")) || ".";
    const threshold = parseInt(flagVal(args, "--threshold") || "3", 10); // top-N hotspots are "high"
    const report = await buildXRay({ repoPath: path });
    const top = report.hotspots.hotspots.slice(0, threshold).map((h) => h.file);
    let changed = (flagVal(args, "--changed") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (changed.length === 0) {
      // derive from the last commit if not supplied
      const r = spawnSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], { cwd: path, encoding: "utf8" });
      changed = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    }
    const hits = changed.filter((f) => top.includes(f));
    if (hits.length) {
      process.stdout.write(`⚠️  CI GATE: changed files touch top-${threshold} hotspots — review carefully:\n${hits.map((h) => "   🔥 " + h).join("\n")}\n`);
      process.exit(2);
    }
    process.stdout.write(`✓ CI GATE: no changed file is a top-${threshold} hotspot.\n`);
    return;
  }

  const target = args.find((a) => !a.startsWith("--") && a !== flagVal(args, "--server") && a !== flagVal(args, "--token"));
  const asJson = args.includes("--json");
  const noSign = args.includes("--no-sign");
  const doPublish = args.includes("--publish");
  const server = flagVal(args, "--server") || process.env.XRAY_SERVER || "";
  const token = flagVal(args, "--token") || process.env.XRAY_TOKEN || "";
  if (!target) {
    process.stderr.write("usage: mneme-xray <path|https-git-url> [--json] [--no-sign] [--publish --server URL --token KEY]\n");
    process.exit(2);
  }

  const isUrl = /^https:\/\//.test(target);
  const report = await buildXRay(isUrl ? { gitUrl: target } : { repoPath: target });

  // privacy gate — never emit a report that leaks raw source
  const leak = xrayLeaksRaw(report);
  if (leak.leaks) {
    process.stderr.write(`✗ refusing to emit: report failed raw-free check (${leak.reasons.join("; ")})\n`);
    process.exit(1);
  }

  const repoRootForKey = isUrl ? process.cwd() : (existsSync(target) ? target : process.cwd());
  const signed = (noSign && !doPublish) ? { report, receipt: null } : sealXRay(repoRootForKey, report);

  if (doPublish) {
    if (!server || !token) {
      process.stderr.write("✗ --publish needs --server URL and --token KEY (or env XRAY_SERVER / XRAY_TOKEN)\n");
      process.exit(2);
    }
    const pr = await publishReport(server, token, signed);
    if (!pr.ok) { process.stderr.write(`✗ publish failed: ${pr.error}\n`); process.exit(1); }
    process.stdout.write(`✓ published ${report.subject.repoName} → ${server}\n  profile ${pr.profileId}  ·  fingerprint ${pr.fingerprint?.slice(0, 24)}…\n  (source never left this machine — only the signed, raw-free report was sent)\n`);
    return;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(signed, null, 2) + "\n");
    return;
  }

  const r = report;
  const line = "─".repeat(58);
  process.stdout.write(`\n  REPO X-RAY · ${r.subject.repoName} @ ${r.subject.commitHash.slice(0, 12)}\n  ${line}\n`);
  process.stdout.write(`  GRADE ${r.summary.grade}   ${r.summary.headline}\n  ${line}\n`);
  for (const b of r.summary.bullets) process.stdout.write(`  ${b}\n`);
  process.stdout.write(`  ${line}\n  fingerprint ${r.fingerprint.slice(0, 24)}…\n`);
  if (!noSign) {
    const v = verifyXRay(signed);
    process.stdout.write(`  signed: ${v.valid ? "✓ Ed25519 receipt verifies offline" : "✗ " + v.reason}\n`);
  }
  process.stdout.write("\n");
}

main().catch((e) => {
  process.stderr.write(`✗ x-ray failed: ${(e as Error).message}\n`);
  process.exit(1);
});

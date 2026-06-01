#!/usr/bin/env node
/**
 * Runner-free GitHub Pages deploy.
 * ================================
 * Builds the Mneme dashboard LOCALLY and pushes the static output straight to a
 * `gh-pages` branch — no GitHub Actions runner, so it sidesteps the free-tier
 * runner backlog entirely. After the first run, switch the repo's Pages source
 * ONCE to "Deploy from a branch → gh-pages / (root)" and every `npm run
 * deploy:pages` thereafter updates the live site in ~1 minute, on your machine.
 *
 *   node scripts/deploy-pages-local.mjs            # build + push gh-pages
 *   node scripts/deploy-pages-local.mjs --dry-run  # build + stage only (no push)
 *   node scripts/deploy-pages-local.mjs --base /   # override base path (local preview)
 *
 * Safe by design:
 *   - Builds into packages/web/dist, then COPIES to a temp dir for the git work
 *     (your working tree + dist are never touched by git operations).
 *   - Force-pushes ONLY the gh-pages branch (a deploy artifact branch); main is
 *     never touched.
 *   - Pushing gh-pages does NOT change the live site until you flip the Pages
 *     source to it — so the first run is safe to do before switching.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const WEB_DIST = join(REPO_ROOT, "packages", "web", "dist");
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const baseIdx = args.indexOf("--base");
const BASE_PATH = baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "/mneme-ai/";
const BRANCH = "gh-pages";

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, ...opts });
  return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
function git(cmdArgs, opts = {}) { return run("git", cmdArgs, opts); }
function must(label, r) {
  if (r.code !== 0) { console.error(`✗ ${label} failed (exit ${r.code}):\n${r.out.trim()}`); process.exit(1); }
  return r;
}
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

console.log(`🛫 runner-free Pages deploy — base="${BASE_PATH}"${DRY_RUN ? " (dry-run)" : ""}`);

// ── 1. build the dashboard locally ──────────────────────────────────────
console.log("① building @mneme-ai/web …");
// shell:true + a single command string is the cross-platform way to invoke npm
// (a .cmd shim on Windows) from spawnSync without an ENOENT.
{
  const r = spawnSync("npm run build --workspace=@mneme-ai/web", {
    cwd: REPO_ROOT, env: { ...process.env, BASE_PATH }, shell: true, encoding: "utf8", windowsHide: true,
  });
  if ((r.status ?? -1) !== 0) { console.error(`✗ web build failed (exit ${r.status}):\n${((r.stdout ?? "") + (r.stderr ?? "")).trim().slice(-800)}`); process.exit(1); }
}
if (!existsSync(join(WEB_DIST, "index.html"))) {
  console.error(`✗ build produced no index.html at ${WEB_DIST}`); process.exit(1);
}

// ── 2. stage the artifact in a temp dir (keeps dist + working tree pristine) ──
const commit = git(["rev-parse", "HEAD"]).out.trim().slice(0, 40) || "unknown";
const origin = git(["remote", "get-url", "origin"]).out.trim();
if (!origin) { console.error("✗ no `origin` remote — run inside the repo clone."); process.exit(1); }
const webVersion = (() => { try { return JSON.parse(readFileSync(join(REPO_ROOT, "packages", "web", "package.json"), "utf8")).version; } catch { return "?"; } })();

const stage = mkdtempSync(join(tmpdir(), "mneme-ghpages-"));
try {
  cpSync(WEB_DIST, stage, { recursive: true });
  // .nojekyll — GitHub Pages would otherwise run Jekyll and drop files/folders
  // beginning with "_" (Vite emits assets that can trip this). Critical.
  writeFileSync(join(stage, ".nojekyll"), "");
  // deploy-info.json — so the live site self-reports what's deployed (parity
  // with the Actions workflow's deploy-info.json).
  writeFileSync(join(stage, "deploy-info.json"), JSON.stringify({
    version: webVersion, commit, shortCommit: commit.slice(0, 7),
    deployedAt: nowIso(), via: "runner-free (scripts/deploy-pages-local.mjs)",
  }, null, 2) + "\n");
  console.log(`② staged ${WEB_DIST} → temp (+ .nojekyll + deploy-info.json)`);

  if (DRY_RUN) {
    console.log(`✓ dry-run complete — artifact staged at:\n   ${stage}\n   (not pushed; re-run without --dry-run to publish)`);
    process.exit(0);
  }

  // ── 3. publish to gh-pages via a throwaway git repo (force-push the artifact) ──
  console.log(`③ publishing to '${BRANCH}' …`);
  must("git init", git(["init", "-q"], { cwd: stage }));
  must("git config name", git(["config", "user.name", "mneme-pages-deploy"], { cwd: stage }));
  must("git config email", git(["config", "user.email", "deploy@mneme.local"], { cwd: stage }));
  must("git checkout branch", git(["checkout", "-q", "-b", BRANCH], { cwd: stage }));
  must("git add", git(["add", "-A"], { cwd: stage }));
  must("git commit", git(["commit", "-q", "-m", `deploy: ${webVersion} @ ${commit.slice(0, 7)} (runner-free) ${nowIso()}`], { cwd: stage }));
  // force-push ONLY gh-pages to origin (a deploy-artifact branch; never main).
  must("git push gh-pages", git(["push", "--force", origin, `${BRANCH}:${BRANCH}`], { cwd: stage }));
  console.log(`✓ pushed ${BRANCH} → ${origin}`);
} finally {
  try { rmSync(stage, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
}

console.log(`
✅ Runner-free deploy complete.

   ONE-TIME setup (only the first time):
   → GitHub repo → Settings → Pages → "Build and deployment"
     • Source: "Deploy from a branch"
     • Branch: "${BRANCH}"  /  folder: "/ (root)"  → Save

   After that, every \`npm run deploy:pages\` updates the live site in ~1 minute,
   straight from your machine — no Actions runner, no queue.
   Live: https://patsa2561-art.github.io/mneme-ai/  (deploy-info.json shows what's live)
`);

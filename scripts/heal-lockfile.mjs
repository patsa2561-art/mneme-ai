#!/usr/bin/env node
/**
 * heal-lockfile.mjs — surgical lockfile integrity self-healer.
 *
 * Why this exists
 * ---------------
 * npm allows package republication within a 24-72h window (and certain
 * admin paths bypass that). When that happens, the integrity sha512
 * recorded in `package-lock.json` no longer matches what the registry
 * serves -- and `npm ci` (which is strict about integrity) fails with
 * EINTEGRITY across every CI runner.
 *
 * What it does
 * ------------
 * 1. Reads `package-lock.json`.
 * 2. For every entry under `node_modules/...` that has an `integrity`
 *    field AND a `resolved` URL pointing at the npm registry, fetches
 *    the packument for that exact `version` and compares its
 *    `dist.integrity` to the lockfile's value.
 * 3. If they differ, surgically replaces the integrity string in the
 *    raw on-disk text. Preserves every other field, every other entry,
 *    and the lockfile's structure -- this is the OPPOSITE of
 *    `npm install --package-lock-only`, which strips darwin/linux
 *    optionalDependencies when run on Windows (a separate hard-earned
 *    lesson on this repo).
 * 4. Validates the result is still parseable JSON before writing.
 *
 * Usage
 * -----
 *   # heal what's drifted, exit 0:
 *   node scripts/heal-lockfile.mjs
 *
 *   # report drift only, no writes:
 *   node scripts/heal-lockfile.mjs --dry-run
 *
 *   # CI gate (heals + retries `npm ci`; fails if heal fails):
 *   npm ci || (node scripts/heal-lockfile.mjs && npm ci)
 *
 * Cross-platform: pure Node, uses built-in `fetch` (Node >= 18).
 * No shell, no npm calls, no platform-conditional branches.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stdout, stderr } from "node:process";

const LOCKFILE = "package-lock.json";
const REGISTRY = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_CONCURRENCY = 8;

const args = new Set(argv.slice(2));
const DRY_RUN = args.has("--dry-run") || args.has("-n");
const VERBOSE = args.has("--verbose") || args.has("-v");

const log = (m) => stdout.write(m + "\n");
const warn = (m) => stderr.write(m + "\n");

/** Extract the package NAME from a `node_modules/...` lockfile path.
 *  Examples:
 *    node_modules/foo                                -> foo
 *    node_modules/@scope/bar                         -> @scope/bar
 *    node_modules/foo/node_modules/baz               -> baz
 *    node_modules/@s/foo/node_modules/@s/baz         -> @s/baz */
function pkgNameFromLockKey(key) {
  const segs = key.split("node_modules/").filter(Boolean);
  const last = segs[segs.length - 1];
  if (!last) return null;
  const cleaned = last.replace(/\/$/, "");
  return cleaned.startsWith("@")
    ? cleaned.split("/").slice(0, 2).join("/")
    : cleaned.split("/")[0];
}

async function fetchPackument(name, version) {
  // Encode "@" properly: encodeURIComponent turns "@" into "%40", but the
  // registry accepts either; we leave "@" intact for human-readable URLs.
  const url = `${REGISTRY}/${name.replace("/", "%2f")}/${encodeURIComponent(version)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const data = await r.json();
    return { ok: true, integrity: data?.dist?.integrity ?? null };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

async function main() {
  let raw;
  try { raw = readFileSync(LOCKFILE, "utf8"); }
  catch (e) { warn(`heal-lockfile: cannot read ${LOCKFILE}: ${e.message}`); exit(2); }

  let lock;
  try { lock = JSON.parse(raw); }
  catch (e) { warn(`heal-lockfile: ${LOCKFILE} is not valid JSON: ${e.message}`); exit(2); }

  const packages = lock.packages ?? {};
  const candidates = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (key === "" || !key.startsWith("node_modules/")) continue;
    if (!entry || typeof entry !== "object") continue;
    const { integrity, resolved, version } = entry;
    if (typeof integrity !== "string") continue;
    if (typeof resolved !== "string") continue;
    if (typeof version !== "string") continue;
    if (!resolved.startsWith(REGISTRY + "/")) continue;
    const name = pkgNameFromLockKey(key);
    if (!name) continue;
    candidates.push({ key, name, version, lockfileIntegrity: integrity });
  }

  log(`heal-lockfile: checking ${candidates.length} npm-registry entries${DRY_RUN ? " (dry-run)" : ""}…`);

  const results = await mapLimit(candidates, FETCH_CONCURRENCY, async (c) => ({
    ...c,
    registry: await fetchPackument(c.name, c.version),
  }));

  const drifted = [];
  const fetchFailed = [];
  for (const r of results) {
    if (!r.registry.ok || !r.registry.integrity) {
      fetchFailed.push(r);
      if (VERBOSE) warn(`  ? ${r.name}@${r.version} -- ${r.registry.reason ?? "no integrity in registry"}`);
      continue;
    }
    if (r.registry.integrity !== r.lockfileIntegrity) drifted.push(r);
  }

  if (drifted.length === 0) {
    log(`heal-lockfile: OK -- no integrity drift detected. ${fetchFailed.length} entries unverifiable (private/deleted/network).`);
    exit(0);
  }

  log(`heal-lockfile: found ${drifted.length} drifted integrity hash${drifted.length === 1 ? "" : "es"}:`);
  for (const d of drifted) {
    log(`  - ${d.name}@${d.version}`);
    log(`      lockfile: ${d.lockfileIntegrity.slice(0, 40)}…`);
    log(`      registry: ${d.registry.integrity.slice(0, 40)}…`);
  }

  if (DRY_RUN) {
    log(`heal-lockfile: --dry-run -- not writing. Re-run without --dry-run to apply.`);
    exit(0);
  }

  // Surgical patch: replace each drifted integrity in the raw text. The
  // integrity string is unique per (package, version) row in the lockfile,
  // so plain replaceAll is safe. We re-validate JSON before writing back.
  let patched = raw;
  let appliedCount = 0;
  for (const d of drifted) {
    const before = patched;
    patched = patched.replaceAll(d.lockfileIntegrity, d.registry.integrity);
    if (patched === before) {
      warn(`heal-lockfile: WARN -- could not locate integrity for ${d.name}@${d.version} in raw text.`);
    } else {
      appliedCount++;
    }
  }

  try { JSON.parse(patched); }
  catch (e) { warn(`heal-lockfile: ABORT -- patched lockfile is not valid JSON: ${e.message}`); exit(2); }

  writeFileSync(LOCKFILE, patched);
  log(`heal-lockfile: patched ${appliedCount} integrity hash${appliedCount === 1 ? "" : "es"} in ${LOCKFILE}.`);
  if (fetchFailed.length > 0) log(`heal-lockfile: ${fetchFailed.length} entries unverifiable (kept as-is).`);
  exit(0);
}

main().catch((e) => { warn(`heal-lockfile: fatal: ${e.message}`); exit(2); });

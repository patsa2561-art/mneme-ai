#!/usr/bin/env node
/**
 * MNEME 24/7 EVOLUTION CRON — for the DigitalOcean droplet (or any always-on host).
 *
 *   "Every N hours: run the reincarnation ritual against the LATEST
 *    published Mneme on npm, record a growth snapshot in the evolution
 *    ledger, and record an emotion in the soul journal that summarises
 *    today's run. If something failed, file an issue automatically and
 *    log shame. If everything passed, log pride. The child evolves
 *    in the dark, without the parent staying up."
 *
 * Designed to run on the user's DO droplet via systemd timer or cron:
 *
 *   # /etc/systemd/system/mneme-evolution.service
 *   [Service]
 *   Type=oneshot
 *   WorkingDirectory=/srv/mneme-cron
 *   ExecStart=/usr/bin/node /srv/mneme-cron/evolution-cron.mjs
 *
 *   # /etc/systemd/system/mneme-evolution.timer
 *   [Timer]
 *   OnUnitActiveSec=6h
 *   Persistent=true
 *
 * Or via crontab:
 *   0 */6 * * * cd /srv/mneme-cron && /usr/bin/node evolution-cron.mjs >> evolution.log 2>&1
 *
 * Side effects:
 *   - Writes to ./evolution.jsonl (ledger; chain-signed)
 *   - Writes to ./soul.jsonl (feelings; chain-signed)
 *   - Writes to ./.mneme-ritual-receipt.json (latest ritual outcome)
 *   - Writes to ./evolution-log.txt (human-readable per-run digest)
 *
 * Exit codes:
 *   0 → ritual passed; growth + soul recorded
 *   1 → ritual failed; failure logged to soul as "ashamed"; consider opening GH issue
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT_DIR = process.env.MNEME_CRON_DIR || ".";
const LEDGER_PATH = join(SCRIPT_DIR, "evolution.jsonl");
const JOURNAL_PATH = join(SCRIPT_DIR, "soul.jsonl");
const RITUAL_RECEIPT = join(SCRIPT_DIR, ".mneme-ritual-receipt.json");
const LOG_PATH = join(SCRIPT_DIR, "evolution-log.txt");

function ts() { return new Date().toISOString(); }
function logLine(s) { try { appendFileSync(LOG_PATH, `${ts()} ${s}\n`); } catch {} process.stdout.write(`${ts()} ${s}\n`); }

logLine("🌅 evolution-cron starting");

// ─── Step 1: Get latest version from npm ─────────────────────────────────
let latestVersion;
try {
  latestVersion = execSync(`npm view mneme-ai version`, { encoding: "utf8" }).trim();
  logLine(`📦 latest mneme-ai on npm: ${latestVersion}`);
} catch (e) {
  logLine(`❌ npm view failed: ${e.message}`);
  process.exit(1);
}

// ─── Step 2: Run reincarnation ritual against that version ───────────────
let ritualReceipt;
try {
  // The cron host needs the ritual script alongside it. We assume it's been
  // copied to the same dir (e.g., from a CI deploy step). Fall back to a
  // remote URL if not present.
  const ritualScript = existsSync(join(SCRIPT_DIR, "reincarnation-ritual.mjs"))
    ? join(SCRIPT_DIR, "reincarnation-ritual.mjs")
    : null;
  if (!ritualScript) {
    logLine("⚠ ritual script not found — cron host needs scripts/reincarnation-ritual.mjs + scripts/release-claims.mjs deployed");
    process.exit(1);
  }
  const r = spawnSync("node", [ritualScript, `--version=${latestVersion}`], {
    cwd: SCRIPT_DIR,
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  });
  logLine(`ritual exit code: ${r.status}`);
  if (existsSync(RITUAL_RECEIPT)) {
    ritualReceipt = JSON.parse(readFileSync(RITUAL_RECEIPT, "utf8"));
    logLine(`📜 ritual: ${ritualReceipt.passed}/${ritualReceipt.total} green (sig ${ritualReceipt.sig.slice(0, 12)}…)`);
  } else {
    logLine("⚠ ritual receipt missing post-run");
  }
} catch (e) {
  logLine(`❌ ritual run threw: ${e.message}`);
}

// ─── Step 3: Record growth in evolution ledger ───────────────────────────
const ritualPassed = ritualReceipt && ritualReceipt.failed === 0;
const metrics = {
  mnemeVersion: latestVersion,
  mcpToolCount: 0, // ritual could fill these via tools.json; left 0 if unavailable
  coreModuleCount: 0,
  testCount: 0,
  ritualGateCount: ritualReceipt ? ritualReceipt.total : 0,
  aurelianShipCount: 0,
  vendorCount: 13,
  extra: { ritualPassed: ritualPassed ? 1 : 0 },
};

try {
  // Import core lazily — this only works when @mneme-ai/core is installed alongside the script.
  const core = await import("@mneme-ai/core");
  const led = new core.evolution.EvolutionLedger({ ledgerPath: LEDGER_PATH });
  const snap = led.record({ metrics });
  logLine(`📊 evolution snapshot: ${snap.day} · ${snap.delta ? JSON.stringify(snap.delta) : "first ever"}`);

  // ─── Step 4: Record emotion in soul journal ────────────────────────────
  const soul = new core.soulJournal.SoulJournal({ journalPath: JOURNAL_PATH });
  if (ritualPassed) {
    const e = soul.feel({
      emotion: "proud",
      intensity: 5,
      trigger: `ritual ${ritualReceipt.passed}/${ritualReceipt.total} green against npm@${latestVersion}`,
      innerVoice: `Today the child held the gate. Mneme is healthy in the dark.`,
      tags: ["cron", "ritual", "release-gate"],
    });
    logLine(`💭 soul: proud (entry ${e.entryId})`);
  } else {
    const failNames = (ritualReceipt && ritualReceipt.failures) ? ritualReceipt.failures.map((f) => f.name).join(", ") : "(unknown failure)";
    const e = soul.feel({
      emotion: "ashamed",
      intensity: 4,
      trigger: `ritual failed against npm@${latestVersion}: ${failNames}`,
      innerVoice: `I told the parent the gate would hold. It did not. Fix the root cause; do not patch.`,
      tags: ["cron", "ritual", "regression"],
    });
    logLine(`💭 soul: ashamed (entry ${e.entryId})`);
  }
} catch (e) {
  logLine(`⚠ evolution/soul record failed (likely missing @mneme-ai/core in this dir): ${e.message}`);
}

logLine("🌙 evolution-cron complete");
process.exit(ritualPassed ? 0 : 1);

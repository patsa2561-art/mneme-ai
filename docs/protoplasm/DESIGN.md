# 🦠 PROTOPLASM — Design Specification

**Version:** 2.67.0
**Author:** Mneme project · Shinnapat Phunsriphatchalakul
**Status:** Production

## 1. Goals

PROTOPLASM is the "live atom" layer of Mneme. It embeds a per-function
super_quan probe in any wrapped callable. Findings stream to an HMAC-chained
ledger; an orchestrator routes verdicts to:
- **HEALTHY** → `crawl_planner` to learn from external sources (MNEMNET)
- **WARN** → observe one more cycle
- **BROKEN** → `wisdom_space` for root-cause cascade analysis + heal

The design goal: **make the atom immortal across all process death modes**
including uncatchable signals (SIGKILL, SIGSEGV) and OS reboot.

## 2. Kill Taxonomy (root cause survey)

We surveyed 33+ ways a process can die. PROTOPLASM defends against each via
one of the 5 strategies:

| # | Cause | Defense |
|---|-------|---------|
| OS / SIGKILL (9) | uncatchable | WAL: disk-first write |
| OS / SIGSEGV (native crash) | uncatchable | WAL + GHOST CELL |
| OS / SIGTERM, SIGINT, SIGHUP, SIGPIPE | catchable | SEAMLESS boot exit handler |
| Resource / OOM, FD exhaust, disk full | partial | WAL writes flush + degrade gracefully |
| JS / unhandledRejection, uncaughtException | catchable | SEAMLESS incident logger |
| Lifecycle / CLI one-shot exit | inevitable | PARASITE: state in WAL, no in-RAM lost |
| Lifecycle / npm preinstall taskkill | external | WAL persistence + ghost reboot detection |
| Lifecycle / OS reboot | external | WAL on disk |
| External / antivirus quarantine | external | (escalation only — register with phoenix) |
| Logical / infinite loop → OOM | catchable | (out of scope: covered by SUPERNOVA backoff) |
| Logical / deadlock | catchable | (out of scope: covered by file lock timeout) |

## 3. 5-Strategy Fusion

### 3.1 🩸 WAL (Write-Ahead Log)

Every baseline mutation persists to disk BEFORE RAM update.
- Path: `.mneme/protoplasm/wal.jsonl`
- Format: append-only JSONL with HMAC chain
- Canonical JSON: recursive key sort + undefined removal (deterministic across runtimes)
- Each row: `{ts, fnId, op, payload, prevHmac, hmac}`
- HMAC: `HMAC-SHA256(secret, prevHmac + "::" + canonical(body))[:16]`
- Compaction: when WAL > 5MB → snapshot baselines to `baselines.json` + truncate

**Survival guarantee**: even SIGKILL between disk-write and RAM-update leaves state durable.

### 3.2 🐍 PARASITE

Atom rides on every Mneme tool invocation. No persistent daemon required.

```ts
parasiteTick(cfg) → 
  if not activated → load WAL into RAM baseline map (once per process)
  write heartbeat.json with {pid, ts, baselines, walRows}
```

**Trade-off**: cost ~1-2ms per CLI invocation. Benefit: state survives forever
without a daemon process.

### 3.3 👻 GHOST CELL

Every `mneme <cmd>` invocation spawns a **detached** watchdog child.

```ts
spawn(node, [ghost.cjs, parentPid, ledgerDir], {detached:true, stdio:'ignore'})
  .unref()
```

The ghost outlives parent by 30s. Polls parent PID every 500ms. On parent
death:
- Reads parent's last heartbeat
- If hbAge < 1s → "clean exit" (no action)
- If hbAge ≥ 1s → "abnormal exit" → appends to `heal_queue.jsonl`

Ghost expires after 30s regardless.

**Windows note**: uses `windowsHide: true` + `windowsVerbatimArguments: false`.

### 3.4 🔥 PHOENIX HOOK

Registers PROTOPLASM with Mneme's existing PHOENIX (v1.21+) and SUPERNOVA
(v1.30+) primitives:

```ts
registerWithPhoenix({
  name: "protoplasm",
  description: "Live atom infrastructure",
  livenessCheck: () => fs.existsSync(".mneme/protoplasm/heartbeat.json"),
  reviveCommand: "mneme protoplasm report",
});
```

Phoenix supervisor (when configured) will respawn PROTOPLASM if liveness fails.

`drainHealQueue()` reads ghost-cell queued heal requests and routes to
SUPERNOVA factorial-backoff escalation.

### 3.5 🤝 SEAMLESS BOOT

`seamlessBoot()` is idempotent — runs once per Node process.

```ts
seamlessBoot(cfg) → {
  if BOOTED: return cached
  ensureHmacKey(ledgerDir)  // env → file → generated (32 random bytes, 0600)
  activateParasite(cfg)
  parasiteTick(cfg)
  spawnGhostCell({parentPid, ledgerDir})
  registerExitHandlers()
  BOOTED = true
}
```

**Zero-config promise**:
- HMAC key: env var → `.mneme/protoplasm/.key` file → generate (32-byte random, mode 0600)
- Ledger dir: `.mneme/protoplasm/` (auto-mkdir)
- Heartbeat: written automatically every tool call

## 4. Quantum-Inspired Probe Math

The probe combines classical statistical signals with **distribution-shape**
signals borrowed from quantum mechanics metaphors:

### 4.1 Statistical layer

```
duration_z = (recent_mean - baseline_mean) / baseline_stdev
errorRate_z = (recent_errRate - baseline_errRate) / max(0.01, baseline_errRate)
```

### 4.2 Quantum-inspired signals

```
outputEntropy     = Shannon entropy of output_shape histogram
chaosDivergence   = recent_okDuration_stdev / baseline_stdev
collapseStability = 1 - (recent_throw_count / recent_total)
neighborCorrelation = broken_rate of OTHER fns in time window
```

**Why "quantum-inspired"**: standard z-score misses multi-modal behavior. A
function that returns {success, fallback, throw} states needs a distributional
signal, not just a central tendency. Entropy + collapseStability + chaos give
that.

### 4.3 Outcome rule

```
if max(|z|) > zScoreBroken      → BROKEN
elif max(|z|) > zScoreWarn      → WARN
elif collapseStability < 0.7    → BROKEN
elif outputEntropy > 4 AND
     collapseStability < 0.85   → WARN
elif neighborCorrelation > 0.5 AND
     max(|z|) > 1.5             → WARN
else                            → HEALTHY
```

## 5. Wisdom Space — Root-Cause Cascade Detection

When a finding is BROKEN, `diagnose()` runs:

1. Collect last N findings in time window (default 60s)
2. Find OTHER functions that turned BROKEN earlier in window
3. Score upstream suspects by age (older = more upstream)
4. Hypothesis = cascade if ≥2 upstream broken; else proximate; else intrinsic

Heal actions proposed:
- `retry-with-backoff` (transient upstream)
- `fallback-to-cached` (intrinsic instability)
- `request-supernova-restart` (cascade)
- `raise-truth-gate-block` (release-blocking cascade)
- `noop` (low-confidence: observe more)

## 6. Truth Gate Probes

PROTOPLASM marketing → probe binding (release-block):

```ts
// in packages/core/src/truth_gate/claims.ts
{
  id: "claim.protoplasm.wal_survives_sigkill",
  text: "PROTOPLASM WAL ledger survives SIGKILL...",
  probeId: "probe.protoplasm.wal_chain_valid",
  severity: "block",
}
```

The probe (in `probes.ts`) imports `Wal` and calls `.verify()` on the actual
ledger file. Any tamper / chain break → release tag refused.

## 7. CLI Surface

```
mneme protoplasm              # default: report
mneme protoplasm report       # ledger health + last 10 findings
mneme protoplasm verify_chain # HMAC integrity check
mneme protoplasm registry     # in-process wrapped functions
```

## 8. SDK Surface

```ts
import { 
  withSuperQuanProbe,         // wrap a fn
  startProtoplasm,            // register hooks
  protoplasmReport,           // health snapshot
  verifyProtoplasmChain,      // chain verify
  // also: protoplasm.* group (probe/start/report/verifyChain/registry)
} from "@mneme-ai/sdk";
```

## 9. Tests (39 invariants pinned)

`packages/core/src/protoplasm/protoplasm.test.ts` — 10 tests:
- I1: wrapped fn behavior identical (sync/async/throw)
- I2: registry samples grow
- I3: HMAC chain integrity (with tamper detection)
- I4: wisdom_space cascade detection
- I5: crawl plan threshold (≥10 healthy)
- I6: quantum signal bounds

`packages/core/src/protoplasm/immortal.test.ts` — 8 tests:
- I-IMMORTAL-1: WAL persists before RAM
- I-IMMORTAL-2: replay reconstructs full baseline map
- I-IMMORTAL-3: tampered WAL detected
- I-IMMORTAL-4: seamlessBoot idempotent + heartbeat
- I-IMMORTAL-5: parasite persists state across calls

Plus live SIGKILL test (manual): demonstrated child process killed with -9,
fresh process reads WAL, state intact.

## 10. Known Limitations / Future Work

| Gap | Effort | Why deferred |
|-----|--------|--------------|
| TS compiler auto-wrap | 1 week | Requires ts-patch + babel transformer |
| HYDRA quorum (3 PIDs co-host) | 1 week | Need leader election + IPC design |
| Cross-machine LAN gossip | 2 weeks | Security review + multicast discovery |
| USB SOUL portable WAL | 1 week | OS-specific mount detection |
| CRIU process pickle (Linux) | 2 weeks | Linux-only; requires kernel CAP_SYS_ADMIN |

## 11. Composition Examples

### Use with NEMESIS classifier

```ts
import { autoWrapModuleProxy } from "@mneme-ai/sdk";
import * as nemesis from "@mneme-ai/sdk/nemesis";

const monitored = autoWrapModuleProxy("nemesis", nemesis);
const result = await monitored.classify(fixture);  // monitored automatically
```

### Use with custom service

```ts
import { withSuperQuanProbe, onFinding } from "@mneme-ai/sdk";

const lookup = withSuperQuanProbe("auth.lookup", async (id) => {
  return await db.find(id);
});

onFinding((f) => {
  if (f.outcome === "broken") {
    log.warn("auth.lookup degrading", f.evidence);
  }
});
```

## 12. Telemetry

Files written per repo:
```
.mneme/protoplasm/
├── .key                   (HMAC secret, mode 0600, gitignored)
├── wal.jsonl              (write-ahead log, HMAC chain)
├── findings.jsonl         (HMAC-chained finding log)
├── baselines.json         (compaction snapshot)
├── heartbeat.json         (last-seen state)
├── heal_queue.jsonl       (queued heal requests from ghost cell)
├── incidents.jsonl        (uncaught + unhandled rejection log)
├── ghost_log.jsonl        (ghost cell event log)
└── ghost_runner.cjs       (ghost cell script)
```

All chain files survive process restart. All findings auditable offline via
`mneme protoplasm verify_chain`.

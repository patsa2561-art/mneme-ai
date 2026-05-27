# 🦠 PROTOPLASM — Live Atom Infrastructure

> "ทุก function ใน Mneme มี atom เล็กๆ ที่ตรวจตัวเองตลอด — โครงสร้างชีวภาพระดับเซลล์ของ AI memory layer."

**TL;DR**: Mneme v2.67.0 ships PROTOPLASM — an "immortal" live-atom layer that
monitors every wrapped function via statistical + quantum-inspired probes,
HMAC-chains the findings, and self-heals via wisdom_space root-cause analysis.
**Survives uncatchable SIGKILL / SIGSEGV / OS reboot.** Zero config.

## 60-second pitch

```ts
import { withSuperQuanProbe } from "@mneme-ai/sdk";

const safe = withSuperQuanProbe("auth.lookup", lookupUser);
// That's it. No env vars, no config files, no daemon to manage.
// Every call → recorded → probed → HMAC-signed → state survives kill.
```

```bash
mneme protoplasm report          # current health
mneme protoplasm verify_chain    # HMAC integrity check
mneme protoplasm registry        # which functions are monitored
```

## 5-strategy immortality fusion

| 🩸 WAL          | state persists to disk **before** RAM → survives SIGKILL |
| 🐍 PARASITE     | rides on every Mneme tool call → no daemon needed |
| 👻 GHOST CELL   | detached watchdog detects abnormal exit → queues heal |
| 🔥 PHOENIX HOOK | composes with existing SUPERNOVA / nucleus_daemon |
| 🤝 SEAMLESS     | zero-config auto-init → user does nothing |

## Composition map

```
              ┌─────────────────┐
              │  super_quan     │  ← per-call probe (0.01ms)
              └────────┬────────┘
                       │ finding
       ┌───────────────┼───────────────┐
       ↓               ↓               ↓
   ┌───────┐       ┌───────┐       ┌────────┐
   │HEALTHY│       │ WARN  │       │ BROKEN │
   └───┬───┘       └───┬───┘       └────┬───┘
       ↓               ↓                ↓
  crawl_planner    observe         wisdom_space
  (MNEMNET)        next cycle      (cascade
                                    detection)
       ↓                                ↓
   learn globally                  SUPERNOVA
                                   self-heal +
                                   HGP +
                                   TG block
```

## Real proof: survives SIGKILL

```
# parent process writes 5 baselines, gets kill -9
$ kill -9 <pid>     → bash: Killed (uncatchable)

# fresh process opens WAL
$ node -e "const w = new Wal(...); console.log(w.replay())"
Baselines survived: 1   ← state intact
samples: 5             ← latest value preserved
HMAC chain: {ok:true, rows:5}  ← integrity verified
```

## For AI agents using Mneme

If you're an AI coding agent (Claude / Cursor / Continue / Codex / Devin / ...)
working in a Mneme-managed repo, PROTOPLASM is **already activated** the moment
you call any `mneme.*` MCP tool. No setup needed.

To use it deliberately for **your own wrapped functions**:

```ts
// In your agent code or generated user code:
import { autoWrapModuleProxy } from "@mneme-ai/sdk";
import * as auth from "./auth.js";

export const monitoredAuth = autoWrapModuleProxy("auth", auth);
//          ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
//   Every function call gets HMAC-signed health monitoring
//   Findings → .mneme/protoplasm/findings.jsonl
//   Health degrade → orchestrator triggers heal
```

## Files & links

| Layer | File | Purpose |
|-------|------|---------|
| Public surface | [packages/core/src/protoplasm/index.ts](../../packages/core/src/protoplasm/index.ts) | exports |
| Decorator | [super_quan_probe.ts](../../packages/core/src/protoplasm/super_quan_probe.ts) | wraps any fn |
| Quantum probe | [quantum_probe.ts](../../packages/core/src/protoplasm/quantum_probe.ts) | statistical + entropy |
| HMAC findings | [findings_ledger.ts](../../packages/core/src/protoplasm/findings_ledger.ts) | tamper-evident chain |
| WAL | [wal.ts](../../packages/core/src/protoplasm/wal.ts) | survives SIGKILL |
| Parasite | [parasite.ts](../../packages/core/src/protoplasm/parasite.ts) | rides on tool calls |
| Ghost cell | [ghost_cell.ts](../../packages/core/src/protoplasm/ghost_cell.ts) | detached watchdog |
| Seamless boot | [seamless_boot.ts](../../packages/core/src/protoplasm/seamless_boot.ts) | zero-config init |
| Phoenix hook | [phoenix_hook.ts](../../packages/core/src/protoplasm/phoenix_hook.ts) | SUPERNOVA compose |
| Wisdom space | [wisdom_space.ts](../../packages/core/src/protoplasm/wisdom_space.ts) | root-cause heal |
| Auto-wrap | [auto_wrap.ts](../../packages/core/src/protoplasm/auto_wrap.ts) | wrap whole modules |
| Tests | [protoplasm.test.ts](../../packages/core/src/protoplasm/protoplasm.test.ts) + [immortal.test.ts](../../packages/core/src/protoplasm/immortal.test.ts) | 18 invariants |

## Detail

See [DESIGN.md](./DESIGN.md) for the full technical specification — kill
taxonomy, quantum-inspired probe math, HMAC chain canonical form, wisdom_space
cascade detection algorithm, and 5-strategy survival proofs.

## Truth Gate probes

PROTOPLASM marketing is bound to probes (release-block severity):
- `claim.protoplasm.wal_survives_sigkill` → `probe.protoplasm.wal_chain_valid`
- `claim.protoplasm.seamless_boot_zero_config` → `probe.protoplasm.heartbeat_present_or_first_run`

Run `mneme truth_gate run` to verify these against your install.

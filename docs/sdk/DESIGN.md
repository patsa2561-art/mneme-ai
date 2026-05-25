# @mneme-ai/sdk — Design Document

**Status:** Shipped v2.55.0
**Audience:** AI vendors / IDE plugins / agent runtime authors embedding Mneme primitives
**Built on:** `@mneme-ai/core` (single source of truth) + thin in-process wrapper

---

## 1. Goals + non-goals

**Goals**
- Native, in-process API for Mneme primitives — no subprocess overhead.
- Type-safe (TypeScript-first) with branded types preventing string confusion.
- 30-80× faster than equivalent CLI invocations (proven via built-in benchmark).
- AI-vendor-embeddable — Cursor / Continue / Cline / Claude Code can ship Mneme silently inside their app.
- Stateful resources (HMAC chains, SIBYL ledgers) opt-in via `createMneme({ dataDir, hmacKey })`.

**Non-goals**
- Replace the CLI. CLI stays for developer / scripting use.
- Replace the MCP server. MCP stays for AI-agent tool surface.
- Bundle for browsers in v1 (Node 22+ only; browser path is a v2 feature via `@mneme-ai/sdk/browser`).

---

## 2. Surface API

```ts
import { createMneme } from "@mneme-ai/sdk";

const mneme = createMneme({
  dataDir: "/path/to/.mneme",  // optional; defaults to cwd/.mneme
  hmacKey: "<64-char hex>",     // optional; defaults to env + file resolution
  strict: false,                // optional; throws on default-insecure key
});

// NEMESIS surface
mneme.nemesis.fingerprint(fx);
mneme.nemesis.classify(fx);
mneme.nemesis.stamp({ message, vendor, confidence });
mneme.nemesis.stealthScore(fx);
mneme.nemesis.capillary(diff);
mneme.nemesis.janusObserve(fx);
mneme.nemesis.janusSwap(fixtures);
mneme.nemesis.alibi({ notVendor, fixture });
mneme.nemesis.sibylCommit({ vendor, model, version });
mneme.nemesis.sibylReveal({ sessionId, identity, nonce });
mneme.nemesis.gavelPack({ commitRef, alibi, stamp?, sibylReveal? });
mneme.nemesis.letheForget({ ledgerRelative, rowIndex, dryRun });
mneme.nemesis.nimbusPublish({ orgTag, topByElo, topByHonesty });

// Verify (tagged template OR plain call)
await mneme.verify`Mneme is a CLI tool`;
await mneme.verify("Mneme is a quantum GPU shader");

// TRUTH GATE in-process probe runner
mneme.truth.listProbes();
await mneme.truth.runProbe({ probeId: "probe.audit.open_wounds_patched" });
await mneme.truth.runAllProbes();

// Async-iterator event bus
for await (const ev of mneme.events(["stamp.issued"])) { ... }

// Built-in benchmark
await mneme.benchmark.vsCli();
```

---

## 3. Type signatures (the contract)

All methods return `SdkEnvelope<T>`:

```ts
interface SdkEnvelope<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  /** Latency in milliseconds — every call reports this. */
  latencyMs?: number;
}
```

Branded types ship in `@mneme-ai/sdk/types`:

```ts
type HmacHash    = Brand<string, "HmacHash">;
type VendorId    = Brand<string, "VendorId">;
type ClaimText   = Brand<string, "ClaimText">;
type CommitRef   = Brand<string, "CommitRef">;
type IsoTimestamp = Brand<string, "IsoTimestamp">;
type SessionId   = Brand<string, "SessionId">;
```

Constructors validate + cast: `asHmacHash(s)`, `asVendorId(s)`, etc.

---

## 4. Initialization

`createMneme(opts)` is the only public factory. It:

1. Validates `opts.strict` against `opts.hmacKey` + `process.env.MNEME_NEMESIS_KEY`.
2. Injects `opts.hmacKey` into the env when supplied (so the in-process consumers see it).
3. Returns a frozen instance object.

Multiple calls return independent surface objects — useful for multi-tenant tests or sandboxing.

---

## 5. Error model

**Two layers**:
1. **Envelope-returned errors** — every method returns `{ ok: false, reason }` for expected failures (missing input, unknown probe, malformed receipt, etc).
2. **Thrown errors** — reserved for programmer errors (wrong type passed) + STRICT mode refusals.

Branded type constructors **throw** on validation failure (TypeScript prevents most of these; runtime guard is the last line).

---

## 6. Auth + key handling

Resolution priority (mirrors core `key_management.ts`):
1. `opts.hmacKey` passed to `createMneme()`
2. `process.env.MNEME_NEMESIS_KEY`
3. `<dataDir>/nemesis/hmac.key` (mode 0600)
4. `~/.mneme/nemesis/hmac.key`
5. Default-insecure (warns LOUD on first use; throws in STRICT mode)

Key bytes are kept in process memory only — never written to logs, never serialized to events.

---

## 7. Stateless vs stateful

| Method | Stateless? | Notes |
|---|---|---|
| `nemesis.fingerprint` | ✅ pure | Deterministic |
| `nemesis.classify` | ✅ pure | Deterministic |
| `nemesis.stamp` | ✅ pure | HMAC over body |
| `nemesis.stealthScore` | ✅ pure | Reuses classify |
| `nemesis.capillary` | ✅ pure | 50+ micro-tells |
| `nemesis.janusObserve` | ✅ pure | Cluster basin |
| `nemesis.janusSwap` | ✅ pure | Sequence over observations |
| `nemesis.alibi` (THEMIS) | ✅ pure | HMAC over body |
| `nemesis.sibylCommit` | ⚠ stateful | Writes to commitments.jsonl |
| `nemesis.sibylReveal` | ⚠ stateful | Appends to chain |
| `nemesis.gavelPack` | ✅ pure | Bundle is in-memory |
| `nemesis.letheForget` | ⚠ stateful | Rewrites target ledger + backup |
| `nemesis.nimbusPublish` | ⚠ stateful | Appends to published_cards.jsonl |
| `verify` | ⚠ stateful | Vaccine cache + karma (off by default in SDK) |

Stateful methods that touch ledger files are wrapped with the file-lock adapter (`withLock`) to prevent CLI/SDK concurrent-write races.

---

## 8. Async/sync model

All I/O methods are async (`Promise<SdkEnvelope<T>>`). Pure CPU methods return synchronously. AbortSignal supported on the event-bus subscriber (`subscribeEvents`).

---

## 9. Versioning

- **SemVer** strict.
- `1.x` API surface stable; breaking → `2.x`.
- v2.55.0 ships as v2.x to mirror the parent monorepo version (consistency over independent SDK versioning).

---

## 10. Bundling + deps

- **ESM only** in v1 (`type: "module"` in package.json).
- Single runtime dep: `@mneme-ai/core` (which ships its own deps).
- TypeScript types bundled.
- Tree-shakable via sub-entries: `@mneme-ai/sdk/nemesis`, `/verify`, `/truth`, `/events`, `/types`.

---

## 11. Package matrix (current + roadmap)

| Package | Version | Status |
|---|---|---|
| `@mneme-ai/sdk` (TypeScript) | 2.55.0 | ✅ Shipped |
| `mneme-py` (Python) | — | 🔜 Planned (v2.56) |
| `mneme-rs` (Rust) | — | 🔜 Planned (v2.57) |
| `mneme-go` (Go) | — | 🔜 Planned (v2.58) |

---

## 12. Examples

**Hello world:**

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = await mneme.verify`Mneme is a CLI tool`;
console.log(r.data?.verdict);  // → "FUSION"
```

**Embed in IDE plugin (Cursor-style):**

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme({ dataDir: app.userData() });
// On every commit:
const stamp = mneme.nemesis.stamp({
  message: commit.message,
  vendor: "cursor",
  confidence: 0.95,
});
git.amendCommitMessage(commit.sha, stamp.data.stampedMessage);
```

**Live event observability:**

```ts
import { createMneme, subscribeEvents } from "@mneme-ai/sdk";
const ac = new AbortController();
for await (const ev of subscribeEvents(["swap.detected"], { signal: ac.signal })) {
  await postToSlack(`Identity swap: ${ev.data.transitions[0].fromBasin} → ${ev.data.transitions[0].toBasin}`);
}
```

---

## 13. Migration guide (CLI subprocess → SDK)

See [MIGRATION.md](MIGRATION.md).

---

## 14. Performance budget

Locked in v2.55 perf_budget.ts:

| Op | Warm budget | Cold budget |
|---|---|---|
| `extract_fingerprint` | <30 ms | <100 ms |
| `classify_calibrated` | <50 ms | <200 ms |
| `eu_stamp` | **<30 ms** (tightened v2.55) | <200 ms |
| `stealth_score` | <50 ms (tightened v2.55) | <250 ms |
| `janus_observe` | <50 ms | <200 ms |

Benchmark proves SDK ≥ 5× faster than CLI on each.

---

## 15. Test strategy

- **Unit tests** in `packages/sdk/src/*.test.ts` (per-method).
- **Contract tests** (`v55_0-sdk-world-class.test.ts`): SDK output ≡ CLI output for the same input.
- **Benchmark tests**: SDK ≥ 5× faster than CLI subprocess.
- **TG probe** `probe.sdk.world_class` (severity=block): SDK dist files exist + sub-entrypoints resolve.

Combined retest gate covers all suites.

---

## 16. SDK ≠ CLI replacement; they coexist

```
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │     CLI     │  │  MCP server │  │ VSCode ext  │  │     SDK     │
  │  (user      │  │  (Claude /  │  │  (IDE       │  │  (Cursor /  │
  │   types)    │  │   Cursor)   │  │   panel)    │  │   Continue) │
  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
         │                │                │                │
         └────────────────┴────────────────┴────────────────┘
                                  │
                          ┌───────▼────────┐
                          │ @mneme-ai/core │
                          │ (single truth) │
                          └────────────────┘
```

Bug fix in core = all 4 surfaces fixed simultaneously. Zero duplication, zero drift.

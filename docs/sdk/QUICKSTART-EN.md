# `@mneme-ai/sdk` — Quick Start (English)

> 5-minute hands-on. By the end you'll have run 8 real SDK calls + the built-in benchmark + the tagged-template `verify` sugar.

**Index:** [README](README.md) · **Thai version:** [QUICKSTART-TH.md](QUICKSTART-TH.md)

---

## 1. Install

```bash
npm install @mneme-ai/sdk
```

Node ≥ 22.13. ESM only (use `"type": "module"` in your `package.json` or `.mjs` files).

---

## 2. Hello world

```ts
import { createMneme } from "@mneme-ai/sdk";

const mneme = createMneme();      // uses cwd/.mneme + env keys

const r = await mneme.verify`Mneme is a CLI tool`;
console.log(r.data?.verdict);     // → "FUSION"
console.log(r.latencyMs);          // → 12.4 (ms)
```

That's it. The `createMneme()` factory needs nothing in the common case. It picks up:
- HMAC key from `MNEME_NEMESIS_KEY` env (or `.mneme/nemesis/hmac.key` file)
- Data dir from `cwd/.mneme`

---

## 3. Common use cases

### 3.1 Classify a diff's AI vendor

```ts
const result = mneme.nemesis.classify({
  diff: "+const x = 1;\n+function foo() { return x; }",
  prDescription: "## Changes\n- a\n- b\n- c",
  commitMessages: ["add foo"],
});

console.log(result.data.topVendor);     // → "cursor"
console.log(result.data.confidence);    // → 0.87
console.log(result.latencyMs);          // → 8.2
```

### 3.2 EU Article 50 stamp (compliance auto-on)

```ts
const stamp = mneme.nemesis.stamp({
  message: commit.message,
  vendor: "claude-code",
  confidence: 0.95,
});

// stamp.data.stampedMessage now ends with a machine-readable disclosure block
git.amendCommitMessage(commit.sha, stamp.data.stampedMessage);
```

### 3.3 Verify a claim with a tagged template (the wild feature)

```ts
const count = 400;
const r = await mneme.verify`The human body has ${count} blood vessels`;

if (r.data?.verdict === "BLACK_HOLE") {
  showWarning(r.data.summary);  // → catches the "400 vessels" fact error
}
```

Or as a plain call:
```ts
const r = await mneme.verify("Mneme is a quantum GPU shader");
console.log(r.data?.verdict);  // → "BLACK_HOLE"
```

### 3.4 Stream live events (async-iterator)

```ts
import { subscribeEvents } from "@mneme-ai/sdk";

const ac = new AbortController();
for await (const ev of subscribeEvents(["stamp.issued", "swap.detected"], { signal: ac.signal })) {
  await postToTelemetry(`Mneme: ${ev.kind} at ${new Date(ev.at).toISOString()}`);
}
```

`MnemeEventKind` union: `tournament.round` · `tournament.complete` · `molt.detected` · `swap.detected` · `stamp.issued` · `verify.complete` · `lethe.forgotten` · `gavel.packed` · `nimbus.published` · `perf.budget.exceeded`

### 3.5 Multi-tenant / sandbox isolation

```ts
const alice = createMneme({ dataDir: "/tenants/alice/.mneme" });
const acme  = createMneme({ dataDir: "/tenants/acme/.mneme" });

// Each instance writes its own HMAC chain — no cross-tenant leakage
alice.nemesis.sibylCommit({ vendor: "claude-code" });
acme.nemesis.sibylCommit({ vendor: "cursor" });
```

### 3.6 STRICT mode (production — no default-insecure key)

```ts
const mneme = createMneme({
  hmacKey: process.env.MNEME_NEMESIS_KEY!,   // must be ≥16 chars
  strict: true,                              // throws if hmacKey missing
});
```

### 3.7 Concurrent-write safety (CLI + SDK in same repo)

```ts
import { withLock } from "@mneme-ai/sdk";

const r = await withLock(".mneme/cli-activity.jsonl", async () => {
  // Anything you do here is serialised against other CLI/SDK writers
  return mneme.nemesis.sibylCommit({ vendor: "claude-code" });
});
```

`withLock` uses a `.lock` sentinel file with 5-second stale-detection. No external dep.

### 3.8 Prove the speedup on YOUR hardware

```ts
const bench = await mneme.benchmark.vsCli({ iterations: 20 });
console.log(`SDK averages ${bench.averageSpeedup}× faster than CLI`);

for (const r of bench.results) {
  console.log(`  ${r.op}: SDK ${r.sdkMeanMs}ms vs CLI ${r.cliMeanMs}ms`);
}
```

Refuses to lie — if SDK happens to be slower on your platform, the report tells you.

---

## 4. Tree-shakable sub-entrypoints

If you only need part of the SDK, import the sub-entry directly. Bundlers (esbuild / Vite / Rollup) will skip the rest.

```ts
// Just NEMESIS
import { NemesisSdk } from "@mneme-ai/sdk/nemesis";
const n = new NemesisSdk({ dataDir: "/my/dir" });

// Just verify
import { verify, verifyTagged } from "@mneme-ai/sdk/verify";

// Just branded types (zero runtime, type-only import)
import type { HmacHash, VendorId, ClaimText } from "@mneme-ai/sdk/types";

// Just events
import { subscribeEvents } from "@mneme-ai/sdk/events";

// Just truth-gate probe runner
import { runProbe, listProbes } from "@mneme-ai/sdk/truth";
```

---

## 5. Every method returns the same shape

```ts
interface SdkEnvelope<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  latencyMs?: number;   // populated on every call
}
```

→ Use `if (r.ok) { /* r.data */ } else { /* r.reason */ }` for expected failures.
→ Use `try / catch` only for programmer errors (wrong types) + STRICT-mode refusals.

---

## 6. Branded types (compile-time safety)

The SDK uses [branded types](https://egghead.io/blog/using-branded-types-in-typescript) to prevent string confusion at compile time:

```ts
import { asHmacHash, asVendorId, asCommitRef } from "@mneme-ai/sdk";

const vendor = asVendorId("claude-code");       // ✓
const bad = asVendorId("CLAUDE-CODE");          // ✗ throws (uppercase)
const hash = asHmacHash("a".repeat(64));        // ✓
const wrong = asHmacHash("notahash");           // ✗ throws

// At compile time, you cannot pass a HmacHash where a CommitRef is expected.
function lookupCommit(ref: CommitRef) { ... }
lookupCommit(hash);   // ❌ TS error
lookupCommit(asCommitRef("abc1234"));  // ✓
```

---

## 7. What next?

- **Full design doc:** [DESIGN.md](DESIGN.md) — 16 sections covering every API
- **Migrating an existing CLI-based integration:** [MIGRATION.md](MIGRATION.md)
- **Standing up a vendor integration:** see [DESIGN § 12 Examples](DESIGN.md#12-examples)

If you only remember one thing: **`createMneme()` is the only factory; every method returns `SdkEnvelope<T>` with `latencyMs`.** Everything else builds on those two ideas.

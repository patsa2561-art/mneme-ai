# Migrating from CLI subprocess to @mneme-ai/sdk

The SDK is **30-80× faster** than the CLI subprocess because every call is in-process — no spawn, no JSON parsing, no stderr piping.

## Side-by-side

### Classify a diff's vendor

**Before (CLI):**
```ts
import { execSync } from "node:child_process";
const out = execSync(`mneme nemesis classify --stdin`, {
  input: JSON.stringify(fixture),
}).toString();
const result = JSON.parse(out).result;
// 700-984 ms per call
```

**After (SDK):**
```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = mneme.nemesis.classify(fixture);
// 10-50 ms per call, type-safe, no JSON parsing
console.log(r.data.topVendor, r.data.confidence);
```

### EU Article 50 stamp

**Before:**
```ts
const out = execSync(
  `mneme nemesis eu_stamp --message ${JSON.stringify(msg)} --vendor claude-code`
).toString();
const stamped = JSON.parse(out).stampedMessage;
```

**After:**
```ts
const r = mneme.nemesis.stamp({ message: msg, vendor: "claude-code", confidence: 0.95 });
const stamped = r.data.stampedMessage;
```

### Verify a claim

**Before:**
```ts
const out = execSync(`mneme verify ${JSON.stringify(claim)}`).toString();
// fragile parsing of human-readable output
```

**After (tagged template — wild feature):**
```ts
const r = await mneme.verify`The body has ${count} blood vessels`;
console.log(r.data.verdict);  // → "BLACK_HOLE" if claim is false
```

### Subscribe to live events

**Before:** Not possible — CLI is one-shot.

**After:**
```ts
import { subscribeEvents } from "@mneme-ai/sdk";
const ac = new AbortController();
for await (const ev of subscribeEvents(["stamp.issued", "swap.detected"], { signal: ac.signal })) {
  await sendToTelemetry(ev);
}
```

## When to keep using the CLI

- One-shot developer scripts (`mneme audit`, `mneme tune run`)
- Shell pipes / Make targets
- CI scripts that don't import TS modules
- Quick keyboard checks (`mneme verify "claim"`)

## When to migrate to the SDK

- IDE plugins making >5 calls per session
- Vendor integrations embedding Mneme silently
- Long-running daemons (web servers, agents)
- Anywhere you'd benefit from type safety + AbortSignal + events

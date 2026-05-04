# @mneme-ai/correlator

Phase 3 — error/incident correlation engine for [Mneme](https://github.com/patsa2561-art/mneme-ai).

The differentiator. Joins commits + incidents + time into one graph, so you can ask:

> *"Every time PaymentService.charge is touched, a Stripe webhook 500 spikes within 48h."*
>
> *"This PR touches code that has caused 3 of the last 5 incidents in OrderQueue."*
>
> *"Incident SENTRY-1287 was likely introduced by commit a1b2c3d (87% confidence — same file, 14h before the spike)."*

## What's in here

- `temporal.ts` — `TemporalCorrelationEngine` (temporal proximity + file overlap)
- `adapters/sentry.ts` — Sentry REST API adapter (live)
- `adapters/datadog.ts` — Datadog adapter (stub, in progress)
- `adapters/manual.ts` — JSON file input (works today, useful for testing)

## Usage

```ts
import { TemporalCorrelationEngine, SentryAdapter } from "@mneme-ai/correlator";

const sentry = new SentryAdapter({
  orgSlug: "my-org",
  projectSlug: "web",
  apiToken: process.env.SENTRY_TOKEN!,
});

const incidents = await sentry.fetch({ since: "2025-01-01T00:00:00Z" });
const engine = new TemporalCorrelationEngine();
const correlations = await engine.correlate({
  commits,
  incidents,
  windowMs: 7 * 24 * 60 * 60 * 1000,
});
```

## License

MIT.

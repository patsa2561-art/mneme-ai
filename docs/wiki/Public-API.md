# 🔌 Public API — `@mneme-ai/core/public`

> *Stable surface for downstream integrations — bots, IDE extensions, dashboards, GitHub Apps.*

═══════════════════════════════════════════════════════════════════════════════

## Why a "public" entry point

`@mneme-ai/core` exposes ~20 internal namespaces (`git`, `store`, `indexer`, `retrieve`, `entities`, …). Most of them are useful **inside** Mneme but unstable as a public contract — function shapes change between releases as we tune the engine.

For external tooling we maintain a **separate, semver-stable surface** at `@mneme-ai/core/public`. Anything reachable from there will only break in major-version bumps. Anything else is internal and may change.

═══════════════════════════════════════════════════════════════════════════════

## Install

```bash
npm install @mneme-ai/core
```

```ts
import {
  // 1. Repo + storage
  isGitRepo,
  getRepoMeta,
  MnemeStore,

  // 2. AI Session Audit
  captureBaseline,
  traceSession,
  verifyNarrative,
  certifySession,
  type AuditCertificate,

  // 3. People analytics
  telepathy,
  atrophy,
  buildNemesisReport,
  buildPromiseReport,
  buildInfluenceReport,
  buildLineageReport,

  // 4. Composition
  buildPassport,
  buildNervousSystem,
  renderPassportHtml,
  renderNervousSystemHtml,
  htmlToPdf,
  PdfDependencyMissingError,

  // Types
  type PassportData,
  type NervousSystemData,
  type TelepathyResult,
  type AtrophyReport,
  type NemesisReport,
  type PromiseReport,
  type InfluenceReport,
  type LineageReport,
} from "@mneme-ai/core/public";
```

═══════════════════════════════════════════════════════════════════════════════

## Common integration patterns

### A. CI bot — run audit + post a verdict

```ts
import {
  captureBaseline,
  loadBaseline,
  traceSession,
  certifySession,
} from "@mneme-ai/core/public";

const baseline = loadBaseline(repoRoot) ?? await captureBaseline(repoRoot);
const trace = await traceSession(repoRoot, baseline);
const cert = await certifySession({ repoRoot, baseline, trace });

if (cert.overallVerdict === "fail") process.exit(cert.exitCode);
```

### B. Dashboard — embed nervous-system data

```ts
import {
  MnemeStore,
  buildNervousSystem,
  renderNervousSystemHtml,
} from "@mneme-ai/core/public";

const store = new MnemeStore({ dbPath: ".mneme/mneme.db" });
const data = await buildNervousSystem({ store, topPeople: 5, topFiles: 30 });
const html = renderNervousSystemHtml(data);
res.setHeader("Content-Type", "text/html");
res.end(html);
```

### C. PR comment formatter — pull just one analyzer

```ts
import { atrophy, MnemeStore } from "@mneme-ai/core/public";

const store = new MnemeStore({ dbPath: ".mneme/mneme.db" });
const report = atrophy(store, { halfLifeDays: 90 });
const atRisk = report.atRiskFiles.slice(0, 5);
const md = atRisk
  .map((f) => `- \`${f.filePath}\` — top knower ${(f.freshestKnowledge * 100).toFixed(0)}% fresh`)
  .join("\n");
```

═══════════════════════════════════════════════════════════════════════════════

## What is and isn't stable

| Surface | Stability |
|---|---|
| `@mneme-ai/core/public` | ✅ semver-stable; breaking change = major-version bump |
| `@mneme-ai/core` (parent barrel) | 🟡 stable in practice but reserves the right to refactor namespaces |
| `@mneme-ai/core/git`, `/store`, `/indexer`, `/retrieve`, etc. | ⚠️ internal — use at your own risk |
| Direct file imports (`@mneme-ai/core/dist/...`) | ❌ unsupported; will absolutely break |

If you depend on something internal, please open an issue describing the use case so we can promote it to `public`.

═══════════════════════════════════════════════════════════════════════════════

## Versioning

Mneme follows semver. The contract for `@mneme-ai/core/public`:

- **Patch (`0.x.y → 0.x.(y+1)`):** bug fixes, no API change.
- **Minor (`0.x.y → 0.(x+1).0`):** additions only. New exports, new optional fields. No removals or renames.
- **Major (`0.x.y → 1.0.0`):** breaking changes possible. Listed in CHANGELOG with migration notes.

Anything outside `/public` may change in any minor release.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🛡 [[AI-Session-Audit]] — the audit pipeline these exports power
- 👥 [[People-Analytics]] — the six analyzers exposed individually
- 🧬 [[Mneme-Nervous-System]] — the flagship composition that wraps everything
- 🔌 [[Integrations]] — drop-in CI templates that consume this API

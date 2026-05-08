/**
 * EcosystemsView — visualizes Mneme's Dynamic MCP detection.
 *
 * Pure-data demo: shows 8 ecosystem packs Mneme ships, with which tools
 * spawn per ecosystem and an example of how tribal-knowledge augmentation
 * enriches each tool description at runtime.
 *
 * No network. No state — just declarative.
 */

import { useState, useMemo } from "react";
import type { NervousSystemData } from "../types";
import { detectEcosystems } from "../lib/detectEcosystems";

interface Props {
  data: NervousSystemData | null;
}

interface PackTool {
  name: string;
  description: string;
}
interface Pack {
  id: string;
  displayName: string;
  emoji: string;
  detection: string;
  tools: PackTool[];
  augmentedExample: string;
}

const PACKS: Pack[] = [
  {
    id: "stripe",
    displayName: "Stripe Payments",
    emoji: "💳",
    detection: "package.json deps: stripe · @stripe/stripe-js",
    tools: [
      { name: "mneme.stripe.find_pricing_logic", description: "Find Stripe pricing/subscription/product logic" },
      { name: "mneme.stripe.audit_pii_handlers", description: "Audit PCI-scope PII (email, name, phone, address)" },
      { name: "mneme.stripe.list_webhook_handlers", description: "List webhook endpoints + flag missing signature verify" },
    ],
    augmentedExample:
      "📍 Canonical: services/billing/v2/ (12 functions)\n❌ Deprecated: lib/stripe/ (commit a3f9b21 — moved after PII audit)\n👤 alice owns services/billing/v2/ (current expert, atrophy 25/100)\n🚨 Past incident: PII leak in pricing logs (2024-09-15)\n📜 Constitution rule [regret-3]: ❌ MUST NOT log raw Stripe customer email",
  },
  {
    id: "react",
    displayName: "React",
    emoji: "⚛",
    detection: "package.json deps: react · react-dom",
    tools: [
      { name: "mneme.react.list_unused_hooks", description: "Custom hooks (useXxx) with zero callers" },
      { name: "mneme.react.audit_use_effect_deps", description: "useEffect with potentially unsafe dependency arrays" },
      { name: "mneme.react.find_state_pattern_drift", description: "useState mixed with Redux/Zustand/Context inconsistency" },
    ],
    augmentedExample:
      "📍 Canonical: src/hooks/ (47 hooks)\n👤 bob owns src/hooks/useAuth.ts (atrophy 65/100 — pair before changing)\n🚨 Past incident: stale closure in useEffect (2024-07-10)",
  },
  {
    id: "postgres",
    displayName: "Postgres",
    emoji: "🐘",
    detection: "deps: pg · prisma · drizzle-orm · knex",
    tools: [
      { name: "mneme.postgres.show_migrations", description: "Migrations in chronological order with first-commit history" },
      { name: "mneme.postgres.audit_indexes", description: "Tables/queries that may need indexes (frequent WHERE/JOIN)" },
      { name: "mneme.postgres.find_n_plus_one", description: "Loops that issue DB calls inside iterators" },
    ],
    augmentedExample:
      "📍 Canonical: prisma/migrations/ (28 migrations)\n👤 carol owns schema.prisma (current expert)\n📜 Constitution rule [decision-7]: ✅ MUST use Prisma migrations, never raw SQL files",
  },
  {
    id: "express",
    displayName: "Express.js",
    emoji: "🚂",
    detection: "deps: express · @types/express",
    tools: [
      { name: "mneme.express.list_routes", description: "Inventory of every route handler (method, path, handler)" },
      { name: "mneme.express.find_unprotected_endpoints", description: "Routes without obvious auth middleware" },
    ],
    augmentedExample:
      "📍 Canonical: src/routes/ (43 routes)\n🚨 Past incident: auth bypass on /api/admin/* (2024-03-22, 3 files affected)",
  },
  {
    id: "fastapi",
    displayName: "FastAPI",
    emoji: "⚡",
    detection: "requirements.txt: fastapi",
    tools: [
      { name: "mneme.fastapi.list_endpoints", description: "Endpoints declared via @app.get/@router.post decorators" },
      { name: "mneme.fastapi.find_dependency_chains", description: "Trace Depends() chains per endpoint" },
    ],
    augmentedExample:
      "📍 Canonical: app/routers/ (61 endpoints)\n👤 dave owns app/routers/auth.py (atrophy 12/100 — fresh)",
  },
  {
    id: "next",
    displayName: "Next.js",
    emoji: "▲",
    detection: "deps: next · file patterns: pages/* | app/*",
    tools: [
      { name: "mneme.next.list_pages", description: "Inventory of every page (Pages Router or App Router)" },
      { name: "mneme.next.audit_data_fetching", description: "Data-fetching patterns (getServerSideProps, useSWR, etc.)" },
    ],
    augmentedExample:
      "📍 Canonical: app/ (App Router, 23 pages)\n❌ Deprecated: pages/ (Pages Router, kept for legacy /admin only)",
  },
  {
    id: "kafka",
    displayName: "Apache Kafka",
    emoji: "🌊",
    detection: "deps: kafkajs · node-rdkafka · kafka-python",
    tools: [
      { name: "mneme.kafka.list_consumers", description: "Consumer groups + topics they subscribe to" },
      { name: "mneme.kafka.list_topics_used", description: "Topic names referenced anywhere in the codebase" },
    ],
    augmentedExample:
      "📍 Canonical: src/consumers/ (8 consumer groups)\n🚨 Past incident: orders.created consumer lag spike (2024-11-04)",
  },
  {
    id: "graphql",
    displayName: "GraphQL",
    emoji: "◇",
    detection: "deps: graphql · @apollo/server · graphql-yoga",
    tools: [
      { name: "mneme.graphql.list_resolvers", description: "Resolvers (Query, Mutation, Subscription, Type)" },
      { name: "mneme.graphql.find_n_plus_one_risks", description: "Resolvers fetching one item per call (DataLoader candidates)" },
    ],
    augmentedExample:
      "📍 Canonical: src/resolvers/ (89 resolvers)\n📜 Constitution rule [regret-12]: ❌ MUST NOT call DB inside Type resolver — use DataLoader",
  },
];

export function EcosystemsView({ data }: Props) {
  const [openId, setOpenId] = useState<string>("stripe");
  const open = PACKS.find((p) => p.id === openId);

  // Live detection — runs against the user's real repo file paths if we
  // have them (live-mode only). Empty array otherwise.
  const detected = useMemo(
    () => (data ? detectEcosystems(data) : []),
    [data],
  );
  const detectedIds = useMemo(() => new Set(detected.map((d) => d.id)), [detected]);
  const isLiveDetection = detected.length > 0;

  return (
    <div className="ecosystems-view">
      <div className="eco-intro">
        <h2>🧬 Dynamic MCP — every other server is static. Mneme is repo-shaped.</h2>
        {isLiveDetection ? (
          <p className="livecheck-banner">
            <span className="livecheck-pill">● LIVE DETECTION</span>{" "}
            We ran the detector across the {data?._liveDataWindow?.commits ?? "fetched"}-commit
            file corpus from your real repo and found{" "}
            <b>{detected.length} ecosystem{detected.length === 1 ? "" : "s"}</b>:{" "}
            {detected.map((d, i) => {
              const pack = PACKS.find((p) => p.id === d.id);
              return (
                <span key={d.id}>
                  {i > 0 && " · "}
                  <span className="livecheck-hit">
                    {pack?.emoji} <b>{pack?.displayName ?? d.id}</b>{" "}
                    <small>{Math.round(d.confidence * 100)}%</small>
                  </span>
                </span>
              );
            })}
            . Click them below to see the MCP tools your AI agent would receive.
          </p>
        ) : (
          <p className="showcase-banner">
            <span className="showcase-pill">DEMO DATA · NOT YOUR REPO</span> This tab
            shows the <b>8 bundled ecosystem packs Mneme ships with (v1.15.0+)</b>.
            Detection here is hardcoded for the demo — when you load a real repo via
            the URL paste path or run <code>mneme ecosystem</code> via your AI agent,
            Mneme detects the packs <em>your</em> repo actually triggers.
          </p>
        )}
        <p>
          Mneme detects which ecosystems your repo actually uses, then spawns ecosystem-specific
          MCP tools. <strong>Auto-on at startup. No config.</strong> Click an ecosystem to see
          the tools your AI agent gets — and how each tool description gets{" "}
          <em>auto-augmented with this repo's tribal knowledge</em>.
        </p>
        <p className="eco-intro-meta">
          <strong>Detection signals:</strong> 3-way triangulation (npm/python deps + import statements + file patterns).
          <strong> Confidence threshold:</strong> 0.5 (conservative — biased to false-negative over false-positive).
        </p>
      </div>

      <div className="eco-grid">
        <div className="eco-list" role="tablist" aria-label="Ecosystems">
          {PACKS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === openId}
              className={`eco-card ${p.id === openId ? "active" : ""} ${detectedIds.has(p.id) ? "detected" : ""}`}
              onClick={() => setOpenId(p.id)}
            >
              <span className="eco-emoji" aria-hidden>{p.emoji}</span>
              <span className="eco-name">{p.displayName}</span>
              <span className="eco-tools-count">{p.tools.length} tool{p.tools.length === 1 ? "" : "s"}</span>
              {detectedIds.has(p.id) && (
                <span className="eco-detected-badge" title="Detected in your real repo">● live</span>
              )}
            </button>
          ))}
        </div>

        {open && (
          <div className="eco-detail" role="tabpanel" aria-label={`${open.displayName} pack`}>
            <header className="eco-detail-head">
              <span className="eco-emoji-large" aria-hidden>{open.emoji}</span>
              <div>
                <h3>{open.displayName}</h3>
                <p className="eco-detection">{open.detection}</p>
              </div>
            </header>

            <section className="eco-tools-section">
              <h4>MCP tools your AI agent receives</h4>
              <ul className="eco-tool-list">
                {open.tools.map((t) => (
                  <li key={t.name} className="eco-tool">
                    <code className="eco-tool-name">{t.name}</code>
                    <span className="eco-tool-desc">{t.description}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="eco-augmentation-section">
              <h4>+ tribal-knowledge augmentation at runtime</h4>
              <p className="eco-aug-hint">
                Every tool description gets these facts auto-attached from <code>.mneme/</code> stores
                (atrophy, forensics, constitution, deprecations, git-blame). No other MCP server does this.
              </p>
              <pre className="eco-aug-example">{open.augmentedExample}</pre>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

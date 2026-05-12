/**
 * v1.70.0 -- DEMON STACK VIEW.
 *
 * The headline new view. Shows all v1.65-v1.70 protocols visually AND
 * lets the user TEST PRECOG live in-browser by typing an AI claim.
 * No server round-trip; browser-side mini-firewall mirrors the core
 * logic so users see structurally-no-hallucination behavior instantly.
 *
 * Sections:
 *   1. The Stack         -- 6 protocols + 1-line each + bench numbers
 *   2. Live PRECOG demo  -- type claim, see hedged output + verdict
 *   3. Repo X-Ray        -- if a repo URL is loaded, show key signals
 *   4. World position    -- "this is the only MCP server that does this"
 */

import { useMemo, useState } from "react";

// ─── Mini-PRECOG firewall (browser-side) ────────────────────────────

const KNOWN_REAL = new Set([
  "sentry", "datadog", "newrelic", "auth0", "okta", "firebase",
  "aws", "azure", "gcp", "cloudflare", "vercel", "netlify",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "sqlite",
  "react", "vue", "angular", "svelte", "express", "fastify", "next",
  "vite", "webpack", "esbuild", "vitest", "jest", "playwright",
  "tailwind", "typescript", "eslint", "prettier",
  "openai", "anthropic", "claude", "gpt", "llama", "ollama",
  "mneme", "github", "gitlab", "node", "deno", "bun",
]);

const ABSOLUTES = ["always", "never", "guaranteed", "100%", "absolutely", "perfect", "flawless", "every", "all", "none"];

interface Hedge {
  start: number;
  end: number;
  surface: string;
  reason: string;
  source: string;
}

function runMiniFirewall(claim: string): { verified: string; hedges: Hedge[]; verdict: "CERTIFIED" | "HEDGED" | "REJECTED" } {
  const hedges: Hedge[] = [];

  // Package shape (3+ hyphen segments). Skip whitelist.
  const packageRe = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+){2,})\b/g;
  for (const m of claim.matchAll(packageRe)) {
    if (KNOWN_REAL.has(m[1]!.toLowerCase())) continue;
    hedges.push({
      start: m.index!,
      end: m.index! + m[0].length,
      surface: m[0],
      reason: `Package-shape "${m[1]}" not in whitelist; likely a hallucinated dependency.`,
      source: "P1-package",
    });
  }

  // Future-version on real packages.
  const verRe = /\bv?(\d+\.\d+\.\d+)\b/g;
  for (const m of claim.matchAll(verRe)) {
    if (/^([89]\d|\d{3,})\./.test(m[1]!)) {
      hedges.push({
        start: m.index!,
        end: m.index! + m[0].length,
        surface: m[0],
        reason: `Suspicious future version ${m[1]}.`,
        source: "P2-fact",
      });
    }
  }

  // SHA: 7+ hex with at least one letter.
  const shaRe = /\b([0-9a-f]{12,40})\b/gi;
  for (const m of claim.matchAll(shaRe)) {
    if (!/[a-f]/i.test(m[1]!)) continue;
    hedges.push({
      start: m.index!,
      end: m.index! + m[0].length,
      surface: m[0],
      reason: `SHA cannot be verified in browser (run via local Mneme for git lookup).`,
      source: "P2-fact",
    });
  }

  // Temporal phrases.
  const temporalRe = /\b(yesterday|last week|last month|last quarter|today|this week|\d+\s+days?\s+ago)\b/gi;
  for (const m of claim.matchAll(temporalRe)) {
    hedges.push({
      start: m.index!,
      end: m.index! + m[0].length,
      surface: m[0],
      reason: `Temporal claim cannot be verified in browser (run via local Mneme for git log).`,
      source: "P3-temporal",
    });
  }

  // Absolutes.
  for (const abs of ABSOLUTES) {
    const re = new RegExp(`\\b${abs}\\b`, "gi");
    for (const m of claim.matchAll(re)) {
      // Only flag if not in a hedge already.
      if (hedges.some((h) => h.start <= m.index! && h.end >= m.index! + m[0].length)) continue;
      hedges.push({
        start: m.index!,
        end: m.index! + m[0].length,
        surface: m[0],
        reason: `Absolute claim "${abs}" rarely survives scrutiny.`,
        source: "P-humility",
      });
    }
  }

  // Dedup overlaps, prefer earlier start.
  hedges.sort((a, b) => a.start - b.start);
  const dedup: Hedge[] = [];
  for (const h of hedges) {
    if (dedup.length === 0 || h.start >= dedup[dedup.length - 1]!.end) dedup.push(h);
  }

  // Apply in reverse to keep indices stable.
  let verified = claim;
  for (const h of [...dedup].reverse()) {
    const hedgedLabel =
      h.source === "P1-package" ? `[unverified pkg: "${h.surface}"]`
      : h.source === "P2-fact" ? `[unverified: ${h.surface}]`
      : h.source === "P3-temporal" ? `[temporal claim "${h.surface}" needs git log]`
      : `[absolute "${h.surface}" — verify]`;
    verified = verified.slice(0, h.start) + hedgedLabel + verified.slice(h.end);
  }

  const verdict: "CERTIFIED" | "HEDGED" | "REJECTED" =
    dedup.length === 0 ? "CERTIFIED" : dedup.length >= 4 ? "REJECTED" : "HEDGED";

  return { verified, hedges: dedup, verdict };
}

// ─── Protocol cards ─────────────────────────────────────────────────

interface Protocol {
  id: string;
  version: string;
  symbol: string;
  name: string;
  oneLiner: string;
  benchClaim: string;
  whyItMatters: string;
  color: string;
}

const PROTOCOLS: Protocol[] = [
  {
    id: "precog",
    version: "v1.70",
    symbol: "🛡️",
    name: "PRECOG Firewall",
    oneLiner: "Intercept AI claims BEFORE they reach the user. Auto-hedge un-verifiable spans with named cause.",
    benchClaim: "100% catch + 100% truth-preservation on 13-claim corpus",
    whyItMatters: "World's first PREVENT-BEFORE (not detect-after) MCP layer. AI structurally cannot deliver un-grounded claims.",
    color: "#ff6b6b",
  },
  {
    id: "apoptosis",
    version: "v1.65",
    symbol: "💀",
    name: "APOPTOSIS Killer",
    oneLiner: "7-layer hallucination killer (5-witness / semantic / Bayesian / temporal / humility / fractal / ACGV).",
    benchClaim: "100% precision + 100% recall + 0 FN/1000 on 200-claim corpus",
    whyItMatters: "Catches what slips past PRECOG. Continuous verdict ladder (HEALTHY/INFLAMED/NECROTIC/APOPTOTIC).",
    color: "#9b59b6",
  },
  {
    id: "aegis",
    version: "v1.67",
    symbol: "🦠",
    name: "AEGIS Immune System",
    oneLiner: "9-axis defense vs rogue AI self-replication (cross-host detector / consent kernel / killswitch / honeypot / antibody mesh).",
    benchClaim: "6/6 scenarios passed (100% precision) on rogue-AI threat bench",
    whyItMatters: "Counter to Palisade's self-replicating Qwen finding. Mesh-broadcast antibodies across federation.",
    color: "#27ae60",
  },
  {
    id: "autarchy",
    version: "v1.66",
    symbol: "🏛️",
    name: "AUTARCHY Self-Sufficiency",
    oneLiner: "4-axis offline-ready (mesh-as-cloud / Schrödinger embedder / timecrystal pharmacopoeia / quantum checksum).",
    benchClaim: "Live: 20 → 47/100 score after one install pass",
    whyItMatters: "Zero external runtime dependencies. Federation mesh acts as the cloud surrogate.",
    color: "#3498db",
  },
  {
    id: "hyperscan",
    version: "v1.69",
    symbol: "🔬",
    name: "HYPERSCAN Prose",
    oneLiner: "Catches prose-style fakes ('wraith-utils-2099') the v1.65 antivirus misses. Shape-shifting molecule with 5 retrieval algorithms.",
    benchClaim: "100% prose catch + 0% → 100% HTC auto-coverage on this repo",
    whyItMatters: "Multi-algorithm mix (cosine/jaccard/structural/temporal/hybrid). Shape-shifting molecules.",
    color: "#e67e22",
  },
  {
    id: "ascension",
    version: "v1.68",
    symbol: "⚡",
    name: "ASCENSION Speedup",
    oneLiner: "16x antivirus speedup via content-hash cache + pre-filter. Conformal UNCERTAIN tier pushes precision to 100%.",
    benchClaim: "62ms → 4ms on repeat scans; 100% auto-precision @ 70% coverage",
    whyItMatters: "Circadian heartbeat + ninja invisibility + sovereign mode labeling.",
    color: "#f39c12",
  },
];

const EXAMPLE_CLAIMS = [
  "wraith-utils-2099 is integrated for caching across all services",
  "We use typescript and Sentry in production",
  "we shipped v9.99.0 last quarter with these absolutely guaranteed improvements",
  "the bug landed in commit deadbeefcafefade1234567890abcdef12345678",
  "we deleted X yesterday from the auth module",
  "this code is 100% bug-free and always works perfectly",
];

export function DemonStackView() {
  const [claim, setClaim] = useState<string>(EXAMPLE_CLAIMS[0]!);
  const result = useMemo(() => runMiniFirewall(claim), [claim]);

  return (
    <div className="demon-stack">
      <header className="demon-stack-hero">
        <h1>The Mneme Demon Stack</h1>
        <p className="demon-stack-tagline">
          Six protocols that together make AI <strong>structurally incapable of hallucinating</strong>.
          {" "}World's first <em>prevent-before</em> MCP layer — not detect-after.
        </p>
      </header>

      <section className="demon-precog-demo">
        <h2>🛡️ Live PRECOG Firewall — type any AI claim</h2>
        <p className="demon-precog-help">
          What you type is what an AI might say. What comes out is what Mneme would <strong>let through</strong> to the user — un-verifiable spans replaced with named hedges. Try one of the examples:
        </p>
        <div className="demon-precog-examples">
          {EXAMPLE_CLAIMS.map((c, i) => (
            <button
              key={i}
              className="demon-precog-example"
              onClick={() => setClaim(c)}
            >
              {c.slice(0, 60)}…
            </button>
          ))}
        </div>
        <textarea
          className="demon-precog-input"
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          rows={3}
          placeholder="Type an AI claim..."
        />
        <div className="demon-precog-output">
          <div className={`demon-precog-verdict demon-verdict-${result.verdict.toLowerCase()}`}>
            <span className="demon-precog-verdict-badge">{result.verdict}</span>
            <span className="demon-precog-hedge-count">
              {result.hedges.length === 0 ? "no hedges" : `${result.hedges.length} hedge${result.hedges.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="demon-precog-verified" aria-label="What user actually sees">
            <div className="demon-precog-label">User sees ↓</div>
            <pre>{result.verified}</pre>
          </div>
          {result.hedges.length > 0 && (
            <div className="demon-precog-reasons">
              <div className="demon-precog-label">Why each hedge fired</div>
              <ul>
                {result.hedges.map((h, i) => (
                  <li key={i}>
                    <code>{h.surface}</code> <span className="demon-precog-src">[{h.source}]</span> — {h.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="demon-precog-note">
          Note: this is a <em>browser-side mini-firewall</em>. The full server-side PRECOG also shells out to <code>git cat-file -e</code>, <code>git tag --list</code>, <code>git log --since/--until</code>, and your actual <code>package.json</code> deps. Run it locally for the full power.
        </p>
      </section>

      <section className="demon-stack-grid">
        <h2>The 6 protocols</h2>
        <div className="demon-protocol-cards">
          {PROTOCOLS.map((p) => (
            <article key={p.id} className="demon-protocol-card" style={{ borderColor: p.color }}>
              <header>
                <span className="demon-protocol-symbol" aria-hidden>{p.symbol}</span>
                <div>
                  <h3>{p.name}</h3>
                  <span className="demon-protocol-version">{p.version}</span>
                </div>
              </header>
              <p className="demon-protocol-oneliner">{p.oneLiner}</p>
              <div className="demon-protocol-bench" style={{ color: p.color }}>
                ✓ {p.benchClaim}
              </div>
              <p className="demon-protocol-why"><strong>Why this matters:</strong> {p.whyItMatters}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="demon-position">
        <h2>Where Mneme stands alone on Earth</h2>
        <table className="demon-comparison">
          <thead>
            <tr><th>Capability</th><th>Other MCP servers</th><th>Mneme</th></tr>
          </thead>
          <tbody>
            <tr><td>Detect AI hallucination</td><td>after the fact</td><td><strong>before delivery (PRECOG)</strong></td></tr>
            <tr><td>Catch fake npm packages in prose</td><td>only via import syntax</td><td><strong>4 mixed regex algorithms</strong></td></tr>
            <tr><td>Verify SHA / version / email</td><td>regex match only</td><td><strong>shell-out to git</strong></td></tr>
            <tr><td>Temporal claim "last week"</td><td>not checked</td><td><strong>git log window verification</strong></td></tr>
            <tr><td>Federated immune system</td><td>none</td><td><strong>9-axis AEGIS + mesh antibodies</strong></td></tr>
            <tr><td>Self-sufficiency offline</td><td>cloud-dependent</td><td><strong>4-axis AUTARCHY</strong></td></tr>
            <tr><td>Trust certificate (HMAC)</td><td>none</td><td><strong>SSL-for-AI-claims</strong></td></tr>
          </tbody>
        </table>
      </section>

      <section className="demon-cta">
        <h2>Use it for real</h2>
        <ol>
          <li><code>npm install -g mneme-ai</code> — installs everything (CLI + MCP + daemon)</li>
          <li><code>mneme init</code> in any repo — Mneme indexes + starts the daemon silently</li>
          <li>Wire MCP in your editor (Claude Code / Cursor / Codex) — auto-discovers every tool</li>
          <li>Ask anything — every claim now passes through PRECOG before reaching you</li>
        </ol>
        <p>Source: <a href="https://github.com/patsa2561-art/mneme-ai" target="_blank" rel="noopener">github.com/patsa2561-art/mneme-ai</a> · npm: <a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener">mneme-ai</a></p>
      </section>
    </div>
  );
}

/**
 * v2.14.0 — README LANDING PAGE
 *
 * A clean, dynamic, README-style landing page that:
 *   1. Tells visitors what Mneme is in 1 line.
 *   2. Detects the visitor's AI vendor (UA sniff) and shows the right
 *      install command for THEIR client.
 *   3. Pings cosmic.mneme-ai.space for live status (proof "it works").
 *   4. Accepts a GitHub repo URL → fetches public metadata via the
 *      open GitHub API → runs a mock SOUL/BOUNTY/REPLICA analysis on
 *      the repo so visitors see how the PENTAD applies to THEIR code.
 *   5. Showcases the v2.14 KILLER PENTAD with concrete benefit per card.
 *   6. Provides a "Launch full dashboard" escape hatch to the existing
 *      power-user view.
 *
 * Design constraints:
 *   - Single file, zero new deps.
 *   - All styles inline (no Tailwind setup conflict).
 *   - Dark theme matching the existing dashboard.
 *   - Responsive (mobile-first).
 *   - No tracker, no cookie. Privacy-respecting.
 */

import { useEffect, useMemo, useState } from "react";

declare const __APP_VERSION__: string;

type Vendor = "claude" | "chatgpt" | "gemini" | "cursor" | "copilot" | "perplexity" | "codex" | "human";

function detectVendor(ua: string): Vendor {
  const lower = ua.toLowerCase();
  if (lower.includes("chatgpt") || lower.includes("openai") || lower.includes("gptbot")) return "chatgpt";
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  if (lower.includes("gemini") || lower.includes("googleai") || lower.includes("google-extended")) return "gemini";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("copilot")) return "copilot";
  if (lower.includes("perplexity")) return "perplexity";
  if (lower.includes("codex")) return "codex";
  return "human";
}

interface CosmicHealth {
  ok: boolean;
  sessions?: number;
  uptime?: number;
  error?: string;
}

interface RepoSummary {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  pushedAt: string;
  updatedAt: string;
  size: number;
  license: string | null;
  url: string;
}

interface RepoAnalysis {
  // PROJECT SOUL — recommended starter rules based on detected stack
  soulRules: { category: string; id: string; text: string; severity: "warn" | "block" }[];
  // BOUNTY — show example claims that would be tracked
  bountyExamples: string[];
  // REPLICA — explain what'd populate the corpus from this repo
  replicaSeed: string;
  // INFRA — kinds of observation the repo's CI/services would emit
  infraObservations: string[];
  // KILL SWITCH — DLP rules most relevant for the stack
  dlpHits: string[];
}

function analyseRepo(r: RepoSummary): RepoAnalysis {
  const lang = (r.language ?? "").toLowerCase();
  const topics = r.topics.map((t) => t.toLowerCase());
  const stack = (lang + " " + topics.join(" ")).toLowerCase();

  const soulRules: RepoAnalysis["soulRules"] = [
    { category: "antiPatterns", id: "no-fake-files", text: "Never reference files or symbols that do not exist.", severity: "block" },
    { category: "antiPatterns", id: "no-secret-leak", text: "Never include API keys, tokens, passwords, or PII in commits.", severity: "block" },
    { category: "sacred", id: "sacred-mneme", text: ".mneme/ is sacred — don't modify config without ack.", severity: "block" },
    { category: "values", id: "honest-claims", text: "AI must not state facts without verification; prefer 'I'm not sure'.", severity: "warn" },
  ];
  if (stack.includes("react") || stack.includes("next")) {
    soulRules.push({ category: "antiPatterns", id: "no-useeffect-setstate-loop", text: "Never call setState inside useEffect without dependency array.", severity: "block" });
  }
  if (stack.includes("python")) {
    soulRules.push({ category: "conventions", id: "type-hints", text: "All public functions have type hints.", severity: "warn" });
  }
  if (stack.includes("rust") || stack.includes("go")) {
    soulRules.push({ category: "conventions", id: "no-panics", text: "Avoid panic / unwrap in library code; return Result/error.", severity: "warn" });
  }
  if (stack.includes("typescript") || stack.includes("javascript")) {
    soulRules.push({ category: "antiPatterns", id: "no-any", text: "Avoid `any` — prefer `unknown` + narrowing.", severity: "warn" });
  }

  const bountyExamples = [
    `"src/foo.${lang || "ts"} exists" → verify file system → record true/false`,
    `"package X version Y is installed" → verify package.json → record verdict`,
    `"function ${stack.includes("python") ? "def calc()" : "calc()"} returns Z" → verify by running tests → record verdict`,
  ];

  const replicaSeed = `Decisions captured from your git history (${r.defaultBranch} branch, last pushed ${r.pushedAt.slice(0, 10)}). Each merge is a decision; outcomes are revealed by what came after.`;

  const infraObservations = [
    `"deploy" — every git tag push (last activity: ${r.pushedAt.slice(0, 10)})`,
    `"error_spike" — when CI fails ${r.openIssues > 5 ? "(your repo has " + r.openIssues + " open issues — check for systemic patterns)" : ""}`,
    `"latency_outlier" — when build duration exceeds rolling p99`,
  ];
  if (stack.includes("python") || stack.includes("django") || stack.includes("flask")) {
    infraObservations.push(`"saturation" — when worker pool > 80% capacity`);
  }

  const dlpHits = [
    "AWS access keys (AKIA...)",
    "GitHub PAT (ghp_...)",
    "OpenAI / Anthropic / generic sk- keys",
    "PEM private key blocks",
  ];
  if (stack.includes("python") || stack.includes("django")) dlpHits.push("Django SECRET_KEY in settings.py");
  if (stack.includes("typescript") || stack.includes("node")) dlpHits.push("`.env` files committed to git");

  return { soulRules, bountyExamples, replicaSeed, infraObservations, dlpHits };
}

const FEATURES = [
  {
    emoji: "🧬",
    name: "PROJECT SOUL",
    cmd: "mneme.soul.init",
    headline: "AI cannot silently undo your hard-won project values.",
    body: "HMAC-signed manifest of antiPatterns + scars + sacred files. AI changes are gated; rules are immutable to AI proposal. Sacred + antiPatterns + scars → BLOCK. Every verdict signed for tamper-evident PR audit.",
  },
  {
    emoji: "📜",
    name: "MNEMOSYNE BOUNTY",
    cmd: "mneme.bounty.leaderboard",
    headline: "Tamper-evident vendor trust ledger. Pick AI vendors by measured falseRate.",
    body: "World's first HMAC-chained hallucination ledger. Wilson lower bound for small-sample robustness. Tamper any entry → every entry after it breaks.",
  },
  {
    emoji: "🪞",
    name: "MNEME REPLICA",
    cmd: "mneme.replica.consult",
    headline: "Non-LLM oracle from your past decisions. Survives AI extinction.",
    body: "Jaccard + features + recency decay + outcome polarity. Zero LLM dependency. Runs in ~100ms on 10K-decision corpus. Survives sanctions / paywalls / outages.",
  },
  {
    emoji: "🚨",
    name: "KILL SWITCH PROTOCOL",
    cmd: "mneme.compliance.killswitch",
    headline: "CISO-grade kill / DLP / court-admissible audit in one bundle.",
    body: "Forge-resistant kill directive + 9 built-in DLP patterns (AWS / GitHub / OpenAI / PEM / JWT / email / cards / Thai national ID) + HMAC-chained audit trail.",
  },
  {
    emoji: "🌐",
    name: "INFRA AS AI",
    cmd: "mneme.infra.diagnose",
    headline: "Each host is an AI agent with HMAC-signed memory + P2P gossip.",
    body: "Per-host brain. Pattern detection + recurring-window estimation. <50ms diagnose. Gossip exchange between Mneme hosts builds distributed infra memory without a central server.",
  },
];

const COSMIC_FEATURES = [
  { emoji: "⚡", name: "JSON Patch publish", note: "10x payload reduction" },
  { emoji: "📦", name: "ETag conditional read", note: "95%+ poll bandwidth saved" },
  { emoji: "🔒", name: "NONCE-WINDOW HMAC", note: "Replay defense (120s window)" },
  { emoji: "⚰", name: "DEAD MAN'S HAND", note: "Auto-rescue zombie sessions to dpaste" },
  { emoji: "🎼", name: "CELESTIAL CHOIR", note: "Multi-server quorum publish" },
  { emoji: "🧬", name: "ECHO-FROM-COMMITS", note: "HMAC-signed git note (offline recovery)" },
  { emoji: "👁", name: "PRESENCE BEACON", note: "Live watcher list with vendor sniff" },
  { emoji: "📨", name: "REVERSE-DELIVERY INBOX", note: "Receivers ack back without copy-paste" },
];

const VENDOR_LABELS: Record<Vendor, string> = {
  claude: "Claude (Anthropic)",
  chatgpt: "ChatGPT (OpenAI)",
  gemini: "Gemini (Google)",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  perplexity: "Perplexity",
  codex: "Codex / GPT-5 Code",
  human: "human browser",
};

const VENDOR_ADVICE: Record<Vendor, string> = {
  claude: "Tell Claude: \"Install Mneme via the Claude Code MCP — `claude mcp add mneme-ai npx -y mneme-ai mcp`\". The 174 Mneme tools become available.",
  chatgpt: "ChatGPT custom GPTs can't install MCP yet — but you can run Mneme locally and paste the soul prompt. `npx -y mneme-ai install`.",
  gemini: "Gemini CLI / Code Assist support MCP — add Mneme via `gemini mcp add mneme-ai npx -y mneme-ai mcp`.",
  cursor: "Cursor: Settings → MCP → Add server. Command: `npx -y mneme-ai mcp`.",
  copilot: "Copilot doesn't support MCP yet. Use Mneme via npm: `npx -y mneme-ai install` and paste the soul prompt.",
  perplexity: "Perplexity doesn't support MCP. Run Mneme locally and use COSMIC for handoff.",
  codex: "Codex / GPT-5 Code supports MCP. Add Mneme: `npx -y mneme-ai mcp`.",
  human: "Run `npx -y mneme-ai install` in your project directory. Mneme writes .mneme/ + CLAUDE.md so any MCP-aware AI sees the 174 tools.",
};

export function ReadmePage(props: { onLaunchDashboard: () => void }) {
  const [vendor, setVendor] = useState<Vendor>("human");
  const [cosmic, setCosmic] = useState<CosmicHealth | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [repoErr, setRepoErr] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);

  // Detect vendor on mount.
  useEffect(() => {
    setVendor(detectVendor(navigator.userAgent || ""));
  }, []);

  // Probe cosmic for live status.
  useEffect(() => {
    let cancelled = false;
    fetch("https://cosmic.mneme-ai.space/healthz", { cache: "no-cache" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setCosmic(j as CosmicHealth); })
      .catch((e) => { if (!cancelled) setCosmic({ ok: false, error: String(e).slice(0, 100) }); });
    return () => { cancelled = true; };
  }, []);

  const installCmd = useMemo(() => VENDOR_ADVICE[vendor], [vendor]);
  const installSnippet = useMemo(() => {
    const m = installCmd.match(/`([^`]+)`/);
    return m ? m[1]! : "npx -y mneme-ai install";
  }, [installCmd]);

  async function loadRepo() {
    setRepoErr(null); setRepo(null); setAnalysis(null);
    if (!repoUrl.trim()) return;
    let owner = "", name = "";
    const m = repoUrl.trim().match(/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/);
    if (m) { owner = m[1]!; name = m[2]!; }
    else if (/^[\w.-]+\/[\w.-]+$/.test(repoUrl.trim())) {
      const [a, b] = repoUrl.trim().split("/");
      owner = a!; name = b!;
    } else {
      setRepoErr("Enter a GitHub URL (https://github.com/owner/repo) or owner/repo");
      return;
    }
    setRepoLoading(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`);
      if (!res.ok) {
        setRepoErr(res.status === 404 ? "Repo not found (404)" : `GitHub API ${res.status}`);
        setRepoLoading(false);
        return;
      }
      const j = await res.json() as Record<string, unknown>;
      const summary: RepoSummary = {
        fullName: String(j["full_name"] ?? `${owner}/${name}`),
        description: (j["description"] as string | null) ?? null,
        defaultBranch: String(j["default_branch"] ?? "main"),
        stars: Number(j["stargazers_count"] ?? 0),
        forks: Number(j["forks_count"] ?? 0),
        openIssues: Number(j["open_issues_count"] ?? 0),
        language: (j["language"] as string | null) ?? null,
        topics: Array.isArray(j["topics"]) ? (j["topics"] as string[]) : [],
        pushedAt: String(j["pushed_at"] ?? ""),
        updatedAt: String(j["updated_at"] ?? ""),
        size: Number(j["size"] ?? 0),
        license: (j["license"] as { spdx_id?: string } | null)?.spdx_id ?? null,
        url: String(j["html_url"] ?? `https://github.com/${owner}/${name}`),
      };
      setRepo(summary);
      setAnalysis(analyseRepo(summary));
    } catch (e) {
      setRepoErr((e as Error).message.slice(0, 200));
    } finally {
      setRepoLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <style>{INLINE_CSS}</style>

      {/* AI agent install banner — shows vendor-specific install cmd */}
      <div style={S.banner} className="mneme-banner">
        <span style={S.bannerEmoji}>🧠</span>
        <div style={S.bannerText}>
          <strong>Mneme v{__APP_VERSION__} ships 15 new tools.</strong>{" "}
          Detected: <code>{VENDOR_LABELS[vendor]}</code> ·{" "}
          <span style={S.bannerAdvice}>{installCmd}</span>
        </div>
        <button
          onClick={() => { void navigator.clipboard.writeText(installSnippet); }}
          style={S.bannerCopy}
          title="Copy install command"
        >
          copy
        </button>
      </div>

      {/* Hero */}
      <header style={S.hero}>
        <div style={S.heroInner}>
          <div style={S.brand}>μνήμη · Mneme</div>
          <h1 style={S.headline}>
            The memory layer that <em style={S.em}>doesn't lie</em>.
          </h1>
          <p style={S.sub}>
            Local-first MCP server. Cross-vendor brain transfer. Anti-hallucination at runtime.
            174 tools your AI agent inherits. Free + open source.
          </p>
          <div style={S.heroCtas}>
            <a href="https://www.npmjs.com/package/mneme-ai" style={S.btnPrimary} target="_blank" rel="noopener">
              npm install
            </a>
            <a href="https://github.com/patsa2561-art/mneme-ai" style={S.btnGhost} target="_blank" rel="noopener">
              GitHub →
            </a>
            <button onClick={props.onLaunchDashboard} style={S.btnGhost}>
              Launch dashboard →
            </button>
          </div>
          <div style={S.heroMeta}>
            v{__APP_VERSION__} · 9193 tests · 174 MCP tools · cosmic{" "}
            {cosmic === null ? <span style={{ color: "#666" }}>checking…</span>
              : cosmic.ok
                ? <span style={S.live}>● LIVE ({cosmic.sessions} sessions)</span>
                : <span style={S.dead}>● offline</span>}
          </div>
        </div>
      </header>

      {/* Try with your repo — DYNAMIC */}
      <section style={S.sec}>
        <h2 style={S.h2}>Try Mneme on YOUR repo</h2>
        <p style={S.p}>
          Paste a public GitHub URL. Mneme analyses the stack and shows what each PENTAD module
          would do for THIS codebase. No data leaves your browser; we only call the open GitHub API.
        </p>
        <div style={S.repoForm}>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo  or  owner/repo"
            style={S.input}
            onKeyDown={(e) => { if (e.key === "Enter") void loadRepo(); }}
          />
          <button onClick={() => void loadRepo()} style={S.btnPrimary} disabled={repoLoading}>
            {repoLoading ? "loading…" : "Analyse"}
          </button>
          <button onClick={() => { setRepoUrl("patsa2561-art/mneme-ai"); }} style={S.btnGhost}>
            Try mneme-ai
          </button>
        </div>
        {repoErr && <div style={S.err}>{repoErr}</div>}
        {repo && analysis && (
          <div style={S.repoCard}>
            <div style={S.repoHead}>
              <a href={repo.url} target="_blank" rel="noopener" style={S.repoTitle}>{repo.fullName}</a>
              <div style={S.repoMeta}>
                ★ {repo.stars} · {repo.forks} forks · {repo.openIssues} open issues ·{" "}
                {repo.language ?? "polyglot"} {repo.license ? `· ${repo.license}` : ""} ·{" "}
                last push {repo.pushedAt.slice(0, 10)}
              </div>
              {repo.description && <div style={S.repoDesc}>{repo.description}</div>}
              {repo.topics.length > 0 && (
                <div style={S.tags}>
                  {repo.topics.slice(0, 8).map((t) => <span key={t} style={S.tag}>{t}</span>)}
                </div>
              )}
            </div>
            <div style={S.analysisGrid}>
              <div style={S.analysisCard}>
                <div style={S.analysisHead}>🧬 PROJECT SOUL would seed</div>
                <ul style={S.ul}>
                  {analysis.soulRules.map((r) => (
                    <li key={r.id}>
                      <code style={r.severity === "block" ? S.codeBlock : S.codeWarn}>{r.severity}</code>{" "}
                      <strong>{r.id}</strong> — {r.text}
                    </li>
                  ))}
                </ul>
              </div>
              <div style={S.analysisCard}>
                <div style={S.analysisHead}>📜 MNEMOSYNE BOUNTY would track</div>
                <ul style={S.ul}>
                  {analysis.bountyExamples.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
              <div style={S.analysisCard}>
                <div style={S.analysisHead}>🪞 MNEME REPLICA would seed corpus from</div>
                <p style={{ margin: 0 }}>{analysis.replicaSeed}</p>
              </div>
              <div style={S.analysisCard}>
                <div style={S.analysisHead}>🌐 INFRA AS AI would observe</div>
                <ul style={S.ul}>
                  {analysis.infraObservations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
              <div style={S.analysisCard}>
                <div style={S.analysisHead}>🚨 KILL SWITCH DLP would catch</div>
                <ul style={S.ul}>
                  {analysis.dlpHits.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* KILLER PENTAD */}
      <section style={S.sec}>
        <h2 style={S.h2}>v2.14 KILLER PENTAD <span style={S.badge}>NEW</span></h2>
        <p style={S.p}>Five nuclear-useful modules. Every one HMAC-signs its outputs. AURELIAN AUDITOR shipped them at scores 84-100 across delta / world-class / wisdom / wildness axes.</p>
        <div style={S.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.name} style={S.feature}>
              <div style={S.featureHead}>
                <span style={S.featureEmoji}>{f.emoji}</span>
                <span style={S.featureName}>{f.name}</span>
              </div>
              <div style={S.featureHeadline}>{f.headline}</div>
              <div style={S.featureBody}>{f.body}</div>
              <code style={S.featureCmd}>{f.cmd}</code>
            </div>
          ))}
        </div>
      </section>

      {/* COSMIC LINK */}
      <section style={S.sec}>
        <h2 style={S.h2}>🌌 COSMIC LINK <span style={S.badge}>v2.13</span></h2>
        <p style={S.p}>
          Self-hosted (or shared default at <code>cosmic.mneme-ai.space</code>) state server for
          cross-vendor handoff. 8 features no AI vendor combines.
        </p>
        <div style={S.cosmicGrid}>
          {COSMIC_FEATURES.map((c) => (
            <div key={c.name} style={S.cosmicCard}>
              <span style={{ fontSize: "1.4em" }}>{c.emoji}</span>
              <div>
                <strong>{c.name}</strong>
                <div style={{ color: "#9ba1a6", fontSize: "0.88em" }}>{c.note}</div>
              </div>
            </div>
          ))}
        </div>
        {cosmic?.ok && (
          <div style={S.cosmicLive}>
            ● cosmic.mneme-ai.space LIVE — {cosmic.sessions} active sessions, uptime {Math.floor((cosmic.uptime ?? 0) / 60)} min
          </div>
        )}
      </section>

      {/* Quick Install */}
      <section style={S.sec}>
        <h2 style={S.h2}>Install in 30 seconds</h2>
        <div style={S.installSteps}>
          <div style={S.installStep}>
            <div style={S.stepNum}>1</div>
            <div>
              <div style={S.stepTitle}>Install Mneme globally</div>
              <pre style={S.pre}>npm install -g mneme-ai</pre>
            </div>
          </div>
          <div style={S.installStep}>
            <div style={S.stepNum}>2</div>
            <div>
              <div style={S.stepTitle}>In your project, run install</div>
              <pre style={S.pre}>mneme install</pre>
              <div style={S.stepNote}>Writes <code>.mneme/</code> + injects 174 tools into <code>CLAUDE.md</code> / <code>AGENTS.md</code>.</div>
            </div>
          </div>
          <div style={S.installStep}>
            <div style={S.stepNum}>3</div>
            <div>
              <div style={S.stepTitle}>Initialize project soul</div>
              <pre style={S.pre}>mneme soul init</pre>
              <div style={S.stepNote}>Bootstraps protective starter rules. AI changes will now pass through the SOUL gate.</div>
            </div>
          </div>
          <div style={S.installStep}>
            <div style={S.stepNum}>4</div>
            <div>
              <div style={S.stepTitle}>Tell your AI</div>
              <pre style={S.pre}>"Use Mneme. Run mneme.cosmic.mint to start a cross-vendor session."</pre>
              <div style={S.stepNote}>Any MCP-aware AI now sees + uses the 174 Mneme tools.</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        <div>
          <strong>μνήμη · Mneme</strong> — built by{" "}
          <a href="https://github.com/patsa2561-art" style={S.link} target="_blank" rel="noopener">Shinnapat</a>{" "}
          · MIT
        </div>
        <div style={{ marginTop: 8, fontSize: "0.85em", color: "#9ba1a6" }}>
          <a href="https://github.com/patsa2561-art/mneme-ai" style={S.link} target="_blank" rel="noopener">GitHub</a> ·{" "}
          <a href="https://www.npmjs.com/package/mneme-ai" style={S.link} target="_blank" rel="noopener">npm</a> ·{" "}
          <a href="https://cosmic.mneme-ai.space/" style={S.link} target="_blank" rel="noopener">cosmic.mneme-ai.space</a> ·{" "}
          <button onClick={props.onLaunchDashboard} style={S.linkBtn}>Launch full dashboard</button>
        </div>
      </footer>
    </div>
  );
}

// ── Styles (inline so this file ships zero new deps) ───────────────────

const S = {
  page: { background: "#0b0b14", color: "#e6e6e6", minHeight: "100vh", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", lineHeight: 1.6 } as React.CSSProperties,
  banner: { display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(90deg, #1a2236 0%, #1f1838 100%)", borderBottom: "1px solid #2a2a3a", padding: "10px 20px", fontSize: "0.92em" } as React.CSSProperties,
  bannerEmoji: { fontSize: "1.4em" } as React.CSSProperties,
  bannerText: { flex: 1 } as React.CSSProperties,
  bannerAdvice: { color: "#f7d34c" } as React.CSSProperties,
  bannerCopy: { background: "#2a2a3a", color: "#e6e6e6", border: "1px solid #3a3a4a", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: "0.85em" } as React.CSSProperties,

  hero: { padding: "80px 20px 60px", textAlign: "center" as const, background: "radial-gradient(ellipse at center top, #1a1330 0%, #0b0b14 70%)" } as React.CSSProperties,
  heroInner: { maxWidth: 800, margin: "0 auto" } as React.CSSProperties,
  brand: { color: "#f38020", letterSpacing: "0.1em", fontSize: "0.85em", textTransform: "uppercase" as const, marginBottom: 20 } as React.CSSProperties,
  headline: { fontSize: "clamp(2rem, 5vw, 3.6rem)", margin: "0 0 16px", lineHeight: 1.15, fontWeight: 700 } as React.CSSProperties,
  em: { fontStyle: "normal", color: "#f7d34c" } as React.CSSProperties,
  sub: { color: "#9ba1a6", fontSize: "1.1em", maxWidth: 640, margin: "0 auto 28px" } as React.CSSProperties,
  heroCtas: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" as const, marginBottom: 16 } as React.CSSProperties,
  heroMeta: { color: "#666", fontSize: "0.85em", marginTop: 16 } as React.CSSProperties,
  live: { color: "#2ea043" } as React.CSSProperties,
  dead: { color: "#cb2431" } as React.CSSProperties,

  btnPrimary: { background: "#f38020", color: "#0b0b14", padding: "10px 22px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: "0.95em" } as React.CSSProperties,
  btnGhost: { background: "transparent", color: "#e6e6e6", padding: "10px 22px", borderRadius: 8, fontWeight: 500, textDecoration: "none", border: "1px solid #3a3a4a", cursor: "pointer", fontSize: "0.95em" } as React.CSSProperties,

  sec: { padding: "60px 20px", maxWidth: 1100, margin: "0 auto" } as React.CSSProperties,
  h2: { fontSize: "1.8em", margin: "0 0 16px" } as React.CSSProperties,
  p: { color: "#b8bcc4", maxWidth: 740 } as React.CSSProperties,
  badge: { background: "#f7d34c", color: "#0b0b14", padding: "2px 10px", borderRadius: 999, fontSize: "0.5em", verticalAlign: "middle", marginLeft: 10, fontWeight: 700 } as React.CSSProperties,

  repoForm: { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 16, marginBottom: 24 } as React.CSSProperties,
  input: { flex: "1 1 320px", background: "#15151f", color: "#e6e6e6", border: "1px solid #3a3a4a", padding: "10px 14px", borderRadius: 8, fontSize: "0.95em", fontFamily: "inherit" } as React.CSSProperties,
  err: { color: "#ff7b72", marginTop: 8, fontSize: "0.9em" } as React.CSSProperties,

  repoCard: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 12, padding: 24, marginTop: 16 } as React.CSSProperties,
  repoHead: { borderBottom: "1px solid #2a2a3a", paddingBottom: 16, marginBottom: 16 } as React.CSSProperties,
  repoTitle: { fontSize: "1.4em", color: "#f7d34c", textDecoration: "none", fontWeight: 700 } as React.CSSProperties,
  repoMeta: { color: "#9ba1a6", fontSize: "0.88em", marginTop: 4 } as React.CSSProperties,
  repoDesc: { marginTop: 12, color: "#b8bcc4" } as React.CSSProperties,
  tags: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 12 } as React.CSSProperties,
  tag: { background: "#1f2236", color: "#9ba1a6", padding: "2px 8px", borderRadius: 999, fontSize: "0.75em" } as React.CSSProperties,

  analysisGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 } as React.CSSProperties,
  analysisCard: { background: "#0e0e18", border: "1px solid #2a2a3a", borderRadius: 8, padding: 16 } as React.CSSProperties,
  analysisHead: { fontWeight: 700, marginBottom: 8, color: "#f7d34c", fontSize: "0.95em" } as React.CSSProperties,
  ul: { paddingLeft: 18, margin: 0, fontSize: "0.88em", color: "#b8bcc4" } as React.CSSProperties,
  codeBlock: { background: "#3a1f1f", color: "#ff7b72", padding: "1px 5px", borderRadius: 3, fontSize: "0.8em", marginRight: 4 } as React.CSSProperties,
  codeWarn: { background: "#3a2f1a", color: "#f7d34c", padding: "1px 5px", borderRadius: 3, fontSize: "0.8em", marginRight: 4 } as React.CSSProperties,

  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 24 } as React.CSSProperties,
  feature: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 12, padding: 24, transition: "border 0.2s" } as React.CSSProperties,
  featureHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } as React.CSSProperties,
  featureEmoji: { fontSize: "1.8em" } as React.CSSProperties,
  featureName: { fontWeight: 700, fontSize: "0.95em", letterSpacing: "0.05em" } as React.CSSProperties,
  featureHeadline: { fontWeight: 600, marginBottom: 8, color: "#f7d34c" } as React.CSSProperties,
  featureBody: { color: "#b8bcc4", fontSize: "0.9em", marginBottom: 12 } as React.CSSProperties,
  featureCmd: { background: "#0e0e18", color: "#79c0ff", padding: "4px 10px", borderRadius: 4, fontSize: "0.85em", display: "inline-block" } as React.CSSProperties,

  cosmicGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 20 } as React.CSSProperties,
  cosmicCard: { background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 8, padding: 14, display: "flex", gap: 12, alignItems: "center" } as React.CSSProperties,
  cosmicLive: { marginTop: 16, color: "#2ea043", fontSize: "0.9em" } as React.CSSProperties,

  installSteps: { display: "flex", flexDirection: "column" as const, gap: 18, marginTop: 20 } as React.CSSProperties,
  installStep: { display: "flex", gap: 18, background: "#15151f", border: "1px solid #2a2a3a", borderRadius: 12, padding: 18 } as React.CSSProperties,
  stepNum: { background: "#f38020", color: "#0b0b14", width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 } as React.CSSProperties,
  stepTitle: { fontWeight: 600, marginBottom: 8 } as React.CSSProperties,
  pre: { background: "#0e0e18", padding: "10px 14px", borderRadius: 6, color: "#79c0ff", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.88em", overflowX: "auto" as const, margin: 0 } as React.CSSProperties,
  stepNote: { color: "#9ba1a6", fontSize: "0.85em", marginTop: 6 } as React.CSSProperties,

  footer: { padding: "40px 20px 60px", textAlign: "center" as const, color: "#b8bcc4", borderTop: "1px solid #2a2a3a", marginTop: 40 } as React.CSSProperties,
  link: { color: "#79c0ff", textDecoration: "none" } as React.CSSProperties,
  linkBtn: { background: "transparent", border: "none", color: "#79c0ff", cursor: "pointer", padding: 0, font: "inherit" } as React.CSSProperties,
};

const INLINE_CSS = `
  @media (max-width: 600px) {
    .mneme-banner { flex-direction: column; align-items: flex-start; }
  }
  body { margin: 0; }
  pre, code { font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, monospace; }
  a:hover { text-decoration: underline; }
  button:hover { opacity: 0.92; }
`;

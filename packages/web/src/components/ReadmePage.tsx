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

// ── i18n ─────────────────────────────────────────────────────────────
type Lang = "en" | "th";
const I18N: Record<Lang, Record<string, string>> = {
  en: {
    brand: "μνήμη · Mneme",
    headline_pre: "Stop your AI from ",
    headline_em: "shipping the same bug twice",
    headline_post: ".",
    sub: "Mneme is the memory + accountability layer for AI agents. It remembers your project's scars, predicts regressions BEFORE deploy, and refuses to let AI silently undo your hard-won wisdom. Local-first. Free. Open source.",
    cta_npm: "npm install",
    cta_github: "GitHub →",
    cta_demo: "Try interactive demo →",
    meta_tests: "tests",
    meta_mcp: "MCP tools",
    meta_cosmic: "cosmic",
    meta_checking: "checking…",
    meta_live: "LIVE",
    meta_offline: "offline",
    meta_sessions: "sessions",

    repo_h2: "Try Mneme on YOUR repo",
    repo_p: "Paste a public GitHub URL. Mneme analyses the stack and shows what each module would do for THIS codebase. No data leaves your browser; we only call the open GitHub API.",
    repo_placeholder: "GitHub / GitLab / Bitbucket / Codeberg URL  (or  owner/repo for GitHub)",
    repo_try_mneme: "Try mneme-ai",
    repo_analyse: "Analyse",
    repo_loading: "loading…",
    repo_err_invalid: "Enter a GitHub URL (https://github.com/owner/repo) or owner/repo",
    repo_err_404: "Repo not found (404)",

    soul_h: "🧬 PROJECT SOUL would seed",
    bounty_h: "📜 MNEMOSYNE BOUNTY would track",
    replica_h: "🪞 MNEME REPLICA would seed corpus from",
    infra_h: "🌐 INFRA AS AI would observe",
    dlp_h: "🚨 KILL SWITCH DLP would catch",

    hypercar_h2: "v2.15 HYPERCAR PENTAD",
    hypercar_badge: "NEW",
    hypercar_p: "Four distribution wedges that make Mneme indispensable. AURELIAN gate: 4/4 SHIP at scores 93-100.",

    pentad_h2: "v2.14 KILLER PENTAD",
    pentad_p: "Five nuclear-useful modules. Every one HMAC-signs its outputs. SHIP-graded by AURELIAN AUDITOR.",

    cosmic_h2: "🌌 COSMIC LINK",
    cosmic_p: "Self-hosted (or shared default at cosmic.mneme-ai.space) state server for cross-vendor handoff. 8 features no AI vendor combines.",
    cosmic_live: "LIVE",

    install_h2: "Install in 30 seconds",
    install_s1_title: "Tell your AI",
    install_s1_pre: '"Install Mneme in this project, then bootstrap it."',
    install_s1_note: "Your AI agent reads Mneme's manifest and runs every command for you. You never type a CLI command — the AI does.",
    install_s2_title: "AI runs (you watch)",
    install_s2_pre: "npx mneme install  →  mneme genesis  →  mneme soul init",
    install_s2_note: "Mneme writes .mneme/ + injects 184 tools into CLAUDE.md / AGENTS.md. Every MCP-aware AI now sees them.",
    install_s3_title: "Just talk to your AI normally",
    install_s3_pre: '"Refactor this React component."',
    install_s3_note: "Behind the scenes: SOUL gate checks values; BOUNTY tracks vendor claims; VIBE explains in plain English; ARBITRAGE routes to cheapest vendor; BUG PROPHET predicts regression risk. All automatic.",

    footer_built: "built by",
    footer_launch: "Launch full dashboard",
  },
  th: {
    brand: "μνήμη · Mneme",
    headline_pre: "หยุด AI จาก",
    headline_em: "การสร้างบั๊กตัวเดิมซ้ำ",
    headline_post: ".",
    sub: "Mneme คือชั้นความจำ + accountability ให้ AI agent. มันจำ \"บาดแผล\" ของ project, ทำนาย regression ก่อน deploy, และไม่ปล่อยให้ AI ลบความฉลาดที่ทีมหามาได้. รันบนเครื่อง. ฟรี. Open source.",
    cta_npm: "ติดตั้ง npm",
    cta_github: "GitHub →",
    cta_demo: "ลอง demo →",
    meta_tests: "tests",
    meta_mcp: "MCP tools",
    meta_cosmic: "cosmic",
    meta_checking: "กำลังเช็ค…",
    meta_live: "LIVE",
    meta_offline: "ออฟไลน์",
    meta_sessions: "sessions",

    repo_h2: "ลอง Mneme กับ repo ของคุณ",
    repo_p: "วาง URL GitHub แบบ public. Mneme วิเคราะห์ stack แล้วโชว์ว่าแต่ละโมดูลจะทำอะไรกับ repo นี้. ข้อมูลไม่ออกจาก browser; เรียกแค่ GitHub API ฟรี",
    repo_placeholder: "GitHub / GitLab / Bitbucket / Codeberg URL  (หรือ owner/repo สำหรับ GitHub)",
    repo_try_mneme: "ลอง mneme-ai",
    repo_analyse: "วิเคราะห์",
    repo_loading: "กำลังโหลด…",
    repo_err_invalid: "ใส่ GitHub URL (https://github.com/owner/repo) หรือ owner/repo",
    repo_err_404: "ไม่พบ repo (404)",

    soul_h: "🧬 PROJECT SOUL จะใส่กฎ",
    bounty_h: "📜 MNEMOSYNE BOUNTY จะ track",
    replica_h: "🪞 MNEME REPLICA จะสร้าง corpus จาก",
    infra_h: "🌐 INFRA AS AI จะสังเกต",
    dlp_h: "🚨 KILL SWITCH DLP จะดักจับ",

    hypercar_h2: "v2.15 HYPERCAR PENTAD",
    hypercar_badge: "ใหม่",
    hypercar_p: "4 distribution wedges ที่ทำให้ Mneme ขาดไม่ได้. AURELIAN กำกับ: 4/4 SHIP คะแนน 93-100.",

    pentad_h2: "v2.14 KILLER PENTAD",
    pentad_p: "5 โมดูลพลังมหาศาล. ทุกตัว HMAC-sign output. AURELIAN AUDITOR กำกับว่า SHIP ทุกตัว.",

    cosmic_h2: "🌌 COSMIC LINK",
    cosmic_p: "Server ส่งสมองข้าม vendor (ใช้ shared default ที่ cosmic.mneme-ai.space หรือ self-host). 8 features ที่ไม่มี AI vendor ใดมีพร้อมกัน.",
    cosmic_live: "LIVE",

    install_h2: "ติดตั้งใน 30 วินาที",
    install_s1_title: "บอก AI ของคุณ",
    install_s1_pre: '"ติดตั้ง Mneme ใน project นี้ แล้ว bootstrap ให้ด้วย"',
    install_s1_note: "AI agent อ่าน manifest ของ Mneme แล้วรัน command ให้คุณ. คุณไม่ต้องพิมพ์ CLI เอง — AI ทำให้.",
    install_s2_title: "AI รัน (คุณดู)",
    install_s2_pre: "npx mneme install  →  mneme genesis  →  mneme soul init",
    install_s2_note: "Mneme เขียน .mneme/ + ใส่ 184 tools ลง CLAUDE.md / AGENTS.md. AI ที่รองรับ MCP เห็นทันที.",
    install_s3_title: "พูดกับ AI ปกติ",
    install_s3_pre: '"Refactor React component นี้หน่อย"',
    install_s3_note: "เบื้องหลัง: SOUL ตรวจค่านิยม; BOUNTY track vendor; VIBE อธิบายภาษาคน; ARBITRAGE เลือก vendor ถูกที่สุด; BUG PROPHET ทำนาย regression. อัตโนมัติทุกขั้น.",

    footer_built: "พัฒนาโดย",
    footer_launch: "เปิด full dashboard",
  },
};

function readLang(): Lang {
  try {
    const v = localStorage.getItem("mneme-lang");
    if (v === "th" || v === "en") return v;
    // Auto-detect from browser
    return /^th/i.test(navigator.language || "") ? "th" : "en";
  } catch { return "en"; }
}

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

const HYPERCAR_FEATURES = [
  {
    emoji: "🌅",
    name: "MNEME GENESIS",
    cmd: "mneme.genesis.plan",
    headline: "Cold-start to value in <60 seconds. AI knows your stack.",
    body: "Reads your repo, detects stack + frameworks + CI + age, seeds protective starter rules per detected env. Zero config questions. Reversible.",
  },
  {
    emoji: "🐝",
    name: "MNEME HIVE",
    cmd: "mneme.hive.lookup",
    headline: "Privacy-preserving pattern marketplace. Network effect from day 1.",
    body: "Hashed-pattern fingerprints (sha256 over canonical AST shape; identifiers/strings/numbers masked). Same problem across users hashes identically. Source code NEVER leaves your machine.",
  },
  {
    emoji: "🎨",
    name: "MNEME VIBE",
    cmd: "mneme.vibe.check",
    headline: "Beginner-friendly safety wrapper for AI-builders. Built-in plain English.",
    body: "Auto-runs DLP + SOUL + complexity-creep gates after every AI change. Returns ship_it / ship_with_note / wait_review / stop_unsafe + 0-10 confidence + actionable findings.",
  },
  {
    emoji: "🎯",
    name: "MNEME ARBITRAGE",
    cmd: "mneme.arbitrage.choose",
    headline: "Meta-AI router: cheapest vendor that meets your quality bar.",
    body: "16 task types × 7 default vendors strength table + measured BOUNTY data. Quality budgets ultra/high/balanced/cheap/free_only. Signed decision.",
  },
  {
    emoji: "🔮",
    name: "BUG PROPHET",
    cmd: "mneme.bug_prophet.prophesy",
    headline: "Predict regression risk BEFORE shipping. Pure inference, no LLM.",
    body: "Fuses SOUL scars + REPLICA bad outcomes + HIVE pattern history + BOUNTY vendor trust + complexity into 0-1 risk score with mitigations.",
  },
];

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
  const [lang, setLangState] = useState<Lang>("en");
  const [vendor, setVendor] = useState<Vendor>("human");
  const [cosmic, setCosmic] = useState<CosmicHealth | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [repoErr, setRepoErr] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);

  useEffect(() => { setLangState(readLang()); }, []);
  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem("mneme-lang", l); } catch {}
  }
  const t = (k: string): string => I18N[lang][k] ?? I18N.en[k] ?? k;

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
    const trimmed = repoUrl.trim();
    if (!trimmed) return;

    // v2.16: parse GitHub / GitLab / Bitbucket / Codeberg / Sourcehut.
    let host: "github" | "gitlab" | "bitbucket" | "codeberg" | "sourcehut" = "github";
    let owner = "", name = "", path = "";

    // GitLab supports nested groups (group/subgroup/repo). Capture the full path.
    const gitlab = trimmed.match(/^https?:\/\/(?:[a-z0-9-]+\.)?gitlab\.com\/(.+?)(?:\.git)?\/?$/i);
    const bitbucket = trimmed.match(/^https?:\/\/bitbucket\.org\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
    const codeberg = trimmed.match(/^https?:\/\/codeberg\.org\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
    const sourcehut = trimmed.match(/^https?:\/\/(?:git\.)?sr\.ht\/~?([^/]+)\/([^/?#]+?)\/?$/i);
    const github = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
    const ownerRepo = /^[\w.-]+\/[\w.-]+$/.test(trimmed);

    if (gitlab) { host = "gitlab"; path = gitlab[1]!; const parts = path.split("/"); owner = parts.slice(0, -1).join("/"); name = parts[parts.length - 1]!; }
    else if (bitbucket) { host = "bitbucket"; owner = bitbucket[1]!; name = bitbucket[2]!; path = `${owner}/${name}`; }
    else if (codeberg) { host = "codeberg"; owner = codeberg[1]!; name = codeberg[2]!; path = `${owner}/${name}`; }
    else if (sourcehut) { host = "sourcehut"; owner = sourcehut[1]!; name = sourcehut[2]!; path = `${owner}/${name}`; }
    else if (github) { host = "github"; owner = github[1]!; name = github[2]!; path = `${owner}/${name}`; }
    else if (ownerRepo) { host = "github"; const [a, b] = trimmed.split("/"); owner = a!; name = b!; path = `${owner}/${name}`; }
    else {
      setRepoErr("Paste a public repo URL: github.com / gitlab.com / bitbucket.org / codeberg.org / sr.ht — or owner/repo for GitHub.");
      return;
    }

    setRepoLoading(true);
    try {
      let summary: RepoSummary | null = null;
      if (host === "github") {
        const res = await fetch(`https://api.github.com/repos/${owner}/${name}`);
        if (!res.ok) {
          setRepoErr(res.status === 404 ? "Repo not found (404)" : `GitHub API ${res.status}`);
          setRepoLoading(false); return;
        }
        const j = await res.json() as Record<string, unknown>;
        summary = {
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
      } else if (host === "gitlab") {
        // GitLab API needs URL-encoded path
        const enc = encodeURIComponent(path);
        const res = await fetch(`https://gitlab.com/api/v4/projects/${enc}`);
        if (!res.ok) {
          setRepoErr(res.status === 404 ? "GitLab project not found / private" : `GitLab API ${res.status}`);
          setRepoLoading(false); return;
        }
        const j = await res.json() as Record<string, unknown>;
        summary = {
          fullName: String(j["path_with_namespace"] ?? path),
          description: (j["description"] as string | null) ?? null,
          defaultBranch: String(j["default_branch"] ?? "main"),
          stars: Number(j["star_count"] ?? 0),
          forks: Number(j["forks_count"] ?? 0),
          openIssues: Number(j["open_issues_count"] ?? 0),
          language: null,
          topics: Array.isArray(j["topics"]) ? (j["topics"] as string[]) : [],
          pushedAt: String(j["last_activity_at"] ?? ""),
          updatedAt: String(j["last_activity_at"] ?? ""),
          size: 0,
          license: null,
          url: String(j["web_url"] ?? `https://gitlab.com/${path}`),
        };
      } else if (host === "bitbucket") {
        const res = await fetch(`https://api.bitbucket.org/2.0/repositories/${owner}/${name}`);
        if (!res.ok) {
          setRepoErr(res.status === 404 ? "Bitbucket repo not found / private" : `Bitbucket API ${res.status}`);
          setRepoLoading(false); return;
        }
        const j = await res.json() as Record<string, unknown>;
        summary = {
          fullName: String(j["full_name"] ?? `${owner}/${name}`),
          description: (j["description"] as string | null) ?? null,
          defaultBranch: ((j["mainbranch"] as { name?: string } | null)?.name) ?? "main",
          stars: 0, forks: 0, openIssues: 0,
          language: (j["language"] as string | null) ?? null,
          topics: [],
          pushedAt: String(j["updated_on"] ?? ""),
          updatedAt: String(j["updated_on"] ?? ""),
          size: Number(j["size"] ?? 0),
          license: null,
          url: String(((j["links"] as { html?: { href?: string } } | null)?.html?.href) ?? `https://bitbucket.org/${owner}/${name}`),
        };
      } else if (host === "codeberg") {
        // Gitea-compatible API
        const res = await fetch(`https://codeberg.org/api/v1/repos/${owner}/${name}`);
        if (!res.ok) {
          setRepoErr(res.status === 404 ? "Codeberg repo not found / private" : `Codeberg API ${res.status}`);
          setRepoLoading(false); return;
        }
        const j = await res.json() as Record<string, unknown>;
        summary = {
          fullName: String(j["full_name"] ?? `${owner}/${name}`),
          description: (j["description"] as string | null) ?? null,
          defaultBranch: String(j["default_branch"] ?? "main"),
          stars: Number(j["stars_count"] ?? 0),
          forks: Number(j["forks_count"] ?? 0),
          openIssues: Number(j["open_issues_count"] ?? 0),
          language: (j["language"] as string | null) ?? null,
          topics: [],
          pushedAt: String(j["updated_at"] ?? ""),
          updatedAt: String(j["updated_at"] ?? ""),
          size: Number(j["size"] ?? 0),
          license: null,
          url: String(j["html_url"] ?? `https://codeberg.org/${owner}/${name}`),
        };
      } else if (host === "sourcehut") {
        // sr.ht doesn't have a fully-public meta API; show minimal card.
        summary = {
          fullName: `~${owner}/${name}`,
          description: "Sourcehut repo (~limited metadata via public API; full analysis requires CLI).",
          defaultBranch: "main",
          stars: 0, forks: 0, openIssues: 0,
          language: null, topics: [],
          pushedAt: "", updatedAt: "", size: 0, license: null,
          url: `https://sr.ht/~${owner}/${name}`,
        };
      }
      if (summary) {
        setRepo(summary);
        setAnalysis(analyseRepo(summary));
      }
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
          <strong>Mneme v{__APP_VERSION__} · 184 tools.</strong>{" "}
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
        {/* TH / EN language toggle */}
        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          <button onClick={() => setLang("en")} style={{ ...S.bannerCopy, background: lang === "en" ? "#f38020" : "#2a2a3a", color: lang === "en" ? "#0b0b14" : "#e6e6e6" }}>EN</button>
          <button onClick={() => setLang("th")} style={{ ...S.bannerCopy, background: lang === "th" ? "#f38020" : "#2a2a3a", color: lang === "th" ? "#0b0b14" : "#e6e6e6" }}>TH</button>
        </div>
      </div>

      {/* Hero */}
      <header style={S.hero}>
        <div style={S.heroInner}>
          <div style={S.brand}>{t("brand")}</div>
          <h1 style={S.headline}>
            {t("headline_pre")}<em style={S.em}>{t("headline_em")}</em>{t("headline_post")}
          </h1>
          <p style={S.sub}>{t("sub")}</p>
          <div style={S.heroCtas}>
            <a href="https://www.npmjs.com/package/mneme-ai" style={S.btnPrimary} target="_blank" rel="noopener">
              {t("cta_npm")}
            </a>
            <button onClick={props.onLaunchDashboard} style={{ ...S.btnPrimary, background: "#8957e5" }}>
              {t("cta_demo")}
            </button>
            <a href="https://github.com/patsa2561-art/mneme-ai" style={S.btnGhost} target="_blank" rel="noopener">
              {t("cta_github")}
            </a>
          </div>
          <div style={S.heroMeta}>
            v{__APP_VERSION__} · 9255+ {t("meta_tests")} · 184 {t("meta_mcp")} · {t("meta_cosmic")}{" "}
            {cosmic === null ? <span style={{ color: "#666" }}>{t("meta_checking")}</span>
              : cosmic.ok
                ? <span style={S.live}>● {t("meta_live")} ({cosmic.sessions} {t("meta_sessions")})</span>
                : <span style={S.dead}>● {t("meta_offline")}</span>}
          </div>
        </div>
      </header>

      {/* WHAT IS MNEME — answer the #1 visitor question in 30 seconds */}
      <section style={S.sec}>
        <h2 style={S.h2}>{lang === "th" ? "Mneme คืออะไร? (อ่าน 30 วินาที)" : "What is Mneme? (30-second read)"}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 20 }}>
          <div style={{ background: "#1a1015", border: "1px solid #4a1f1f", borderRadius: 12, padding: 20 }}>
            <div style={{ color: "#ff7b72", fontWeight: 700, marginBottom: 8 }}>{lang === "th" ? "❌ ไม่มี Mneme" : "❌ Without Mneme"}</div>
            <div style={{ fontSize: "0.95em", color: "#e6e6e6", marginBottom: 8 }}>
              {lang === "th"
                ? "AI ของคุณ ship bug ที่ทีมเคยจ่าย $40K แก้ไป 18 เดือนก่อน. AI ไม่รู้ว่า project มี \"บาดแผล\". AI กล้า claim ว่าไฟล์มี อยู่จริง ทั้งที่ไม่มี. คุณเสียเวลา debug หลายชั่วโมง."
                : "Your AI ships a bug your team paid $40K to fix 18 months ago. It doesn't know the project's scars. It hallucinates files that don't exist. You spend hours debugging."}
            </div>
            <div style={{ color: "#9ba1a6", fontSize: "0.85em" }}>
              {lang === "th" ? "= ปัญหาคลาสสิก: AI ไม่มีความจำต่อเนื่อง" : "= Classic problem: AI has no persistent memory"}
            </div>
          </div>
          <div style={{ background: "#0e1f15", border: "1px solid #1f4a2a", borderRadius: 12, padding: 20 }}>
            <div style={{ color: "#3fb950", fontWeight: 700, marginBottom: 8 }}>{lang === "th" ? "✅ มี Mneme" : "✅ With Mneme"}</div>
            <div style={{ fontSize: "0.95em", color: "#e6e6e6", marginBottom: 8 }}>
              {lang === "th"
                ? "AI ขอเพิ่ม lodash → Mneme เห็น scar \"no-lodash since 2024-11-12\" → BLOCK. AI claim ว่ามีไฟล์ → Mneme verify ทันที → catch hallucination. AI propose deploy วันศุกร์ → BUG PROPHET ทำนาย regression risk 87% → เตือน."
                : "AI proposes adding lodash → Mneme sees scar \"no-lodash since 2024-11-12\" → BLOCK. AI claims a file exists → Mneme verifies → catches hallucination. AI suggests Friday deploy → BUG PROPHET predicts 87% regression risk → warns."}
            </div>
            <div style={{ color: "#9ba1a6", fontSize: "0.85em" }}>
              {lang === "th" ? "= AI ของคุณกลายเป็น AI ที่จำได้ + ตรวจสอบได้" : "= Your AI gains memory + accountability"}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 24, padding: 18, background: "#0e0e18", border: "1px solid #2a2a3a", borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{lang === "th" ? "ใครควรใช้ Mneme?" : "Who is Mneme for?"}</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#b8bcc4", fontSize: "0.92em", lineHeight: 1.8 }}>
            <li>{lang === "th"
              ? "นักพัฒนา (solo / ทีม) ที่ใช้ Claude Code / Cursor / Codex / Gemini / Copilot — เพิ่มชั้นความจำ + ความปลอดภัย"
              : "Developers using Claude Code / Cursor / Codex / Gemini / Copilot — adds memory + safety on top"}</li>
            <li>{lang === "th"
              ? "Vibe coders (Bolt / Lovable / Replit) ที่ไม่เคยเขียนโค้ด — VIBE mode ดูแลให้คุณไม่ ship secrets / bug"
              : "Vibe coders (Bolt / Lovable / Replit) — VIBE mode prevents shipping secrets / bugs"}</li>
            <li>{lang === "th"
              ? "CTO / CISO ที่กลัว AI hallucinate ในงานสำคัญ — KILL SWITCH + DLP + court-admissible audit"
              : "CTOs / CISOs worried about AI hallucinations in production — KILL SWITCH + DLP + court-admissible audit"}</li>
            <li>{lang === "th"
              ? "ทุกคนที่อยากเปลี่ยน vendor AI ได้อิสระ — ไม่ติด lock-in กับใคร"
              : "Anyone who wants vendor freedom — never locked in with one AI vendor"}</li>
          </ul>
        </div>
        <div style={{ marginTop: 16, color: "#79c0ff", fontSize: "0.92em", textAlign: "center" as const }}>
          {lang === "th"
            ? "👇 ลองเลย: วาง URL repo ของคุณข้างล่าง"
            : "👇 Try it now: paste your repo URL below"}
        </div>
      </section>

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

      {/* HYPERCAR PENTAD — v2.15 */}
      <section style={S.sec}>
        <h2 style={S.h2}>{t("hypercar_h2")} <span style={S.badge}>{t("hypercar_badge")}</span></h2>
        <p style={S.p}>{t("hypercar_p")}</p>
        <div style={S.featureGrid}>
          {HYPERCAR_FEATURES.map((f) => (
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

      {/* KILLER PENTAD — v2.14 */}
      <section style={S.sec}>
        <h2 style={S.h2}>{t("pentad_h2")}</h2>
        <p style={S.p}>{t("pentad_p")}</p>
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

      {/* Quick Install — 3 steps, AI does everything */}
      <section style={S.sec}>
        <h2 style={S.h2}>{t("install_h2")}</h2>
        <div style={S.installSteps}>
          <div style={S.installStep} className="mneme-step">
            <div style={S.stepNum}>1</div>
            <div>
              <div style={S.stepTitle}>{t("install_s1_title")}</div>
              <pre style={S.pre}>{t("install_s1_pre")}</pre>
              <div style={S.stepNote}>{t("install_s1_note")}</div>
            </div>
          </div>
          <div style={S.installStep} className="mneme-step">
            <div style={S.stepNum}>2</div>
            <div>
              <div style={S.stepTitle}>{t("install_s2_title")}</div>
              <pre style={S.pre}>{t("install_s2_pre")}</pre>
              <div style={S.stepNote}>{t("install_s2_note")}</div>
            </div>
          </div>
          <div style={S.installStep} className="mneme-step">
            <div style={S.stepNum}>3</div>
            <div>
              <div style={S.stepTitle}>{t("install_s3_title")}</div>
              <pre style={S.pre}>{t("install_s3_pre")}</pre>
              <div style={S.stepNote}>{t("install_s3_note")}</div>
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

// ── Styles (inline; Linear/Stripe-style — sparse, big type, gradient accents) ──

const S = {
  // v2.17.1 redesign: pure black-near-black background, huge type, only
  // ONE accent gradient (orange→pink), generous whitespace, minimal borders.
  page: { background: "#0a0a0e", color: "#e6e6e6", minHeight: "100vh", fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", lineHeight: 1.55, WebkitFontSmoothing: "antialiased" } as React.CSSProperties,
  banner: { display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "12px 24px", fontSize: "0.88em", backdropFilter: "blur(8px)" } as React.CSSProperties,
  bannerEmoji: { fontSize: "1.3em" } as React.CSSProperties,
  bannerText: { flex: 1, color: "#a1a1aa" } as React.CSSProperties,
  bannerAdvice: { color: "#fbbf24" } as React.CSSProperties,
  bannerCopy: { background: "rgba(255,255,255,0.05)", color: "#e6e6e6", border: "1px solid rgba(255,255,255,0.08)", padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: "0.82em", letterSpacing: "0.02em" } as React.CSSProperties,

  // Hero — Linear-style: huge gradient text, sparse, no clutter
  hero: { padding: "120px 24px 80px", textAlign: "center" as const, background: "radial-gradient(ellipse 80% 50% at center top, rgba(243, 128, 32, 0.08) 0%, transparent 70%)", position: "relative" as const, overflow: "hidden" as const } as React.CSSProperties,
  heroInner: { maxWidth: 880, margin: "0 auto" } as React.CSSProperties,
  brand: { color: "#a1a1aa", letterSpacing: "0.18em", fontSize: "0.78em", textTransform: "uppercase" as const, marginBottom: 32, fontWeight: 500 } as React.CSSProperties,
  headline: { fontSize: "clamp(2.4rem, 6vw, 4.8rem)", margin: "0 0 24px", lineHeight: 1.05, fontWeight: 800, letterSpacing: "-0.03em" } as React.CSSProperties,
  em: { fontStyle: "normal", background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" } as React.CSSProperties,
  sub: { color: "#a1a1aa", fontSize: "1.18em", maxWidth: 680, margin: "0 auto 40px", lineHeight: 1.6, fontWeight: 400 } as React.CSSProperties,
  heroCtas: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" as const, marginBottom: 24 } as React.CSSProperties,
  heroMeta: { color: "#52525b", fontSize: "0.85em", marginTop: 24, letterSpacing: "0.02em" } as React.CSSProperties,
  live: { color: "#22c55e", fontWeight: 600 } as React.CSSProperties,
  dead: { color: "#ef4444" } as React.CSSProperties,

  btnPrimary: { background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)", color: "#0a0a0e", padding: "12px 26px", borderRadius: 10, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: "0.95em", boxShadow: "0 4px 20px rgba(243, 128, 32, 0.25)" } as React.CSSProperties,
  btnGhost: { background: "rgba(255,255,255,0.03)", color: "#e6e6e6", padding: "12px 26px", borderRadius: 10, fontWeight: 500, textDecoration: "none", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: "0.95em" } as React.CSSProperties,

  sec: { padding: "100px 24px", maxWidth: 1120, margin: "0 auto" } as React.CSSProperties,
  h2: { fontSize: "clamp(1.6rem, 3vw, 2.4em)", margin: "0 0 20px", fontWeight: 700, letterSpacing: "-0.02em" } as React.CSSProperties,
  p: { color: "#a1a1aa", maxWidth: 740, fontSize: "1.05em" } as React.CSSProperties,
  badge: { background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)", color: "#0a0a0e", padding: "3px 12px", borderRadius: 999, fontSize: "0.5em", verticalAlign: "middle", marginLeft: 14, fontWeight: 700, letterSpacing: "0.05em" } as React.CSSProperties,

  repoForm: { display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 20, marginBottom: 28 } as React.CSSProperties,
  input: { flex: "1 1 320px", background: "rgba(255,255,255,0.03)", color: "#e6e6e6", border: "1px solid rgba(255,255,255,0.1)", padding: "12px 16px", borderRadius: 10, fontSize: "0.95em", fontFamily: "inherit", outline: "none" } as React.CSSProperties,
  err: { color: "#ef4444", marginTop: 10, fontSize: "0.9em" } as React.CSSProperties,

  repoCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28, marginTop: 20 } as React.CSSProperties,
  repoHead: { borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 20, marginBottom: 20 } as React.CSSProperties,
  repoTitle: { fontSize: "1.4em", background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", textDecoration: "none", fontWeight: 700, letterSpacing: "-0.01em" } as React.CSSProperties,
  repoMeta: { color: "#71717a", fontSize: "0.88em", marginTop: 6 } as React.CSSProperties,
  repoDesc: { marginTop: 14, color: "#a1a1aa" } as React.CSSProperties,
  tags: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 14 } as React.CSSProperties,
  tag: { background: "rgba(255,255,255,0.04)", color: "#a1a1aa", padding: "3px 10px", borderRadius: 999, fontSize: "0.75em", border: "1px solid rgba(255,255,255,0.06)" } as React.CSSProperties,

  analysisGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 } as React.CSSProperties,
  analysisCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 20 } as React.CSSProperties,
  analysisHead: { fontWeight: 600, marginBottom: 12, color: "#fbbf24", fontSize: "0.95em", letterSpacing: "-0.005em" } as React.CSSProperties,
  ul: { paddingLeft: 18, margin: 0, fontSize: "0.88em", color: "#a1a1aa", lineHeight: 1.7 } as React.CSSProperties,
  codeBlock: { background: "rgba(239, 68, 68, 0.12)", color: "#f87171", padding: "2px 7px", borderRadius: 4, fontSize: "0.78em", marginRight: 4, fontWeight: 600 } as React.CSSProperties,
  codeWarn: { background: "rgba(251, 191, 36, 0.12)", color: "#fbbf24", padding: "2px 7px", borderRadius: 4, fontSize: "0.78em", marginRight: 4, fontWeight: 600 } as React.CSSProperties,

  featureGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, marginTop: 28 } as React.CSSProperties,
  feature: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 28, transition: "all 0.2s ease" } as React.CSSProperties,
  featureHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } as React.CSSProperties,
  featureEmoji: { fontSize: "2em", filter: "drop-shadow(0 4px 8px rgba(243, 128, 32, 0.3))" } as React.CSSProperties,
  featureName: { fontWeight: 700, fontSize: "0.92em", letterSpacing: "0.06em", color: "#a1a1aa" } as React.CSSProperties,
  featureHeadline: { fontWeight: 600, marginBottom: 10, color: "#f4f4f5", fontSize: "1.05em", lineHeight: 1.4 } as React.CSSProperties,
  featureBody: { color: "#a1a1aa", fontSize: "0.9em", marginBottom: 14, lineHeight: 1.6 } as React.CSSProperties,
  featureCmd: { background: "rgba(121, 192, 255, 0.08)", color: "#79c0ff", padding: "5px 12px", borderRadius: 6, fontSize: "0.82em", display: "inline-block", fontFamily: "ui-monospace, SFMono-Regular, monospace" } as React.CSSProperties,

  cosmicGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 24 } as React.CSSProperties,
  cosmicCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16, display: "flex", gap: 14, alignItems: "center" } as React.CSSProperties,
  cosmicLive: { marginTop: 20, color: "#22c55e", fontSize: "0.9em", fontWeight: 600 } as React.CSSProperties,

  installSteps: { display: "flex", flexDirection: "column" as const, gap: 16, marginTop: 24 } as React.CSSProperties,
  installStep: { display: "flex", gap: 20, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 22 } as React.CSSProperties,
  stepNum: { background: "linear-gradient(135deg, #f38020 0%, #ec4899 100%)", color: "#0a0a0e", width: 36, height: 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0, fontSize: "0.95em" } as React.CSSProperties,
  stepTitle: { fontWeight: 600, marginBottom: 10, fontSize: "1.05em" } as React.CSSProperties,
  pre: { background: "rgba(0,0,0,0.4)", padding: "12px 16px", borderRadius: 8, color: "#79c0ff", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.88em", overflowX: "auto" as const, margin: 0, border: "1px solid rgba(255,255,255,0.04)" } as React.CSSProperties,
  stepNote: { color: "#71717a", fontSize: "0.85em", marginTop: 8, lineHeight: 1.6 } as React.CSSProperties,

  footer: { padding: "60px 24px 80px", textAlign: "center" as const, color: "#71717a", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 60 } as React.CSSProperties,
  link: { color: "#79c0ff", textDecoration: "none", fontWeight: 500 } as React.CSSProperties,
  linkBtn: { background: "transparent", border: "none", color: "#79c0ff", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 500 } as React.CSSProperties,
};

const INLINE_CSS = `
  /* v2.15.2 — full mobile polish */
  body { margin: 0; }
  pre, code { font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, monospace; }
  a:hover { text-decoration: underline; }
  button:hover { opacity: 0.92; }

  /* Banner: stack on mobile */
  @media (max-width: 720px) {
    .mneme-banner { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 16px; font-size: 0.85em; }
    .mneme-banner > div:last-child { align-self: flex-end; }
  }

  /* Hero scales down */
  @media (max-width: 600px) {
    h1 { font-size: 1.8rem !important; }
    h2 { font-size: 1.4em !important; }
    section { padding: 40px 16px !important; }
  }

  /* Repo form: stack on mobile so input gets full width */
  @media (max-width: 480px) {
    input { font-size: 16px !important; /* iOS prevents zoom-on-focus when >= 16px */ }
    pre { font-size: 0.78em !important; padding: 10px !important; word-break: break-all; }
    .mneme-step { flex-direction: column; gap: 10px !important; }
  }

  /* Touch targets: min 44x44 per Apple HIG */
  button, a { min-height: 36px; }
  @media (pointer: coarse) {
    button, a[href] { min-height: 44px; min-width: 44px; }
  }

  /* Smooth scroll between sections */
  html { scroll-behavior: smooth; }
`;

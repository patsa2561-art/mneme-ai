/**
 * HTML renderer for `mneme passport` and `mneme nervous-system`.
 *
 * Self-contained — no external CSS, no external fonts, no JS.  All styling
 * is inline so the file can be opened anywhere (browser, email preview,
 * archived as an artefact) and a CTO can print it to PDF without a tool.
 *
 * Design language:
 *   - Mneme purple #7c3aed accents, knowledge greens #059669, atrophy reds.
 *   - System-font stack, monospace = JetBrains Mono / Fira Code fallback.
 *   - CSS Grid; A4 page-aware (`@page`, `page-break-before` on sections).
 *   - Inline SVG only for charts (matrix heatmaps + sparklines + bars).
 *   - Information-density: every metric carries (a) raw number, (b) plain
 *     English, (c) where relevant the team baseline / delta.
 *
 * Both renderers return a complete HTML document string.  No I/O.
 */

import type { PassportData, VoicePhrase, PassportExpertiseFile } from "./passport.js";
import type { NervousSystemData, BrainLobe, AlphaSlot, CriticalFileSlot } from "./nervous-system.js";
import type { TelepathyPair } from "./telepathy.js";

// ─── public API ───────────────────────────────────────────────────────

export function renderPassportHtml(data: PassportData): string {
  const css = SHARED_CSS;
  const title = `Passport · ${escape(data.identity.name || data.identity.email)}`;
  const generated = formatDateTime(data.meta.generatedAt);

  const body =
    renderHeaderRibbon(title, data.meta.repoName, generated, "passport") +
    renderPrivacyStripe() +
    renderPassportCover(data) +
    renderPassportDna(data) +
    renderPassportExpertise(data) +
    renderPassportTelepathy(data) +
    renderPassportInfluence(data) +
    renderPassportPromises(data) +
    renderPassportFading(data) +
    renderPassportVoice(data) +
    (data.friction ? renderPassportFriction(data) : "") +
    renderLimits(data.limits, "Passport — honest limits") +
    renderFooter(generated);

  return wrapDocument(title, css, body);
}

export function renderNervousSystemHtml(data: NervousSystemData): string {
  const css = SHARED_CSS;
  const title = `The Nervous System of ${escape(data.meta.repoName)}`;
  const generated = formatDateTime(data.meta.generatedAt);

  const sections: string[] = [];
  sections.push(renderHeaderRibbon(title, data.meta.repoName, generated, "nervous-system"));
  sections.push(renderPrivacyStripe());
  sections.push(renderNervousCover(data));
  sections.push(renderNervousAlphas(data));
  sections.push(renderNervousTelepathyHeatmap(data));
  sections.push(renderNervousAtrophy(data));
  sections.push(renderNervousLobes(data));
  sections.push(renderNervousPromises(data));
  sections.push(renderNervousSurprising(data));
  for (const passport of data.passports) {
    sections.push(renderMiniPassport(passport));
  }
  sections.push(renderLimits(data.limits, "Nervous System — honest limits"));
  sections.push(renderFooter(generated));

  return wrapDocument(title, css, sections.join("\n"));
}

// ─── document scaffolding ─────────────────────────────────────────────

function wrapDocument(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="Mneme — μνήμη, the memory layer of your codebase" />
<title>${escape(title)}</title>
<style>${css}</style>
</head>
<body>
<main class="report">
${body}
</main>
</body>
</html>`;
}

// ─── shared CSS ───────────────────────────────────────────────────────
// Single source of truth; both reports inherit.  Keep all values literal —
// no CSS variables in hot-path selectors so older PDF engines don't choke.

const SHARED_CSS = `
@page { size: A4; margin: 18mm 16mm; }
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Roboto",
               "Helvetica Neue", Arial, sans-serif;
  font-size: 11.5pt;
  line-height: 1.45;
  color: #1f2937;
  background: #fafaf9;
}
.report { max-width: 820px; margin: 0 auto; padding: 18mm 16mm 24mm 16mm; }
@media print {
  .report { max-width: none; padding: 0; }
  body { background: #ffffff; }
}

/* Top ribbon (every page in print) */
.ribbon {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 14px 0;
  border-bottom: 1.5px solid #7c3aed;
  margin-bottom: 18px;
}
.ribbon .brand {
  font-family: "Iowan Old Style", "Palatino Linotype", "Cambria", Georgia, serif;
  font-style: italic;
  font-size: 18pt;
  letter-spacing: -0.01em;
  color: #5b21b6;
}
.ribbon .title {
  font-weight: 700;
  font-size: 13pt;
  color: #111827;
  letter-spacing: -0.01em;
}
.ribbon .meta {
  font-size: 9pt;
  color: #6b7280;
  text-align: right;
}

.privacy-stripe {
  background: #f5f3ff;
  border-left: 3px solid #7c3aed;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 10pt;
  color: #4c1d95;
  margin-bottom: 22px;
}

section {
  margin: 28px 0 18px 0;
  page-break-inside: avoid;
}
section.page-break {
  page-break-before: always;
  margin-top: 0;
}
section h2 {
  margin: 0 0 6px 0;
  font-size: 16pt;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: #1f2937;
}
section h2 .num {
  display: inline-block;
  font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", monospace;
  font-size: 10pt;
  background: #ede9fe;
  color: #6d28d9;
  padding: 2px 7px;
  border-radius: 4px;
  margin-right: 8px;
  vertical-align: 2px;
}
section h3 {
  margin: 18px 0 6px 0;
  font-size: 11.5pt;
  font-weight: 600;
  color: #374151;
  letter-spacing: -0.005em;
}
section .lead {
  margin: 4px 0 12px 0;
  color: #4b5563;
  font-size: 10.5pt;
}
section .plain {
  font-size: 10pt;
  color: #6b7280;
  font-style: italic;
}

/* Cover hero */
.hero {
  background: linear-gradient(135deg, #faf5ff 0%, #ecfdf5 100%);
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  padding: 22px 24px;
  margin-bottom: 26px;
  page-break-after: avoid;
}
.hero h1 {
  margin: 0 0 6px 0;
  font-size: 22pt;
  letter-spacing: -0.025em;
  color: #1f2937;
}
.hero .subtitle {
  font-size: 11pt;
  color: #4c1d95;
  margin: 0 0 14px 0;
}
.hero .metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-top: 12px;
}
.hero .metric {
  background: rgba(255,255,255,0.7);
  border-radius: 6px;
  padding: 12px;
  border: 1px solid #e5e7eb;
}
.hero .metric .label {
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6d28d9;
  font-weight: 700;
}
.hero .metric .value {
  font-size: 16pt;
  font-weight: 700;
  color: #111827;
  margin: 4px 0 2px 0;
  letter-spacing: -0.01em;
}
.hero .metric .sub {
  font-size: 8.5pt;
  color: #6b7280;
}
.hero .metric .spark {
  margin-top: 8px;
}

/* Cards / data blocks */
.card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  padding: 14px 16px;
  margin: 10px 0;
}
.card.warn { border-left: 3px solid #d97706; background: #fffbeb; }
.card.bad  { border-left: 3px solid #b91c1c; background: #fef2f2; }
.card.good { border-left: 3px solid #059669; background: #ecfdf5; }
.card.info { border-left: 3px solid #7c3aed; background: #f5f3ff; }
.card h4 {
  margin: 0 0 4px 0;
  font-size: 11pt;
  font-weight: 600;
  color: #111827;
}
.card .small { font-size: 9.5pt; color: #6b7280; }

/* Two-column body */
.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 18px;
  align-items: start;
}

/* Tables */
table.data {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
}
table.data th, table.data td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
}
table.data th {
  font-weight: 600;
  color: #374151;
  background: #f9fafb;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 8.5pt;
}
table.data td.num {
  font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", monospace;
  text-align: right;
  font-size: 9.5pt;
  white-space: nowrap;
}
table.data td.path {
  font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", monospace;
  font-size: 9.5pt;
  word-break: break-all;
}
table.data tr:hover { background: #fafafa; }

/* Bars (inline progress) */
.bar {
  display: inline-block;
  width: 60px;
  height: 8px;
  background: #f3f4f6;
  border-radius: 3px;
  vertical-align: 1px;
  overflow: hidden;
}
.bar > span {
  display: block;
  height: 100%;
  background: #7c3aed;
}
.bar.good > span { background: #059669; }
.bar.warn > span { background: #d97706; }
.bar.bad  > span { background: #b91c1c; }

/* Tier pills */
.pill {
  display: inline-block;
  font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", monospace;
  font-size: 8.5pt;
  letter-spacing: 0.04em;
  padding: 1px 7px;
  border-radius: 3px;
  font-weight: 600;
}
.pill.safe   { background: #d1fae5; color: #065f46; }
.pill.warn   { background: #fef3c7; color: #92400e; }
.pill.bad    { background: #fee2e2; color: #991b1b; }
.pill.fresh  { background: #d1fae5; color: #065f46; }
.pill.warm   { background: #cffafe; color: #155e75; }
.pill.fading { background: #fef3c7; color: #92400e; }
.pill.ghosted{ background: #fee2e2; color: #991b1b; }
.pill.purple { background: #ede9fe; color: #5b21b6; }
.pill.gray   { background: #f3f4f6; color: #374151; }

/* Tag chips for voice */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 9.5pt;
  color: #5b21b6;
}
.chip .freq { color: #7c3aed; font-weight: 600; margin-left: 4px; }

/* Telepathy heatmap grid */
.heatmap {
  display: grid;
  grid-auto-rows: 22px;
  grid-template-columns: 140px 1fr;
  gap: 1px;
  font-size: 8.5pt;
  background: #e5e7eb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
.heatmap .h-row-label {
  background: #ffffff;
  padding: 3px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  color: #374151;
}
.heatmap .h-cells { display: flex; height: 22px; }
.heatmap .h-cell {
  flex: 1 1 0;
  background: #ffffff;
  font-size: 7.5pt;
  text-align: center;
  line-height: 22px;
  color: #1f2937;
  border-right: 1px solid #f3f4f6;
}
.heatmap .h-cell.diag { background: #f3f4f6; }
.heatmap .h-cell:last-child { border-right: none; }

.legend {
  font-size: 8.5pt;
  color: #6b7280;
  margin: 4px 0 12px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend .swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

/* Sparkline svg */
svg.sparkline { display: block; }

/* Footer */
.report-footer {
  margin-top: 36px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
  font-size: 8.5pt;
  color: #6b7280;
  text-align: center;
}
.report-footer .brand-mini {
  font-family: "Iowan Old Style", "Palatino Linotype", "Cambria", Georgia, serif;
  font-style: italic;
  color: #5b21b6;
}

ul.tight { margin: 6px 0 0 18px; padding: 0; }
ul.tight li { margin: 3px 0; }

dl.kv {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 4px 0 10px 0;
  font-size: 10pt;
}
dl.kv dt {
  color: #6b7280;
  font-weight: 500;
  font-size: 9.5pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 1px;
}
dl.kv dd {
  margin: 0;
  color: #111827;
  font-weight: 600;
}
.delta-up   { color: #059669; }
.delta-down { color: #b91c1c; }
.muted      { color: #6b7280; }
.mono       { font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", monospace; }
`;

// ─── shared bits ───────────────────────────────────────────────────────

function renderHeaderRibbon(
  title: string,
  repoName: string,
  generatedAt: string,
  kind: "passport" | "nervous-system",
): string {
  return `<header class="ribbon">
  <div class="brand">μνήμη</div>
  <div class="title">${escape(title)}</div>
  <div class="meta">
    ${escape(kind === "passport" ? "passport" : "nervous-system")} ·
    ${escape(repoName)} ·<br/>generated ${escape(generatedAt)}
  </div>
</header>`;
}

function renderPrivacyStripe(): string {
  return `<aside class="privacy-stripe">
    <strong>Local data, local report.</strong>
    Every number on this page was computed from this repository's git log on this machine.
    Nothing was sent to any server.
  </aside>`;
}

function renderFooter(generatedAt: string): string {
  return `<footer class="report-footer">
    Generated by <span class="brand-mini">μνήμη — Mneme</span> ·
    ${escape(generatedAt)} · all data computed locally · view source on GitHub
  </footer>`;
}

function renderLimits(limits: string[], heading: string): string {
  if (limits.length === 0) return "";
  const items = limits.map((l) => `<li>${escape(l)}</li>`).join("\n");
  return `<section class="page-break">
  <h2><span class="num">∎</span>${escape(heading)}</h2>
  <p class="lead">A king-of-king report is honest about what it can and cannot tell you. Read these before drawing conclusions.</p>
  <ul class="tight">${items}</ul>
</section>`;
}

// ─── passport sections ─────────────────────────────────────────────────

function renderPassportCover(data: PassportData): string {
  const id = data.identity;
  const ex = data.expertise;
  const dna = data.dna;
  const headline = passportHeadline(data);
  const repoSharePct = (id.repoCommitShare * 100).toFixed(1);

  // Hero metrics — 4 cards.
  const metrics = [
    {
      label: "Commits authored",
      value: String(id.commitCount),
      sub: `${repoSharePct}% of repo · ${id.activeDays} active days`,
      sparkline: dnaHourSparkline(dna.hours.byHour),
    },
    {
      label: "Knowledge mass",
      value: ex.knowledgeMass.toFixed(1),
      sub: `${ex.filesStillFresh} / ${ex.filesKnown} files still fresh`,
      sparkline: knowledgeShareSparkline(data.expertise.topFiles),
    },
    {
      label: "Latent collaborators",
      value: String(data.telepathySlot.pairs.length),
      sub: data.telepathySlot.pairsEvaluated > 0
        ? `out of ${data.telepathySlot.pairsEvaluated} candidate pairs`
        : "no candidate pairs evaluated",
      sparkline: tinyBars(data.telepathySlot.pairs.slice(0, 8).map((p) => p.score)),
    },
    {
      label: "Promise keep-rate",
      value: data.promiseSlot.kept + data.promiseSlot.stale === 0
        ? "—"
        : (data.promiseSlot.keepRate * 100).toFixed(0) + "%",
      sub: `${data.promiseSlot.kept} kept · ${data.promiseSlot.stale} stale · ${data.promiseSlot.open} open`,
      sparkline: tinyBars([data.promiseSlot.kept, data.promiseSlot.open, data.promiseSlot.stale]),
    },
  ];

  const cards = metrics.map(
    (m) => `<div class="metric">
      <div class="label">${escape(m.label)}</div>
      <div class="value">${escape(m.value)}</div>
      <div class="sub">${escape(m.sub)}</div>
      <div class="spark">${m.sparkline}</div>
    </div>`,
  ).join("\n");

  return `<section>
  <div class="hero">
    <h1>${escape(id.name || id.email)}</h1>
    <div class="subtitle">${escape(headline)}</div>
    <div class="metrics">${cards}</div>
  </div>
  <dl class="kv">
    <dt>Email</dt>          <dd class="mono">${escape(id.email)}</dd>
    <dt>DNA fingerprint</dt><dd class="mono">${escape(id.dnaHash)}</dd>
    <dt>Active range</dt>   <dd>${escape(id.fromDate)} → ${escape(id.toDate)}</dd>
    <dt>Repo share</dt>     <dd>${escape(repoSharePct)}% of ${escape(String(data.meta.totalCommits))} total commits</dd>
    <dt>Authors in repo</dt><dd>${escape(String(data.meta.repoAuthorCount))}</dd>
  </dl>
</section>`;
}

function passportHeadline(data: PassportData): string {
  const parts: string[] = [];
  if (data.influenceSlot && data.influenceSlot.adoptionsByOthers > 0) {
    parts.push(
      `cultural alpha #${data.influenceSlot.rank} of ${data.influenceSlot.rankedOf}`,
    );
  }
  if (data.telepathySlot.pairs.length > 0) {
    parts.push(`${data.telepathySlot.pairs.length} latent collaborator${data.telepathySlot.pairs.length === 1 ? "" : "s"}`);
  }
  if (data.expertise.topFiles[0]) {
    const f = data.expertise.topFiles[0];
    parts.push(`${(f.knowledge * 100).toFixed(0)}% fresh on ${f.filePath}`);
  }
  if (parts.length === 0) {
    parts.push(`${data.identity.commitCount} commit${data.identity.commitCount === 1 ? "" : "s"} in this repo`);
  }
  return parts.join(" · ");
}

function renderPassportDna(data: PassportData): string {
  const dna = data.dna;
  const style = dna.style;
  const msg = dna.message;
  const hours = dna.hours;
  const files = dna.files;
  const topVerbs = msg.topVerbs.map((v) => `<span class="chip">${escape(v.verb)}<span class="freq">${escape(String(v.count))}</span></span>`).join("");
  const topDirs = files.topDirs.map((d) => `<span class="chip">${escape(d.dir || "(root)")}<span class="freq">${(d.share * 100).toFixed(0)}%</span></span>`).join("");
  const topExts = files.topExts.map((e) => `<span class="chip">${escape(e.ext || "(none)")}<span class="freq">${(e.share * 100).toFixed(0)}%</span></span>`).join("");

  return `<section class="page-break">
  <h2><span class="num">01</span>DNA fingerprint</h2>
  <p class="lead">A behavioural signature extracted from commit history. These describe <em>this engineer's habits</em>, not a benchmark.</p>
  <div class="two-col">
    <div>
      <h3>Style genome <span class="muted">— how their commits are shaped</span></h3>
      <table class="data">
        <tr><td>Files per commit</td><td class="num">${escape(num(style.filesPerCommit, 1))}</td><td class="muted">lower = more focused diffs</td></tr>
        <tr><td>Churn per commit</td><td class="num">${escape(num(style.churnPerCommit, 0))}</td><td class="muted">insertions + deletions, capped</td></tr>
        <tr><td>Test ratio</td><td class="num">${pct(style.testRatio)}</td><td class="muted">commits touching test/spec</td></tr>
        <tr><td>Issue-ref ratio</td><td class="num">${pct(style.issueRefRatio)}</td><td class="muted">commits citing #123 / JIRA-45</td></tr>
        <tr><td>Conventional commits</td><td class="num">${pct(style.conventionalRatio)}</td><td class="muted">feat:/fix:/chore: prefix</td></tr>
      </table>
      <h3>Message DNA</h3>
      <table class="data">
        <tr><td>Avg subject length</td><td class="num">${escape(num(msg.avgSubjectLength, 0))} chars</td><td class="muted">terse vs descriptive</td></tr>
        <tr><td>Imperative ratio</td><td class="num">${pct(msg.imperativeRatio)}</td><td class="muted">"fix", "add" vs noun-style</td></tr>
        <tr><td>Body ratio</td><td class="num">${pct(msg.bodyRatio)}</td><td class="muted">commits with a body</td></tr>
      </table>
      <h3>Top leading verbs</h3>
      <div class="chips">${topVerbs || `<span class="muted small">(none)</span>`}</div>
    </div>
    <div>
      <h3>Working hours <span class="muted">UTC · weekend ratio ${pct(hours.weekendRatio)}</span></h3>
      ${renderHourBars(hours.byHour, hours.peakWindow)}
      <h3>Day-of-week</h3>
      ${renderWeekdayBars(hours.byWeekday)}
      <h3>File affinity</h3>
      <div class="chips">${topDirs || `<span class="muted small">(none)</span>`}</div>
      <div class="chips" style="margin-top:6px;">${topExts || `<span class="muted small">(none)</span>`}</div>
    </div>
  </div>
</section>`;
}

function renderPassportExpertise(data: PassportData): string {
  const top = data.expertise.topFiles;
  const rows = top.map((f) => {
    const pctFresh = (f.knowledge * 100).toFixed(0);
    return `<tr>
      <td><span class="pill ${f.band}">${escape(f.band.toUpperCase())}</span></td>
      <td class="path">${escape(f.filePath)}</td>
      <td class="num">${pctFresh}%</td>
      <td class="num">${escape(String(f.touchCount))}</td>
      <td class="num">${humanDays(f.lastTouchDaysAgo)}</td>
      <td class="muted small">${escape(f.refreshHint)}</td>
    </tr>`;
  }).join("\n");
  const empty = top.length === 0
    ? `<tr><td colspan="6" class="muted small">(no expertise data — check that the file-change index has been populated)</td></tr>`
    : "";
  return `<section class="page-break">
  <h2><span class="num">02</span>Expertise map</h2>
  <p class="lead">Where this engineer's knowledge currently lives. Rows are sorted by current freshness — top file first.</p>
  <dl class="kv">
    <dt>Knowledge mass</dt><dd>${escape(num(data.expertise.knowledgeMass, 1))}</dd>
    <dt>Files known</dt>   <dd>${escape(String(data.expertise.filesKnown))}</dd>
    <dt>Still fresh</dt>   <dd>${escape(String(data.expertise.filesStillFresh))}</dd>
    <dt>Last active</dt>   <dd>${escape(formatDate(data.expertise.lastActiveAt))}</dd>
  </dl>
  <table class="data">
    <thead><tr>
      <th>Tier</th><th>File</th><th>Fresh</th><th>Touches</th><th>Last</th><th>Refresh</th>
    </tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

function renderPassportTelepathy(data: PassportData): string {
  const pairs = data.telepathySlot.pairs;
  const rows = pairs.map((p) => {
    const me = data.identity.email.toLowerCase();
    const other = p.authorA.email.toLowerCase() === me ? p.authorB : p.authorA;
    return `<tr>
      <td><strong>${escape(other.name || other.email)}</strong></td>
      <td class="num">${escape(p.score.toFixed(3))}</td>
      <td class="num">${escape(String(p.events))}</td>
      <td class="path">${escape(p.topTopic.topic)}</td>
      <td class="muted small">${escape(formatDate(p.lastSeenAt))}</td>
    </tr>`;
  }).join("\n");
  const empty = pairs.length === 0
    ? `<tr><td colspan="5" class="muted small">No latent collaborators detected within the rhyme window. Either solo work or the cadence does not overlap others.</td></tr>`
    : "";
  return `<section>
  <h2><span class="num">03</span>Latent collaborators</h2>
  <p class="lead">Pairs where their commits "rhyme" — Alice changes one part of a topic, this engineer changes the other within the rhyme window. They never co-authored, but the repo proves they're a team.</p>
  <table class="data">
    <thead><tr><th>Collaborator</th><th>Score</th><th>Events</th><th>Top shared topic</th><th>Last</th></tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

function renderPassportInfluence(data: PassportData): string {
  const slot = data.influenceSlot;
  if (!slot) {
    return `<section>
      <h2><span class="num">04</span>Cultural footprint</h2>
      <p class="lead">No influence ranking available — this engineer did not originate or adopt any reused TS/JS function shape.</p>
    </section>`;
  }
  const shapes = slot.topShapes.map((s) => {
    const adopters = s.adopters.slice(0, 3).map((a) => escape(a.name || a.email)).join(", ");
    return `<tr>
      <td><span class="pill purple">${escape(s.shape.kind)}</span></td>
      <td class="mono">${escape(s.shape.name)}/${escape(String(s.shape.arity))}</td>
      <td class="num">${escape(String(s.adoptions))}</td>
      <td class="muted small">${adopters || "—"}</td>
    </tr>`;
  }).join("\n");
  const empty = slot.topShapes.length === 0
    ? `<tr><td colspan="4" class="muted small">No specific patterns reached the adoption floor.</td></tr>`
    : "";
  return `<section>
  <h2><span class="num">04</span>Cultural footprint</h2>
  <p class="lead">PageRank flows credit toward whoever sets the patterns others copy. Volume-independent: a 5-commit pattern-setter outranks a 500-commit copy-paster.</p>
  <dl class="kv">
    <dt>PageRank</dt>            <dd class="mono">${escape(slot.pageRank.toFixed(4))}</dd>
    <dt>Rank</dt>                <dd>#${escape(String(slot.rank))} of ${escape(String(slot.rankedOf))}</dd>
    <dt>Originated</dt>          <dd>${escape(String(slot.originatedShapesTotal))} shapes (${escape(String(slot.originatedShapesAdopted))} adopted by others)</dd>
    <dt>Adoptions by others</dt> <dd>${escape(String(slot.adoptionsByOthers))} (by ${escape(String(slot.uniqueAdopters))} engineer${slot.uniqueAdopters === 1 ? "" : "s"})</dd>
    <dt>Adopted from others</dt> <dd>${escape(String(slot.adoptionsByThisAuthor))} pattern${slot.adoptionsByThisAuthor === 1 ? "" : "s"}</dd>
  </dl>
  <table class="data">
    <thead><tr><th>Kind</th><th>Pattern</th><th>Adoptions</th><th>Top adopters</th></tr></thead>
    <tbody>${shapes}${empty}</tbody>
  </table>
</section>`;
}

function renderPassportPromises(data: PassportData): string {
  const slot = data.promiseSlot;
  const baseline = slot.teamBaseline;
  const baselineRate = baseline.kept + baseline.stale === 0 ? null : baseline.keepRate;
  const delta = baselineRate === null ? null : slot.keepRate - baselineRate;
  return `<section>
  <h2><span class="num">05</span>Promise ledger</h2>
  <p class="lead">Every "I'll fix later" / TODO / follow-up parsed from this engineer's commit messages and verified against subsequent commits. Heuristic — read it as a starting list, not a verdict.</p>
  <dl class="kv">
    <dt>Total</dt>      <dd>${escape(String(slot.total))} promise${slot.total === 1 ? "" : "s"}</dd>
    <dt>Kept</dt>       <dd class="delta-up">${escape(String(slot.kept))}</dd>
    <dt>Stale</dt>      <dd class="delta-down">${escape(String(slot.stale))}</dd>
    <dt>Open</dt>       <dd>${escape(String(slot.open))}</dd>
    <dt>Keep-rate</dt>  <dd>${slot.kept + slot.stale === 0 ? "—" : (slot.keepRate * 100).toFixed(0) + "%"}${delta === null ? "" : ` <span class="muted small">vs team ${(baselineRate! * 100).toFixed(0)}%, Δ ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)} pp</span>`}</dd>
  </dl>
  ${slot.oldestStale ? `<div class="card warn"><h4>Oldest stale promise (${escape(num(slot.oldestStale.ageDays, 0))} days old)</h4><div class="small">${escape(slot.oldestStale.excerpt)}</div><div class="small mono muted">${escape(slot.oldestStale.commitShort)} · ${escape(formatDate(slot.oldestStale.date))}</div></div>` : ""}
  ${slot.mostRecentKept ? `<div class="card good"><h4>Most recent kept</h4><div class="small">${escape(slot.mostRecentKept.excerpt)}</div><div class="small mono muted">${escape(slot.mostRecentKept.commitShort)} · ${escape(formatDate(slot.mostRecentKept.date))} · fulfilled by ${escape(slot.mostRecentKept.fulfilledBy ?? "—")}</div></div>` : ""}
</section>`;
}

function renderPassportFading(data: PassportData): string {
  const fading = data.fadingDomains;
  const rows = fading.map((f) => `<tr>
      <td class="path">${escape(f.filePath)}</td>
      <td class="num">${escape(String(f.peakTouches))}</td>
      <td class="num">${(f.currentKnowledge * 100).toFixed(0)}%</td>
      <td class="num">${humanDays(f.daysIdle)}</td>
    </tr>`).join("\n");
  const empty = fading.length === 0
    ? `<tr><td colspan="4" class="muted small">No fading domains — every file this engineer touched ≥3 times is still fresh.</td></tr>`
    : "";
  return `<section>
  <h2><span class="num">06</span>Knowledge atrophy clock</h2>
  <p class="lead">Files this engineer once knew well (≥3 historical touches) where current knowledge has decayed below 30%. Re-onboarding cost in waiting if they ever return to this code.</p>
  <table class="data">
    <thead><tr><th>File</th><th>Touches</th><th>Now fresh</th><th>Idle</th></tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

function renderPassportVoice(data: PassportData): string {
  const phrases = data.voice;
  const chips = phrases.map((p) => renderVoiceChip(p)).join("");
  return `<section>
  <h2><span class="num">07</span>Voice fingerprint</h2>
  <p class="lead">Words this engineer uses disproportionately in their commit messages, weighted against the team baseline. TF-IDF style — a phrase scores high only when they say it more often than the rest of the team.</p>
  <div class="chips">${chips || `<span class="muted small">(no distinguishing phrases — fewer than 5 commits with substantive bodies)</span>`}</div>
</section>`;
}

function renderVoiceChip(p: VoicePhrase): string {
  return `<span class="chip" title="auth ${(p.authorRate * 100).toFixed(2)}% / team ${(p.teamRate * 100).toFixed(2)}%">${escape(p.phrase)}<span class="freq">${escape(String(p.count))}×</span></span>`;
}

function renderPassportFriction(data: PassportData): string {
  const f = data.friction!;
  const rows = f.pairs.map((p) => `<tr>
      <td>${escape(p.a)}</td>
      <td>${escape(p.b)}</td>
      <td class="num">${escape(String(p.total))}</td>
      <td class="path">${escape(p.topFile ?? "—")}</td>
      <td class="muted small">${escape(formatDate(p.lastClashAt))}</td>
    </tr>`).join("\n");
  const empty = f.pairs.length === 0
    ? `<tr><td colspan="5" class="muted small">No friction events crossed the minimum-events floor.</td></tr>`
    : "";
  return `<section>
  <h2><span class="num">08</span>Engineering friction <span class="muted small">(style/architecture, not personal conflict)</span></h2>
  <p class="lead"><strong>Opt-in.</strong> Pairs where commits keep rewriting each other's work. Mneme detects <em>code churn</em>, not personality. Read as "these two have an architectural conversation to have", not as a performance signal.</p>
  <table class="data">
    <thead><tr><th>A</th><th>B</th><th>Events</th><th>Top contested file</th><th>Last clash</th></tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

// ─── nervous-system sections ───────────────────────────────────────────

function renderNervousCover(data: NervousSystemData): string {
  const cards = data.hero.metrics.map((m) => `<div class="metric">
    <div class="label">${escape(m.label)}</div>
    <div class="value">${escape(m.value)}</div>
    <div class="sub">${escape(m.subtitle)}</div>
    <div class="spark">${renderSparkline(m.sparkline)}</div>
  </div>`).join("\n");
  return `<section>
  <div class="hero">
    <h1>The Nervous System of ${escape(data.meta.repoName)}</h1>
    <div class="subtitle">${escape(data.hero.headline)}</div>
    <div class="metrics">${cards}</div>
  </div>
  <dl class="kv">
    <dt>Total commits</dt>     <dd>${escape(String(data.meta.totalCommits))}</dd>
    <dt>Active authors</dt>    <dd>${escape(String(data.meta.totalAuthors))}</dd>
    <dt>Knowledge half-life</dt><dd>${escape(String(data.meta.halfLifeDays))} days</dd>
    <dt>Ranked authors</dt>    <dd>${escape(String(data.meta.rankedAuthorCount))}</dd>
  </dl>
  <h3>Table of contents</h3>
  <ol class="tight">
    <li>Cultural alphas — who sets the patterns</li>
    <li>Latent-collaboration heatmap — invisible teams</li>
    <li>Atrophy critical list — files at knowledge risk</li>
    <li>Brain lobes — repo neuroanatomy</li>
    <li>Promise debt — repo-wide ledger</li>
    <li>What's surprising — punchy findings</li>
    <li>Mini-passports for the top contributors</li>
    <li>Honest limits</li>
  </ol>
</section>`;
}

function renderNervousAlphas(data: NervousSystemData): string {
  const rows = data.alphas.map((a) => `<tr>
    <td><strong>#${escape(String(a.rank))}</strong></td>
    <td><strong>${escape(a.name || a.email)}</strong> <span class="muted small mono">${escape(a.email)}</span></td>
    <td class="num">${escape(a.pageRank.toFixed(4))}</td>
    <td class="num">${escape(String(a.adoptionsByOthers))}</td>
    <td class="num">${escape(String(a.uniqueAdopters))}</td>
    <td class="num">${escape(String(a.originatedShapesAdopted))}</td>
    <td class="muted small">${a.topShape ? escape(`${a.topShape.name}/${a.topShape.arity}`) : "—"}</td>
  </tr>`).join("\n");
  const empty = data.alphas.length === 0
    ? `<tr><td colspan="7" class="muted small">No rankings — repo has no reused TS/JS function shapes yet.</td></tr>`
    : "";
  return `<section class="page-break">
  <h2><span class="num">01</span>Cultural alphas</h2>
  <p class="lead">PageRank over function-shape adoption. Higher = more engineers copying their patterns. Volume-independent.</p>
  <table class="data">
    <thead><tr>
      <th>Rank</th><th>Engineer</th><th>PageRank</th><th>Adoptions</th><th>Adopters</th><th>Originated</th><th>Top pattern</th>
    </tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

function renderNervousTelepathyHeatmap(data: NervousSystemData): string {
  const pairs = data.telepathy.pairs;
  if (pairs.length === 0) {
    return `<section class="page-break">
      <h2><span class="num">02</span>Latent-collaboration heatmap</h2>
      <p class="lead">No latent pairs detected. Either solo / small repo, or commits do not overlap others within the rhyme window.</p>
    </section>`;
  }
  const heatmap = renderTelepathyHeatmap(pairs);
  const rowsTable = pairs.slice(0, 12).map((p) => `<tr>
    <td><strong>${escape(p.authorA.name || p.authorA.email)}</strong></td>
    <td>↔</td>
    <td><strong>${escape(p.authorB.name || p.authorB.email)}</strong></td>
    <td class="num">${escape(p.score.toFixed(3))}</td>
    <td class="num">${escape(String(p.events))}</td>
    <td class="path">${escape(p.topTopic.topic)}</td>
    <td class="muted small">${escape(formatDate(p.lastSeenAt))}</td>
  </tr>`).join("\n");
  return `<section class="page-break">
  <h2><span class="num">02</span>Latent-collaboration heatmap</h2>
  <p class="lead">Each row is a pair of engineers whose commits "rhyme" — one edits part of a topic, the other edits the rest within the rhyme window, repeatedly. Cell darkness = telepathy score. Diagonal cells skipped.</p>
  ${heatmap}
  <h3>Pair detail (top 12)</h3>
  <table class="data">
    <thead><tr><th>A</th><th></th><th>B</th><th>Score</th><th>Events</th><th>Top topic</th><th>Last</th></tr></thead>
    <tbody>${rowsTable}</tbody>
  </table>
</section>`;
}

function renderTelepathyHeatmap(pairs: TelepathyPair[]): string {
  // Build symmetric author × author matrix; row labels left, cells across.
  const authors = new Map<string, string>();
  for (const p of pairs) {
    if (!authors.has(p.authorA.email)) authors.set(p.authorA.email, p.authorA.name || p.authorA.email);
    if (!authors.has(p.authorB.email)) authors.set(p.authorB.email, p.authorB.name || p.authorB.email);
  }
  const list = [...authors.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const idx = new Map<string, number>();
  list.forEach(([e], i) => idx.set(e, i));
  const N = list.length;
  if (N === 0) return "";
  const matrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  let maxScore = 0;
  for (const p of pairs) {
    const i = idx.get(p.authorA.email)!;
    const j = idx.get(p.authorB.email)!;
    matrix[i]![j] = p.score;
    matrix[j]![i] = p.score;
    if (p.score > maxScore) maxScore = p.score;
  }
  const rows = list.map(([email, name], i) => {
    const cells = list.map((_, j) => {
      if (i === j) return `<div class="h-cell diag"></div>`;
      const v = matrix[i]![j]!;
      const intensity = maxScore > 0 ? v / maxScore : 0;
      const color = heatColor(intensity);
      const label = v > 0 ? v.toFixed(2) : "";
      return `<div class="h-cell" style="background:${color};" title="${escape(name)} ↔ ${escape(list[j]![1])} = ${escape(v.toFixed(3))}">${escape(label)}</div>`;
    }).join("");
    return `<div class="h-row-label">${escape(name)}</div><div class="h-cells">${cells}</div>`;
  }).join("");
  const legend = `<div class="legend">
    <span>weak</span>
    <span class="swatch" style="background:${heatColor(0.1)}"></span>
    <span class="swatch" style="background:${heatColor(0.3)}"></span>
    <span class="swatch" style="background:${heatColor(0.6)}"></span>
    <span class="swatch" style="background:${heatColor(1.0)}"></span>
    <span>strong (max ${maxScore.toFixed(2)})</span>
  </div>`;
  return `<div class="heatmap" style="grid-template-columns: 140px 1fr;">${rows}</div>${legend}`;
}

function heatColor(intensity: number): string {
  // Light → deep purple (Mneme brand) for telepathy.
  const t = Math.max(0, Math.min(1, intensity));
  const r = Math.round(255 - (255 - 124) * t);
  const g = Math.round(255 - (255 - 58) * t);
  const b = Math.round(255 - (255 - 237) * t);
  return `rgb(${r},${g},${b})`;
}

function renderNervousAtrophy(data: NervousSystemData): string {
  const rows = data.atrophy.criticalFiles.slice(0, 30).map((f: CriticalFileSlot) => `<tr>
    <td><span class="pill ${f.tier === "at-risk" ? "bad" : f.tier === "warn" ? "warn" : "safe"}">${escape(f.tier.toUpperCase())}</span></td>
    <td class="path">${escape(f.filePath)}</td>
    <td class="num">${escape(String(f.totalTouches))}</td>
    <td class="num">${(f.freshestKnowledge * 100).toFixed(0)}%</td>
    <td>${f.topKnower ? escape(f.topKnower.name) : "<span class='muted small'>(none)</span>"}</td>
    <td class="num">${escape(String(f.liveExpertCount))}</td>
  </tr>`).join("\n");
  const empty = data.atrophy.criticalFiles.length === 0
    ? `<tr><td colspan="6" class="muted small">No at-risk files — every file has at least one live expert above threshold.</td></tr>`
    : "";
  const livePct = data.atrophy.fileCount === 0 ? 0 : Math.round((data.atrophy.filesWithLiveExpert / data.atrophy.fileCount) * 100);
  return `<section class="page-break">
  <h2><span class="num">03</span>Atrophy critical list</h2>
  <p class="lead">Files most at risk of becoming "ghost code". Tier = best living knowledge: SAFE ≥ 70% · WARN 30–70% · AT-RISK &lt; 30%. Half-life ${escape(String(data.atrophy.halfLifeDays))} days.</p>
  <dl class="kv">
    <dt>Files indexed</dt>      <dd>${escape(String(data.atrophy.fileCount))}</dd>
    <dt>With live expert</dt>   <dd>${escape(String(data.atrophy.filesWithLiveExpert))} (${livePct}%)</dd>
    <dt>Deep ghost files</dt>   <dd class="delta-down">${escape(String(data.atrophy.ghostedDeepFiles))}</dd>
  </dl>
  <table class="data">
    <thead><tr><th>Tier</th><th>File</th><th>Touches</th><th>Best fresh</th><th>Top knower</th><th>Live experts</th></tr></thead>
    <tbody>${rows}${empty}</tbody>
  </table>
</section>`;
}

function renderNervousLobes(data: NervousSystemData): string {
  if (data.lobes.length === 0) return "";
  const rows = data.lobes.map((l: BrainLobe) => `<tr>
    <td class="path">${escape(l.lobe)}</td>
    <td class="num">${escape(String(l.fileCount))}</td>
    <td class="num">${escape(String(l.totalTouches))}</td>
    <td>${l.topOwner ? `<strong>${escape(l.topOwner.name)}</strong> <span class="muted small">${escape(String(l.topOwner.touches))}×</span>` : "<span class='muted small'>—</span>"}</td>
    <td class="num">${(l.concentrationPct * 100).toFixed(0)}%</td>
    <td class="path muted small">${l.freshestFile ? escape(l.freshestFile.filePath) : "—"}</td>
    <td class="path muted small">${l.ghostFile ? escape(l.ghostFile.filePath) + ` <span class="pill ghosted">${humanDays(l.ghostFile.daysIdle)}</span>` : "—"}</td>
  </tr>`).join("\n");
  return `<section class="page-break">
  <h2><span class="num">04</span>Brain lobes <span class="muted small">— repo neuroanatomy</span></h2>
  <p class="lead">Files clustered by depth-3 directory. For each lobe: top owner, touch concentration, freshest file (highest current knowledge), and the lobe's "ghost zone" (deepest-decayed file with ≥2 historical touches).</p>
  <table class="data">
    <thead><tr><th>Lobe</th><th>Files</th><th>Touches</th><th>Top owner</th><th>80% conc.</th><th>Freshest file</th><th>Ghost zone</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderNervousPromises(data: NervousSystemData): string {
  return `<section>
  <h2><span class="num">05</span>Promise debt — repo-wide</h2>
  <dl class="kv">
    <dt>Open</dt>   <dd>${escape(String(data.promises.open))}</dd>
    <dt>Kept</dt>   <dd class="delta-up">${escape(String(data.promises.kept))}</dd>
    <dt>Stale</dt>  <dd class="delta-down">${escape(String(data.promises.stale))}</dd>
    <dt>Keep-rate</dt><dd>${data.promises.kept + data.promises.stale === 0 ? "—" : (data.promises.keepRate * 100).toFixed(0) + "%"}</dd>
  </dl>
  <p class="plain">Run <code>mneme promise --status stale</code> to enumerate the items.</p>
</section>`;
}

function renderNervousSurprising(data: NervousSystemData): string {
  if (data.surprising.length === 0) return "";
  const items = data.surprising.map((s) => `<li>${escapeMixed(s)}</li>`).join("\n");
  return `<section>
  <h2><span class="num">06</span>What's surprising</h2>
  <p class="lead">A small number of high-signal findings, ranked by likely impact. Read these first if you have 30 seconds.</p>
  <ul class="tight">${items}</ul>
</section>`;
}

function renderMiniPassport(p: PassportData): string {
  const ex = p.expertise;
  const top = ex.topFiles.slice(0, 5).map((f) => `<tr>
    <td><span class="pill ${f.band}">${escape(f.band.toUpperCase())}</span></td>
    <td class="path">${escape(f.filePath)}</td>
    <td class="num">${(f.knowledge * 100).toFixed(0)}%</td>
  </tr>`).join("");
  const tele = p.telepathySlot.pairs.slice(0, 4).map((pp) => {
    const me = p.identity.email.toLowerCase();
    const other = pp.authorA.email.toLowerCase() === me ? pp.authorB : pp.authorA;
    return `<li><strong>${escape(other.name || other.email)}</strong> <span class="muted small">score ${escape(pp.score.toFixed(2))} · ${escape(String(pp.events))} events</span></li>`;
  }).join("");
  const voice = p.voice.slice(0, 6).map(renderVoiceChip).join("");
  const head = passportHeadline(p);
  return `<section class="page-break">
  <h2><span class="num">∾</span>Mini-passport · ${escape(p.identity.name || p.identity.email)}</h2>
  <p class="lead">${escape(head)}</p>
  <div class="two-col">
    <div>
      <h3>Top expertise</h3>
      <table class="data">
        <thead><tr><th>Tier</th><th>File</th><th>Fresh</th></tr></thead>
        <tbody>${top || `<tr><td colspan="3" class="muted small">(none)</td></tr>`}</tbody>
      </table>
      <dl class="kv">
        <dt>Commits</dt>     <dd>${escape(String(p.identity.commitCount))}</dd>
        <dt>Knowledge mass</dt><dd>${escape(num(ex.knowledgeMass, 1))}</dd>
        <dt>DNA hash</dt>    <dd class="mono">${escape(p.identity.dnaHash)}</dd>
        <dt>PageRank</dt>    <dd>${p.influenceSlot ? `#${escape(String(p.influenceSlot.rank))} (${escape(p.influenceSlot.pageRank.toFixed(4))})` : `<span class="muted small">no rank</span>`}</dd>
        <dt>Promises</dt>    <dd>${escape(String(p.promiseSlot.kept))} kept · ${escape(String(p.promiseSlot.stale))} stale · ${escape(String(p.promiseSlot.open))} open</dd>
      </dl>
    </div>
    <div>
      <h3>Latent collaborators</h3>
      <ul class="tight">${tele || `<li class="muted small">(none)</li>`}</ul>
      <h3>Voice fingerprint</h3>
      <div class="chips">${voice || `<span class="muted small">(none)</span>`}</div>
    </div>
  </div>
</section>`;
}

// ─── tiny inline charts ────────────────────────────────────────────────

function renderSparkline(values: number[]): string {
  if (values.length === 0) {
    return `<svg class="sparkline" width="120" height="22"></svg>`;
  }
  const w = 120, h = 22, pad = 2;
  const max = Math.max(1, ...values);
  const step = (w - pad * 2) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lastX = pad + (values.length - 1) * step;
  const lastY = h - pad - (values[values.length - 1]! / max) * (h - pad * 2);
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <polyline fill="none" stroke="#7c3aed" stroke-width="1.5" points="${points}" />
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2" fill="#7c3aed" />
  </svg>`;
}

function tinyBars(values: number[]): string {
  if (values.length === 0) {
    return `<svg class="sparkline" width="120" height="22"></svg>`;
  }
  const w = 120, h = 22, pad = 1;
  const max = Math.max(1, ...values);
  const bw = (w - pad * 2) / values.length;
  const rects = values.map((v, i) => {
    const bh = max === 0 ? 0 : (v / max) * (h - pad * 2);
    const x = pad + i * bw + 0.6;
    const y = h - pad - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}" fill="#10b981" />`;
  }).join("");
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function dnaHourSparkline(byHour: number[]): string {
  return tinyBars(byHour);
}

function knowledgeShareSparkline(top: PassportExpertiseFile[]): string {
  return tinyBars(top.slice(0, 8).map((f) => f.knowledge));
}

function renderHourBars(byHour: number[], peakWindow: string): string {
  const max = Math.max(1, ...byHour);
  const bars = byHour.map((v, h) => {
    const heightPct = (v / max) * 100;
    const isPeak = peakWindow.startsWith(String(h).padStart(2, "0"));
    return `<div title="${h}:00 — ${v} commits" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:46px;">
      <div style="height:${heightPct.toFixed(0)}%;background:${isPeak ? "#7c3aed" : "#a78bfa"};border-radius:1px;"></div>
    </div>`;
  }).join("");
  return `<div style="display:flex;gap:1.5px;border-bottom:1px solid #e5e7eb;padding-bottom:2px;">${bars}</div>
    <div style="display:flex;justify-content:space-between;font-size:7.5pt;color:#6b7280;margin-top:2px;"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
    <div class="muted small">peak ${escape(peakWindow)}</div>`;
}

function renderWeekdayBars(byWeekday: number[]): string {
  const labels = ["S", "M", "T", "W", "T", "F", "S"];
  const max = Math.max(1, ...byWeekday);
  const bars = byWeekday.map((v, i) => {
    const heightPct = (v / max) * 100;
    return `<div title="${labels[i]} — ${v} commits" style="flex:1;display:flex;flex-direction:column;align-items:center;">
      <div style="width:60%;height:46px;display:flex;flex-direction:column;justify-content:flex-end;">
        <div style="height:${heightPct.toFixed(0)}%;background:#10b981;border-radius:1px;"></div>
      </div>
      <div style="font-size:7.5pt;color:#6b7280;">${labels[i]}</div>
    </div>`;
  }).join("");
  return `<div style="display:flex;gap:3px;">${bars}</div>`;
}

// ─── helpers ───────────────────────────────────────────────────────────

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape but leave backtick-fenced segments wrapped in <code>.
 * Used by surprising-findings strings which embed `paths`.
 */
function escapeMixed(s: string): string {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return `<code class="mono">${escape(p.slice(1, -1))}</code>`;
    }
    return escape(p);
  }).join("");
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function num(v: number, places: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(places);
}

function humanDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "1 d";
  if (days < 14) return `${Math.round(days)} d`;
  if (days < 60) return `${Math.round(days / 7)} w`;
  if (days < 730) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toISOString();
  return s.slice(0, 10) + " " + s.slice(11, 16) + " UTC";
}

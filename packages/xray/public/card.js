/* Shared X-Ray card renderer — used by both the home page and the permalink page. */
(function (g) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const gC = (x) => "g-" + ("ABCDEF".includes(x) ? x : "C");
  const pct = (n) => (n || 0) + "%";

  function xrayCardHTML(signed, opts) {
    opts = opts || {};
    const r = signed.report, s = r.summary;
    const dep = r.deps, sec = r.secrets, bf = r.busFactor, age = r.age, cx = r.complexity;
    const verified = signed.receipt ? '<span class="verified"><span class="dot"></span>Ed25519 — verifies offline</span>' : "unsigned";

    const depChips = (dep.atRisk || []).slice(0, 6).map((d) =>
      `<span class="chip ${d.band === "dead" ? "bad" : "warn"}">${esc(d.name)} · ${d.band}${d.successor ? ` → ${esc(d.successor)}` : ""}</span>`).join("") || `<span class="chip">none dying</span>`;
    const secChips = sec.totalFindings === 0 ? `<span class="chip">clean</span>` :
      Object.entries(sec.byKind).slice(0, 8).map(([k, n]) => `<span class="chip bad">${esc(k)} ×${n}</span>`).join("");
    const fragile = (bf.fragileFiles || []).slice(0, 4).map((x) => `<span class="chip ${x.topAuthorShare >= 0.9 ? "warn" : ""}">${esc(x.file)} · ${Math.round(x.topAuthorShare * 100)}%</span>`).join("");
    const hot = (cx.hotspots || []).slice(0, 4).map((h) => `<span class="chip">${esc(h.symbol).slice(0, 40)} · ${h.bodyLines}L</span>`).join("");

    const share = opts.share ? `<div class="share" id="share"></div>` : "";

    return `
    <div class="card">
      <div class="top">
        <div class="grade ${gC(s.grade)}">${esc(s.grade)}</div>
        <div><div class="repo">${esc(r.subject.repoName)}</div>
          <div class="head">${esc(s.headline)} · ${s.signalsRun} signals · @ ${esc(String(r.subject.commitHash).slice(0, 10))}</div></div>
      </div>
      <div class="rows">
        <div class="row"><div class="k">Dependencies</div><div class="v"><span class="big">${dep.total}</span> total · ${dep.byBand.dead + dep.byBand.moribund} dying<div class="chips">${depChips}</div></div></div>
        <div class="row"><div class="k">Secrets</div><div class="v"><span class="big">${sec.totalFindings}</span> finding(s) in ${sec.filesScanned} files<div class="chips">${secChips}</div></div></div>
        <div class="row"><div class="k">Bus factor</div><div class="v"><span class="big">${bf.busFactor}</span> · top author ${pct(bf.topContributorShare)} · ${pct(bf.singleOwnerFilePct)} files single-owner<div class="chips">${fragile}</div></div></div>
        <div class="row"><div class="k">Vitality</div><div class="v"><span class="big">${esc(age.vitality)}</span> · ${esc(age.lifespan)} old · ${age.totalCommits} commits · ${age.totalAuthors} authors</div></div>
        <div class="row"><div class="k">Complexity</div><div class="v"><span class="big">${cx.totalSymbols}</span> symbols · ${cx.filesAnalysed} files · max depth ${cx.maxDepth}<div class="chips">${hot}</div></div></div>
      </div>
      <div class="foot">${verified}<span>fingerprint <code>${esc(String(r.fingerprint).slice(0, 28))}…</code></span></div>
      ${share}
    </div>`;
  }

  g.MnemeXRay = { xrayCardHTML, gradeClass: gC, esc };
})(window);

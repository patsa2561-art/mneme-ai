/* Shared X-Ray card renderer — used by both the home page and the permalink page. */
(function (g) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const gC = (x) => "g-" + ("ABCDEF".includes(x) ? x : "C");
  const pct = (n) => (n || 0) + "%";

  // tiny unicode sparkline from an array of numbers
  function sparkline(arr) {
    if (!arr || !arr.length) return "";
    const bars = "▁▂▃▄▅▆▇█", max = Math.max(1, ...arr);
    return `<span class="spark" title="activity over time (oldest → newest)">${arr.map((n) => bars[Math.min(7, Math.round((n / max) * 7))]).join("")}</span>`;
  }

  // one-line "what is this / what's it for" under every label
  const INFO = {
    Dependencies: "Are your libraries dying or legally risky?",
    Secrets: "Leaked credentials sitting in the code.",
    "Bus factor": "Key-person risk — what breaks if someone leaves.",
    Vitality: "Is the project alive and maintained?",
    Complexity: "The biggest, most tangled code.",
    Hotspots: "Where bugs hide — refactor these first.",
    Coupling: "Files that secretly change together.",
    Security: "Dangerous commands in build/CI + doc prompt-injection.",
  };
  const kcell = (label) => `<div class="k">${label}${INFO[label] ? `<span class="kdesc">${INFO[label]}</span>` : ""}</div>`;

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
    const hs = r.hotspots || { hotspots: [], trend: [] };
    const hsChips = (hs.hotspots || []).slice(0, 5).map((h) => `<span class="chip">${esc(h.file)} · ${h.changes}× · ${h.loc}L${h.expert ? ` · ${esc(h.expert)}` : ""}</span>`).join("") || `<span class="chip">none</span>`;
    const cp = r.coupling || { pairs: [] };
    const cpChips = (cp.pairs || []).slice(0, 5).map((p) => `<span class="chip ${p.hidden ? "warn" : ""}">${esc(p.a)} ⇄ ${esc(p.b)} · ${Math.round(p.confidence * 100)}%</span>`).join("") || `<span class="chip">none</span>`;
    const lic = (dep.licenses) || { permissive: 0, "weak-copyleft": 0, "strong-copyleft": 0, unknown: 0 };
    const licChips = (dep.licenseFlags || []).slice(0, 5).map((l) => `<span class="chip ${l.class === "strong-copyleft" ? "bad" : "warn"}">${esc(l.name)} · ${esc(l.license)}</span>`).join("");
    const spark = sparkline(hs.trend || []);
    const secu = r.security || { destructive: [], commandsScanned: 0, injectionFindings: 0 };
    const secuChips = (secu.destructive || []).slice(0, 5).map((d) => `<span class="chip bad">${esc(d.where)}: ${esc(d.command).slice(0, 38)}</span>`).join("")
      || (secu.injectionFindings ? (secu.injectionWhere || []).slice(0, 4).map((w) => `<span class="chip warn">injection: ${esc(w)}</span>`).join("") : `<span class="chip">${secu.commandsScanned || 0} cmds · clean</span>`);

    const share = opts.share ? `<div class="share" id="share"></div>` : "";

    return `
    <div class="card">
      <div class="top">
        <div class="grade ${gC(s.grade)}">${esc(s.grade)}</div>
        <div><div class="repo">${esc(r.subject.repoName)}</div>
          <div class="head">${esc(s.headline)} · ${s.signalsRun} signals · @ ${esc(String(r.subject.commitHash).slice(0, 10))}</div></div>
      </div>
      <div class="trustbar">
        <span class="hgauge"><span class="hdot"></span>0 numbers from AI</span>
        <span class="htext"><b>${s.signalsRun} deterministic signals</b> across <b>${(sec.filesScanned || 0).toLocaleString()} files</b> — every figure is computed from git, code &amp; package metadata, <b>not one guessed by an AI</b>. Re-run this commit → identical numbers${verified ? ` · <b>signed</b>, verifies offline` : ""}.</span>
      </div>
      <div class="rows">
        <div class="row">${kcell("Dependencies")}<div class="v"><span class="big">${dep.total}</span> total · ${dep.byBand.dead + dep.byBand.moribund} dying · ${(lic["strong-copyleft"] + lic["weak-copyleft"])} copyleft<div class="chips">${depChips}${licChips}</div></div></div>
        <div class="row">${kcell("Secrets")}<div class="v"><span class="big">${sec.totalFindings}</span> in production code · ${sec.filesScanned} files${sec.excludedTestHits ? ` · <span class="muted">+${sec.excludedTestHits} in tests/docs (excluded)</span>` : ""}<div class="chips">${secChips}</div></div></div>
        <div class="row">${kcell("Bus factor")}<div class="v"><span class="big">${bf.busFactor}</span> · top author ${pct(bf.topContributorShare)} · ${pct(bf.singleOwnerFilePct)} files single-owner<div class="chips">${fragile}</div></div></div>
        <div class="row">${kcell("Vitality")}<div class="v"><span class="big">${esc(age.vitality)}</span> · ${esc(age.lifespan)} old · ${age.totalCommits} commits · ${age.totalAuthors} authors</div></div>
        <div class="row">${kcell("Complexity")}<div class="v"><span class="big">${cx.totalSymbols}</span> symbols · ${cx.filesAnalysed} files · max depth ${cx.maxDepth}<div class="chips">${hot}</div></div></div>
        <div class="row">${kcell("Hotspots")}<div class="v"><span class="muted">refactor-ROI · churn × size · last ${hs.windowDays||365}d</span> ${spark}<div class="chips">${hsChips}</div></div></div>
        <div class="row">${kcell("Coupling")}<div class="v"><span class="muted">${(cp.pairs||[]).length} coupled pair(s) · hidden = cross-directory</span><div class="chips">${cpChips}</div></div></div>
        <div class="row">${kcell("Security")}<div class="v"><span class="big">${(secu.destructive||[]).length}</span> destructive cmd(s) · ${secu.commandsScanned||0} checked${secu.injectionFindings?` · ${secu.injectionFindings} doc injection`:""}<div class="chips">${secuChips}</div></div></div>
      </div>
      <div class="foot">${verified}<span>fingerprint <code>${esc(String(r.fingerprint).slice(0, 28))}…</code></span></div>
      ${share}
    </div>`;
  }

  g.MnemeXRay = { xrayCardHTML, gradeClass: gC, esc };
})(window);

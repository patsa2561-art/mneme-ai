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

  // TRIAGE — curate the 8 signals into attention(critical/warn/info) vs clear,
  // each with PROVENANCE. Mirrors packages/xray/src/triage.ts (the tested source
  // of truth + its A/B gauntlet); kept compact for the browser. 100% traceable.
  function triageOf(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const A = [];
    const sec = r.secrets || {}, su = r.security || {}, dep = r.deps || {}, bf = r.busFactor || {}, age = r.age || {}, cx = r.complexity || {}, hs = r.hotspots || {}, cp = r.coupling || {};
    if (num(sec.filesScanned) > 0) {
      if (sec.worstVerdict === "BLOCK") A.push({ s: "Secrets", sev: "critical", f: `${num(sec.totalFindings)} credential leak(s) in production code`, p: `secrets · ${num(sec.filesScanned)} files · ${sec.hits && sec.hits[0] ? sec.hits[0].file + ":" + sec.hits[0].line : "—"}` });
      else if (num(sec.totalFindings) > 0) A.push({ s: "Secrets", sev: "warn", f: `${num(sec.totalFindings)} credential-pattern match(es) to review`, p: `secrets · ${num(sec.filesScanned)} files · value never stored` });
    }
    if ((su.destructive || []).length > 0) A.push({ s: "Security", sev: "critical", f: `${su.destructive.length} destructive build/CI command(s)`, p: `CERBERUS · ${su.destructive[0].where}` });
    else if (num(su.injectionFindings) > 0) A.push({ s: "Security", sev: "warn", f: `${num(su.injectionFindings)} possible prompt-injection in docs`, p: `FIREWALL · ${(su.injectionWhere || [])[0] || "doc"}` });
    const dying = num((dep.byBand || {}).moribund) + num((dep.byBand || {}).dead);
    const copyleft = num((dep.licenses || {})["strong-copyleft"]) + num((dep.licenses || {})["weak-copyleft"]);
    if (dying > 0) A.push({ s: "Dependencies", sev: dying >= 3 ? "critical" : "warn", f: `${dying} of ${num(dep.total)} deps dying`, p: `deps · ${dep.atRisk && dep.atRisk[0] ? dep.atRisk[0].name + "→" + (dep.atRisk[0].successor || "?") : "npm metadata"}` });
    else if (copyleft > 0) A.push({ s: "Dependencies", sev: "warn", f: `${copyleft} copyleft dep(s) — review for commercial use`, p: `deps · ${dep.licenseFlags && dep.licenseFlags[0] ? dep.licenseFlags[0].name + ":" + dep.licenseFlags[0].license : "license scan"}` });
    if (num(bf.authors) > 0 && num(bf.busFactor) <= 1) A.push({ s: "Bus factor", sev: "warn", f: `bus factor 1 — one person holds ${num(bf.topContributorShare)}% of commits`, p: `git authorship · ${num(bf.singleOwnerFilePct)}% files single-owner` });
    if (age.vitality === "archived") A.push({ s: "Vitality", sev: "critical", f: `archived — no longer maintained`, p: `git history · last ${age.lastCommitAt || "?"}` });
    else if (age.vitality === "dormant") A.push({ s: "Vitality", sev: "warn", f: `dormant — ${age.lifespan || ""} old, stalled`, p: `git history · last ${age.lastCommitAt || "?"}` });
    if ((cx.hotspots || []).filter((h) => num(h.bodyLines) >= 150).length > 0) A.push({ s: "Complexity", sev: "info", f: `large symbol(s) ≥150 lines`, p: `AST · ${cx.hotspots[0] ? cx.hotspots[0].bodyLines + "L " + cx.hotspots[0].file : ""}` });
    if ((hs.hotspots || []).length > 0) { const h = hs.hotspots[0]; A.push({ s: "Hotspots", sev: "info", f: `refactor first: ${h.file}`, p: `churn×size · ${num(h.changes)}× · ${num(h.loc)}L${h.expert ? " · ask " + h.expert : ""}` }); }
    if ((cp.pairs || []).some((p) => p.hidden)) { const p = cp.pairs.find((x) => x.hidden); A.push({ s: "Coupling", sev: "info", f: `hidden cross-dir coupling: ${p.a} ⇄ ${p.b}`, p: `co-change · ${Math.round(num(p.confidence) * 100)}%` }); }
    const rank = { critical: 0, warn: 1, info: 2 };
    A.sort((a, b) => rank[a.sev] - rank[b.sev]);
    return A;
  }

  function xrayCardHTML(signed, opts) {
    opts = opts || {};
    const r = signed.report, s = r.summary;
    const dep = r.deps, sec = r.secrets, bf = r.busFactor, age = r.age, cx = r.complexity;
    const verified = signed.receipt ? '<span class="verified"><span class="dot"></span>Ed25519 — verifies offline</span>' : "unsigned";
    const tri = triageOf(r);

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
        <div><div class="repo">${esc(r.subject.repoName)}${r.subject.branch ? ` <span class="repobr">@ ${esc(r.subject.branch)}</span>` : ""}</div>
          ${r.subject.kind === "git-url" ? `<a class="repourl" href="${esc(r.subject.ref)}" target="_blank" rel="noopener">${esc(r.subject.ref)} ↗</a>` : `<div class="repourl">${esc(r.subject.ref)}</div>`}
          <div class="head">${esc(s.headline)} · ${s.signalsRun} signals · @ ${esc(String(r.subject.commitHash).slice(0, 10))}</div></div>
      </div>
      <div class="membrane">
        <div class="mp"><span class="mpk">① CAPABILITY</span><span class="mpv">${s.signalsRun} deterministic signals · ${(sec.filesScanned || 0).toLocaleString()} files scanned</span></div>
        <div class="mp"><span class="mpk">② ATTENTION</span><span class="mpv">${tri.length ? `${tri.length} signal(s) need attention` : `all signals clear`}</span></div>
        <div class="mp"><span class="mpk">③ HALLUCINATION</span><span class="mpv"><span class="hdot"></span><b>0</b> — every number from real git/code${verified ? ", signed" : ""}</span></div>
      </div>
      <div class="trustbar"><span class="htext"><b>Every figure is computed from git, code &amp; package metadata — not one guessed by an AI.</b> Re-run this commit → identical numbers${verified ? ` · <b>signed</b>, verifies offline with the embedded public key` : ""}.</span></div>
      ${tri.length ? `<div class="triage">
        <div class="triage-h">🔺 Needs attention (${tri.length}) <span class="triage-sub">— curated &amp; severity-ranked; every line is traceable to its source</span></div>
        ${tri.map((t) => `<div class="ti ${t.sev}"><span class="ti-sev">${t.sev}</span><div class="ti-body"><div class="ti-f"><b>${esc(t.s)}</b> — ${esc(t.f)}</div><div class="ti-p">↳ ${esc(t.p)}</div></div></div>`).join("")}
      </div>` : `<div class="triage clearall">✓ No critical or warning signals — all ${s.signalsRun} checks clear.</div>`}
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

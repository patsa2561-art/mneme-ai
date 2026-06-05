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

  // VERDICT — turn the accurate metrics into a DECISION a human can act on:
  // "should I trust / adopt / inherit this repo, and what do I do about it?"
  // Every line is derived 100% from a signed metric (no new data, no AI guess).
  function synthesizeVerdict(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const dep = r.deps || {}, sec = r.secrets || {}, bf = r.busFactor || {}, age = r.age || {}, cx = r.complexity || {}, su = r.security || {}, hs = r.hotspots || {};
    const dying = num((dep.byBand || {}).dead) + num((dep.byBand || {}).moribund);
    const copyleft = num((dep.licenses || {})["strong-copyleft"]) + num((dep.licenses || {})["weak-copyleft"]);
    const secrets = num(sec.totalFindings), destructive = (su.destructive || []).length;
    const soloPct = num(bf.singleOwnerFilePct), topShare = num(bf.topContributorShare), busF = num(bf.busFactor);
    const symbols = num(cx.totalSymbols), codeFiles = num(cx.filesAnalysed);
    const isDocs = symbols < 30 && (codeFiles === 0 || symbols / Math.max(1, codeFiles) < 1.5);
    const kind = isDocs ? "Docs / content repo" : "Code project";

    // the takeaways — what it means + what to DO, severity-ranked, action-first
    const T = [];
    if (sec.worstVerdict === "BLOCK" && secrets > 0) T.push({ t: "bad", x: `🔴 ${secrets} live secret${secrets > 1 ? "s" : ""} in production code — rotate them now and add a pre-commit secret scan${sec.hits && sec.hits[0] ? ` (e.g. ${esc(sec.hits[0].file)}:${sec.hits[0].line})` : ""}.` });
    else if (secrets > 0) T.push({ t: "warn", x: `🟠 ${secrets} credential-pattern match${secrets > 1 ? "es" : ""} to review in production code.` });
    if (destructive > 0) T.push({ t: "bad", x: `🔴 ${destructive} destructive command${destructive > 1 ? "s" : ""} in build/CI (${esc((su.destructive[0] || {}).where || "ci")}) — audit before trusting this pipeline.` });
    else if (num(su.injectionFindings) > 0) T.push({ t: "warn", x: `🟠 ${num(su.injectionFindings)} possible prompt-injection in docs — sanitize before feeding to an AI.` });
    if (dying > 0) { const a = (dep.atRisk || [])[0]; T.push({ t: "warn", x: `🟠 ${dying} dependency${dying > 1 ? "ies" : "y"} dying/abandoned — plan a migration${a && a.successor ? ` (e.g. ${esc(a.name)} → ${esc(a.successor)})` : ""}.` }); }
    if (copyleft > 0) T.push({ t: "warn", x: `🟠 ${copyleft} dependency${copyleft > 1 ? "ies" : "y"} with copyleft/unknown license — check before commercial use.` });
    if (age.vitality === "archived" || age.dormant) T.push({ t: "warn", x: `🟠 No recent activity (${esc(age.vitality || "stalled")}) — may be unmaintained; pin a version if you depend on it.` });
    else if (age.vitality === "active") T.push({ t: "ok", x: `✅ Actively maintained — ${num(age.totalCommits).toLocaleString()} commits over ${esc(age.lifespan || "its life")}, ${num(age.totalAuthors)} contributors. Low abandonment risk.` });
    if (busF <= 1 && num(bf.authors) > 0) T.push({ t: "warn", x: `🟠 Key-person risk: one author owns ${topShare}% of commits${soloPct ? ` and ${soloPct}% of files have a single owner` : ""}. If they leave, those areas stall — spread reviews + document.` });
    else if (soloPct >= 40) { const ff = (bf.fragileFiles || []).slice(0, 3).map((x) => esc(x.file)).join(", "); T.push({ t: "warn", x: `🟠 ${soloPct}% of files have a single owner — pair-review the fragile ones${ff ? `: ${ff}` : ""}.` }); }
    if (secrets === 0 && destructive === 0 && dying === 0 && copyleft === 0) T.push({ t: "ok", x: `✅ Clean to adopt — no leaked secrets, no dying/risky-licensed deps, no destructive CI.` });
    if ((hs.hotspots || [])[0] && !isDocs) { const h = hs.hotspots[0]; T.push({ t: "info", x: `ℹ️ If you change one thing first, it's <b>${esc(h.file)}</b> (highest churn×size)${h.expert ? ` — ${esc(h.expert)} knows it best` : ""}.` }); }

    // the headline DECISION (worst-signal-wins)
    const hasRed = secrets > 0 || destructive > 0;
    const stale = age.vitality === "archived" || age.dormant;
    const keyrisk = busF <= 1 || soloPct >= 60;
    let tone, head;
    if (hasRed) { tone = "bad"; head = "⚠️ Exposed risk — fix the red items before you trust this repo"; }
    else if (stale) { tone = "warn"; head = "🪦 Looks unmaintained — risky to depend on without pinning"; }
    else if (dying > 0) { tone = "warn"; head = "Adopt with care — aging dependencies need a migration plan"; }
    else if (keyrisk) { tone = "warn"; head = "✅ Maintained — but ⚠️ concentrated in one person (key-person risk)"; }
    else if (age.vitality === "active") { tone = "ok"; head = `✅ Healthy & actively maintained — safe to build on`; }
    else { tone = "neutral"; head = `Reviewed — ${T.length} thing${T.length === 1 ? "" : "s"} to know below`; }

    // the concrete RISK ITEMS (what exactly + where) — listed, scrollable if long
    const risks = [];
    (sec.hits || []).forEach((h) => risks.push({ g: "Secret", icon: "🔑", t: `${esc(h.kind)} — ${esc(h.file)}:${h.line}` }));
    (su.destructive || []).forEach((d) => risks.push({ g: "Destructive CI", icon: "💥", t: `${esc(d.where)} — ${esc(String(d.command).slice(0, 80))}` }));
    (dep.atRisk || []).filter((d) => d.band === "dead" || d.band === "moribund").forEach((d) => risks.push({ g: "Dying dep", icon: "📦", t: `${esc(d.name)} (${esc(d.band)})${d.successor ? ` → ${esc(d.successor)}` : ""}` }));
    (dep.licenseFlags || []).forEach((l) => risks.push({ g: "License", icon: "⚖️", t: `${esc(l.name)} — ${esc(l.license)}` }));
    (bf.fragileFiles || []).forEach((f) => risks.push({ g: "Single-owner", icon: "👤", t: `${esc(f.file)} — one author owns ${Math.round((f.topAuthorShare || 0) * 100)}%` }));
    (su.injectionWhere || []).forEach((w) => risks.push({ g: "Prompt-injection", icon: "🧪", t: esc(w) }));

    const top = T.slice(0, 5);
    return { tone, head, kind, takeaways: top, risks };
  }

  // RISK MAP — mirrors packages/xray/src/riskmap.ts (the tested + 100k-stressed source
  // of truth). Every node/edge is verbatim from the signed report; nothing invented.
  function mix(a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
  const riskColor = (t) => (t < 0.5 ? mix("#16a34a", "#d97706", t / 0.5) : mix("#d97706", "#e11d48", (t - 0.5) / 0.5));
  // RISK MAP — a ranked KEY-PERSON-RISK bar chart (NOT a bubble cloud). Instantly
  // readable: one row per file, bar length = single-author share (risk if they leave),
  // colour by severity, worst on top, a "↔N" badge for how many files it's coupled to.
  // Every value verbatim from the signed report — no AI guessed it, nothing overlaps.
  function riskMapHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0), strv = (x) => (typeof x === "string" ? x : "");
    const bf = r.busFactor || {}, hs = r.hotspots || {}, cp = r.coupling || {};
    const base = (f) => { const p = String(f).split("/"); return p[p.length - 1] || f; };
    // coupling degree per file (how many distinct files it changes with)
    const deg = new Map();
    (cp.pairs || []).forEach((p) => { const a = strv(p && p.a), b = strv(p && p.b); if (!a || !b || a === b) return; if (!deg.has(a)) deg.set(a, new Set()); if (!deg.has(b)) deg.set(b, new Set()); deg.get(a).add(b); deg.get(b).add(a); });
    const churn = new Map(); (hs.hotspots || []).forEach((x) => { const f = strv(x && x.file); if (f) churn.set(f, Math.max(churn.get(f) || 0, num(x.changes))); });
    // the key-person list = files with a measured single-author share, worst-first
    let files = (bf.fragileFiles || []).map((x) => ({ file: strv(x && x.file), pct: Math.min(1, Math.max(0, num(x.topAuthorShare))), commits: num(x && x.commits) })).filter((x) => x.file);
    files.sort((a, b) => (b.pct - a.pct) || (b.commits - a.commits) || a.file.localeCompare(b.file));
    files = files.slice(0, 12);
    if (!files.length) return `<div class="riskmap"><div class="rmhead">🔑 Key-person risk</div><div class="rmsub">✓ No single-owner files — knowledge is well spread across the team. Nobody is a single point of failure.</div></div>`;
    const sevColor = (p) => (p >= 0.9 ? "#e11d48" : p >= 0.75 ? "#f97316" : p >= 0.6 ? "#eab308" : "#22c55e");
    const sevWord = (p) => (p >= 0.9 ? "critical" : p >= 0.75 ? "high" : p >= 0.6 ? "watch" : "ok");
    const critical = files.filter((f) => f.pct >= 0.9).length;
    const rows = files.map((f) => {
      const c = deg.has(f.file) ? deg.get(f.file).size : 0;
      const col = sevColor(f.pct), pctN = Math.round(f.pct * 100);
      return `<div class="rmbar" title="${esc(f.file)} — ${pctN}% by one author${c ? `, coupled to ${c} file(s)` : ""}">
        <span class="rmbf">${esc(base(f.file))}</span>
        <span class="rmtrack"><span class="rmfill" style="width:${pctN}%;background:${col}"></span></span>
        <span class="rmval" style="color:${col}">${pctN}%</span>
        <span class="rmcouple">${c ? `↔${c}` : ""}</span>
      </div>`;
    }).join("");
    return `<div class="riskmap">
      <div class="rmhead">🔑 Key-person risk — <b>if one person is away, what's exposed</b></div>
      <div class="rmsub">Each bar is a file. <b>Longer &amp; redder = more of it was written by a single person</b> — so it's riskier if they leave. <b>↔N</b> = it changes together with N other files. Worst on top. Measured from git history — nothing invented.</div>
      <div class="rmbars">${rows}</div>
      <div class="rmleg"><span><i style="background:#e11d48"></i>critical ≥90%</span><span><i style="background:#f97316"></i>high ≥75%</span><span><i style="background:#eab308"></i>watch ≥60%</span><span class="rmsummary">${files.length} owned file(s)${critical ? ` · <b style="color:#be123c">${critical} critical</b>` : ""}</span></div>
    </div>`;
  }

  // BLAST RADIUS — mirrors packages/xray/src/riskmap.ts buildBlastRadius (tested + 100k).
  // "When you changed A, these changed too N% of the time" — measured history, verbatim.
  function blastRadiusHTML(r) {
    const strv = (x) => (typeof x === "string" ? x : ""), num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const pairs = ((r.coupling || {}).pairs) || []; const adj = new Map();
    const add = (f, t, c, co, h) => { if (!f || !t || f === t) return; if (!adj.has(f)) adj.set(f, []); adj.get(f).push({ file: t, c: Math.min(1, Math.max(0, c)), co, h }); };
    pairs.forEach((p) => { const a = strv(p && p.a), b = strv(p && p.b); if (!a || !b) return; const c = num(p.confidence), co = num(p.coChanges), h = !!(p && p.hidden); add(a, b, c, co, h); add(b, a, c, co, h); });
    if (!adj.size) return "";
    const base = (f) => { const x = String(f).split("/"); return x[x.length - 1]; };
    let targets = [...adj.entries()].map(([file, ps]) => { ps.sort((x, y) => y.c - x.c || x.file.localeCompare(y.file)); return { file, reach: ps.reduce((s, x) => s + x.c, 0), partners: ps.slice(0, 5) }; });
    targets.sort((a, b) => b.reach - a.reach || a.file.localeCompare(b.file));
    targets = targets.slice(0, 6);
    // DEEP RIPPLE (2-hop) — mirrors riskmap.ts buildDeepBlast. The widest-blast file +
    // the files reached indirectly through its partners. 2nd hop = weaker, labelled so.
    const dadj = new Map();
    pairs.forEach((p) => { const a = strv(p && p.a), b = strv(p && p.b); if (!a || !b || a === b) return; if (!dadj.has(a)) dadj.set(a, new Set()); if (!dadj.has(b)) dadj.set(b, new Set()); dadj.get(a).add(b); dadj.get(b).add(a); });
    let dtop = "", dbest = -1; [...dadj.entries()].sort((x, y) => x[0].localeCompare(y[0])).forEach(([f, s]) => { if (s.size > dbest) { dbest = s.size; dtop = f; } });
    let deepLine = "";
    if (dtop) { const dir = dadj.get(dtop), ind = new Set(); dir.forEach((d) => (dadj.get(d) || new Set()).forEach((e) => { if (e !== dtop && !dir.has(e)) ind.add(e); })); deepLine = `<div class="bldeep">🌊 <b>Full ripple depth:</b> editing <code>${esc(base(dtop))}</code> touches <b>${dir.size}</b> file${dir.size > 1 ? "s" : ""} directly${ind.size ? ` + <b>${ind.size}</b> more indirectly (2 hops) = <b>${dir.size + ind.size}</b> total reach` : ""}.</div>`; }
    return `<div class="blast">
      <div class="blhead">💥 Change impact — <b>edit one file, what historically moves with it</b></div>
      <div class="blsub">Measured from git history (not a prediction): when these files changed, their partners changed too. Review them together to avoid surprise breakage.</div>
      ${targets.map((t) => `<div class="blrow"><span class="blf">✏️ ${esc(base(t.file))}</span><span class="blarrow">→</span><span class="blp">${t.partners.map((p) => `<span class="blpill${p.h ? " hidden" : ""}">${esc(base(p.file))} <b>${Math.round(p.c * 100)}%</b></span>`).join("")}</span></div>`).join("")}
      ${deepLine}
    </div>`;
  }

  // MOMENTUM — mirrors packages/xray/src/intel.ts buildMomentum (tested + 100k).
  // "Is this repo speeding up or slowing down?" from the commit-activity trend.
  function momentumHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const buckets = (((r.hotspots || {}).trend) || []).map((x) => Math.max(0, num(x)));
    const total = buckets.reduce((s, x) => s + x, 0);
    if (buckets.length < 4 || total === 0) return "";
    const mid = Math.floor(buckets.length / 2);
    const earlier = buckets.slice(0, mid).reduce((s, x) => s + x, 0), recent = buckets.slice(mid).reduce((s, x) => s + x, 0);
    const ratio = recent / Math.max(1, earlier), pct = Math.round(ratio * 100);
    const v = ratio >= 1.25 ? { w: "accelerating", i: "🚀", c: "#16a34a" } : ratio >= 0.75 ? { w: "steady", i: "➡️", c: "#3a3df0" } : ratio >= 0.4 ? { w: "slowing", i: "🐢", c: "#d97706" } : { w: "winding down", i: "🍂", c: "#be123c" };
    return `<div class="momentum"><span class="moi">${v.i}</span><div class="mobody"><div class="moh">Momentum — <b style="color:${v.c}">${v.w}</b></div><div class="mosub">Commit activity over time · recent period is <b>${pct}%</b> of the earlier one ${sparkline(buckets)}</div></div></div>`;
  }

  // KEYSTONE RISK — mirrors packages/xray/src/intel.ts buildKeystones (tested + 100k).
  // The novel composite no SonarQube/Snyk computes: a file whose change RIPPLES widely
  // (temporal coupling) AND is written almost entirely by one author. Both are git facts.
  function keystoneHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0), strv = (x) => (typeof x === "string" ? x : "");
    const baseN = (f) => { const p = String(f).split("/"); return p[p.length - 1] || f; };
    const pairs = ((r.coupling || {}).pairs) || []; const adj = new Map();
    const add = (f, t, c) => { if (!f || !t || f === t) return; if (!adj.has(f)) adj.set(f, { reach: 0, parts: new Set() }); const o = adj.get(f); o.reach += Math.min(1, Math.max(0, c)); o.parts.add(t); };
    pairs.forEach((p) => { const a = strv(p && p.a), b = strv(p && p.b); if (!a || !b) return; const c = num(p.confidence); add(a, b, c); add(b, a, c); });
    const owner = new Map(); (((r.busFactor || {}).fragileFiles) || []).forEach((x) => { const f = strv(x && x.file); if (f) owner.set(f, Math.max(owner.get(f) || 0, Math.min(1, Math.max(0, num(x.topAuthorShare))))); });
    const expert = new Map(); (((r.hotspots || {}).hotspots) || []).forEach((x) => { const f = strv(x && x.file), e = strv(x && x.expert); if (f && e) expert.set(f, e); });
    let ks = [...adj.entries()].map(([file, o]) => ({ file, reach: o.reach, partners: o.parts.size, ownerPct: owner.get(file) || 0, expert: expert.get(file) || null })).filter((k) => k.ownerPct >= 0.6);
    ks.forEach((k) => { k.score = k.reach * k.ownerPct; });
    ks.sort((a, b) => b.score - a.score || b.reach - a.reach || a.file.localeCompare(b.file));
    ks = ks.slice(0, 3);
    if (!ks.length) return "";
    return `<div class="keystone">
      <div class="kshead">🔑 Keystone risk — <b>your single points of catastrophe</b></div>
      <div class="kssub">Files that <b>ripple widely</b> when changed <b>and</b> are written almost entirely by <b>one person</b>. If that person is away, a wide blast radius has no second expert. Change-coupling × authorship — both measured from git, nothing invented.</div>
      ${ks.map((k) => `<div class="ksrow"><span class="ksf">${esc(baseN(k.file))}</span><span class="ksmeta">ripples to <b>${k.partners}</b> file${k.partners > 1 ? "s" : ""} · <b>${Math.round(k.ownerPct * 100)}%</b> one author${k.expert ? ` · ask <b>${esc(k.expert)}</b>` : ""}</span></div>`).join("")}
      <div class="ksact">→ Protect the top path first: document it and pair a second dev <b>before</b> the owner is unavailable.</div>
    </div>`;
  }

  // ONBOARDING PATH — mirrors packages/xray/src/intel.ts buildOnboarding (tested + 100k).
  // "Read files in this order to learn the repo fast" — hub (most-coupled) first.
  function onboardingHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0), strv = (x) => (typeof x === "string" ? x : "");
    const baseN = (f) => { const p = String(f).split("/"); return p[p.length - 1] || f; };
    const cp = r.coupling || {}, hs = r.hotspots || {};
    const deg = new Map();
    (cp.pairs || []).forEach((p) => { const a = strv(p && p.a), b = strv(p && p.b); if (!a || !b || a === b) return; if (!deg.has(a)) deg.set(a, new Set()); if (!deg.has(b)) deg.set(b, new Set()); deg.get(a).add(b); deg.get(b).add(a); });
    const churn = new Map(), expert = new Map();
    (hs.hotspots || []).forEach((x) => { const f = strv(x && x.file); if (!f) return; churn.set(f, Math.max(churn.get(f) || 0, num(x.changes))); const e = strv(x && x.expert); if (e) expert.set(f, e); });
    const files = new Set([...deg.keys(), ...churn.keys()]); if (!files.size) return "";
    const maxC = Math.max(1, ...[...churn.values()]);
    let steps = [...files].map((file) => { const connections = deg.has(file) ? deg.get(file).size : 0, changes = churn.get(file) || 0; return { file, connections, changes, score: connections * 2 + changes / maxC, expert: expert.get(file) || null }; });
    steps.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    steps = steps.slice(0, 8);
    return `<div class="onboard">
      <div class="obhead">📖 Onboarding path — <b>read these first to understand the repo fast</b></div>
      <div class="obsub">A heuristic from git, not a curriculum: the <b>hub</b> (changes with the most files) and busiest files come first — the fastest way for a new dev to grasp the system. Nothing invented.</div>
      <ol class="oblist">${steps.map((s) => `<li class="obrow"><span class="obf">${esc(baseN(s.file))}</span><span class="obwhy">${s.connections > 0 ? `hub · changes with <b>${s.connections}</b> file${s.connections > 1 ? "s" : ""}` : `busy · <b>${s.changes}</b> changes`}${s.expert ? ` · ask <b>${esc(s.expert)}</b>` : ""}</span></li>`).join("")}</ol>
    </div>`;
  }

  // CONTEXT AIR QUALITY — mirrors packages/xray/src/airquality.ts buildAirQuality (tested + 100k).
  // One breathability number: how clean is this codebase for an AI to work in.
  function airQualityHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const arrn = (x) => (Array.isArray(x) ? x : []);
    const W = { secrets: 0.24, destructive: 0.16, ownership: 0.14, coupling: 0.2, deprot: 0.1, complexity: 0.16 };
    const cl = (v) => Math.max(0, Math.min(1, v));
    const sFind = num((r.secrets || {}).totalFindings), destr = arrn((r.security || {}).destructive).length;
    const ownerPct = cl(num((r.busFactor || {}).singleOwnerFilePct) / 100);
    const hidden = arrn((r.coupling || {}).pairs).filter((p) => !!(p && p.hidden)).length;
    const dead = num(((r.deps || {}).byBand || {}).dead), morib = num(((r.deps || {}).byBand || {}).moribund);
    const huge = arrn((r.complexity || {}).hotspots).filter((h) => num(h && h.bodyLines) >= 120).length;
    const imp = { secrets: cl(sFind / 8), destructive: cl(destr / 3), ownership: ownerPct, coupling: cl(hidden / 8), deprot: cl((dead + morib * 0.5) / 8), complexity: cl(huge / 5) };
    const pollution = Object.keys(W).reduce((s, k) => s + W[k] * imp[k], 0);
    const score = Math.round(cl(1 - pollution) * 100);
    const band = score >= 85 ? "Pristine" : score >= 70 ? "Good" : score >= 50 ? "Moderate" : score >= 30 ? "Unhealthy" : "Hazardous";
    const col = score >= 85 ? "#16a34a" : score >= 70 ? "#65a30d" : score >= 50 ? "#d97706" : score >= 30 ? "#ea580c" : "#e11d48";
    const lbl = { secrets: "Leaked secrets", destructive: "Destructive commands", ownership: "Knowledge concentration", coupling: "Hidden coupling", deprot: "Dependency rot", complexity: "Oversized functions" };
    const det = { secrets: `${sFind} secret pattern(s)`, destructive: `${destr} destructive cmd(s)`, ownership: `${Math.round(ownerPct * 100)}% single-owner`, coupling: `${hidden} hidden link(s)`, deprot: `${dead} dead + ${morib} moribund`, complexity: `${huge} oversized fn(s)` };
    const polls = Object.keys(W).map((k) => ({ k, impact: imp[k] })).filter((p) => p.impact > 0).sort((a, b) => b.impact - a.impact);
    return `<div class="aq">
      <div class="aqgauge"><div class="aqring" style="background:conic-gradient(${col} ${score * 3.6}deg,#eef0f2 0)"><div class="aqnum" style="color:${col}">${score}</div></div></div>
      <div class="aqbody">
        <div class="aqhead">🫁 Context Air Quality — <b style="color:${col}">${band}</b> <span class="aqof">/100</span></div>
        <div class="aqsub">How clean this codebase is for an <b>AI to work in</b> — a weighted composite of measured signals. <i>Not a hallucination forecast.</i></div>
        ${polls.length ? `<div class="aqpolls">${polls.slice(0, 4).map((p) => `<span class="aqpill" title="${esc(det[p.k])}"><i style="background:${p.impact >= 0.66 ? "#e11d48" : p.impact >= 0.33 ? "#d97706" : "#eab308"}"></i>${esc(lbl[p.k])}</span>`).join("")}</div>` : `<div class="aqclean">✓ no measured pollutants — clean air</div>`}
      </div>
    </div>`;
  }

  // CODE STABILITY — the showcase signal: how much work SURVIVED (revert/hotfix from git).
  function stabilityHTML(r) {
    const s = r.stability; if (!s || !s.commits) return "";
    const col = s.survivalPct >= 95 ? "#16a34a" : s.survivalPct >= 85 ? "#65a30d" : s.survivalPct >= 70 ? "#d97706" : "#e11d48";
    const base = (f) => { const p = String(f).split("/"); return p[p.length - 1] || f; };
    return `<div class="stab">
      <div class="stabhead">🔄 Code Stability — <b style="color:${col}">${s.survivalPct}% survived</b> <span class="staboff">(last ${s.windowDays}d · from git, no AI)</span></div>
      <div class="stabsub"><b>${s.didNotSurvive}</b> of ${s.commits} recent commits were later <b>reverted or hotfixed</b> (${s.explicitReverts} explicit revert${s.explicitReverts !== 1 ? "s" : ""} = proof · ${s.hotfixSignals} hotfix signal${s.hotfixSignals !== 1 ? "s" : ""} = weaker). Everyone measures "did it ship"; this measures "did it <b>last</b>".</div>
      ${s.unstableFiles.length ? `<div class="stabfiles">Most-reverted files: ${s.unstableFiles.map((f) => `<span class="stabpill">${esc(base(f.file))} <b>×${f.reverts}</b></span>`).join("")}</div>` : `<div class="stabclean">✓ no repeatedly-reverted files — stable</div>`}
    </div>`;
  }

  // AGENT-READINESS — is this repo safe for an autonomous AI agent to work in?
  function agentReadyHTML(r) {
    const a = r.agentReady; if (!a || !a.signals) return "";
    const col = a.band === "ready" ? "#16a34a" : a.band === "caution" ? "#d97706" : "#e11d48";
    const lbl = a.band === "ready" ? "READY" : a.band === "caution" ? "CAUTION" : "RISKY";
    const chip = (s) => `<span class="archip ${s.present ? "on" : "off"}">${s.present ? "✓" : "✗"} ${esc(s.label)}</span>`;
    return `<div class="ar">
      <div class="arhead">🤖 Agent-Readiness — <b style="color:${col}">${a.score}/100 · ${lbl}</b> <span class="aroff">(safe for an autonomous AI agent?)</span></div>
      <div class="arsub">${esc(a.note)}</div>
      <div class="archips">${a.signals.map(chip).join("")}</div>
    </div>`;
  }

  function xrayCardHTML(signed, opts) {
    opts = opts || {};
    g.__lastSigned = signed;   // stash for the "Verify signature" proof button
    const r = signed.report, s = r.summary;
    const dep = r.deps, sec = r.secrets, bf = r.busFactor, age = r.age, cx = r.complexity;
    const verified = signed.receipt ? '<span class="verified"><span class="dot"></span>Ed25519 — verifies offline</span>' : "unsigned";
    const tri = triageOf(r);
    const vd = synthesizeVerdict(r);

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
      <div class="verdict v-${vd.tone}">
        <div class="vhead">${esc(vd.head)}</div>
        <div class="vkind">${esc(vd.kind)} · what this means for you ↓</div>
        <ul class="vlist">${vd.takeaways.map((t) => `<li class="vt-${t.t}">${t.x}</li>`).join("")}</ul>
        ${vd.risks.length ? `<details class="vrisks"${vd.risks.length <= 6 ? " open" : ""}><summary>📋 ${vd.risks.length} flagged item${vd.risks.length > 1 ? "s" : ""} — exactly what &amp; where</summary>
          <div class="vrlist">${vd.risks.map((k) => `<div class="vr"><span class="vrg">${k.icon} ${k.g}</span><span class="vrt">${k.t}</span></div>`).join("")}</div></details>` : ""}
      </div>
      ${airQualityHTML(r)}
      ${stabilityHTML(r)}
      ${agentReadyHTML(r)}
      ${momentumHTML(r)}
      ${keystoneHTML(r)}
      ${riskMapHTML(r)}
      ${blastRadiusHTML(r)}
      ${onboardingHTML(r)}
      <div class="membrane">
        <div class="mp"><span class="mpk">CAPABILITY</span><span class="mpv">${s.signalsRun} deterministic signals · ${(sec.filesScanned || 0).toLocaleString()} files scanned</span></div>
        <div class="mp"><span class="mpk">ATTENTION</span><span class="mpv">${tri.length ? `${tri.length} signal(s) need attention` : `all signals clear`}</span></div>
      </div>
      <div class="trustbar"><span class="hdot"></span><div class="htext"><b>Reproducible — not hallucinated.</b> An LLM is random (different every run); X-Ray is plain code reading git, so re-running this commit gives the <b>byte-identical</b> result — that's why nothing here is AI-guessed. ${verified ? `Fingerprint <code class="fp">${esc(String(r.fingerprint).slice(0, 16))}…</code> · <button class="verifybtn" type="button" data-verify>Verify signature ↗</button>` : ""}</div></div>
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
      <div class="foot${verified ? " foot-v" : ""}"${verified ? ' data-verify role="button" tabindex="0" title="Re-check this report\'s signature"' : ""}>${verified}<span class="footfp">fingerprint <code>${esc(String(r.fingerprint).slice(0, 20))}…</code></span>${verified ? `<span class="footgo">Tamper-proof — click to verify ↗</span>` : ""}</div>
      ${share}
    </div>`;
  }

  g.MnemeXRay = { xrayCardHTML, gradeClass: gC, esc, riskMapHTML };

  // CLICK-TO-ENLARGE the risk map — one delegated listener (works on every page that
  // loads card.js, every browser, mobile). Builds a responsive modal on first open.
  if (typeof document !== "undefined" && !g.__rmZoomBound) {
    g.__rmZoomBound = true;
    const close = () => { const m = document.getElementById("rmmodal"); if (m) m.style.display = "none"; };
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest(".rmmodal-close")) { close(); return; }
      if (t && t.id === "rmmodal") { close(); return; }
      const z = t && t.closest && t.closest(".rmzoom");
      if (z) {
        const svg = z.querySelector("svg"); if (!svg) return;
        let m = document.getElementById("rmmodal");
        if (!m) { m = document.createElement("div"); m.id = "rmmodal"; m.className = "rmmodal"; document.body.appendChild(m); }
        m.innerHTML = `<div class="rmmodal-box"><div class="rmmodal-bar"><b>🗺 Risk map</b> — red = single-owner (key-person risk) · size = churn · line = files that change together<button class="rmmodal-close" aria-label="close">✕</button></div><div class="rmmodal-svg">${svg.outerHTML}</div></div>`;
        m.style.display = "flex";
      }
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { close(); closeVf(); } });

    // ── "Verify signature" — opens a real proof modal a skeptic can read. ──────
    // It re-checks the Ed25519 receipt AND recomputes the report's sha256 in the
    // visitor's own browser-facing call, then shows BOTH hashes matching. The point
    // (what users kept asking): it proves not one number was edited after signing —
    // no AI, no trust in us required. Tamper any metric → this turns red.
    const closeVf = () => { const m = document.getElementById("vfmodal"); if (m) m.style.display = "none"; };
    function vfRow(k, v, mono) { return `<div class="vfr"><span class="vfk">${k}</span><span class="vfv${mono ? " mono" : ""}">${v}</span></div>`; }
    function renderVf(v) {
      const ok = v && v.valid;
      const sh = String((v && v.signedHash) || "").slice(0, 24), rh = String((v && v.recomputedHash) || "").slice(0, 24);
      const when = v && v.signedAt ? new Date(v.signedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
      let m = document.getElementById("vfmodal");
      if (!m) { m = document.createElement("div"); m.id = "vfmodal"; m.className = "vfmodal"; document.body.appendChild(m); }
      m.innerHTML = `<div class="vfbox ${ok ? "ok" : "bad"}">
        <button class="vfclose" aria-label="close">✕</button>
        <div class="vfhero">
          <div class="vfseal">${ok ? "✓" : "✗"}</div>
          <div><div class="vfbig">${ok ? "Signature verified" : "Tamper detected"}</div>
          <div class="vfsub">${ok
            ? "Every number in this report is cryptographically sealed. You don’t have to trust us — here’s the proof."
            : "This report does not match what was signed. " + esc(String((v && v.reason) || "")) }</div></div>
        </div>
        <div class="vfmatch ${v && v.hashesMatch ? "y" : "n"}">
          <div class="vfmatch-h">${v && v.hashesMatch ? "🔒 Fingerprint matches" : "⚠ Fingerprint mismatch"}</div>
          <div class="vfhash"><span>signed&nbsp;&nbsp;</span><code>${esc(sh)}…</code></div>
          <div class="vfhash"><span>recomputed</span><code>${esc(rh)}…</code></div>
          <div class="vfwhy">We recomputed the sha256 over the report you’re reading <b>right now</b>. ${v && v.hashesMatch
            ? "It equals the hash signed at build time — so not a single metric was altered."
            : "It differs from the signed hash — a number was changed after sealing."}</div>
        </div>
        ${vfRow("Algorithm", esc(String((v && v.algorithm) || "ED25519")) + " · asymmetric, verifiable offline", false)}
        ${vfRow("Issuer key", esc(String((v && v.issuerFingerprint) || "—")), true)}
        ${vfRow("Sealed at", esc(when), false)}
        <div class="vffoot">No LLM produced any of these numbers. The same commit always yields this same fingerprint — that determinism is the anti-hallucination guarantee.</div>
      </div>`;
      m.style.display = "flex";
    }
    document.addEventListener("click", async (ev) => {
      const t = ev.target;
      if (t && t.closest && (t.closest(".vfclose") || t.id === "vfmodal")) { closeVf(); return; }
      const b = t && t.closest && t.closest("[data-verify]");
      if (!b || !g.__lastSigned) return;
      ev.preventDefault();
      const old = b.textContent; b.textContent = "verifying…"; b.disabled = true;
      try {
        const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(g.__lastSigned) });
        renderVf(await res.json());
      } catch { /* offline: still prove the hash locally is unavailable without server */ }
      b.textContent = old; b.disabled = false;
    });
  }
})(window);

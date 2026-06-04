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
  function riskMapHTML(r) {
    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0), strv = (x) => (typeof x === "string" ? x : "");
    const bf = r.busFactor || {}, hs = r.hotspots || {}, cx = r.complexity || {}, cp = r.coupling || {};
    const W = 960, H = 520, CAP = 22, PAD = 64, byFile = new Map();
    const nodeR = (size) => 17 + Math.min(1, Math.max(0, size)) * 30;
    const touch = (f) => { f = strv(f); if (!f) return null; if (!byFile.has(f)) byFile.set(f, { o: 0, c: 0, l: 0 }); return byFile.get(f); };
    (bf.fragileFiles || []).forEach((x) => { const n = touch(x && x.file); if (n) n.o = Math.max(n.o, Math.min(1, Math.max(0, num(x.topAuthorShare)))); });
    (hs.hotspots || []).forEach((x) => { const n = touch(x && x.file); if (n) { n.c = Math.max(n.c, num(x.changes)); n.l = Math.max(n.l, num(x.loc)); } });
    (cx.hotspots || []).forEach((x) => { const n = touch(x && x.file); if (n) n.l = Math.max(n.l, num(x.bodyLines)); });
    const pairs = cp.pairs || []; pairs.forEach((p) => { touch(p && p.a); touch(p && p.b); });
    if (!byFile.size) return "";
    const mc = Math.max(1, ...[...byFile.values()].map((v) => v.c)), ml = Math.max(1, ...[...byFile.values()].map((v) => v.l));
    let es = [...byFile.entries()].map(([file, v]) => ({ file, risk: Math.min(1, Math.max(0, v.o)), size: Math.min(1, Math.max(v.c / mc, v.l / ml)), ownerPct: v.o, churn: v.c }));
    es.sort((a, b) => (b.risk - a.risk) || (b.size - a.size) || a.file.localeCompare(b.file));
    es = es.slice(0, CAP);
    const idx = new Map(es.map((e, i) => [e.file, i]));
    const cxC = W / 2, cyC = H / 2, GOLD = 2.399963229728653, RX = W / 2 - PAD, RY = H / 2 - PAD, N = es.length;
    const nodes = es.map((e, i) => { const frac = N <= 1 ? 0 : Math.sqrt((i + 0.5) / N), ang = i * GOLD; return { ...e, i, r: nodeR(e.size), x: Math.min(W - PAD, Math.max(PAD, cxC + RX * frac * Math.cos(ang))), y: Math.min(H - PAD, Math.max(PAD, cyC + RY * frac * Math.sin(ang))) }; });
    const base = (f) => { const p = String(f).split("/"); return p[p.length - 1]; };
    const edges = [];
    pairs.forEach((p) => { const a = idx.get(strv(p && p.a)), b = idx.get(strv(p && p.b)); if (a === undefined || b === undefined || a === b) return; edges.push({ a, b, w: Math.min(1, Math.max(0, num(p.confidence))), hidden: !!(p && p.hidden) }); });
    const edgeSvg = edges.map((e) => { const A = nodes[e.a], B = nodes[e.b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 30; return `<path d="M${A.x.toFixed(1)} ${A.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}" fill="none" stroke="${e.hidden ? "#e11d48" : "#7c83f6"}" stroke-width="${(1 + e.w * 2.6).toFixed(2)}" stroke-opacity="${(0.22 + e.w * 0.5).toFixed(2)}" stroke-linecap="round"${e.hidden ? ' stroke-dasharray="6 5"' : ""}/>`; }).join("");
    // glossy spheres: soft glow + body + top-left highlight + white rim
    const nodeSvg = nodes.map((n) => { const R = n.r, col = riskColor(n.risk), showLabel = n.i < 9 || n.risk >= 0.65; const lbl = esc(base(n.file)).slice(0, 24) + (n.ownerPct >= 0.5 ? ` · ${Math.round(n.ownerPct * 100)}%` : ""); const lw = lbl.length * 6.4 + 14, ly = n.y + R + 7;
      return `<g><circle cx="${n.x}" cy="${n.y}" r="${(R + 11).toFixed(1)}" fill="${col}" opacity="0.12"/><circle cx="${n.x}" cy="${n.y}" r="${R.toFixed(1)}" fill="${col}" opacity="0.95"/><circle cx="${(n.x - R * 0.3).toFixed(1)}" cy="${(n.y - R * 0.32).toFixed(1)}" r="${(R * 0.52).toFixed(1)}" fill="#ffffff" opacity="0.22"/><circle cx="${n.x}" cy="${n.y}" r="${R.toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.7"/>${showLabel ? `<g><rect x="${(n.x - lw / 2).toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="19" rx="9.5" fill="#ffffff" opacity="0.92" stroke="#ececef"/><text x="${n.x}" y="${(ly + 13).toFixed(1)}" text-anchor="middle" font-size="11.5" fill="#33333b" font-family="ui-monospace,Menlo,monospace">${lbl}</text></g>` : ""}</g>`; }).join("");
    const owned = nodes.filter((n) => n.risk >= 0.6).length;
    // TOP key-person risks as WORDS (the part a CEO/dev reads) — concrete + actionable
    const topRisk = nodes.filter((n) => n.risk >= 0.5).slice(0, 6);
    const riskList = topRisk.length ? `<div class="rmlist"><div class="rmlt">⚠️ Top key-person risks — fix these first</div>${topRisk.map((n) => `<div class="rmli"><span class="rmdot" style="background:${riskColor(n.risk)}"></span><b>${esc(base(n.file))}</b><span class="rmwhy">one author owns <b>${Math.round(n.ownerPct * 100)}%</b> of its history — add a reviewer / write docs before they leave</span></div>`).join("")}</div>` : `<div class="rmlist rmok">✓ No single-owner files — knowledge is well spread across the team.</div>`;
    return `<div class="riskmap">
      <div class="rmhead">🗺 Risk map — <b>who holds the keys, and what breaks if they leave</b></div>
      <div class="rmsub"><b>How to read:</b> each circle is a file · <b>red</b> = only one person knows it (key-person risk) · <b>bigger</b> = changes more often · <b>lines</b> = files that always change together. Click the map to enlarge. Every value is verbatim from the signed report — no AI guessed it.</div>
      <div class="rmsvgwrap rmzoom" title="click to enlarge"><svg class="rmsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="repository risk map">${edgeSvg}${nodeSvg}</svg><span class="rmexpand">⤢ enlarge</span></div>
      <div class="rmleg"><span><i style="background:#16a34a"></i>shared / safe</span><span><i style="background:#d97706"></i>concentrated</span><span><i style="background:#e11d48"></i>single-owner</span><span><i class="dash"></i>hidden cross-dir coupling</span><span class="rmsummary">${nodes.length} files · ${edges.length} links${owned ? ` · <b style="color:#be123c">${owned} single-owner</b>` : ""}</span></div>
      ${riskList}
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
    return `<div class="blast">
      <div class="blhead">💥 Change impact — <b>edit one file, what historically moves with it</b></div>
      <div class="blsub">Measured from git history (not a prediction): when these files changed, their partners changed too. Review them together to avoid surprise breakage.</div>
      ${targets.map((t) => `<div class="blrow"><span class="blf">✏️ ${esc(base(t.file))}</span><span class="blarrow">→</span><span class="blp">${t.partners.map((p) => `<span class="blpill${p.h ? " hidden" : ""}">${esc(base(p.file))} <b>${Math.round(p.c * 100)}%</b></span>`).join("")}</span></div>`).join("")}
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
      ${riskMapHTML(r)}
      ${blastRadiusHTML(r)}
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
      <div class="foot">${verified}<span>fingerprint <code>${esc(String(r.fingerprint).slice(0, 28))}…</code></span></div>
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
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    // "Verify signature" — re-checks the Ed25519 receipt via /api/verify (the proof a
    // skeptic can run themselves). Honest: a genuine report verifies; a tampered one fails.
    document.addEventListener("click", async (ev) => {
      const b = ev.target && ev.target.closest && ev.target.closest("[data-verify]");
      if (!b || !g.__lastSigned) return;
      const old = b.textContent; b.textContent = "verifying…"; b.disabled = true;
      try {
        const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(g.__lastSigned) });
        const v = await res.json();
        b.textContent = v && v.valid ? "✓ signature valid (verified offline-style)" : "✗ " + ((v && v.reason) || "invalid");
        b.style.color = v && v.valid ? "#15803d" : "#be123c";
      } catch { b.textContent = old; b.disabled = false; }
    });
  }
})(window);

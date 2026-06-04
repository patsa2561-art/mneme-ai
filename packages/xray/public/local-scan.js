/**
 * In-browser LOCAL FOLDER scan — zero install, no terminal, NOTHING uploaded.
 *
 * A website cannot read your disk on its own (browser security). The File System
 * Access API is the honest exception: the user clicks "Choose folder", the OS
 * shows a native picker, and ONLY the folder they grant is readable — and only by
 * code running in their own tab. We read the files in the browser, run the
 * deterministic file-content analyzers (secrets · dependencies · size), and render
 * the result locally. The bytes never leave the machine.
 *
 * Honest scope: git-history signals (bus factor · vitality · hotspots · coupling)
 * need git, which a browser cannot run — those need the public URL or the bridge.
 * This is the instant, no-install "what's in this folder" scan.
 */
(function (g) {
  // ── pure, deterministic analyzers (unit-testable, no DOM) ──────────────────
  const SECRET_PATTERNS = [
    { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: "AWS secret key", re: /\b[A-Za-z0-9/+]{40}\b(?=.*aws|.*secret)/i },
    { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
    { kind: "OpenAI key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
    { kind: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
    { kind: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
    { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { kind: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
    { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  ];
  // test/fixture/doc files are sample data, not leaks — excluded from the count
  const TEST_RE = /(^|\/)(test|tests|__tests__|fixtures?|examples?|docs?|spec|mocks?)(\/|$)|\.(test|spec)\.|\.md$|\.lock$/i;
  const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|h|cpp|cc|rb|php|cs|kt|swift|scala|sh|bash|env|json|ya?ml|toml|ini|cfg|xml|gradle|properties|tf|sql|vue|svelte)$/i;
  const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__|\.venv|target)(\/|$)/;

  function scanSecretsText(text, relPath) {
    const isTest = TEST_RE.test(relPath || "");
    const hits = [];
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(lines[i])) { hits.push({ kind: p.kind, file: relPath, line: i + 1, isTest }); }
      }
    }
    return hits;
  }

  function parseDeps(pkgJsonText) {
    try {
      const p = JSON.parse(pkgJsonText);
      const d = Object.keys(p.dependencies || {});
      const dev = Object.keys(p.devDependencies || {});
      return { total: d.length + dev.length, deps: d.length, devDeps: dev.length, names: [...d, ...dev].slice(0, 60) };
    } catch { return { total: 0, deps: 0, devDeps: 0, names: [] }; }
  }

  /** Compose a deterministic local report from already-read files. Pure. */
  function summarize(files) {
    // files: [{ rel, text }]
    let loc = 0, scanned = 0, testHits = 0;
    const prodHits = [];
    const langs = {};
    let deps = { total: 0, deps: 0, devDeps: 0, names: [] };
    for (const f of files) {
      if (SKIP_DIR.test(f.rel)) continue;
      if (/(^|\/)package\.json$/.test(f.rel) && !/node_modules/.test(f.rel)) deps = parseDeps(f.text);
      if (!TEXT_EXT.test(f.rel)) continue;
      scanned++;
      loc += f.text.split("\n").length;
      const ext = (f.rel.match(/\.([a-z0-9]+)$/i) || [, "?"])[1].toLowerCase();
      langs[ext] = (langs[ext] || 0) + 1;
      for (const h of scanSecretsText(f.text, f.rel)) { if (h.isTest) testHits++; else prodHits.push(h); }
    }
    return {
      filesScanned: scanned, loc, deps,
      secrets: { totalFindings: prodHits.length, excludedTestHits: testHits, hits: prodHits.slice(0, 20) },
      langs: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }

  g.MnemeLocalScan = { scanSecretsText, parseDeps, summarize, _patterns: SECRET_PATTERNS };

  // ── File System Access glue (browser-only; needs a user gesture + HTTPS) ────
  g.MnemeLocalScan.supported = typeof g.showDirectoryPicker === "function";

  async function readDir(dirHandle, prefix, out, cap) {
    for await (const [name, handle] of dirHandle.entries()) {
      const rel = prefix ? prefix + "/" + name : name;
      if (SKIP_DIR.test(rel) || name.startsWith(".")) continue;
      if (out.length >= cap) return;
      if (handle.kind === "directory") { await readDir(handle, rel, out, cap); }
      else if (TEXT_EXT.test(rel) || /(^|\/)package\.json$/.test(rel)) {
        try { const file = await handle.getFile(); if (file.size <= 2 * 1024 * 1024) out.push({ rel, text: await file.text() }); } catch { /* skip unreadable */ }
      }
    }
  }

  /** Open the OS folder picker, read text files in-browser, return the summary +
   *  the folder name. Throws on user-cancel (caller catches). cap bounds the walk. */
  g.MnemeLocalScan.pickAndScan = async function pickAndScan(cap = 4000) {
    if (!g.MnemeLocalScan.supported) throw new Error("UNSUPPORTED");
    const dir = await g.showDirectoryPicker(); // native picker — user grants ONE folder
    const files = [];
    await readDir(dir, "", files, cap);
    return { folder: dir.name || "folder", files: files.length, summary: summarize(files) };
  };
})(typeof window !== "undefined" ? window : globalThis);

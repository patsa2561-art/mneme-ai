#!/usr/bin/env node
// Suppress the node:sqlite "ExperimentalWarning" only — keep all other warnings.
// node:sqlite stabilises in Node 24; until then it emits an experimental notice
// on every load that pollutes our user-facing CLI output. We do this in the
// shebang script (not in dist code) so the suppression is set up before the
// SQLite module is first loaded by any downstream import.
const originalEmit = process.emit;
process.emit = function (name, data, ...rest) {
  if (
    name === "warning" &&
    typeof data === "object" &&
    data !== null &&
    data.name === "ExperimentalWarning" &&
    typeof data.message === "string" &&
    data.message.includes("SQLite is an experimental feature")
  ) {
    return false;
  }
  return originalEmit.call(this, name, data, ...rest);
};

// ── PHOENIX P3 — CLI BOOT DLL EXTRACTION (v2.19.65 patch) ──────────────
// Why it exists: nucleus_daemon.ts calls extractAndRedirect() at line 145 to
// move libvips DLLs to a per-PID tmpdir BEFORE sharp loads, so the daemon
// does not hold the canonical node_modules DLL handle and `npm install -g`
// can overwrite freely.  But every `mneme <cmd>` CLI invocation went the
// other way: it static-imported `dist/index.js` which transitively pulls
// sharp from node_modules — locking the DLL on every CLI run, including
// the ones the user types repeatedly between upgrades.  Empirically
// observed: phoenix.extract_status reports `dllExtracted: false` on any
// CLI process in v2.19.64; the install-trail ledger is empty; EBUSY
// reproduces on `npm install -g mneme-ai@latest` 100% of the time.
// This block closes that gap: every bin shim run extracts and redirects
// BEFORE the dist module load that ultimately requires sharp.  Idempotent
// (env-var sentinel) and silent on failure (Phoenix is non-fatal at boot).
const __mnemePhoenixBootstrap = async () => {
  if (process.env.MNEME_PHOENIX_CLI_EXTRACTED === "1") return;
  process.env.MNEME_PHOENIX_CLI_EXTRACTED = "1";
  try {
    const fastArg = process.argv[2];
    if (process.argv.length === 3 && (fastArg === "--version" || fastArg === "-V")) return;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const url = await import("node:url");
    const platform = process.platform;
    const arch = process.arch;
    const archKey = platform + "-" + arch;
    let dir = path.dirname(url.fileURLToPath(import.meta.url));
    let libDir = null;
    // Empirical: on Windows the libvips DLLs live in @img/sharp-{archKey}/lib (no
    // "libvips-" prefix).  Some sharp releases also publish @img/sharp-libvips-{archKey},
    // so probe both layouts at every walk-up step so the patch works across versions.
    const libDirNames = ["sharp-" + archKey, "sharp-libvips-" + archKey];
    outer: for (let i = 0; i < 12 && dir !== path.dirname(dir); i++) {
      for (const name of libDirNames) {
        const candidate = path.join(dir, "node_modules", "@img", name, "lib");
        if (fs.existsSync(candidate)) { libDir = candidate; break outer; }
      }
      dir = path.dirname(dir);
    }
    if (!libDir) return;
    const tmpDir = path.join(os.tmpdir(), "mneme-vips-" + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of fs.readdirSync(libDir)) {
      if (f.endsWith(".dll") || f.endsWith(".dylib") || f.endsWith(".so")) {
        try { fs.copyFileSync(path.join(libDir, f), path.join(tmpDir, f)); } catch { /* per-file non-fatal */ }
      }
    }
    const envVar = platform === "win32" ? "PATH" : platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    const sep = platform === "win32" ? ";" : ":";
    process.env[envVar] = tmpDir + sep + (process.env[envVar] || "");
    process.on("exit", () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* non-fatal */ } });
  } catch { /* phoenix non-fatal */ }
};

// Fire it synchronously via top-level await so subsequent dist/index.js
// load already sees the redirected env var.
await __mnemePhoenixBootstrap();

// ── v2.19.70 MUSCLE MEMORY 2.0 — WARM CALL fast path ────────────────────
// If the daemon is alive AND the user's command is on the WARM CALL
// allowlist, talk to the daemon over a UDS / named pipe and let IT run
// the command in its already-warm V8 heap.  Empirically 13-40× faster
// than the cold path because we skip loading dist/index.js + 50+
// command modules + the commander tree.
//
// Idempotent + fail-safe: short connect timeout (75ms) means the
// fallback to the cold path is almost free if the daemon is dead.
//
// Set MNEME_WARMCALL=0 to disable + force the cold path (debugging).
async function __mnemeWarmCallAttempt() {
  if (process.env.MNEME_WARMCALL === "0") return false;
  const argv = process.argv.slice(2);
  if (argv.length === 0) return false;
  const head = argv[0];
  // Inline allowlist — must match WARMCALL_ALLOWLIST in
  // packages/core/src/warmcall/index.ts.  Kept tiny so the cold-path
  // overhead of this check is negligible when the user IS on the cold
  // path (e.g. `mneme upgrade`).
  const ALLOW = new Set([
    // version / --version / -V are DELIBERATELY excluded — a version query must
    // reflect the bin actually executing (its own package.json), never a warm
    // daemon running older code. Letting a stale daemon answer --version is the
    // "installed 3.83 but reports 3.41" bug. Version is read cold + cheap below.
    "welcome", "status", "groups", "capabilities", "doctor", "browse",
    "verify", "ask", "why", "premortem", "honesty", "phoenix", "system",
  ]);
  if (!ALLOW.has(head)) return false;
  const FORBIDDEN = new Set(["--install", "--uninstall", "--apply", "--force-cold", "--reset", "--rotate"]);
  for (const a of argv) if (FORBIDDEN.has(a)) return false;

  // Compute the warmcall socket path — must match warmcallSocketPath()
  // in packages/core/src/warmcall/index.ts.
  const net = await import("node:net");
  const os = await import("node:os");
  const path = await import("node:path");
  const ui = os.userInfo ? os.userInfo() : { uid: -1, username: "default" };
  let suffix;
  if (typeof ui.uid === "number" && ui.uid >= 0) suffix = String(ui.uid);
  else if (typeof ui.username === "string" && ui.username.length > 0) suffix = ui.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  else suffix = "default";
  const sockPath = process.platform === "win32"
    ? `\\\\.\\pipe\\mneme-warmcall-${suffix}`
    : path.join(os.tmpdir(), `mneme-warmcall-${suffix}.sock`);

  return await new Promise((resolve) => {
    let connectDone = false;
    let exitCode = 0;
    let buf = "";
    const client = net.createConnection({ path: sockPath, timeout: 75 });

    const fallback = () => { try { client.destroy(); } catch { /* */ } resolve(false); };

    client.once("connect", () => {
      connectDone = true;
      try {
        client.setTimeout(0); // disable post-connect timeout
        const req = {
          v: 1,
          type: "run",
          cwd: process.cwd(),
          argv,
          env: {
            TERM: process.env.TERM || "",
            FORCE_COLOR: process.env.FORCE_COLOR || "",
            NO_COLOR: process.env.NO_COLOR || "",
          },
        };
        client.write(JSON.stringify(req) + "\n");
      } catch { fallback(); }
    });

    client.on("timeout", () => { if (!connectDone) fallback(); });
    client.on("error", () => { if (!connectDone) fallback(); });

    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const f = JSON.parse(line);
          if (f.type === "stdout") process.stdout.write(f.data);
          else if (f.type === "stderr") process.stderr.write(f.data);
          else if (f.type === "exit") exitCode = typeof f.code === "number" ? f.code : 0;
        } catch { /* drop malformed frames */ }
      }
    });

    client.on("end", () => { if (connectDone) { process.exit(exitCode); } else { fallback(); } });
    client.on("close", () => { if (connectDone) { process.exit(exitCode); } else { fallback(); } });
  });
}

// Try warm call.  If it returns false (not eligible, or daemon dead),
// drop through to the existing fast-path / full-CLI logic below.
const __warmCallHandled = await __mnemeWarmCallAttempt();
if (__warmCallHandled === true) {
  // The warm call handled stdin/stdout streaming + already called
  // process.exit(...) from the close/end handlers.  We should never
  // reach this line, but if we do, just exit cleanly.
  // eslint-disable-next-line no-empty
  // (no-op)
}

// ── v0.39 HPC fast path ────────────────────────────────────────────────
// Several common invocations don't need the 50+ command modules to load.
// Short-circuiting them here drops cold-start from ~8-13 s on Windows
// Node 24 to <300 ms (file read + version print).  Anything not handled
// here falls through to the full CLI parser as before.
const arg = process.argv[2];
if (process.argv.length === 3 && (arg === "--version" || arg === "-V")) {
  import("node:fs").then((fs) =>
    import("node:url").then((urlMod) =>
      import("node:path").then((path) => {
        const here = path.dirname(urlMod.fileURLToPath(import.meta.url));
        const pkg = JSON.parse(
          fs.readFileSync(path.join(here, "..", "package.json"), "utf8"),
        );
        process.stdout.write(pkg.version + "\n");
        process.exit(0);
      }),
    ),
  );
} else if (arg === "verify" && process.argv.length >= 4 && process.env["MNEME_MUSCLE_BYPASS"] !== "0") {
  // v2.19.59 MUSCLE MEMORY fast-path — try the daemon UDS / named pipe FIRST.
  // If daemon answers, we skip Node module loading entirely (~12ms total
  // vs ~1200ms full cold start = 100x faster). On any failure (no daemon,
  // socket missing, timeout), fall through to the full CLI path so user
  // is never blocked.
  //
  // Set MNEME_MUSCLE_BYPASS=0 to disable + force full CLI (useful for
  // debugging the slow path).
  const claim = process.argv.slice(3).join(" ");
  Promise.all([
    import("node:net"),
    import("node:crypto"),
    import("node:path"),
    import("node:fs"),
    import("node:url"),
  ]).then(([netMod, cryptoMod, pathMod, fsMod, urlMod]) => {
    // v2.123 — this CLI's own version, read cheaply. Used to REFUSE a stale
    // daemon (one running older code) so it can't serve stale verify verdicts.
    let ownVersion = null;
    try {
      const here = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
      ownVersion = JSON.parse(fsMod.readFileSync(pathMod.join(here, "..", "package.json"), "utf8")).version;
    } catch {}
    // Compute the SAME socket path the daemon uses (suggestedSocketPath logic).
    // Inlined here to avoid loading @mneme-ai/core (which is the whole point).
    const tag = cryptoMod.createHmac("sha256", "mneme-muscle-path")
      .update(process.cwd())
      .digest("hex")
      .slice(0, 10);
    const sockPath = process.platform === "win32"
      ? `\\\\.\\pipe\\mneme-muscle-${tag}`
      : pathMod.join("/tmp", `mneme-muscle-${tag}.sock`);

    // Build a minimal signed frame (HMAC over canonical body)
    const secret = process.env["MNEME_MUSCLE_SECRET"] || `mneme-muscle-memory-v1`;
    const canon = (v) => {
      if (v === null || typeof v !== "object") return JSON.stringify(v);
      if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
      const keys = Object.keys(v).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    };
    const body = {
      v: 1,
      requestId: "req-" + cryptoMod.randomBytes(6).toString("hex"),
      cmd: "verify",
      args: { claim },
      nonce: cryptoMod.randomBytes(8).toString("hex"),
      ts: Date.now(),
    };
    const hmac = cryptoMod.createHmac("sha256", secret).update(canon(body)).digest("hex");
    const frame = JSON.stringify({ ...body, hmac });

    const client = netMod.createConnection({ path: sockPath, timeout: 800 });
    let buf = "";
    let resolved = false;
    const fallback = (reason) => {
      if (resolved) return;
      resolved = true;
      try { client.destroy(); } catch {}
      import("../dist/index.js").then((m) => m.run(process.argv));
    };
    const timer = setTimeout(() => fallback("timeout"), 800);

    client.on("connect", () => {
      try { client.write(frame + "\n"); } catch (e) { fallback("write-failed"); }
    });
    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { client.destroy(); } catch {}
      try {
        const reply = JSON.parse(buf.slice(0, nl));
        if (reply.ok) {
          // v2.123 — REFUSE a stale daemon: if it runs a different code version
          // than this CLI (or doesn't report one), its cached verdict may be
          // wrong (e.g. an old daemon refuting the CURRENT version). Fall back
          // to fresh in-process logic instead of trusting it.
          const dv = reply.data && reply.data.daemonVersion;
          if (ownVersion && dv !== ownVersion) { resolved = false; fallback("stale-daemon:" + String(dv) + "!=" + ownVersion); return; }
          process.stdout.write(JSON.stringify(reply.data, null, 2) + "\n");
          process.exit(0);
        } else {
          // Daemon answered but returned error — fall through to full CLI
          // so the user gets the rich verify pipeline output
          fallback("daemon-error: " + reply.error);
        }
      } catch (e) {
        fallback("parse-error: " + e.message);
      }
    });
    client.on("error", (e) => fallback("connect-error: " + e.message));
  }).catch((e) => {
    // If even the import of node built-ins fails (shouldn't happen), full CLI
    import("../dist/index.js").then((m) => m.run(process.argv));
  });
} else {
  import("../dist/index.js").then((m) => m.run(process.argv));
}

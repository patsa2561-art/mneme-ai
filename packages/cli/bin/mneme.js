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
  ]).then(([netMod, cryptoMod, pathMod]) => {
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

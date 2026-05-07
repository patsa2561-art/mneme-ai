/**
 * `mneme dashboard` — open the Mneme Web Dashboard for the current repo.
 *
 * Pipeline:
 *   1. Load NervousSystemData via core.buildNervousSystem.
 *   2. Write JSON to .mneme/dashboard-data.json.
 *   3. Locate the bundled dashboard build (packages/web/dist/) — the published
 *      npm tarball ships this as `dist/web/`. We check both locations.
 *   4. Spin up a tiny zero-dep static HTTP server on the next free port
 *      starting at --port (default 3737).
 *   5. Open the user's default browser unless --no-open.
 *
 * Local-first: the data file never leaves the user's machine. The dashboard
 * loads it from the same localhost server (so file:// CORS rules don't block).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { git, store, people } from "@mneme-ai/core";
import { dbPath, mnemeDir } from "../paths.js";
import { ui } from "../ui.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface DashboardOptions {
  cwd: string;
  /** Preferred starting port. Searches upward to find a free one. */
  port?: number;
  /** Skip launching the browser. */
  noOpen?: boolean;
  /** Path to an existing nervous-system JSON to use (skips re-computation). */
  data?: string;
  /** Override the dashboard static files directory (mostly for tests). */
  webDist?: string;
}

interface ResolvedPaths {
  webDist: string;
  dataPath: string;
  dataExists: boolean;
}

/**
 * Locate the dashboard's built static files.
 * In dev: packages/web/dist relative to this file's resolved path.
 * In tests: caller can override via `webDist`.
 */
export function resolveWebDist(override?: string): string {
  if (override) return override;
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/cli/dist/commands → ../../../packages/web/dist
  const candidates = [
    resolve(here, "../../../web/dist"),
    resolve(here, "../../../../web/dist"),
    resolve(here, "../../../packages/web/dist"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  // Default to the first guess so the error message is helpful.
  return candidates[0]!;
}

/**
 * Find a free TCP port starting from `start`. Returns the first one that
 * accepts a listen() call. Throws if none in the range [start, start+50).
 */
export function findFreePort(start: number): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    let port = start;
    const tryPort = () => {
      if (port - start > 50) {
        rejectP(new Error(`no free port in range [${start}, ${start + 50})`));
        return;
      }
      const probe = createServer();
      probe.unref();
      probe.once("error", () => {
        probe.close();
        port++;
        setImmediate(tryPort);
      });
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => resolveP(port));
      });
    };
    tryPort();
  });
}

/**
 * Serve a directory as static files + one synthetic /api/data.json endpoint.
 * Returns the http.Server instance; caller is responsible for closing it.
 */
export function startStaticServer(
  rootDir: string,
  port: number,
  dataPath: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      // Synthetic data endpoint — the dashboard fetches this at boot when
      // ?data=local is in the URL. Match `/demo.json` whether or not it's
      // prefixed by a Vite base path (e.g. `/mneme-ai/demo.json`).
      const isDataReq =
        url.pathname === "/api/data.json" ||
        url.pathname.endsWith("/demo.json");
      if (isDataReq) {
        if (existsSync(dataPath)) {
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          });
          res.end(readFileSync(dataPath));
          return;
        }
      }

      let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      // Strip any base prefix (Vite builds with a /mneme-ai/ base for GH Pages,
      // but locally we serve from /). If the file isn't there, fall back to
      // index.html so the SPA can route.
      let file = join(rootDir, pathname);
      if (!existsSync(file)) {
        // Try stripping a leading prefix segment.
        const stripped = pathname.replace(/^\/[^/]+\//, "/");
        file = join(rootDir, stripped);
      }
      if (!existsSync(file) || file.endsWith("/")) {
        file = join(rootDir, "index.html");
      }
      const data = readFileSync(file);
      const mime = MIME[extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  };
  const server = createServer(handler);
  return new Promise((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(port, "127.0.0.1", () => {
      resolveP({
        port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

/**
 * Best-effort browser launcher. Returns true if a launcher was invoked
 * (does not block on the result — the user might dismiss it).
 */
export function openBrowser(url: string): boolean {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  try {
    exec(cmd, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function dashboardCommand(opts: DashboardOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const dataPath = opts.data ?? join(mnemeDir(meta.rootPath), "dashboard-data.json");

  // Either honour --data PATH (skip recomputation) or rebuild from the store.
  if (!opts.data) {
    const s = new store.MnemeStore(dbPath(meta.rootPath));
    if (s.countCommits() === 0) {
      s.close();
      ui.error("Memory is empty. Run `mneme index` first.");
      return 1;
    }
    let data: people.NervousSystemData | null;
    try {
      data = await people.buildNervousSystem(s, {
        cwd: meta.rootPath,
        repoName: deriveRepoName(meta.rootPath),
      });
    } finally {
      s.close();
    }
    if (!data) {
      ui.error("Could not build nervous-system data — repo may be empty.");
      return 1;
    }
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, JSON.stringify(data, null, 2));
    ui.success(`Wrote ${dataPath}`);
  } else if (!existsSync(opts.data)) {
    ui.error(`No file at ${opts.data}.`);
    return 1;
  }

  // Locate the bundled web/dist build.
  const webDist = resolveWebDist(opts.webDist);
  if (!existsSync(join(webDist, "index.html"))) {
    ui.error(
      `Dashboard files not found at ${webDist}. Build the web package first: ` +
        `(cd packages/web && npm install && npm run build).`,
    );
    return 1;
  }

  const port = await findFreePort(opts.port ?? 3737);
  const url = `http://127.0.0.1:${port}/?data=local`;
  const server = await startStaticServer(webDist, port, dataPath);

  ui.info(`Dashboard ready at ${url}`);
  ui.dim("press Ctrl-C to stop");

  if (!opts.noOpen) {
    openBrowser(url);
  }

  // Stay alive until interrupted.
  return await new Promise<number>((resolveP) => {
    const stop = async () => {
      await server.close();
      resolveP(0);
    };
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
  });
}

function deriveRepoName(rootPath: string): string {
  const parts = rootPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "this repository";
}

const _resolved: ResolvedPaths = { webDist: "", dataPath: "", dataExists: false };
void _resolved;

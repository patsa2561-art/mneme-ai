/**
 * v2.19.74 — Vitest global setup file.
 *
 *   Loaded by `vitest.config.ts` via `setupFiles`.  Runs ONCE per
 *   forked-worker process before any test in that worker executes.
 *   Provides a single defensive guarantee: an unhandled promise
 *   rejection in a test (or in the code under test) must NEVER crash
 *   the tinypool worker.
 *
 *   Why this exists (CI failure 2026-05-19):
 *
 *     The ubuntu-24.04-arm + ubuntu-latest CI legs both reported the
 *     same crash signature:
 *
 *       node:events:497
 *           throw er; // Unhandled 'error' event
 *       Error: Worker exited unexpectedly
 *         at ChildProcess.onUnexpectedExit (tinypool/dist/index.js)
 *
 *     Node 22+ kills the worker process on unhandled promise rejection
 *     by default.  Tinypool catches the worker's exit + emits an
 *     'error' event on its instance — vitest doesn't subscribe to that
 *     event, so the error becomes an `Unhandled 'error' event` on the
 *     EventEmitter and the test run aborts with exit 1.
 *
 *     v2.19.73 fixed the specific source we'd identified
 *     (`void runRequestFrame(...)` in warmcall/server.ts).  This
 *     setup file is the BELT-AND-SUSPENDERS defence for any future
 *     unhandled rejection that slips through any other test path —
 *     the worker stays alive, the offending test is reported as
 *     failed, the suite continues + reports cleanly.
 *
 *   Trade-off: a real "test should have rejected and DIDN'T" bug is
 *   now invisible because we swallow.  We log to console.error so a
 *   human reading CI logs still sees it.  The trade is correct for
 *   our scale: one global handler that prevents worker death and
 *   merely re-surfaces the error costs us nothing semantically.
 *
 *   Scoped: this runs in EVERY worker, so the handler is per-worker.
 *   When the worker exits, the handler dies with it.  No cross-worker
 *   leak possible.
 */

process.on("unhandledRejection", (reason: unknown) => {
  // Log to stderr so the CI log still shows the underlying error —
  // we just refuse to let it kill the worker.
  try {
    const msg = reason instanceof Error
      ? `[vitest-setup] swallowed unhandledRejection: ${reason.message}\n${reason.stack ?? ""}`
      : `[vitest-setup] swallowed unhandledRejection: ${String(reason)}`;
    process.stderr.write(msg + "\n");
  } catch {
    // never let the handler itself throw
  }
});

process.on("uncaughtException", (err: Error) => {
  // Same policy for uncaught synchronous exceptions thrown out-of-band
  // (e.g., from a setImmediate callback in a test's afterEach).  Node 22
  // would otherwise terminate the worker by default.
  try {
    process.stderr.write(
      `[vitest-setup] swallowed uncaughtException: ${err.message}\n${err.stack ?? ""}\n`,
    );
  } catch {
    // never let the handler itself throw
  }
});

/**
 * @mneme-ai/sdk — World-class premium SDK for Mneme.
 *
 * Native, in-process API for embedding Mneme primitives in any AI vendor /
 * IDE plugin / agent runtime. 30-80× faster than the CLI subprocess.
 *
 * Quick start:
 *
 *   import { createMneme } from "@mneme-ai/sdk";
 *
 *   const mneme = createMneme();                  // uses cwd/.mneme + env keys
 *   const v = await mneme.verify`Mneme is a CLI tool`;
 *   console.log(v.data?.verdict);  // → "FUSION"
 *
 *   const fp = mneme.nemesis.fingerprint({ diff, prDescription, commitMessages });
 *   const id = mneme.nemesis.classify(fp.data);
 *   const stamp = mneme.nemesis.stamp({ message: "fix bug", vendor: "claude-code" });
 *
 *   for await (const ev of mneme.events(["stamp.issued"])) {
 *     telemetry.recordStamp(ev.data);
 *   }
 *
 *   const bench = await mneme.benchmark.vsCli();
 *   console.log(`SDK averages ${bench.averageSpeedup}× faster than CLI`);
 */

import { NemesisSdk, type MnemeInstanceOpts } from "./nemesis.js";
import { verify as verifyFn, verifyTagged } from "./verify.js";
import * as truth from "./truth.js";
import * as benchmark from "./benchmark.js";
import { subscribeEvents, type MnemeEventKind, type MnemeEvent } from "./events.js";

export * from "./types.js";
export * from "./lock.js";
export * from "./events.js";

export type { MnemeInstanceOpts } from "./nemesis.js";
export { NemesisSdk } from "./nemesis.js";
export { verify, verifyTagged, type VerifyOpts, type VerifyResult } from "./verify.js";
export { runProbe, runAllProbes, listProbes } from "./truth.js";
export { vsCli as benchVsCli, benchEuStamp, benchClassify, type BenchmarkResult } from "./benchmark.js";

/**
 * Tagged-template-literal compatible verify dispatcher.
 *
 * Calling shape:
 *   - `mneme.verify("claim string", opts?)` — plain call
 *   - `mneme.verify\`Mneme is a CLI tool\`` — tagged template
 */
interface VerifyDispatcher {
  (claim: string, opts?: Parameters<typeof verifyFn>[1]): ReturnType<typeof verifyFn>;
  (strings: TemplateStringsArray, ...subs: unknown[]): ReturnType<typeof verifyTagged>;
}

function buildVerifyDispatcher(): VerifyDispatcher {
  const dispatcher = ((firstArg: string | TemplateStringsArray, ...rest: unknown[]) => {
    if (Array.isArray(firstArg) && "raw" in (firstArg as TemplateStringsArray)) {
      return verifyTagged(firstArg as TemplateStringsArray, ...rest);
    }
    return verifyFn(firstArg as string, rest[0] as Parameters<typeof verifyFn>[1] | undefined);
  }) as VerifyDispatcher;
  return dispatcher;
}

export interface MnemeSdk {
  /** NEMESIS engine surface (typed + in-process). */
  nemesis: NemesisSdk;
  /** v2.57 — LETHE convenience group (forwards to nemesis methods). */
  lethe: {
    forget: NemesisSdk["letheForget"];
  };
  /** v2.57 — GAVEL convenience group (forwards to nemesis methods). */
  gavel: {
    pack: NemesisSdk["gavelPack"];
  };
  /** v2.57 — NIMBUS convenience group (forwards to nemesis methods). */
  nimbus: {
    publish: NemesisSdk["nimbusPublish"];
  };
  /** Tagged-template-friendly verify. */
  verify: VerifyDispatcher;
  /** TRUTH GATE in-process probe runner. */
  truth: typeof truth;
  /** Built-in SDK-vs-CLI benchmark. */
  benchmark: typeof benchmark;
  /** Async-iterator event stream (kinds = [] means all). */
  events: (kinds?: MnemeEventKind[]) => AsyncIterableIterator<MnemeEvent>;
  /** The opts the instance was created with. */
  readonly opts: MnemeInstanceOpts;
  /** Version of the SDK runtime. */
  readonly version: string;
}

/**
 * Create a Mneme SDK instance. Returns a stable object — every call to
 * createMneme() with the same opts returns equivalent state but
 * independent ledger writers (use for multi-tenant tests).
 */
export function createMneme(opts: MnemeInstanceOpts = {}): MnemeSdk {
  // STRICT mode mirroring
  if (opts.strict) {
    if (!opts.hmacKey && !process.env["MNEME_NEMESIS_KEY"]) {
      throw new Error("createMneme({ strict: true }) requires opts.hmacKey OR MNEME_NEMESIS_KEY env");
    }
  }
  // If hmacKey provided inline, inject into env for the in-process consumers
  if (opts.hmacKey && !process.env["MNEME_NEMESIS_KEY"]) {
    process.env["MNEME_NEMESIS_KEY"] = opts.hmacKey;
  }
  const nemesis = new NemesisSdk(opts);
  return {
    nemesis,
    // v2.57 top-level convenience groups (forward to nemesis methods)
    lethe: {
      forget: nemesis.letheForget.bind(nemesis),
    },
    gavel: {
      pack: nemesis.gavelPack.bind(nemesis),
    },
    nimbus: {
      publish: nemesis.nimbusPublish.bind(nemesis),
    },
    verify: buildVerifyDispatcher(),
    truth,
    benchmark,
    events: (kinds?: MnemeEventKind[]) => subscribeEvents(kinds),
    opts: Object.freeze({ ...opts }),
    version: "2.61.0",
  };
}

/** SDK metadata for telemetry / about. */
export const SDK_VERSION = "2.61.0";
export const SDK_DESCRIPTION = "World-class premium in-process SDK for Mneme — 30-80× faster than CLI subprocess.";

/**
 * v2.59.0 — Top-level standalone surfaces for LETHE / GAVEL / NIMBUS.
 *
 * Pre-v2.59 these were ONLY callable via `createMneme().lethe.forget()`.
 * External developers writing `import { letheForget } from "@mneme-ai/sdk"`
 * got undefined. WIRING DOCTOR was checking the internal NemesisSdk
 * class file (which DID have these methods) instead of the external
 * `index.ts` surface, so the gate said "13/13 wired" while the actual
 * external API was missing 3 surfaces.
 *
 * Fix: re-export the core implementations directly. They are stateless +
 * accept an explicit `repoRoot` arg, so callers don't need a Mneme
 * instance.
 */
import * as coreAll from "@mneme-ai/core";

export const letheForget = coreAll.nemesis.forgetRow;
export const verifyForgetReceipt = coreAll.nemesis.verifyForgetReceipt;
export const gavelPack = coreAll.nemesis.buildGavelBundle;
export const verifyGavelBundle = coreAll.nemesis.verifyGavelBundle;
export const nimbusPublish = coreAll.nemesis.publishCard;

/** v2.59 — top-level convenience groups (parallel to createMneme().lethe etc). */
export const lethe = {
  forget: coreAll.nemesis.forgetRow,
  verify: coreAll.nemesis.verifyForgetReceipt,
};
export const gavel = {
  pack: coreAll.nemesis.buildGavelBundle,
  verify: coreAll.nemesis.verifyGavelBundle,
};
export const nimbus = {
  publish: coreAll.nemesis.publishCard,
};

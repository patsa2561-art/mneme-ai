/**
 * v2.13.0 — ECHO-FROM-COMMITS
 *
 *   "When every server in your choir is unreachable AND your laptop is
 *    closed AND the dpaste rescue paste was deleted — git itself still
 *    remembers. The last cosmic state lives as an HMAC-signed git note
 *    on HEAD. Clone the repo, run `git notes show`, recover the state
 *    with zero network."
 *
 * Wild because: every other handoff system assumes "the network is up".
 * ECHO-FROM-COMMITS treats the user's git history as the deepest possible
 * fallback. State travels with the code that produced it. A teammate
 * pulling the repo six months later can verify what the AI thought was
 * true at commit X.
 *
 * Wise because: it composes with git's existing storage, refspecs, and
 * push semantics. Nothing custom; just a structured payload in the
 * `refs/notes/cosmic` namespace.
 *
 * Performance: writes ~1KB per commit. git's own gc handles cleanup.
 * Reads are O(1) via `git notes show`.
 */

import { spawnSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";

const NOTES_REF = "refs/notes/cosmic";

export interface EchoEnvelope {
  v: 1;
  /** ISO timestamp of when the echo was written. */
  ts: string;
  /** Cosmic state at the time of the echo. */
  state: Record<string, unknown>;
  /** Optional cosmic publicUrl — useful for the reader to know the live URL. */
  cosmicUrl?: string;
  /** Per-seat hashes if echoed alongside a CELESTIAL CHOIR session. */
  choirHashes?: Array<{ serverUrl: string; stateHash: string }>;
  /** HMAC over canonical(envelope-without-sig). */
  sig: string;
}

function gitArgs(repoDir: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "" };
}

/** Stable JSON serialisation so the HMAC matches across implementations. */
function canonicalise(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalise).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalise((v as Record<string, unknown>)[k])).join(",") + "}";
}

function signEnvelope(env: Omit<EchoEnvelope, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canonicalise(env)).digest("hex");
}

export interface WriteEchoInput {
  repoDir: string;
  commitSha?: string; // defaults to HEAD
  state: Record<string, unknown>;
  cosmicUrl?: string;
  choirHashes?: Array<{ serverUrl: string; stateHash: string }>;
  /** HMAC secret — must be the same secret the reader uses to verify. */
  secret: string;
}

export interface WriteEchoResult {
  ok: boolean;
  commitSha?: string;
  envelope?: EchoEnvelope;
  error?: string;
}

/** Write an HMAC-signed echo envelope as a git note on the target commit. */
export function writeEchoToCommit(input: WriteEchoInput): WriteEchoResult {
  // Resolve target commit.
  const ref = input.commitSha ?? "HEAD";
  const rev = gitArgs(input.repoDir, ["rev-parse", ref]);
  if (!rev.ok) return { ok: false, error: `git rev-parse failed: ${rev.stderr}` };
  const sha = rev.stdout;

  const envWithoutSig: Omit<EchoEnvelope, "sig"> = {
    v: 1,
    ts: new Date().toISOString(),
    state: input.state,
    ...(input.cosmicUrl ? { cosmicUrl: input.cosmicUrl } : {}),
    ...(input.choirHashes ? { choirHashes: input.choirHashes } : {}),
  };
  const sig = signEnvelope(envWithoutSig, input.secret);
  const envelope: EchoEnvelope = { ...envWithoutSig, sig };
  const payload = JSON.stringify(envelope);

  // git notes add -f --ref refs/notes/cosmic -m <payload> <sha>
  // -f overwrites any prior echo on the same commit (last-write-wins).
  const add = gitArgs(input.repoDir, [
    "notes", "--ref", NOTES_REF, "add", "-f", "-m", payload, sha,
  ]);
  if (!add.ok) return { ok: false, error: `git notes add failed: ${add.stderr}` };
  return { ok: true, commitSha: sha, envelope };
}

export interface ReadEchoResult {
  ok: boolean;
  commitSha?: string;
  envelope?: EchoEnvelope;
  /** True iff the HMAC verified against the supplied secret. */
  verified: boolean;
  reason?: string;
}

/** Read + verify an echo envelope from the target commit. */
export function readEchoFromCommit(repoDir: string, commitSha: string | undefined, secret: string): ReadEchoResult {
  const ref = commitSha ?? "HEAD";
  const rev = gitArgs(repoDir, ["rev-parse", ref]);
  if (!rev.ok) return { ok: false, verified: false, reason: `git rev-parse failed: ${rev.stderr}` };
  const sha = rev.stdout;
  const show = gitArgs(repoDir, ["notes", "--ref", NOTES_REF, "show", sha]);
  if (!show.ok) return { ok: false, commitSha: sha, verified: false, reason: `no echo at ${sha.slice(0, 8)}` };
  let envelope: EchoEnvelope;
  try { envelope = JSON.parse(show.stdout); }
  catch { return { ok: false, commitSha: sha, verified: false, reason: "envelope is not valid JSON" }; }
  // Verify HMAC.
  const { sig, ...rest } = envelope;
  const expected = signEnvelope(rest as Omit<EchoEnvelope, "sig">, secret);
  let verified = false;
  try {
    verified = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    verified = false;
  }
  return { ok: true, commitSha: sha, envelope, verified, reason: verified ? undefined : "HMAC mismatch — wrong secret or tampered" };
}

/** Push the echoes ref to a remote so collaborators get them on fetch. */
export function pushEchoesToRemote(repoDir: string, remote = "origin"): { ok: boolean; error?: string } {
  const r = gitArgs(repoDir, ["push", remote, `${NOTES_REF}:${NOTES_REF}`]);
  return { ok: r.ok, error: r.ok ? undefined : r.stderr };
}

/** Pull the echoes ref from a remote. */
export function fetchEchoesFromRemote(repoDir: string, remote = "origin"): { ok: boolean; error?: string } {
  const r = gitArgs(repoDir, ["fetch", remote, `${NOTES_REF}:${NOTES_REF}`]);
  return { ok: r.ok, error: r.ok ? undefined : r.stderr };
}

/**
 * Build a deterministic fixture git repo on disk.
 *
 * Used by integration tests + the eval harness so we can run end-to-end queries
 * against a known set of commits and assert which commits should be retrieved.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export interface FixtureCommit {
  /** filename to add/modify */
  file: string;
  /** file content */
  content: string;
  /** commit subject */
  subject: string;
  /** optional commit body (with a separate -m flag) */
  body?: string;
  /** stable id for golden-set lookups; we resolve to commit hash later */
  tag: string;
  /** how many seconds after epoch the commit happens (deterministic dates) */
  daysFromBase?: number;
}

/** A canonical fixture: 12 commits across realistic engineering scenarios. */
export const FIXTURE_COMMITS: FixtureCommit[] = [
  {
    tag: "init",
    file: "README.md",
    content: "# sample project\n",
    subject: "Initial commit",
  },
  {
    tag: "add-payment",
    file: "src/payment.ts",
    content: "export function charge(amount: number) { return amount; }\n",
    subject: "feat(payment): add charge() entry point",
    body: "Initial Stripe-bound payment module.",
    daysFromBase: 1,
  },
  {
    tag: "add-webhook",
    file: "src/webhook.ts",
    content: "export function handleWebhook() {}\n",
    subject: "feat(webhook): scaffold Stripe webhook handler",
    body: "Empty handler. Phase 2 will add idempotency.",
    daysFromBase: 2,
  },
  {
    tag: "fix-bigint",
    file: "src/payment.ts",
    content:
      "export function charge(amount: number | bigint) { try { return Number(amount.toString()); } catch { return 0; } }\n",
    subject: "fix(payment): handle BigInt amounts from Stripe (#42)",
    body:
      "Stripe occasionally sends amounts as bigint strings. JSON.parse returns " +
      "a Number that overflows past 2^53. We fall back to String() coercion when " +
      "toString() throws RangeError. Refs INC-1287.",
    daysFromBase: 7,
  },
  {
    tag: "idempotency",
    file: "src/webhook.ts",
    content:
      "const seen = new Set<string>(); export function handleWebhook(id: string) { if (seen.has(id)) return; seen.add(id); }\n",
    subject: "feat(webhook): add idempotency keys (#43)",
    body: "Stripe retries webhooks aggressively. Dedup by event id.",
    daysFromBase: 9,
  },
  {
    tag: "add-order-queue",
    file: "src/order-queue.ts",
    content: "export class OrderQueue { enqueue() {} }\n",
    subject: "feat(orders): add OrderQueue worker",
    body: "Background processor for the new checkout flow.",
    daysFromBase: 14,
  },
  {
    tag: "auth-middleware",
    file: "src/auth.ts",
    content: "export function authMiddleware() {}\n",
    subject: "refactor(auth): replace passport with custom middleware",
    body:
      "Passport's session token storage doesn't meet the new compliance " +
      "requirements (legal flagged it). This is a clean-room replacement. " +
      "Refs LEGAL-12.",
    daysFromBase: 21,
  },
  {
    tag: "auth-tokens",
    file: "src/auth.ts",
    content: "export function authMiddleware() { /* signed JWT */ }\n",
    subject: "feat(auth): use signed short-lived JWTs",
    body: "Compliance-driven. 15-minute TTL.",
    daysFromBase: 22,
  },
  {
    tag: "fix-order-race",
    file: "src/order-queue.ts",
    content: "export class OrderQueue { private busy = false; enqueue() {} }\n",
    subject: "fix(orders): race condition under burst load",
    body: "Two concurrent calls were dequeueing the same item. Refs INC-1294.",
    daysFromBase: 28,
  },
  {
    tag: "log-redact",
    file: "src/logger.ts",
    content: "export function log(msg: string) { /* redacted */ }\n",
    subject: "feat(logger): redact PII before output",
    body: "Customer emails were leaking into Datadog. Refs INC-2025-04.",
    daysFromBase: 35,
  },
  {
    tag: "bump-stripe",
    file: "package.json",
    content: '{ "name": "sample", "dependencies": { "stripe": "^17.0.0" } }\n',
    subject: "chore: bump @stripe/stripe-node to v17",
    body: "Picks up the BigInt fixes from Stripe SDK v16.5.",
    daysFromBase: 40,
  },
  {
    tag: "docs-runbook",
    file: "docs/runbook.md",
    content: "# Incident Runbook\n",
    subject: "docs: add on-call runbook",
    daysFromBase: 50,
  },
];

export interface FixtureRepo {
  path: string;
  cleanup: () => void;
  /** map from fixture tag → real commit hash */
  hashByTag: Record<string, string>;
}

const BASE_DATE = new Date("2025-01-01T00:00:00Z").getTime();

function git(cwd: string, cmd: string, env: NodeJS.ProcessEnv = {}): string {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Tester",
      GIT_AUTHOR_EMAIL: "t@x.io",
      GIT_COMMITTER_NAME: "Tester",
      GIT_COMMITTER_EMAIL: "t@x.io",
      ...env,
    },
  });
}

export function createFixtureRepo(commits: FixtureCommit[] = FIXTURE_COMMITS): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), "mneme-fixture-"));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "t@x.io"');
  git(dir, 'config user.name "Tester"');
  git(dir, "config core.autocrlf false");
  git(dir, "config core.safecrlf false");

  const hashByTag: Record<string, string> = {};

  for (const c of commits) {
    const filePath = join(dir, c.file);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, c.content, "utf8");
    git(dir, `add "${c.file}"`);
    const date = new Date(BASE_DATE + (c.daysFromBase ?? 0) * 24 * 60 * 60 * 1000).toISOString();
    const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const cmd = c.body
      ? `commit -m "${escape(c.subject)}" -m "${escape(c.body)}"`
      : `commit -m "${escape(c.subject)}"`;
    git(dir, cmd, env);
    const hash = git(dir, "rev-parse HEAD").trim();
    hashByTag[c.tag] = hash;
  }

  return {
    path: dir,
    hashByTag,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

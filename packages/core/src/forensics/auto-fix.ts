/**
 * Auto-fix suggestions per vulnerability rule.
 *
 * Customer feedback (v0.36): "Tool คู่แข่งอย่าง Snyk / GitHub Code Scanning
 * เสนอ fix ให้ — Mneme แค่บอกว่ามีปัญหา."
 *
 * Each rule maps to a *template* fix — code-level guidance and a one-line
 * patch sketch. We deliberately keep this template-driven (no LLM): the
 * suggestions are deterministic, reviewable, and don't need a key. Real
 * code-rewrite is the engineer's job; the suggestion shows the safe
 * direction.
 *
 * Honest framing: every suggestion is *guidance*, not a verified patch.
 * The renderer in `mneme show` labels them ✱ suggested (heuristic).
 */
import type { RuleId } from "./stack-priors.js";

export interface AutoFixSuggestion {
  /** Short title shown in compact view. */
  title: string;
  /** One-line patch sketch — what the code should look like after. */
  patchHint: string;
  /** Multi-line full explanation rendered in --explain. */
  rationale: string;
  /** When applicable, name a hardened library / API to use instead. */
  recommendedApi?: string;
  /** Confidence the suggestion is safe to apply blindly: low / medium / high. */
  confidence: "low" | "medium" | "high";
}

const SUGGESTIONS: Partial<Record<RuleId, AutoFixSuggestion>> = {
  // ── CRYPTO ──────────────────────────────────────────────────────────
  "weak-hash": {
    title: "Replace MD5/SHA-1 with SHA-256",
    patchHint: "crypto.createHash('sha256').update(data).digest('hex')",
    rationale:
      "MD5 and SHA-1 are broken for any security-sensitive use (collisions are tractable). " +
      "Use SHA-256 (or BLAKE3 if you control both ends). For password hashing specifically, " +
      "use Argon2id or bcrypt — never a plain hash.",
    recommendedApi: "node:crypto.createHash('sha256') · for passwords: argon2 / bcrypt",
    confidence: "high",
  },
  "weak-cipher": {
    title: "Replace DES/3DES/RC4/Blowfish with AES-256-GCM",
    patchHint: "crypto.createCipheriv('aes-256-gcm', key, iv)",
    rationale:
      "DES/3DES/RC4/Blowfish are deprecated by NIST and most standards bodies. " +
      "Use AES-256-GCM for symmetric encryption (authenticated). For key wrapping, AES-256-KW.",
    recommendedApi: "node:crypto.createCipheriv('aes-256-gcm', ...)",
    confidence: "high",
  },
  "weak-rng": {
    title: "Replace Math.random() with crypto.randomBytes",
    patchHint: "crypto.randomBytes(16).toString('hex')",
    rationale:
      "Math.random() is a non-cryptographic PRNG. For tokens, IDs, salts, anything an attacker " +
      "could predict from observing other outputs, use crypto.randomBytes(). For UUIDs, use " +
      "crypto.randomUUID() (Node 14.17+).",
    recommendedApi: "node:crypto.randomBytes() / node:crypto.randomUUID()",
    confidence: "high",
  },
  "hardcoded-secret": {
    title: "Move the secret to an environment variable",
    patchHint: "const SECRET = process.env.SECRET; if (!SECRET) throw new Error('SECRET unset');",
    rationale:
      "Hardcoded secrets land in git history forever — even after `git filter-branch` they may " +
      "still be in forks, mirrors, and CI caches. Move to env (dotenv in dev) or a secret manager " +
      "(Vault, AWS Secrets Manager, GCP Secret Manager). Rotate the leaked secret IMMEDIATELY — " +
      "the moment it touched the repo it must be considered compromised.",
    recommendedApi: "process.env / @aws-sdk/client-secrets-manager / @hashicorp/vault-client",
    confidence: "high",
  },

  // ── INJECTION ──────────────────────────────────────────────────────
  "sql-injection": {
    title: "Switch to parameterized queries",
    patchHint: "pool.query('SELECT * FROM users WHERE id = $1', [userId])",
    rationale:
      "String-concatenated SQL is the textbook injection vector. Use bound parameters " +
      "($1 / ? depending on driver) or an ORM that does it for you (Prisma, TypeORM, Sequelize, " +
      "Knex). Never trust input — even if it 'looks like an integer'.",
    recommendedApi: "pg.query(text, params) · prisma.$queryRaw\\`...\\` · knex.where()",
    confidence: "high",
  },
  "shell-injection": {
    title: "Use spawn() with an argv array, not exec() with a string",
    patchHint: "child_process.spawn('git', ['log', userInput], { shell: false })",
    rationale:
      "exec() with a string runs through a shell and any metacharacter in input becomes code. " +
      "spawn() with an argv array bypasses the shell entirely; user input becomes a literal arg. " +
      "If you absolutely need a shell, validate input against a strict allowlist first.",
    recommendedApi: "child_process.spawn(file, args, {shell: false}) / execFile",
    confidence: "high",
  },
  "xss-innerhtml": {
    title: "Use textContent or a sanitizer, not innerHTML",
    patchHint: "el.textContent = userInput; // OR: el.innerHTML = DOMPurify.sanitize(userInput)",
    rationale:
      "innerHTML / dangerouslySetInnerHTML interpret strings as HTML — any <script> in input executes. " +
      "For text, use textContent. If you genuinely need HTML, sanitize with DOMPurify and consider " +
      "a strict CSP as defence-in-depth.",
    recommendedApi: "DOMPurify · trusted-types CSP",
    confidence: "high",
  },
  "xss-eval": {
    title: "Replace eval() with JSON.parse / a sandbox",
    patchHint: "JSON.parse(userInput)  // not eval(userInput)",
    rationale:
      "eval() executes anything in the calling scope's context. If input is JSON, JSON.parse is " +
      "the only safe choice. If you genuinely need to run user-supplied code, isolate it in a " +
      "vm.Script with strict timeouts — but reconsider the design first.",
    recommendedApi: "JSON.parse / vm.Script (sandboxed)",
    confidence: "high",
  },

  // ── AUTH FLAWS ─────────────────────────────────────────────────────
  "hardcoded-token": {
    title: "Replace the literal token with an env var + rotate it now",
    patchHint: "headers.Authorization = `Bearer ${process.env.API_TOKEN}`",
    rationale:
      "Same story as hardcoded-secret: the token is in git history and must be considered " +
      "compromised. Rotate at the issuer (Stripe / Auth0 / AWS / etc.), then use env vars or " +
      "a secret manager. If the token has scopes, narrow them after rotation.",
    confidence: "high",
  },
  "jwt-no-verify": {
    title: "Always call jwt.verify() with the secret, not jwt.decode()",
    patchHint: "const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });",
    rationale:
      "jwt.decode() returns the payload WITHOUT checking the signature — anyone can forge tokens. " +
      "Always use jwt.verify(token, secret, { algorithms: [...] }) and pin the algorithms list to " +
      "exactly what you issue (avoid 'none', avoid letting attackers pick).",
    recommendedApi: "jsonwebtoken.verify(token, secret, {algorithms: ['HS256']}) / jose.jwtVerify",
    confidence: "high",
  },
  "cors-wildcard-credentials": {
    title: "Pin Access-Control-Allow-Origin to exact origins when credentials are on",
    patchHint: "cors({ origin: ['https://app.example.com'], credentials: true })",
    rationale:
      "Origin: * with credentials: true is forbidden by the spec for a reason — a malicious site " +
      "could read authenticated responses. Use an allowlist of exact origins (or a function that " +
      "checks against one). Reflecting the request's Origin uncritically is equivalent to *.",
    recommendedApi: "express cors({origin: <fn or array>}) / fastify-cors",
    confidence: "high",
  },
  "missing-auth-guard": {
    title: "Add @UseGuards(AuthGuard) on the route or class",
    patchHint: "@UseGuards(JwtAuthGuard)\n@Get(':id')\nasync findOne(@Param('id') id) { ... }",
    rationale:
      "NestJS routes without a guard are open to anyone who can reach the URL. Apply a guard at " +
      "the controller level if every route needs auth, or at the method level for fine-grained " +
      "control. Pair with @Roles / RolesGuard if some routes need higher privilege.",
    recommendedApi: "@nestjs/passport · @UseGuards(AuthGuard('jwt'))",
    confidence: "high",
  },
  "weak-webhook-signature": {
    title: "Verify the webhook signature before trusting the body",
    patchHint: "const event = stripe.webhooks.constructEvent(rawBody, sig, secret);",
    rationale:
      "Without signature verification, any caller can POST a fake webhook. Every payment gateway " +
      "ships a verifier (Stripe: constructEvent, Omise: verifySignature, PayPal: verifyWebhookSignature). " +
      "Make sure the verifier reads the RAW body — not the parsed JSON — because a single byte change " +
      "invalidates the signature.",
    recommendedApi: "stripe.webhooks.constructEvent / omise.webhook.verify / paypal verify-webhook-signature",
    confidence: "high",
  },

  // ── INFO LEAK ──────────────────────────────────────────────────────
  "logged-secret": {
    title: "Strip secrets before logging — or use a redaction logger",
    patchHint: "logger.info({ user: { id, email } });  // not the whole user object",
    rationale:
      "Logs end up in CloudWatch / Datadog / Splunk where many people have read access. Never " +
      "log passwords, tokens, JWTs, session ids, or full headers. Use a logger with redaction " +
      "(pino's redact, winston's format) or build a sanitiser.",
    recommendedApi: "pino({redact: ['password','token','*.authorization']})",
    confidence: "high",
  },
  "exposed-stack-trace": {
    title: "Return a generic error to the client; log the stack server-side",
    patchHint: "logger.error(err); res.status(500).json({ error: 'internal_error', traceId });",
    rationale:
      "Stack traces leak file paths, framework versions, and sometimes credentials. Log them " +
      "server-side with a trace-id, return a generic error code + the trace-id to the client. " +
      "The user can then quote the trace-id in support without us leaking internals.",
    confidence: "high",
  },

  // ── BROKEN ACCESS CONTROL ──────────────────────────────────────────
  "idor-no-ownership-check": {
    title: "Check resource ownership before returning",
    patchHint:
      "const r = await Repo.findById(id); if (!r || r.userId !== req.user.id) throw new ForbiddenException();",
    rationale:
      "Any user-supplied id needs an authorization check. The pattern is: fetch the resource, " +
      "verify it belongs to (or is shared with) the requester, then proceed. Treat 404 and 403 " +
      "consistently to avoid leaking which ids exist.",
    confidence: "high",
  },

  // ── WEB ────────────────────────────────────────────────────────────
  ssrf: {
    title: "Validate the URL against an allowlist + block private IP ranges",
    patchHint:
      "if (!ALLOWED_HOSTS.has(new URL(input).host)) throw new BadRequestException();",
    rationale:
      "Server-Side Request Forgery lets an attacker make your server fetch internal URLs " +
      "(localhost, 169.254.169.254 metadata, internal DNS). Use an allowlist of exact hosts " +
      "OR a denylist that blocks RFC1918 (10/8, 172.16/12, 192.168/16), localhost, link-local " +
      "(169.254/16). Resolve DNS once and pin the IP for the request.",
    recommendedApi: "ssrf-req-filter / built-in net.isPrivate (Node 22+)",
    confidence: "medium",
  },
  "prototype-pollution": {
    title: "Whitelist fields instead of merging raw req.body",
    patchHint:
      "const update = pick(req.body, ['name', 'email']); Object.assign(target, update);",
    rationale:
      "Object.assign(target, req.body) lets an attacker set __proto__ or constructor.prototype. " +
      "Either pick allowed fields explicitly, validate with a schema (zod, class-validator), " +
      "or use Object.create(null) for the target. Lodash _.merge is also unsafe — use _.mergeWith " +
      "with a customizer that drops __proto__/constructor keys.",
    recommendedApi: "zod schema · class-validator · lodash _.pick",
    confidence: "high",
  },
  "mass-assignment": {
    title: "Define a DTO with explicit fields — never pass req.body whole",
    patchHint:
      "const dto = plainToInstance(CreateUserDto, req.body); await validateOrReject(dto); User.create(dto);",
    rationale:
      "User.create(req.body) lets the client set fields you didn't intend (role: 'admin', " +
      "isVerified: true, balance: 1_000_000). Define a DTO class with class-validator decorators, " +
      "use plainToInstance + validateOrReject, then pass the validated DTO to your model.",
    recommendedApi: "class-validator · class-transformer · zod schemas",
    confidence: "high",
  },

  // ── CONCURRENCY ────────────────────────────────────────────────────
  "toctou-race": {
    title: "Use atomic operations or a lock instead of check-then-act",
    patchHint:
      "// In SQL: SELECT ... FOR UPDATE; in Mongo: findOneAndUpdate({_id, balance: {$gte: amt}}, ...)",
    rationale:
      "Check-then-act across an await is racy: two concurrent requests can both pass the check, " +
      "then both perform the act, doubling the effect (classic stock double-deduct, balance " +
      "double-spend). Use atomic conditional updates (findOneAndUpdate with the precondition in " +
      "the filter) or a row-level lock (SELECT FOR UPDATE in a transaction).",
    confidence: "medium",
  },

  // ── PRIVILEGE ──────────────────────────────────────────────────────
  "setuid-root": {
    title: "Drop root before doing anything else; better, run unprivileged from the start",
    patchHint: "process.setuid(process.env.USER); // after binding port 80, drop privileges",
    rationale:
      "Running as root means a single RCE compromises the whole machine. Bind the privileged " +
      "port (80/443) then immediately setuid to a low-privilege user. Better yet: use a " +
      "non-root container, bind port 8080, and let your reverse proxy handle 80/443.",
    confidence: "high",
  },
};

/** Get the auto-fix suggestion for a rule (or undefined if none defined). */
export function autoFixFor(rule: RuleId): AutoFixSuggestion | undefined {
  return SUGGESTIONS[rule];
}

/** Returns true if the rule has a suggestion registered. */
export function hasAutoFix(rule: RuleId): boolean {
  return rule in SUGGESTIONS;
}

/** Total coverage — useful for tests. */
export const _SUGGESTIONS_FOR_TESTS = SUGGESTIONS;

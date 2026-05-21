# TypeCrypt

**Secrets that are readable but not runnable.** Inline string literals stay in your source code — type-checked, editor-highlighted, paste-safe — but the runtime decrypts them on demand from the OS keychain. Paste a `.ts` file into ChatGPT/Cursor/Claude and the secret never leaks because the *byte content the AI sees* is opaque.

> This is a **standalone product**, not a Mneme module. Mneme is referenced only in this spec's "prior art" section for context.

---

## The painpoint

Devs paste source code into AI coding tools (Cursor, Claude Code, ChatGPT, Continue, Cline) dozens of times a day. Existing secret-management tools fall into three categories, all of which fail for the AI-paste case:

| Category | Examples | Why it fails for AI-paste |
|---|---|---|
| Cloud secret stores | Vault, AWS Secrets Manager, Doppler | Devs still inline real secrets during debug |
| Wrapper-based env injection | `1password run`, `vault exec` | Requires wrapping every command; not inline literal |
| Encrypted-at-rest files | SOPS, git-crypt, BlackBox | Decrypted in editor → paste = leak |
| Post-hoc scanners | GitGuardian, TruffleHog, gitleaks | Reactive; alerts after leak already happened |

Closest prior art: **1Password `op run`** uses `op://vault/item/field` syntax inside env files and substitutes at runtime. Good, but: (a) URL syntax, not literal token; (b) requires `op run -- node app.js` wrapper; (c) lives in env files, not inline in `.ts`; (d) no type-level brand.

---

## The categorical shift

Existing tools treat AI-paste leakage as a **detection problem** ("scan and alert"). TypeCrypt treats it as a **structural impossibility** — the secret *physically never exists* in editor buffers, git history, or clipboard contents. Same approach memory-safe languages took for buffer overflows: not "scan for overflow", but structural elimination.

---

## How it works

### Inline tagged template literal

```ts
import { encrypted, Secret } from "@typecrypt/core";

const apiKey: Secret<"openai"> = encrypted`sk-proj-AbCd1234XyZ`;

// What the editor / git / paste sees:
//   const apiKey: Secret<"openai"> = encrypted`enc:openai:7f3a9b2c1d8e4f5a:v1`;
//
// What the runtime sees (after Node loader hook decryption from OS keychain):
//   const apiKey: Secret<"openai"> = "sk-proj-AbCd1234XyZ";
```

### Three layers

1. **TypeScript compiler plugin** — recognises `encrypted\`...\`` tagged templates at compile time. Replaces the plaintext literal with an opaque token (`enc:<scope>:<id>:<version>`) and emits a type brand (`Secret<"openai">`).
2. **Node loader hook** — at runtime, intercepts module loading and decrypts `enc:` tokens against the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). Decrypted value is held in a non-leaking string buffer (no `console.log` overload, no JSON serialise).
3. **Type brand safety** — `Secret<T>` is a phantom-tagged string subtype. The compiler plugin refuses code that flows a `Secret<T>` into `console.log`, `JSON.stringify`, or template-literal concatenation. AI-generated code that accidentally logs a secret won't compile.

### Cross-language reach

| Language | Implementation strategy |
|---|---|
| TypeScript / Node | TS compiler plugin + Node ESM loader hook |
| Python | `importlib` hook + AST rewriter |
| Go | Build plugin (rewrite `encrypted` calls during `go generate`) |
| Java | Bytecode rewriter via Java agent |

**MVP scope: TypeScript + Node only.** Multi-language ships in v2 after the TS product validates the market.

---

## Five differentiators vs prior art

1. **Literal inline in source code** — secret reference is a tagged template right where it's used; no env files, no URL syntax, no wrapper command.
2. **Same surface, different bytes** — editor/git/paste see one thing (opaque token), runtime sees another (decrypted plaintext). Identical visual surface = AI tools and human reviewers can't tell which value is sensitive.
3. **Type-brand level safety** — `Secret<T>` is a real TypeScript brand; compiler plugin enforces non-leakage at build time.
4. **Zero runtime wrapper** — Node loader hook is transparent. `node app.js` works unchanged. CI / Docker / Lambda all work.
5. **AI-paste structurally safe** — secret physically cannot enter clipboard or AI context because the plaintext is computed only inside the Node process's heap, after module loading.

---

## Tech stack

- **Language**: TypeScript 5.x
- **Runtime**: Node 20+ (ESM loader hooks require modern Node)
- **Compiler integration**: TypeScript transformer plugin (works with `ts-patch` for `tsc`, `ts-loader`, `esbuild`, `vite`)
- **Keychain**: native bindings
  - macOS: `Security.framework` via `keytar` or direct N-API
  - Windows: `wincred` via `keytar`
  - Linux: `libsecret` via `keytar` or `secret-tool` fallback
- **CLI**: `commander` + `kleur`
- **Tests**: `vitest`
- **Packaging**: monorepo with `pnpm` workspaces

### Monorepo layout

```
typecrypt/
├── packages/
│   ├── core/                 # runtime: tagged template + loader hook + keychain wrapper
│   │   ├── src/
│   │   │   ├── encrypted.ts  # tagged template `encrypted\`...\``
│   │   │   ├── loader.ts     # Node ESM loader hook
│   │   │   ├── keychain.ts   # cross-platform keychain interface
│   │   │   └── secret.ts     # Secret<T> type brand
│   │   └── package.json      # @typecrypt/core
│   ├── ts-plugin/            # TypeScript transformer plugin
│   │   ├── src/
│   │   │   ├── transformer.ts
│   │   │   └── leak-checker.ts  # refuses console.log(secret) at compile time
│   │   └── package.json      # @typecrypt/ts-plugin
│   ├── cli/                  # `typecrypt set` / `typecrypt list` / `typecrypt rotate`
│   │   └── package.json      # @typecrypt/cli (publishes as `typecrypt`)
│   └── vscode-extension/     # syntax highlighting + tooltip preview
│       └── package.json      # typecrypt-vscode
├── examples/
│   └── express-api/          # showcase: AI-paste-safe Express app
├── docs/
│   └── README.md
└── package.json
```

### npm packages to publish

| Package | Purpose |
|---|---|
| `@typecrypt/core` | Runtime: tagged template, loader, keychain |
| `@typecrypt/ts-plugin` | TS transformer + leak checker |
| `@typecrypt/cli` (bin `typecrypt`) | Key management CLI |
| `typecrypt-vscode` | VS Code extension (Marketplace) |
| `typecrypt` (meta) | `npm install -g typecrypt` installs core + cli + ts-plugin |

---

## 4-week MVP milestone breakdown

### Week 1 — Foundation
- [ ] Repo scaffold (pnpm monorepo, TS strict, vitest, GitHub Actions CI)
- [ ] `@typecrypt/core`:
  - [ ] `Secret<T>` type brand
  - [ ] `encrypted` tagged template (runtime stub returning the literal — no encryption yet)
  - [ ] Keychain wrapper (macOS first, via `keytar`); set / get / delete
- [ ] `@typecrypt/cli`:
  - [ ] `typecrypt set <scope> <value>` writes to keychain
  - [ ] `typecrypt list` lists scopes
  - [ ] `typecrypt rotate <scope>` re-encrypts under new key
- [ ] Example app: hello-world Express that calls `encrypted\`sk-test-abc\``

### Week 2 — TS transformer + loader hook
- [ ] `@typecrypt/ts-plugin`:
  - [ ] Transformer that finds `encrypted\`...\`` and replaces literal with `enc:<scope>:<id>:v1` opaque token at compile time
  - [ ] Emits `_secret_manifest.json` mapping `<id>` → keychain scope
  - [ ] Leak checker: emits TS error when `Secret<T>` flows into `console.*`, `JSON.stringify`, template literals
- [ ] `@typecrypt/core/loader.ts`:
  - [ ] Node ESM loader hook intercepts module loading
  - [ ] On module evaluation, reads `_secret_manifest.json`, decrypts `enc:` tokens via keychain
  - [ ] Returns module text with decrypted values inlined
- [ ] End-to-end test: write a `.ts` file with `encrypted\`secret\``, build with `tsc -p .` + plugin, run with `node --import @typecrypt/core/loader`, verify `secret` is the decrypted value

### Week 3 — Cross-platform + DX
- [ ] Windows Credential Manager support (via `keytar`)
- [ ] Linux libsecret support (via `keytar` + `secret-tool` fallback)
- [ ] `typecrypt-vscode` extension:
  - [ ] Syntax highlight `encrypted\`...\`` as a "sensitive literal"
  - [ ] Hover tooltip: "🔒 encrypted secret — value lives in OS keychain"
  - [ ] Diagnostic on `console.log(apiKey)` for `Secret<T>` values (reads from ts-plugin)
- [ ] Docs:
  - [ ] README with the painpoint pitch
  - [ ] Quickstart (60-sec install + first secret)
  - [ ] FAQ + threat model

### Week 4 — Polish + first ship
- [ ] CI: matrix test macOS + Windows + Linux
- [ ] Coverage ≥ 80%
- [ ] One real customer pilot (paid or free, doesn't matter — need a real codebase using it)
- [ ] Launch:
  - [ ] Publish all 4 npm packages
  - [ ] Submit `typecrypt-vscode` to VS Code Marketplace
  - [ ] HN Show / Product Hunt / dev.to writeup
  - [ ] Pricing page (see "Pricing model" below)

---

## Threat model

### Protects against
- ✅ AI-tool paste leakage (the primary case)
- ✅ Accidental `git commit` of plaintext secrets
- ✅ Shoulder-surfing / screenshare reveal
- ✅ Build-artifact secret embedding (transpiled JS still has opaque tokens)
- ✅ Accidental `console.log(apiKey)` (compiler refuses)

### Does NOT protect against
- ❌ A compromised dev machine (attacker can read the keychain — same as today)
- ❌ A malicious dep that calls `process.env.TYPECRYPT_LOG_SECRETS=1` and re-exports decrypted values (we'll add a runtime guard in v2)
- ❌ Memory-dump attacks during runtime (the secret IS plaintext in heap by design)
- ❌ A coworker with shell access to your machine (it's the OS keychain — coworker access = secret access)

---

## Pricing model

**Free forever**: open source, MIT-licensed core + ts-plugin + cli + vscode extension. Single-developer use case is fully covered.

**TypeCrypt Cloud** (paid, ships in v2): team-level keychain sync (encrypted), policy enforcement (which secrets exist where), audit log, SSO. $10/dev/month. Enterprise tier with on-prem deployment + SOC2 attestation.

The wedge: enterprise paranoia about AI tools = unbounded willingness to pay for structural-elimination of secret-leak class. Free tier drives adoption; cloud tier captures revenue from companies that need centralised policy.

---

## Why this is hard to copy

- **TypeScript transformer + Node loader hook + keychain bridge** is the smallest possible surface that delivers the categorical shift. Building it requires understanding all three.
- **The leak-checker compiler plugin** is the moat. Other secret tools alert; this one *refuses to compile* code that would leak. AI vendors learn to write `Secret<T>`-safe code because their output doesn't ship otherwise.
- **First-mover network effect**: once a team's codebase uses `encrypted\`...\`` everywhere, switching costs are high (every secret must be re-encoded under new tool).

---

## Open questions to confirm before week 1

1. **Multi-language scope at MVP**: ship TS+Node only (4 weeks) or push for Python/Go too (12+ weeks)?
2. **Keychain backend at MVP**: macOS+Windows+Linux from day one (cross-platform pain) or macOS-only (founder demos)?
3. **License**: MIT (open source, max adoption) or BSL (paid for >$1M revenue)?
4. **Pricing**: free forever for individuals + paid team tier from launch, or 100% free until first 1000 users?

Defaults if unanswered: ship **TypeScript+Node only, macOS+Windows+Linux, MIT license, free forever for individuals + paid team tier in v2**.

---

## First commit checklist

```bash
mkdir typecrypt && cd typecrypt
git init
pnpm init
mkdir -p packages/core/src packages/ts-plugin/src packages/cli/src examples/express-api
# Drop this SPEC into docs/SPEC.md
mkdir docs && cp /path/to/TYPECRYPT_SPEC.md docs/SPEC.md
# Then ask Claude Code:
#   "Read docs/SPEC.md. Start Week 1 milestone. Begin with @typecrypt/core."
```

Good luck. Ship in 4 weeks.

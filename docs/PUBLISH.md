# Publishing Mneme to npm

The release workflow is automated — push a `v*` tag, GitHub Actions builds + publishes. This file is the one-time setup, plus the manual escape hatch.

## One-time setup

### 1. Create an npm account (if you don't have one)

→ https://www.npmjs.com/signup

Use the email you want public on the npm package page. You cannot easily change it later.

### 2. Enable 2FA on the npm account

`npm` Settings → Two-Factor Authentication → enable for **both** "Authorization and writes" (the strongest tier). Required for publishing scoped packages with provenance.

### 3. Create an automation token

`npm` Settings → Access Tokens → Generate new token → **Granular Access Token**

| Field | Value |
|---|---|
| Name | `mneme-ai-github-actions` |
| Expiration | 365 days |
| Allowed IP ranges | empty (or restrict to GitHub Actions IPs if paranoid) |
| Packages | choose: *Only select packages and scopes* |
| Selected | `mneme-ai`, `@mneme-ai/*` (scope) |
| Permissions | Read and write |

Copy the token — you only see it once.

### 4. Register the `@mneme-ai` org on npm

The scoped packages (`@mneme-ai/core` etc.) need an org. Two options:

**Option A — free org** (recommended)
1. Visit https://www.npmjs.com/org/create
2. Name: `mneme-ai`
3. Plan: Free (public packages only)

**Option B — your personal scope**
1. Edit each `packages/*/package.json` to use `@<your-npm-username>/...`
2. Update imports across the codebase
3. Skip the org creation

Stick with **Option A** unless you have a reason; it's cleaner.

### 5. Add `NPM_TOKEN` to GitHub repo secrets

In the repo → **Settings → Secrets and variables → Actions → New repository secret**

| Field | Value |
|---|---|
| Name | `NPM_TOKEN` |
| Secret | (paste the npm automation token from step 3) |

That's it. The release workflow at [`.github/workflows/release.yml`](../.github/workflows/release.yml) reads this secret automatically.

## Cutting a release

The whole flow is one tag push:

```bash
# 1. make sure main is green
npm test
npm run eval -- --variant baseline

# 2. bump versions across the workspace
# (manual for now; v0.3 will have a `changesets` flow)
# update each packages/*/package.json "version" field, plus root
# also update README badges if you reference numbers

# 3. commit + push the version bump
git add -A
git commit -m "chore(release): v0.X.Y"
git push origin main

# 4. tag + push the tag
git tag -a v0.X.Y -m "v0.X.Y — <one-line summary>"
git push origin v0.X.Y

# 5. watch the Actions tab
# https://github.com/patsa2561-art/mneme-ai/actions
```

The `release.yml` workflow:

1. Checks out the tag
2. Runs `npm ci`, `npm run build`, `npm test`, `npm run eval`
3. Publishes packages **in dependency order**:
   - `@mneme-ai/core`
   - `@mneme-ai/embeddings`
   - `@mneme-ai/correlator`
   - `@mneme-ai/mcp`
   - `mneme-ai` (CLI binary)

Each `npm publish` uses `--provenance`, which signs the publish with GitHub Actions OIDC. npm shows a "✅ verified provenance" badge on the package page.

## Manual publish (emergency)

If the workflow fails and you need to publish anyway:

```bash
# log in
npm login

# verify you can write to the org
npm whoami
npm access list packages @mneme-ai

# build clean
npm run clean
npm install
npm run build

# publish in order (each command from its package directory)
cd packages/core         && npm publish --access public --provenance && cd ../..
cd packages/embeddings   && npm publish --access public --provenance && cd ../..
cd packages/correlator   && npm publish --access public --provenance && cd ../..
cd packages/mcp          && npm publish --access public --provenance && cd ../..
cd packages/cli          && npm publish --access public --provenance && cd ../..
```

If any one of these fails midway, npm gives you a clear error. The most common failure is **provenance refusing because the working tree has uncommitted changes**. Fix: `git status`, commit or stash, retry.

## Smoke test after publish

```bash
# in a fresh shell (not the dev shell — env var pollution)
npx -y mneme-ai@latest --version
npx -y mneme-ai@latest --help

# in any git repo
cd /path/to/some/repo
npx -y mneme-ai@latest init
npx -y mneme-ai@latest index --embedder hash
npx -y mneme-ai@latest ask "..."
```

If `npx -y` fails to find the binary, the most common cause is the workspace dependencies not yet being on the registry — wait 60 seconds, npm CDN propagation is eventually consistent.

## Unpublishing — read this before you ever do

**npm does not allow unpublishing a package after 72 hours**, and within 72 hours only if no other public package depends on yours. Treat every `npm publish` as permanent.

For a botched release:

1. Bump the patch version (`v0.X.Y+1`)
2. Publish a fixed version
3. `npm deprecate mneme-ai@0.X.Y "broken release; use 0.X.Y+1"`

Do **not** publish over the same version. Do **not** force-push tags after publish. Do **not** unpublish unless absolutely necessary.

## Costs

`mneme-ai` and `@mneme-ai/*` are public packages on the free npm tier.

- Publish: free
- Bandwidth: free for users (npm pays)
- Provenance: free (uses GitHub Actions OIDC)
- Org: free (mneme-ai is a free org)

Your only ongoing costs are GitHub Actions minutes (free tier covers ~3000 minutes/month for public repos — you'll never hit that with a release per week).

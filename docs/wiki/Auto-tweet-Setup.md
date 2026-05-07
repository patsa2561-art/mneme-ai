# 🐦 Auto-tweet on release — setup guide

> *Push a tag → X tweet posts automatically.*

The workflow lives at `.github/workflows/auto-tweet.yml`. It runs on every tag push (and on `workflow_dispatch` with a `dry-run` toggle for testing). It composes the tweet from the matching `CHANGELOG.md` entry plus canonical project links, then posts via the X v2 API.

If the X API secrets aren't configured, the workflow **skips silently with a warning** — it never blocks a release.

═══════════════════════════════════════════════════════════════════════════════

## One-time setup (~10 minutes)

### 1. Create an X developer account

- Go to **https://developer.x.com**
- Click **"Sign up"** → use your existing X account
- Choose the **Free** tier (sufficient for ~1500 tweets / month, well over our ~12 releases/year)

### 2. Create a Project + App

- Inside the developer portal, **Projects & Apps → Overview → + Add Project**
- Name it: `mneme-ai-release-bot` (any name — only you see it)
- Use case: *"Publishing content"*
- Inside the project, **+ Add App**
- Name it: `mneme-release-bot`

### 3. Set permissions to "Read and Write"

- **App settings → User authentication settings → Set up**
- App permissions: **Read and Write**
- Type of App: **Web App, Automated App or Bot**
- Callback URL: `https://github.com/patsa2561-art/mneme-ai` (any HTTPS URL — required field, never used)
- Website URL: `https://patsa2561-art.github.io/mneme-ai/`
- **Save**

> ⚠ If you skip "Read and Write", posting will fail with a 403. Permissions can be flipped later but you'll need to **regenerate** the access token afterwards.

### 4. Generate the four credentials

You need **4 secrets**. The dev portal calls them differently depending on where you click — here's the canonical mapping:

| GitHub secret name | X dev portal label |
|---|---|
| `X_CONSUMER_KEY` | **API Key** |
| `X_CONSUMER_SECRET` | **API Key Secret** |
| `X_ACCESS_TOKEN` | **Access Token** |
| `X_ACCESS_TOKEN_SECRET` | **Access Token Secret** |

In the dev portal:
1. **Keys and tokens** tab
2. **Consumer Keys → Regenerate** → copy the API Key + API Key Secret (these vanish after this view; re-generate if lost)
3. **Authentication Tokens → Access Token and Secret → Generate** → copy both

### 5. Add as GitHub repo secrets

- Open **https://github.com/patsa2561-art/mneme-ai/settings/secrets/actions**
- For each of the 4 names above:
  1. Click **New repository secret**
  2. Name: e.g. `X_CONSUMER_KEY`
  3. Value: the corresponding key
  4. **Add secret**

### 6. Test it

- **Actions → Auto-tweet on release → Run workflow**
- Tag input: `v0.33.0` (any existing tag)
- Dry-run: **true** (composes the tweet but does NOT post — verify the text looks right)
- Run

If the dry-run output looks correct, run again with **dry-run: false** to actually post a test tweet (delete after if you don't want it on your timeline).

═══════════════════════════════════════════════════════════════════════════════

## What the tweet looks like

The workflow extracts the first paragraph from your CHANGELOG entry for the tag and composes:

```
🚀 Mneme v0.33.0 — Production hardening + intelligence upgrade. Three changes that ship together: …

📦 https://www.npmjs.com/package/mneme-ai
🎬 https://patsa2561-art.github.io/mneme-ai
📋 https://github.com/patsa2561-art/mneme-ai/releases/tag/v0.33.0
```

X auto-shortens each URL to 23 chars. The headline is capped at ~150 chars so the whole post fits inside X's 280-char free-tier limit.

═══════════════════════════════════════════════════════════════════════════════

## Customizing the tweet

Edit `.github/workflows/auto-tweet.yml`:

- **Different tagline / format** → modify the `Compose tweet` step's heredoc.
- **Longer tweets (X Premium)** → increase the `MAX = 150` constant in the headline-extract step.
- **Multiple posts (thread)** → switch the action; `noweh/post-tweet-v2-action` doesn't natively thread. Replace with `Eomm/why-don-t-you-tweet@v2` or use the X v2 API directly via curl.

═══════════════════════════════════════════════════════════════════════════════

## Privacy / ops

- Secrets are stored encrypted by GitHub; only the workflow runner sees them at run time.
- The workflow only runs on tag push or manual dispatch — never on PRs or branches.
- Concurrency-controlled: two simultaneous tag pushes won't double-post.
- If you ever leak a key: regenerate immediately in the X dev portal — old keys revoke automatically.

═══════════════════════════════════════════════════════════════════════════════

## Troubleshooting

**`403 Forbidden`** on post step → the app doesn't have Write permission. Re-do step 3, then **regenerate** the access tokens (re-running on the same tokens after a permission change still 403s).

**`401 Unauthorized`** → at least one of the 4 secrets is wrong. Compare the GitHub secret name vs the X portal label using the table in step 4.

**`Headline is empty`** → CHANGELOG entry for the tag couldn't be parsed. Check that the heading exactly matches `## [<version>] — <date>` and that there's a blank line + paragraph below it.

**Workflow skipped silently** → secrets are missing. The workflow logs a warning rather than failing. Add the secrets and re-run.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🚀 [release.yml](https://github.com/patsa2561-art/mneme-ai/blob/main/.github/workflows/release.yml) — the release pipeline this hooks into
- 📰 [CHANGELOG.md](https://github.com/patsa2561-art/mneme-ai/blob/main/CHANGELOG.md) — the source of every tweet headline
- 🔌 [Integrations](Integrations) — other CI hookups

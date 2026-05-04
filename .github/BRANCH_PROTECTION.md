# Branch protection setup

GitHub flagged that `main` is unprotected. This file documents what to enable, when, and why.

## Recommended now (solo maintainer, 5 minutes)

Go to **Settings → Branches → Add branch ruleset** (or **Add classic branch protection rule**) for `main`.

Enable the **light** protections — these cost nothing and prevent accidents:

- [x] **Restrict deletions** — `main` cannot be deleted, even by you
- [x] **Block force pushes** — history cannot be rewritten
- [x] **Require linear history** — no merge commits cluttering the log

Skip these until you have collaborators:

- [ ] Require a pull request before merging
- [ ] Require approvals
- [ ] Require status checks to pass

The light set protects against your own typos. The heavy set is for protecting against other people's PRs.

## Recommended when contributors arrive

Re-enter the same ruleset and add:

- [x] **Require a pull request before merging**
  - [x] Require approvals: **1**
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required checks (these names come from `.github/workflows/ci.yml`):
    - `build-and-test (ubuntu-latest, 22)`
    - `build-and-test (windows-latest, 22)`
    - `build-and-test (macos-latest, 22)`
    - `eval-matrix`
- [x] **Require conversation resolution before merging**
- [x] **Do not allow bypassing the above settings**

## Why we don't auto-protect harder

For a solo maintainer, "require PR + 1 reviewer" means *you cannot push to your own repo* — every change becomes a PR you open and approve yourself. That's friction without benefit.

The right time to flip the heavy switches is when:
- You merge your first external contributor PR
- You have a paying customer or production deployment
- You introduce a release branch alongside `main`

## Bypass / emergency

If you ever need to force-push `main` (rare — almost always a bad idea), temporarily remove the rule, push, restore the rule. Better: revert via a new commit. Best: don't get into that situation.

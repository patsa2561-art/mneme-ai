# Discussions setup — welcome post + categories

GitHub Discussions are off by default. To enable:

1. Go to **Settings → General → Features**
2. Tick **Discussions**
3. The Discussions tab appears in the repo header

Then go to **Discussions → Categories** and configure:

## Suggested categories

| Category | Format | Purpose |
|---|---|---|
| **📣 Announcements** | Announcement | Maintainer-only — releases, breaking changes |
| **💡 Ideas & feature proposals** | Open-ended | "Should we?" conversations before issues |
| **🛠️ Show & Tell** | Open-ended | Users share what they built with Mneme |
| **❓ Q&A** | Question / Answer | Triage-able support — questions get accepted answers |
| **🔬 Phase 2/3 progress** | Open-ended | Tracking semantic clones + incident correlation |
| **✍️ Meditations** | Open-ended | Discussion of the MEDITATIONS.md essays |

## Welcome post

Pin this as the first announcement once Discussions are enabled.

---

**Title:** Welcome to Mneme — start here

**Category:** Announcements
**Pinned:** yes

---

Hi, and welcome.

Mneme is a small project with a specific bet: **AI coding assistants get smarter not by getting bigger, but by getting the right context.** That context lives in your git history, your PR descriptions, your incident reports. We make it queryable.

This space is for everyone who finds that bet interesting. Three things I would love to see here:

1. **Stories.** If you ran `mneme ask` against your own repo and it surfaced something useful — or something embarrassing — say so in *Show & Tell*. Honest reports from real codebases are the most valuable signal we have.

2. **Hard cases.** If you tried Mneme on a repo and it returned nothing useful, that is also worth posting. Mneme is supposed to honestly say *"no relevant context"* when the data is bad. If it lied to you instead, that is a bug. If it stayed silent, the lesson might be about your team's commit hygiene — also useful.

3. **Phase 3 collaborators.** The *moat* of this project is connecting commits to incidents (your observability platform, CI failures). The first pager adapter is in `main`; more are next. If you have a production codebase + an observability account + a willingness to dogfood, please open a thread.

Things to know:

- **Bug?** Open an [issue](../../issues) — has a structured form.
- **Question?** Post in *Q&A*. The community answers; you mark the answer.
- **Already-tried-it report?** Open a thread in *Show & Tell* with the repo size, embedder, and what you asked.
- **Read the [meditations](../../blob/main/MEDITATIONS.md).** They are the philosophy of the tool. The CLI ships them: `mneme wisdom`.

The project is MIT-licensed, written in TypeScript, and runs entirely on your machine by default (Ollama embedder). No API key required, no telemetry, no accounts.

Thank you for being here.

— Shinnapat

---

## Posting cadence (sustainable)

Pinned posts age out unless they get replies. Plan:

- **Weekly** — quick "what shipped this week" thread (3 sentences max, even if nothing big shipped)
- **Per release** — full announcement post in *Announcements*
- **As-they-come** — replies to every Q&A and Show & Tell thread within 48 h

This keeps the space alive without becoming a second job.

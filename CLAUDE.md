# Development guidelines — sky121.github.io

Skylar's portfolio site (GitHub Pages, static — no build step). The **Lab**
(`lab.html`) hosts two live projects, each with its own handoff doc that is
the single source of truth for its state and roadmap:

- **Dragoose** (watercolor flying roguelike): `dragoose.html`,
  `assets/js/dragoose.js`, `assets/css/dragoose.css` → docs in
  `docs/dragoose/README.md`
- **Peckish** (restaurant picker): `eats.html`, `assets/js/eats.js`,
  `assets/css/eats.css` → docs in `docs/peckish/README.md`

## Orchestration model (how work gets done)

**The main session is the ORCHESTRATOR — it never implements tasks itself.**
For every task (planned or user-requested):

1. **Plan** the task into a self-contained scope with explicit verification
   requirements.
2. **Deploy a subagent** to implement it — run multiple agents in parallel
   when tasks touch disjoint files (Dragoose lane vs Peckish lane vs shared).
   Agent prompts must include: exact file whitelist, the design-language
   rules below, verification steps (node --check + Playwright + reading
   screenshots), "no git commands", and a report-back format.
3. The orchestrator stays available for new instructions while agents work;
   on each agent's completion it **reviews the diff, re-verifies, commits,
   opens the PR, merges, resets the branch**, and deploys the next wave.
4. If an agent dies mid-task (usage limits), the orchestrator salvages:
   audit the partial diff, finish only the small gaps, verify, ship.

## Git & PR workflow (standard practice for all future work)

1. **Branch per unit of work.** Each self-contained change (a feature wave,
   a fix, one project's iteration) gets its own branch off `master` —
   never stack unrelated work on one long-lived branch.
2. **Periodically open PRs — do not let branches grow unbounded.** When a
   unit of work is complete and verified, open a PR to `master` with a body
   describing what shipped and how it was verified.
3. **Review before merge.** Every PR gets a review pass (self-review at
   minimum: re-read the diff, check the verification evidence, look for
   regressions in shared files). Fix findings before merging.
4. **Merge when green, then start the next branch from fresh `master`.**
   Small, frequently merged PRs over mega-branches.
5. Commit messages: imperative summary line, body listing user-visible
   changes. Update the relevant `docs/*/README.md` in the same commit as
   the feature it documents.

## Working agreements

- **Verify in a real browser before committing.** `node --check` for syntax,
  then Playwright (chromium at `/opt/pw-browsers/chromium`) driving the real
  flows at mobile viewport; read the screenshots. Zero page errors is the
  bar (the Google Fonts connection error is sandbox noise).
- **Run locally:** `python3 -m http.server 8000` from repo root; pages must
  be served over HTTP, not file://.
- **Parallel workstreams stay in their lanes:** Dragoose work touches only
  dragoose.* + its docs; Peckish only eats.* + its docs. Shared files
  (lab.html, index.html, gallery.js, exhibit-page.css, sitemap.xml) are
  edited by the orchestrator only.
- **Design language is non-negotiable:** watercolor aesthetic; Cormorant
  Garamond (display/italic) + Karla (UI); palette ink #2e3a48, pond #7fa8c9,
  pond-deep #4a7299, wisteria #a292c4, sage #93b48b, rose #d98ba0,
  gold #cdb878, paper #f6f1e7. Always respect `prefers-reduced-motion`;
  keep dark mode (`html.evening`) working; AA contrast.
- **Code style:** vanilla JS, no deps, no build step. `eats.js` and
  `dragoose.js` are each one `'use strict'` IIFE; dragoose.js stays
  ES5-flavored (no arrows/let) to match its existing body. Keep the
  perf patterns: pre-rendered sprites, object pools, no per-frame
  allocation in hot loops.
- **Never commit secrets** (the Peckish Google Maps key lives only in the
  user's browser localStorage).

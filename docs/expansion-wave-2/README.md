# Expansion Wave 2 — Coaching Feature Pack (mobile UX + operator specs)

Pre-build documentation for the next wave of coaching features on the mobile app. **Docs only — no runtime code, `app.json`, `eas.json`, `package.json`, or CI is changed.** Implementation of each brief is a separate follow-up PR with code, tests, and its own review cycle.

This pack is the third docs-only pre-build pack in the repo, after:

- **PR #92** (`docs/expansion/`) — operator-readiness expansion pack: 11 next features (check-ins, AI recap, intake templates, public coach profile, revenue dashboard, team mode, etc.).
- **PR #93** (`docs/platform-readiness/`) — cross-cutting mobile platform pack (release/EAS, feature flags, role-based nav, accessibility, AsyncBoundary, analytics, deep links, QA matrix).

Wave 2 covers a set of coaching-product features that the existing two packs do not specify in full. Every brief in this directory adheres to the same six-question structure (**WHY, WHEN, WHERE, WHO, WHAT, HOW**) and the same readiness sections (screens / API / media UX / a11y / state machine / privacy / flags / analytics / rollout / tests / risks / dependencies / acceptance / operator handoff).

## Index

| File | Topic | One-line scope |
| --- | --- | --- |
| [`01-coach-fitness-challenges.md`](./01-coach-fitness-challenges.md) | Coach-created fitness challenges | Time-boxed multi-client challenges (e.g. "30-day step", "8-week strength"), authored by coach, opt-in by client. |
| [`02-leaderboards-public-private.md`](./02-leaderboards-public-private.md) | Public + private leaderboards | Per-challenge leaderboard surfaces with explicit visibility scope, opt-in display, anonymisation. |
| [`03-profile-images-and-avatars.md`](./03-profile-images-and-avatars.md) | Profile image / avatar flows | Upload, crop, moderate, cache, fall back to initials avatar; coach + client; identity-safe by default. |
| [`04-coach-content-boards.md`](./04-coach-content-boards.md) | Coach content boards | Authoring + delivery of PDFs, newsletters, videos (link), and external links — per-coach board, per-client visibility. |
| [`05-coach-regimens-programs.md`](./05-coach-regimens-programs.md) | Coach-created regimens / programs | Multi-week training + nutrition programs authored by coach (extends existing `ProgramTemplatesScreen`). |
| [`06-per-client-assignment.md`](./06-per-client-assignment.md) | Per-client assignment | Single assignment surface for programs, content, challenges, with start dates and overrides. |
| [`07-coach-client-messaging-surfaces.md`](./07-coach-client-messaging-surfaces.md) | Coach ⇄ client messaging surfaces | Extension of existing 1:1 DM with attachments, voice notes, broadcast (1:N), pinned messages. |
| [`08-progress-visibility.md`](./08-progress-visibility.md) | Progress visibility | What a coach can see about a client's progress and what a client can see about their own — shared, scoped, redacted. |
| [`09-tier-gated-l2-l3.md`](./09-tier-gated-l2-l3.md) | Tier-gated L2 / L3 experiences | Entitlement-driven gating for premium tiers; declarative `useEntitlement()` contract. |
| [`10-do-we-have-this-already.md`](./10-do-we-have-this-already.md) | "Do we have this already?" | Honest gap analysis vs PR #92 / #93 / shipped surface. The first thing a reviewer should read. |

A reviewer who has only ten minutes should read [`10-do-we-have-this-already.md`](./10-do-we-have-this-already.md) first — it tells them where Wave 2 actually adds value vs. duplicates earlier packs.

## Cross-cutting constraints (called out once, here)

The briefs are written under these properties of the mobile shell as it stands today on `main`. **None of them is changed in this PR.**

- **Expo managed workflow**, SDK ~55, React Native 0.83.
- **EAS identity is immutable**: `owner: the-growth-project`, `slug: tgp-health-and-wellness`, `expo.extra.eas.projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`, `bundleIdentifier / package: com.growthproject.app`, `scheme: tgp`. Any feature here that needs new entitlements (camera, photo library) declares them in its own follow-up PR — not here.
- **Theme tokens** (`src/theme/tokens.ts`) are the single source of truth. Display copy uses Cormorant Garamond ≤500 weight; UI copy uses Inter. No raw hex literals in feature code.
- **Quiet-luxury doctrine** (`docs/QUIET_LUXURY_DOCTRINE.md`) governs every UI decision. No "Coming Soon", confetti, exclamation-heavy copy, hype language, em-dash marketing prose, emoji in `src/**`, or trophy chrome. A feature either ships real or its tab is hidden.
- **No streak/badge/trophy vocabulary** (per merged PR #70). Wave 2 leaderboards and challenges use neutral framing: *standings*, *participation*, *milestones* (date · note rows). No flames, medals, trophies, or particle bursts.
- **Navigation shape**: client = 4 icons-only bottom tabs (Home / Train / Log / Profile) + `MoreStack` hung off Profile. Coach = 5 tabs (Clients / Dashboard / Templates / Messages / Settings). New surfaces extend `MoreStack` or coach tabs — they do not introduce a fifth client tab.
- **Auth shape** per `docs/HANDOFF.md` §4. Tenancy is JWT-scoped on the backend. Mobile never asks "give me all clients/challenges/programs" — it asks for *mine* implicitly via the JWT.
- **API client**: `src/services/api.ts` is the single HTTP entry point. New endpoints go through namespaced sub-clients (e.g. `challengesApi`, `programsApi`) inside this file, with versioning headers per `docs/platform-readiness/09-api-contract-compatibility.md`.
- **Realtime** uses Supabase broadcast channels (see `src/services/realtime.ts`). Any new push is a broadcast; the receiving screen also runs a 60 s safety poll.
- **State**: Zustand v5 (`src/store/`) for cross-screen state, React Query (`src/services/queryClient.ts`) for server state. Persisted client store via `react-query-persist-client`.
- **Offline**: writes that must survive a flaky tunnel use a queue pattern (see `src/services/foodLogQueue.ts`). Reads degrade to cached / empty state with the `AsyncBoundary` contract from `docs/platform-readiness/07-loading-error-empty-states.md`.
- **Analytics**: PostHog. Event registry lives alongside `docs/platform-readiness/08-crash-and-analytics-readiness.md`. New events declared in each brief use `wave2_<feature>_<verb>` naming and PII-redacted properties.
- **Feature flags / entitlements**: PostHog flags via the `useFlag()` hook contract from `docs/platform-readiness/02-feature-flag-consumption.md`. Tier gating is a first-class concept (see `09-tier-gated-l2-l3.md`).
- **Testing**: Jest (`jest.setup.js`) for unit / hook tests, React Native Testing Library for component tests. New coach screens follow the `src/screens/coach/__tests__/` layout. No e2e test framework is in this repo today; explicit acceptance steps in each brief are the proxy.
- **Crash telemetry**: Sentry (`src/services/sentry.ts`). Every new feature wraps its top-level navigator entry in a Sentry boundary and tags release/environment per PR #75.
- **`new-website` is out of scope**. There is no `new-website` directory in this repo. No file in this PR references or modifies it.

## What this PR is *not*

- Not a roadmap. Numbering is alphabetical-by-topic, not a committed sequence. Sequencing belongs in the team's planning tool.
- Not permission to start any of these features. Each becomes its own PR with code, tests, and its own docs update.
- Not a duplicate of `docs/expansion/` (PR #92) or `docs/platform-readiness/` (PR #93). Where overlap is unavoidable, [`10-do-we-have-this-already.md`](./10-do-we-have-this-already.md) calls it out explicitly.
- Not a backend spec. Backend contracts referenced here are *what mobile expects*, not what backend has agreed to. Each follow-up PR pairs with a backend PR.
- Not a Figma. Visual specifics (exact spacing, exact micro-copy) belong in design hand-off, not these briefs.

## Operator handoff (for this whole pack)

| Question | Answer |
| --- | --- |
| Who owns this pack? | Mobile lead. Reviewer for individual briefs is whoever owns the surface area (e.g. coach lead for coach-side, client lead for client-side). |
| Where does an operator pick up? | Read this file. Then read [`10-do-we-have-this-already.md`](./10-do-we-have-this-already.md). Then pick a brief and follow its acceptance criteria. |
| What's "done" for the pack? | Draft PR opened, every linked file resolves, no `src/**` / `app.json` / `eas.json` / `package.json` / CI files changed, `npm run validate:config` is no worse than `main`. |
| What's *not* done? | Implementation. Each brief is unimplemented until its own PR ships, gets tests, and turns its feature flag on. |

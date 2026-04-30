# Operator readiness expansion pack

Pre-build documentation for the next 11 mobile-owned (or mobile-facing) features
on the 20-step roadmap. Each file in this directory is a self-contained brief
for a future operator — engineer, contractor, or PM — picking up that feature
cold.

The goal of this pack is not to dictate code. It is to make the *first hour* of
implementation safe: the operator can read one file, understand what the feature
is for, who it serves, where it slots into the existing app, and what to avoid.
Every README answers the same six questions — **WHY, WHEN, WHERE, WHO, WHAT,
HOW** — followed by screens, API contract, feature flag, testing, risks,
dependencies, and acceptance criteria.

## Scope

This pack covers **mobile-owned and mobile-facing** items only. Backend-only
features (e.g. payment-engine internals) are out of scope unless they ship a
mobile surface. Two backend draft PRs are referenced cross-repo because they
unblock several mobile features:

- **PR #117 — AI Program Builder** (backend) — generation endpoint that several
  mobile features in this pack consume (#10, #18).
- **PR #118 — Team Mode** (backend) — multi-coach roles, permissions, client
  assignment that #20 depends on end-to-end.

These PR numbers refer to the backend repository, not this one.

## Index

| # | File | Title | Primary surface |
| - | ---- | ----- | --------------- |
| 5 | [05-weekly-checkins-client.md](./05-weekly-checkins-client.md) | Mobile client UI for weekly check-ins | Client app |
| 6 | [06-coach-checkins-widget.md](./06-coach-checkins-widget.md) | Coach dashboard widget — latest check-ins | Coach app |
| 8 | [08-coach-attention-panel.md](./08-coach-attention-panel.md) | Coach dashboard — clients needing attention | Coach app |
| 10 | [10-coach-generate-recap.md](./10-coach-generate-recap.md) | "Generate weekly recap" coach button | Coach app |
| 11 | [11-coach-ai-voice-tone.md](./11-coach-ai-voice-tone.md) | Editable coach AI voice/tone setting | Coach app |
| 12 | [12-ready-to-scale-checklist.md](./12-ready-to-scale-checklist.md) | Ready-to-scale checklist UI | Coach app |
| 14 | [14-intake-templates.md](./14-intake-templates.md) | Intake templates in invite/onboarding | Coach + onboarding |
| 16 | [16-public-coach-profile.md](./16-public-coach-profile.md) | Public coach profile + deep-link contract | Web → mobile handoff |
| 18 | [18-clone-starter-programs.md](./18-clone-starter-programs.md) | Clone starter programs (mobile coach) | Coach app |
| 19 | [19-coach-revenue-dashboard.md](./19-coach-revenue-dashboard.md) | Coach revenue dashboard | Coach app |
| 20 | [20-team-mode-mobile.md](./20-team-mode-mobile.md) | Team mode — roles, permissions, junior coach | Coach app |

## How to use this pack

1. Pick one README. Read it end-to-end before opening any code.
2. Confirm the **API contract dependency** is satisfied — every feature in this
   pack has a backend prerequisite. If the backend isn't shipped yet, do not
   start the mobile work; the contract is the source of truth and shipping
   ahead of it produces fictitious UI.
3. Confirm the **feature flag** is in place. Every feature ships behind a flag
   so it can be dark-launched, tested with a single coach, and ripped out
   cleanly if the contract drifts. See `src/store/` and existing flags before
   inventing a new mechanism.
4. Build to the **MVP** described, not the maximalist version. The READMEs are
   deliberate about what is *out of scope for v1*.
5. Update the README as you ship. The repo's contribution rule
   (`docs/QUIET_LUXURY_DOCTRINE.md` §8) requires it; this pack is no
   exception.

## Conventions used in every README

- **Status: Pre-build** — none of these features have started. If you start
  one, change this to `In progress — <branch>` and link the PR.
- **Last reviewed: 2026-04-30** — this is the date the brief was written, not
  a guarantee the brief is current. Re-validate against `app.json`,
  `src/services/api.ts`, and the backend OpenAPI before committing code.
- **Out of scope** — every feature has at least one explicit "not for v1"
  bullet. Respect them; the line was drawn deliberately.

## Cross-cutting constraints

These apply to every feature in this pack and are not repeated in each file.

- **Expo / EAS identity is fixed.** `owner: the-growth-project`,
  `projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`,
  `bundleIdentifier / package: com.growthproject.app`. Never edit these to
  ship a feature; if you think you need to, you don't.
- **Theme is single source.** `src/theme/index.ts` — no hardcoded hex, no new
  palette. The bone/forest light theme is the only theme shipping.
- **Doctrine: no placeholder chrome.** `docs/QUIET_LUXURY_DOCTRINE.md`
  forbids "coming soon" tiles, fake activity feeds, and decorative metrics.
  Every screen in this pack must render an *honest* empty state when the
  data is empty — explain what would appear, do not fake what isn't there.
- **Tenant safety.** Coach-side screens never request "all" of anything. The
  JWT scopes responses; the mobile client must not assume otherwise.
- **Navigation shape.** Client app has 4 bottom tabs (Home / Train / Log /
  Profile) with a More stack hung off Profile. Coach app has 5 tabs
  (Clients / Dashboard / Templates / Messages / Settings). Don't add a
  sixth without team agreement.
- **Per-module READMEs are mandatory.** Any new screen directory or service
  module added by a feature in this pack ships its own README on the same
  PR, per doctrine §8.

## What this pack is NOT

- Not a design spec. UX details (spacing, copy, motion) live in Figma and the
  doctrine doc, not here.
- Not a project plan. Estimates, sequencing, and ownership belong in the
  team's planning tool, not in the repo.
- Not permission to ship. Each feature still needs a real PR with tests,
  type-checks, and code review.

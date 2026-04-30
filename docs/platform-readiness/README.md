# Mobile platform readiness pack

Pre-build briefs for the **cross-cutting mobile-platform capabilities** that must be in place before The Growth Project mobile app can carry the next wave of features safely. This pack is the platform-side counterpart to the per-feature briefs in [`docs/expansion/`](../expansion/README.md) (PR #92): #92 answers "what does each new feature look like", this pack answers "what does the mobile platform need so any of those features can ship without breaking everything else".

This is **pre-work documentation**. No code paths in `src/`, `app.json`, `eas.json`, or `.env.example` are touched in this PR. Each brief is a written-down decision an operator (engineer, contractor, or PM) can pick up cold and turn into one or more implementation PRs later.

## Relationship to other PRs

| PR | Repo | What it covers | How this pack relates |
| --- | --- | --- | --- |
| **#92** (this repo) | mobile | Per-feature briefs for items 5, 6, 8, 10, 11, 12, 14, 16, 18, 19, 20 of the 20-step roadmap. | Complements. #92 covers individual feature surfaces; this pack covers platform plumbing those features depend on. No file overlap. |
| **#117** | backend | AI Program Builder (LLM gateway, generation contract, voice/tone, recap). | Referenced by `06-experiment-and-update-channels.md` (rollout of LLM-using surfaces) and `09-api-contract-compatibility.md` (versioned generation endpoints). |
| **#118** | backend | Team mode (org/role hierarchy, junior coach permissions). | Referenced by `04-role-based-navigation-architecture.md` (frontend role evaluation) and `09-api-contract-compatibility.md` (role-stamped responses). |
| **#119** | backend | (Per parent agent reference; treated as the third backend pre-work PR — kept noted in `09` and `06` so this pack stays aligned even if #119's scope shifts.) | Referenced where API-shape / rollout plumbing intersects. |

## Cross-cutting constraints (read once, applies to every brief)

These are properties of **the mobile shell as it exists today**. Every brief below is written under the assumption that none of them change without a separate PR with its own review.

1. **Expo managed workflow, SDK ~55**, React Native 0.83. No bare workflow planned. Anything that would require ejecting must be flagged explicitly in the brief's *Risks* section.
2. **EAS identity is immutable in this PR**: `owner: the-growth-project`, `slug: tgp-health-and-wellness`, `expo.extra.eas.projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`, `bundleIdentifier / package: com.growthproject.app`, `scheme: tgp`. None of the briefs below propose changing these.
3. **Theme tokens** (`src/theme/index.ts`, `tokens.ts`) are the single source of truth for colour, typography, spacing, radius, shadow. No new hex values, no new font families introduced casually. The reusable-UI brief (`05`) is the only place new tokens may be proposed, and only with a written justification.
4. **Quiet-luxury doctrine** (`docs/QUIET_LUXURY_DOCTRINE.md`) constrains all UI patterns named here.
5. **Navigation shape** stays four icons-only bottom tabs (Home / Train / Log / Profile) plus a More stack hung off the Profile tab; auth and onboarding navigators sit outside the tabs. The role-based-navigation brief (`04`) extends this without reshaping it.
6. **Auth + role storage**: token in SecureStore, `user_data` (with `role`) in AsyncStorage, `bootstrapAuth()` in `RootNavigator` decides which navigator mounts. See `docs/HANDOFF.md` §4. The role-based navigation brief plugs into this contract — it does not replace it.
7. **API client**: `src/services/api.ts` owns the JWT, the refresh mutex, and all backend calls. No brief proposes a parallel HTTP client.
8. **`new-website` is out of scope** for every brief in this pack and is not modified.

## Briefs in this pack

Numbered in the suggested execution order — each later brief assumes the earlier ones are at least drafted, even if not yet built.

| # | Brief | One-line scope |
| --- | --- | --- |
| 01 | [Mobile release & EAS readiness](./01-mobile-release-and-eas-readiness.md) | Channels, profiles, version-bump rules, store-listing handoff, signing key custody. |
| 02 | [Feature flag consumption](./02-feature-flag-consumption.md) | A single in-app `useFlag()` contract (PostHog-backed today) so per-feature rollouts don't grow N bespoke gates. |
| 03 | [Experiment & update channels](./03-experiment-and-update-channels.md) | How A/B experiments and OTA updates (when/if adopted) ride the same channel concept as builds. |
| 04 | [Role-based navigation architecture](./04-role-based-navigation-architecture.md) | Extending today's coach/student/onboarding split to support team-mode roles (refs backend #118) without rewriting `RootNavigator`. |
| 05 | [Reusable expansion UI patterns & tokens](./05-reusable-expansion-ui-patterns.md) | The component primitives every expansion-pack feature will reuse — list rows, section headers, cards, banners — and the token additions, if any. |
| 06 | [Accessibility readiness](./06-accessibility-readiness.md) | Concrete bar (labels, hit slop, contrast, dynamic type, reduce-motion, screen-reader flow) every new screen must clear. |
| 07 | [Loading / error / empty states](./07-loading-error-empty-states.md) | One contract for "what does this screen look like in each non-happy-path state", reused across React Query consumers. |
| 08 | [Crash & analytics readiness](./08-crash-and-analytics-readiness.md) | Sentry + PostHog conventions for the next wave: events, properties, redaction, opt-out. |
| 09 | [API contract compatibility](./09-api-contract-compatibility.md) | Versioning, capability discovery, graceful degradation against backend PRs #117 / #118 / #119. |
| 10 | [Mobile QA matrix](./10-mobile-qa-matrix.md) | Devices × OS × build-profile × persona grid every release ticks before promotion. |
| 11 | [Deep links readiness](./11-deep-links-readiness.md) | Adding new deep-link routes without breaking the existing `tgp://join/<code>` + Universal Links contract. |

## Operator handoff (applies to every brief)

Every brief ends with an *Operator handoff* section the next engineer reads first. Pattern:

- **Owning surface(s)**: which file(s) under `src/` or which doc the work most likely lands in.
- **Out-of-band steps**: anything that has to happen outside the repo (EAS dashboard, Sentry project settings, App Store Connect, PostHog feature-flag definition, Supabase, DNS, etc.).
- **Done means**: the precise observable that says the work is complete — not a vibe, an observable.

If a brief doesn't tell an operator what "done" means, it is not done as a brief. Update it.

## What this PR is not

- Not a roadmap. The order above is suggested, not committed; sequencing belongs in the team's planning tool.
- Not permission to start any of the items. Each becomes its own PR with code, tests, and docs.
- Not a duplicate of `docs/expansion/` (PR #92). If a topic is per-feature, it lives there. If it is cross-cutting, it lives here.
- Not a replacement for `docs/HANDOFF.md`. HANDOFF describes the system as it exists today; this pack describes platform changes the next features will need.

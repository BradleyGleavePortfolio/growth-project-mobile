# 05 — Reusable expansion UI patterns & design tokens

> Pre-build brief. Names the component primitives every expansion-pack feature will reuse, and lists the (very few) token additions, if any, that are justified.

## WHY

The expansion pack (#92) introduces ~11 new feature surfaces — weekly check-ins, attention panels, recap generation, voice/tone editing, public coach profiles, revenue dashboards, etc. Most of these are list-and-detail screens with a few common shapes:

- a section header with a label and an optional action,
- a card-like row representing a client / a check-in / an exercise,
- a progress strip or sparkline,
- a banner conveying state (pending, blocked, recommended action),
- an action footer / sticky CTA.

Today these patterns exist informally — `MealCard`, `MilestoneList`, `OptionCard`, etc. — but there is no agreed **list of primitives** the next features will pick from, and no rule that says "if you need a section header, use `<SectionHeader>`, do not roll your own." That ambiguity is what makes UI rot start.

Naming the primitives + the tokens up front means:

- every new feature looks like the rest of the app on day 1,
- a designer can specify a screen by listing primitives, not pixels,
- token additions are scoped (we know they are scoped because we wrote down the list), so the theme stays coherent.

## WHEN

Land this brief before #92 items 5, 6, 8, 12 begin (those are the most UI-heavy and the ones most likely to add bespoke patterns under deadline).

## WHERE

If implemented (not in this PR):

- `src/components/patterns/` (new sub-directory) — houses the primitives, separated from the existing free-form components so it's clear which components are shared.
- `src/theme/tokens.ts` — only if §"Token additions" requires it; the brief expects zero or one addition, not five.
- `src/components/patterns/README.md` (new) — the catalogue.
- `src/__tests__/patterns/` (new) — snapshot or render tests.

## WHO

- **Mobile engineer**: when implementing a feature, looks at the patterns catalogue first. Adds a new primitive only after a 5-minute think + a CR conversation with the mobile lead.
- **Mobile lead**: gatekeeper for new primitives and new tokens.
- **Designer/operator**: speaks in patterns ("Section header + 3 ClientRows + Pending banner"), not Figma frames, when describing a screen.

## WHAT

A short, fixed list of primitives. The brief proposes **eight** — anything more is feature creep.

| # | Primitive | Use |
| --- | --- | --- |
| 1 | `<SectionHeader title actionLabel? onActionPress?>` | The standard "WEEKLY CHECK-INS" / "Last 7 days" small-caps label, optional right-aligned action. |
| 2 | `<ListRow leading title subtitle trailing onPress?>` | The standard data row used for a client, a check-in, an exercise. Replaces the half-dozen ad-hoc rows that exist today. |
| 3 | `<Card>` | Padded surface with the bone background and 1px stone border. |
| 4 | `<MetricBlock label value caption?>` | One stat — "67% adherence" with caption "Last 7 days". |
| 5 | `<StatusBanner tone="info" \| "warning" \| "success" \| "danger" message action?>` | The contextual banner used for "Plan needs attention" or "Profile incomplete". `tone` maps to existing semantic colour tokens. |
| 6 | `<EmptyState title body cta?>` | Already exists as `EmptyState.tsx`. Promote into the patterns folder, document it. |
| 7 | `<LoadingState variant="skeleton" \| "inline">` | Shared loading shape. Skeleton is the existing `SkeletonLoader.tsx`, hoisted. |
| 8 | `<ErrorState retry?>` | Standard "Couldn't load — try again" surface, paired with the retry capability of React Query. |

Each primitive has:

- a TypeScript prop type with no optional `style` prop (we do not let consumers override styling — that is what kills design coherence),
- an `accessibilityLabel` / `accessibilityRole` derived from `title`/`label` automatically,
- a single test rendering it with realistic content.

### Token additions

The brief proposes **at most one** new token: a `feedback.attention` colour for the "needs attention" tone (#92 item 8 — coach attention panel). This is only added if the existing `feedback.warning` is too saturated for the row-tint use. The mobile lead decides at implementation time.

No new typography sizes. No new spacing values. No new radii.

## HOW

1. Create `src/components/patterns/` and move `EmptyState.tsx`, `SkeletonLoader.tsx` (or re-export them) into it.
2. Implement the six new primitives one PR each, with the test + a Storybook-or-equivalent screen (the repo doesn't have Storybook today; a `src/screens/internal/PatternGallery.tsx` reachable in `__DEV__` mode is sufficient).
3. Write `src/components/patterns/README.md` cataloguing each, with an example block, accessibility notes, do/don't.
4. When the first expansion-pack feature reuses a primitive, link the feature's PR description to the catalogue.
5. After three expansion features are live, audit for missing primitives or unused ones. Trim and add as warranted.

## Expo / EAS considerations

- All primitives are pure RN — no native module dependency.
- `react-native-svg` is already in `package.json` for any sparkline / chart needs (see `MetricBlock` for embedding sparklines).
- No bundle-size concern; primitives are small.
- The `__DEV__` pattern gallery must be tree-shaken out of release builds: gate behind `if (__DEV__)` and put it on a route only registered when `__DEV__`.

## Acceptance criteria

- Eight primitives exist under `src/components/patterns/`.
- Each has at least one render test.
- `src/components/patterns/README.md` documents each with realistic use, accessibility notes, do/don'ts.
- A new feature PR can reuse them by importing from `'@/components/patterns'` (or the project's relative-path equivalent).
- Token list grows by **at most one** entry.
- Pattern gallery (if present) is gated behind `__DEV__` and not reachable in `production`.

## Rollout strategy

- **Phase 1**: hoist `EmptyState`, `SkeletonLoader` into the patterns folder. Zero behavioural change.
- **Phase 2**: implement the six new primitives, one per PR.
- **Phase 3**: first expansion feature consumes them.
- **Phase 4**: post-feature audit — remove unused primitives, add missing ones.
- Rollback: each primitive is independently revertible.

## Tests

- Render: each primitive renders with mocked props.
- Accessibility: each primitive's `accessibilityLabel` matches its visible label.
- Snapshot: a single combined snapshot of the pattern gallery to catch unintended drift.
- Manual: open the pattern gallery in a `__DEV__` build on iOS and Android, verify visual consistency.

## Risks

- **Primitives become too rigid**, forcing consumers to copy-paste. Mitigation: review after three features and relax props if needed (carefully — relaxing is one-way).
- **Designer-engineer mismatch**: the designer keeps inventing new shapes the catalogue doesn't have. Mitigation: weekly catalogue sync, the catalogue README is the canonical reference.
- **Pattern-gallery route ships in production**: covered by the `__DEV__` gate; verify in QA matrix [`10-mobile-qa-matrix.md`](./10-mobile-qa-matrix.md).
- **Quiet-luxury doctrine drift**: every primitive must clear `docs/QUIET_LUXURY_DOCTRINE.md`. The doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`) covers some of it; visual review covers the rest.

## Dependencies

- `src/theme/tokens.ts` is the single source of colour/typography/spacing — primitives import from there only.
- `docs/QUIET_LUXURY_DOCTRINE.md` constrains the look-and-feel.
- Cross-link with [`06-accessibility-readiness.md`](./06-accessibility-readiness.md) — primitives are where accessibility is enforced once, not per-feature.
- Cross-link with [`07-loading-error-empty-states.md`](./07-loading-error-empty-states.md) — three of the eight primitives (`LoadingState`, `ErrorState`, `EmptyState`) are the building blocks for that contract.

## Operator handoff

- **Owning surface(s)**: `src/components/patterns/`, `src/components/patterns/README.md`, `src/theme/tokens.ts` (only if a new token is justified).
- **Out-of-band steps**: none. This is purely a code change inside the repo.
- **Done means**: a designer can spec a new screen as "SectionHeader + 3 ListRows + StatusBanner" and an engineer implements it without inventing any new component shape. If they can't, the catalogue is missing something — add it, don't fork it.

# Progression — mobile UX

Mobile presentation layer for the Wave 2 retention progression system
spec'd in `growth-project-backend/docs/product/retention-progression.md`.
This doc covers what a client sees on iOS and Android: the level-up
surface, the milestone wallet, the home-widget tracker, the drip-unlock
notifications, and the Charter Members private channel.

This is a docs-only spec. No `src/`, `app.json`, `eas.json`, or CI is
modified.

---

## 0. Hard cross-repo dependency

The Wave 2 backend spec
**`docs/product/retention-progression.md`** in `growth-project-backend`
owns:

- The `progression_state`, `progression_levels`, `progression_milestones`,
  and `charter_membership` tables (or equivalent).
- The endpoints `/api/v1/progression/state`, `/api/v1/progression/wallet`,
  `/api/v1/progression/level-up/acknowledge`, and the push topic names.
- The semantics of "milestone" — the closed list of triggers (login
  cadence, check-in cadence, plan-adherence percent, weeks-with-coach,
  founding-member status). Mobile **never** invents a milestone.

If the backend spec has not landed, mobile cannot build this work. The
hard-dependency note is mirrored in the repo-root `PERP_HANDOFF.md`.

---

## 1. Vocabulary

The vocabulary in this doc is constrained to match the doctrine excise
in [PR #70](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/70)
(streak/badge/trophy removed) and the rules in
`docs/QUIET_LUXURY_DOCTRINE.md`.

| Permitted | Forbidden | Rationale |
|---|---|---|
| level | tier (when applied to a person), badge, trophy | "Level" reads as a coaching milestone, not a video-game reward. |
| milestone | streak, achievement | "Milestone" implies a thing the coach acknowledges, not a self-celebration. |
| wallet | collection, locker, vault | "Wallet" is the existing semantic for a list of milestones a member has earned. Already used in the planning round. |
| charter member | VIP, founder's club, elite | "Charter member" is the public name. Locked. |
| acknowledged | claimed, unlocked, redeemed | "Acknowledged" is the verb on the level-up modal. The user does not "claim" anything. |

The jest doctrine test in `src/__tests__/quietLuxuryDoctrine.test.ts`
should be updated by the runtime PR to add the right column to the
forbidden-list regex.

---

## 2. Surfaces overview

Five surfaces, in order of how often a member sees them:

| Surface | Visibility | Owner |
|---|---|---|
| Home tracker (the milestone-tracker home widget) | every Home open | `HomeScreen` (`src/screens/client/HomeScreen.tsx`) — adds a new section |
| Level-up surface | rare — only on transition | new full-screen modal pushed onto the active stack |
| Milestone wallet | on demand | new screen `MilestoneWalletScreen` in the More stack |
| Drip-unlock notifications | rare — push-driven | `expo-notifications`, registered in `requestNotificationPermissions()` |
| Charter Members private channel | charter-only | new tab on `CommunityScreen`, gated by entitlement |

Each surface is described below with wireframes, state, and acceptance.

---

## 3. Home tracker

The milestone-tracker home widget. A single section on `HomeScreen` that
tells the client where they are in the level system and what is next.

```
+-----------------------------------------------+
|  Welcome back, Aria                           |
|  Mon 12 May                                   |
+-----------------------------------------------+
|  This week                                    |
|    [Macros]   [Workouts]   [Check-ins]        |
|     2,140       3 of 4        sent            |
+-----------------------------------------------+
|  Progression                                  |
|                                               |
|  Level 3 — Steady                             |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|                                               |
|  ████████████████████░░░░░░░░░░░░░░░░░░░░░    |
|  60 % of the way to Level 4 — Anchored        |
|                                               |
|  Next: log six check-ins on time              |
|  See wallet →                                 |
+-----------------------------------------------+
|  ... (existing cards: Plan, Recipes, Habits)  |
+-----------------------------------------------+
```

Component shape:

- A new `<ProgressionTrackerCard/>` rendered at the top of `HomeScreen`'s
  scroll body, just below the existing day-summary section.
- Reads from a single `useProgressionState()` hook backed by
  `useQuery(['progression', userId], fetchProgressionState)` against
  `/api/v1/progression/state`.
- Shows nothing while loading (skeleton with hairline rectangles), nothing
  on error (silently hides — progression is non-essential context, errors
  are reported to Sentry but never blocked-up to the user).
- The progress bar uses `<ProgressBar/>` from PR #93 brief 05's named
  primitives. Width is computed from a Decimal-safe ratio
  (`milestones_completed_in_level / milestones_required_in_level`) — the
  ratio comes back from the backend already-computed.

The card is hidden entirely when the member is on Level 0 (newly signed
up, no milestones yet) — the Home screen already has its own onboarding
nudges. The card appears the moment the first milestone is recorded.

Tap target: tapping anywhere on the card opens `MilestoneWalletScreen`.

---

## 4. Level-up surface

The level-up modal is the **only** celebratory chrome in the entire
client app. Its design is constrained:

- Bone background. Cormorant Garamond display heading, weight 400.
- No confetti, no animation, no sound. A two-paragraph note and a
  single primary action.
- Triggered by a server-pushed event, then **also** rendered on the next
  Home open after the event (so a missed push still surfaces the
  level-up).
- Acknowledged by the member tapping the primary action. Acknowledgement
  hits `/api/v1/progression/level-up/acknowledge` with the level id;
  the server marks the level-up read so subsequent Home opens do not
  re-render the modal.

```
+-----------------------------------------------+
|                                               |
|                                               |
|                                               |
|                  Level 4 — Anchored           |
|                                               |
|  You are 90 days into your work and have      |
|  logged six check-ins on time, eight straight |
|  weeks of plan adherence over 80 %, and       |
|  twelve weeks with your coach.                |
|                                               |
|  Anchored members get the Charter Members     |
|  channel and the new "long-form" coach        |
|  responses on the AI Guide. They are also     |
|  visible in your wallet.                      |
|                                               |
|                                               |
|                                               |
|              [ Continue ]                     |
|                                               |
+-----------------------------------------------+
```

The modal is presented via `RootNavigator`'s navigation tree as a
modal-presentation route on the active stack (so it does not lose context
of where the user was). It is not a `Modal` component — using the
navigator preserves swipe-back and accessibility focus order.

Route registration:

```ts
// addition to MoreStackParamList
LevelUpAck: { levelId: string; levelName: string; perksMarkdown: string };
```

The screen reads its params (no network call on mount — the data is
already in memory from the home query). On Continue:

1. `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` once.
2. `mutationFn: () => api.post('/v1/progression/level-up/acknowledge', { level_id: levelId })`.
3. Optimistically removes the pending level-up from the local
   `progression_state.pending_level_ups` array via React Query
   `setQueryData`.
4. `navigation.goBack()`.

If the acknowledge request fails, the modal stays mounted and a small
inline error appears under the button: "We could not record this. Pull
down to retry." No alert, no toast.

### 4.1 What the perks panel says

The level-up modal does **not** invent perk text. The `perksMarkdown`
param is server-rendered Markdown rendered by the existing markdown
renderer (the same one used by `EducationScreen`). The vocabulary
constraints in §1 apply to the Markdown — the runtime PR adds a
backend-side lint that strips any forbidden token before it leaves the
server.

---

## 5. Milestone wallet

`MilestoneWalletScreen` — a single screen listing every milestone the
member has earned, plus the next handful in line. Reachable from:

- the Home tracker card,
- the level-up modal's "See all" link (if present),
- the More tab → "Progression" row (a new entry in `MoreScreen`'s list).

```
+-----------------------------------------------+
|  ←  Progression                               |
+-----------------------------------------------+
|  Level 3 — Steady                             |
|  60 % of the way to Level 4 — Anchored        |
+-----------------------------------------------+
|  Earned                                       |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  First 7 days                       28 Jan 26 |
|  Four weeks logged                  25 Feb 26 |
|  Twelve check-ins                   18 Mar 26 |
|  Steady — Level 2                   29 Mar 26 |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|                                               |
|  Coming up                                    |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
|  Six on-time check-ins              this week |
|  Eight weeks at 80 %+ adherence     in ~3 wks |
|  Twelve weeks with your coach       in ~5 wks |
|  Anchored — Level 4                 in ~5 wks |
|  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  |
+-----------------------------------------------+
|  Charter Members                              |
|  Charter Members are the first one hundred to |
|  reach Anchored. You are not yet a Charter    |
|  Member.                                      |
+-----------------------------------------------+
```

Component shape:

- `<MilestoneRow/>` renders one row. Earned rows show a date on the
  right; coming-up rows show a relative-future hint, never a hard date,
  because adherence-based estimates drift.
- The "Charter Members" section renders only when the entitlement
  contract recognises that Charter membership is part of the member's
  level cohort. If they are charter-eligible (Level 4+ within the first
  hundred to reach), it renders as "You are a Charter Member, see the
  channel →". If not, it renders the explanation copy and no link.

Empty state (member has no milestones yet — Level 0 only):

```
+-----------------------------------------------+
|  ←  Progression                               |
+-----------------------------------------------+
|                                               |
|  We will record milestones as you go.         |
|                                               |
|  The first one shows up after seven days of   |
|  consistent logging.                          |
|                                               |
+-----------------------------------------------+
```

Acceptance: the screen never invents milestones. If the backend returns
an empty `earned` array and an empty `coming_up` array, the screen renders
the empty state above. If `coming_up` is empty but `earned` is not (a
maxed-out member), the screen renders only the Earned section and a single
line "You have completed every level."

---

## 6. Drip-unlock notifications

A subset of milestones are **drip-unlocked** — the backend reveals them
on a schedule (e.g. "after 14 days you become eligible for the Steady
milestone"). Mobile receives a push when this happens.

### 6.1 Push contract

| Topic name | Server trigger | Notification body | Tap action |
|---|---|---|---|
| `progression.milestone.unlocked` | New row added to `progression_milestones` for the user | "You can now work toward: <milestone_name>." | Open `MilestoneWalletScreen` |
| `progression.level.up` | User crossed a level threshold | "Level <n> — <name>." | Open `LevelUpAck` modal route |
| `progression.charter.granted` | First-100-to-Anchored watermark reached for the user | "You are now a Charter Member." | Open `CommunityScreen?channel=charter` |

Push is sent server-side via the existing `expo-notifications` registry.
The mobile client registers the topics by including them in the
permission grant. The handler in `src/utils/notifications.ts` already
routes `data.deep_link` to `Linking.openURL` — the server populates
`data.deep_link` with one of:

```
tgp://progression/wallet
tgp://progression/level-up?level=4
tgp://community?channel=charter
```

The deep-link parser in `src/utils/deepLink.ts` is extended with these
shapes. The parser remains additive — the existing `tgp://join/<code>`
contract is untouched.

### 6.2 Quiet hours

Push delivery respects the user's time zone (already stored in
`user_data.timezone` from onboarding). The backend defers notifications
between 21:00 and 08:00 local. There is no in-app toggle for this in v1 —
the silence is always-on. A future "do not disturb" preference is reserved.

### 6.3 In-app rendering when push is suppressed

If a user opens the app and the backend has emitted a level-up event
during quiet hours (no push delivered yet, the event is queued), the home
query returns `progression_state.pending_level_ups` non-empty. The
`HomeScreen` mounts the `LevelUpAck` modal automatically the first time
this list is non-empty per session.

---

## 7. Charter Members private channel

Charter Members are the first hundred users to reach Level 4. The cohort
is closed once it fills.

The Charter Members channel is a new tab on `CommunityScreen`:

```
+-----------------------------------------------+
|  ←  Community                                 |
|  [ Wins* ] [ Charter Members ]                |
+-----------------------------------------------+
|  ...                                          |
+-----------------------------------------------+
```

The `Charter Members` tab is rendered iff
`useEntitlement('charter_member')` returns true. Otherwise the tab
header is hidden (not greyed out — hidden, so non-charter members do not
see "Charter Members" at all). This is the existing entitlement-gated tab
pattern.

Inside the tab: a chronological feed identical in component shape to the
Wins feed, but every post is read-only by default. The CTA at the top is
a single "Post to Charter Members" button. Posts in this feed cannot be
deleted by the poster — only by an OWNER through the admin console
(this matches the existing community moderation policy in
`growth-project-backend/docs/product/community-moderation.md` if it
exists; if not, it is owned by the community-spaces spec from
[PR #94](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/94)
brief).

Wire contract:

```
GET /api/v1/community/feed?channel=charter
POST /api/v1/community/wins  (existing — accepts an optional channel field)
```

The `?channel=charter` filter is server-enforced. The mobile UI sends it
on every fetch when the tab is active.

---

## 8. State machine

Progression states from a mobile-rendering perspective. The backend
authoritative shape is in
`growth-project-backend/docs/product/retention-progression.md` — this is
the projection mobile reads.

```
                        first milestone earned
[ no progression ] ──────────────────────────► [ on level 0 ]
                                                       │
                                              level threshold
                                                       ▼
                                            [ on level n, has pending L+ ]
                                                       │
                                          user acknowledges level-up
                                                       ▼
                                            [ on level n, no pending ]
                                                       │
                                       (loop until terminal level)
                                                       ▼
                                            [ at top level ]
```

Storage on the mobile side:

- `progression_state` is **not** persisted to disk — it is a server
  projection re-fetched on every Home open. React Query persistence
  caches it so cold starts paint last-known-good while the network call
  refreshes in the background.
- `progression.last_acknowledged_level_id` is stored in AsyncStorage so
  that if the network ack fails, the modal still goes away after one
  more acknowledgement attempt (idempotent on the server side).

---

## 9. Analytics events

Names registered against the PR #93 brief 08 registry. Verb-noun,
snake_case. No PII.

| Event | When | Payload |
|---|---|---|
| `progression_home_card_seen` | `<ProgressionTrackerCard/>` mounts on Home | `current_level`, `pct_to_next` |
| `progression_wallet_opened` | `MilestoneWalletScreen` mounts | `current_level`, `earned_count`, `coming_up_count` |
| `progression_level_up_seen` | `LevelUpAck` mounts | `level_id`, `level_name`, `delivery: 'push' \| 'in_app'` |
| `progression_level_up_acknowledged` | user taps Continue on the modal | `level_id`, `seconds_on_screen` |
| `progression_milestone_unlocked_push_received` | push delivered, then app opened to it | `milestone_id` |
| `progression_charter_channel_opened` | charter member taps the Charter tab | (none) |
| `progression_charter_post_submitted` | charter member posts | `length_chars` (rounded to 25 for k-anonymity) |

`level_name` is included on the analytics payload because the level
naming corpus is small (≤ 8 names) and known not to contain PII.

---

## 10. Loading / error / empty states

Per PR #93 brief 07 (`<AsyncBoundary/>`):

| Surface | Loading | Error | Empty |
|---|---|---|---|
| Home tracker card | three hairline rectangles, no shimmer | hidden (silent) | hidden (Level 0, no milestones) |
| `MilestoneWalletScreen` | header + skeleton sections | "We could not load your progression." with retry | per-section empty copy in §5 |
| `LevelUpAck` | n/a — params come pre-loaded | inline error under the button | n/a |
| `CommunityScreen?channel=charter` | skeleton feed rows | "We could not load Charter Members." with retry | "No posts yet. Be the first." (single line, no exclamation) |

---

## 11. Acceptance criteria

A runtime PR closing this spec is accepted when:

1. `<ProgressionTrackerCard/>` renders on `HomeScreen` between the
   day-summary section and the existing Plan/Recipes/Habits cards. It is
   gated behind `useFlag('progression_v1')`.
2. `useProgressionState()` is implemented as a React Query hook with the
   key family `['progression', userId]`. It is invalidated on
   `authEvents.emit('logout')`. Cache is persisted via the existing
   `PersistQueryClientProvider`.
3. `MilestoneWalletScreen` is registered on `MoreStackParamList` as
   `Progression: undefined`. It is reachable from a new "Progression" row
   in `MoreScreen` and from the home tracker card.
4. `LevelUpAck` is registered on `MoreStackParamList` as
   `LevelUpAck: { levelId, levelName, perksMarkdown }`. It is presented
   `mode: 'modal'` with no swipe-down to dismiss (because we want to
   record the acknowledge).
5. The push handler in `src/utils/notifications.ts` recognises and
   deep-link-routes the three new topics from §6.1.
6. The deep-link parser recognises `tgp://progression/wallet`,
   `tgp://progression/level-up?level=<n>`, and
   `tgp://community?channel=charter`.
7. `<AsyncBoundary/>` wraps each query-backed surface listed in §10 with
   the prescribed mappings.
8. Charter Members tab on `CommunityScreen` is rendered iff
   `useEntitlement('charter_member')` returns true. The tab header is
   hidden when the entitlement is absent.
9. Analytics events from §9 fire from the named callsites with the
   prescribed payload shapes.
10. The jest doctrine test in
    `src/__tests__/quietLuxuryDoctrine.test.ts` is updated to add the
    forbidden vocab from §1 (badge / trophy / streak already there;
    "claimed", "redeemed", "VIP", "elite" added).
11. `src/__tests__/` adds:
    - a unit test for `useProgressionState` covering loading/error/empty,
    - a render test for `LevelUpAck` covering the optimistic-ack path
      and the failure path,
    - a parser test for the three new deep-link shapes.
12. Sentry tags include `progression_level` on the user scope so
    progression-correlated crashes are filterable.
13. The runtime PR ships behind `progression_v1` in **off** state. The
    Wave 2 backend endpoints must be live before the flag is enabled for
    any user.

---

## 12. Out of scope for this spec

- **Level naming and milestone copy.** Owned by the backend Wave 2 spec
  (`retention-progression.md`). This spec only describes the rendering
  surface.
- **Coach-side rendering of client progression.** Owned by the coach
  experience pack — the coach sees client levels on `ClientDetail` per
  the existing `ClientDetailScreen` extension contract; this spec does
  not duplicate it.
- **Charter Members invite control.** Whether a charter member can invite
  another is owned by the Whop expansion pack
  ([PR #96](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/96)
  brief 06).
- **Web rendering of progression on `new-website` or any public coach
  profile.** Public coach profiles are owned by
  [PR #92](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/92)
  brief 16.

# Onboarding — mobile flows (client and coach)

Mobile-side spec for the Wave 2 onboarding work. The app already has two
client onboarding paths in production:

- The **10-step full onboarding** (`OnboardingStep1`–`OnboardingStep10`
  + `OnboardingResults`) — the original quiz, taken at first sign-in
  before a coaching invite is attached.
- The **4-step Lean onboarding** (`LeanQ1Goal` → `LeanQ4Metrics`) — a
  faster path used when the user arrives on a coach invite that already
  has the missing data.

Both run inside dedicated navigators (`OnboardingNavigator.tsx`,
`LeanOnboardingNavigator.tsx`), and they coexist — `RootNavigator`
selects between them based on `user_data.onboarding_path`. There is
**no coach-side onboarding** today; coaches who sign up land directly on
`CoachHome` after `RoleSelection`.

This spec layers Wave 2 work onto that foundation. It does not replace
the existing flows — it specifies (a) where new screens slot in,
(b) the new coach onboarding flow, (c) drop-off recovery via push, and
(d) the first-win modal.

This is a docs-only spec. No `src/`, `app.json`, `eas.json`, or CI
changes.

---

## 0. Cross-repo dependency

Soft dependency on the backend Wave 2 spec
**`docs/product/onboarding-client-coach.md`** in
`growth-project-backend`. That spec owns:

- The `onboarding_steps` and `onboarding_completion` table shapes (or
  equivalent).
- The endpoints `/api/v1/onboarding/state`, `/api/v1/onboarding/save`,
  and `/api/v1/onboarding/complete`. The mobile UI POSTs partial state
  on every step; the backend persists it so a partial onboarding can be
  resumed on a different device.
- The coach onboarding step list (matching §3 below 1:1).

This is **soft** because the existing 10-step flow already writes
through to a backend persistence path; this spec only formalises it and
adds the resume contract. A runtime PR can ship most of the new screens
against the existing endpoints and ratify the contract progressively.

The first-win modal is **also** soft on the backend — the trigger event
(see §5) is fired by the existing food-log endpoint; mobile owns the
modal entirely.

---

## 1. Today's onboarding state machine

For reference. This spec extends, does not replace, the machine below.

```
                                                       ┌──────────────────────────────┐
                                                       │                              │
                                                       ▼                              │
[ unauthenticated ] ─sign in─► [ role-selection ] ──client─► [ has invite? ]──yes───►[ Lean Q1 → Q4 ]
                                       │                          │                  │
                                       │                          no                 │
                                       │                          ▼                  │
                                       │                   [ Step 1 → Step 10 ]      │
                                       │                          │                  │
                                       │                          └──────► [ OnboardingResults ]──saved──► [ student/client home ]
                                       │
                                       └──coach──► [ coach home ]            (no coach onboarding today)
```

The legacy `student` value is normalised to `client` per PR #97. This
spec uses `client` throughout.

---

## 2. Client onboarding extensions

### 2.1 What stays unchanged

- The 10-step full path remains the path for clients who arrive without
  an invite. Order of screens, copy, and stored AsyncStorage keys are
  unchanged.
- The 4-step Lean path remains the path for clients who arrive on
  `tgp://join/<code>`.
- `OnboardingResults.tsx` still saves `onboarding_complete = 'true'`
  and writes `macro_targets` to AsyncStorage.

### 2.2 What changes

Two additions, both behind `useFlag('onboarding_v2')`:

1. **Resume contract.** Each step writes its partial state to the
   backend through `/api/v1/onboarding/save` immediately on Next, in
   addition to the existing AsyncStorage write. On a fresh sign-in on
   a new device, the navigator calls `/api/v1/onboarding/state` and
   resumes at the latest step the user reached. If the device's local
   AsyncStorage has more recent data than the server, local wins
   (the user just typed it).
2. **Drop-off recovery push.** A push topic
   `onboarding.client.dropoff` fires 4h, 24h, and 72h after the user
   abandons onboarding (no progression past their last step). After
   72h the topic is silenced and an in-app banner takes over. See §5.

### 2.3 First-win modal

After the user logs their first food on `LogScreen`, a modal appears
once, ever. It is the only celebratory chrome in client onboarding.
Same constraints as the level-up modal in `progression-mobile-ux.md` §4
— bone background, Cormorant Garamond display heading weight 400,
no animation, single primary action.

```
+-----------------------------------------------+
|                                               |
|                                               |
|                                               |
|                  First log saved              |
|                                               |
|  Logging is the cornerstone of how your coach |
|  reads your week. The next time they look at  |
|  your file, they will see what you ate today. |
|                                               |
|  Two more things to set up:                   |
|                                               |
|    □  Add your weight on Sunday               |
|    □  Send your first weekly check-in         |
|                                               |
|                                               |
|              [ Sounds good ]                  |
|                                               |
+-----------------------------------------------+
```

Wire-up:

- Trigger: the first time the food-log mutation succeeds on the device
  AND `AsyncStorage.first_win_seen !== 'true'`.
- Modal lives at route `MoreStack/FirstWinAck` (registered new) so it
  can be `presentation: 'modal'` and survive a swipe-back.
- On Sounds good: write `first_win_seen = 'true'` and POST
  `/api/v1/onboarding/first-win-ack` (idempotent).
- Analytics: `first_win_modal_seen`, `first_win_modal_acknowledged`.

If the modal is queued for display but the user navigates away from
`LogScreen` without seeing it (e.g. the food-log mutation finishes after
they've already left), the modal fires on the next Home open.

---

## 3. Coach onboarding flow

New. The coach today goes from `RoleSelection` directly to `CoachHome`
with zero intermediate state. That is fine for solo coaches who already
know the product, but it is a bad first session for any coach acquired
through marketing because they immediately face an empty `ClientsList`
and an empty `Messages`.

The new coach onboarding is a **5-step quiz** behind a feature flag
`useFlag('coach_onboarding_v1')`. With the flag off, the path is
unchanged. Steps:

| # | Title | Purpose | Storage key |
|---|---|---|---|
| 1 | Coach profile | Display name, headline (≤ 60 chars), profile photo (optional) | `coach_onboarding.profile` |
| 2 | Niche | Single-select from the closed list (Strength, Hypertrophy, Fat loss, Lifestyle/habits, Endurance, Other) | `coach_onboarding.niche` |
| 3 | Experience | Years coaching, current client count, prior platforms (multi-select) | `coach_onboarding.experience` |
| 4 | Coaching style | Three options on a 1-5 Likert (frequency of check-ins, level of macro detail, preferred message length) | `coach_onboarding.style` |
| 5 | First invite | Generate the first client invite code OR skip | `coach_onboarding.first_invite` |

```
+-----------------------------------------------+
|  Step 1 of 5                                  |
|                                               |
|  Your coach profile                           |
|                                               |
|  Display name                                 |
|  [ Sam Riley                          ]       |
|                                               |
|  Headline (one line, ≤ 60 chars)              |
|  [ Strength coach for busy parents.   ]       |
|                                               |
|  Photo (optional)                             |
|  [ + Add photo ]                              |
|                                               |
|                                               |
|              [ Skip ]    [ Next ]             |
+-----------------------------------------------+
```

```
+-----------------------------------------------+
|  Step 5 of 5                                  |
|                                               |
|  Your first invite                            |
|                                               |
|  Most coaches get their first three clients   |
|  off Instagram or text. We can give you the   |
|  link to share now.                           |
|                                               |
|              [ Generate invite ]              |
|                                               |
|              [ I'll do it later ]             |
|                                               |
+-----------------------------------------------+
```

Wireframes for steps 2–4 follow the existing `OnboardingStep*`
component shapes — single primary card, `Next` button at the bottom,
`Skip` at the top right where allowed (steps 1, 4, 5 only — niche and
experience are required because the marketplace ranking spec'd in
[PR #96](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/96)
brief 06 needs them).

### 3.1 Navigation

The new coach onboarding lives in its own navigator:

```ts
// new file: src/navigation/CoachOnboardingNavigator.tsx
export type CoachOnboardingStackParamList = {
  Step1Profile:    undefined;
  Step2Niche:      undefined;
  Step3Experience: undefined;
  Step4Style:      undefined;
  Step5FirstInvite:undefined;
  Results:         undefined;
};
```

`RootNavigator.bootstrapAuth()` is extended (behind the flag) with one
new branch:

```
if user_data.role === 'coach':
  if useFlag('coach_onboarding_v1') AND user_data.coach_onboarding_complete !== 'true':
    mount <CoachOnboardingNavigator/>
  else:
    mount <CoachNavigator variant=...>
```

`coach_onboarding_complete` is a new key in `user_data` written by the
backend after the Results step. Mobile never writes it — same shape as
`onboarding_complete` for clients.

### 3.2 Drop-off recovery

A coach who quits the flow mid-way (closes app, signs out, switches
device) resumes where they left off because every step's Next writes
through `/api/v1/onboarding/coach-save`.

Push topics:

| Topic | When | Body |
|---|---|---|
| `onboarding.coach.dropoff` | 24h after the last incomplete step | "Your coach profile is partway done. One step away from inviting your first client." |

Quiet hours per `progression-mobile-ux.md` §6.2 apply.

---

## 4. Resume contract — wire shape

A consolidated client- and coach-onboarding state read endpoint:

```
GET /api/v1/onboarding/state
  -> {
       path: 'client_full' | 'client_lean' | 'coach',
       last_completed_step: number,        // 0 = none yet
       partial: Record<string, unknown>,   // key per step, see below
       updated_at: string,                 // ISO 8601
     }
```

Save endpoint, per-step:

```
POST /api/v1/onboarding/save
  body: { path, step, data }
  -> { ok: true, last_completed_step: number, updated_at: string }
```

Idempotent on `(user_id, path, step)`. Re-POSTing the same step
overwrites the data. The `path` is fixed at first call and the backend
rejects later POSTs that change the path mid-flow.

Complete endpoint (idempotent):

```
POST /api/v1/onboarding/complete
  body: { path }
  -> { ok: true, completed_at: string }
```

Mobile writes `user_data.onboarding_complete = 'true'` (clients) or
`user_data.coach_onboarding_complete = 'true'` (coaches) on success.

Conflict resolution:

- The mobile client compares `state.updated_at` to the local AsyncStorage
  `onboarding_data.updated_at` on resume. If local is newer, local wins
  and the client immediately POSTs the local state to the server. If
  server is newer, server wins and the client overwrites local.
- This is a last-write-wins model. It is acceptable for onboarding
  because the entries are scalars or short strings; collision risk is
  marginal compared to the simplicity gain.

---

## 5. Drop-off recovery — push and in-app banner

### 5.1 Push topics

| Topic | Delivered when | Tap action |
|---|---|---|
| `onboarding.client.dropoff` | 4h, 24h, 72h after last incomplete step (one push per window) | Resume the path at the last incomplete step |
| `onboarding.coach.dropoff` | 24h after last incomplete step | Resume the path at the last incomplete step |
| `onboarding.client.first_invite_ready` | Sent immediately when a coach attaches an invite to a partially-onboarded client | "Your coach has set up your account. One last step to start." → resume |
| `onboarding.client.first_check_in_due` | 7 days post-completion if no weekly check-in submitted | "Your first weekly check-in is ready." → `Report` route |

The body strings are **examples**. The runtime PR consumes server-rendered
copy from `onboarding-client-coach.md` (backend Wave 2 spec) and does not
hardcode strings. If the backend has not specified the copy, the runtime
PR pauses on the body string until copy is ratified — placeholder strings
are not acceptable per the doctrine.

### 5.2 In-app banner

After 72h, push topics are silenced and the next time the user opens the
app they see a banner at the top of the relevant screen:

For incomplete clients (lands on Welcome → Login → Home as before, then):

```
+-----------------------------------------------+
| Finish setting up your account.               |
|                                  [ Continue ] |
+-----------------------------------------------+
| Welcome back, Aria                            |
| ...                                           |
```

The banner uses the existing `<OfflineBanner/>` slot (same vertical
position, same hairline border) but with bone background and ink text.
Component: new `<OnboardingBanner/>` exported from
`src/components/banners/`. Dismiss is sticky (it does not show again
within the same session, but reappears on cold start until the path is
complete).

The banner is **not** rendered while the user is on `OnboardingNavigator`
or `LeanOnboardingNavigator` — the banner is for users who returned to
the main shell with a stale incomplete onboarding (this is uncommon but
happens when the user did one or two steps, force-quit, and then signed
in fresh on a new device that didn't pick up the resume cleanly).

---

## 6. Acceptance criteria — completion rates

Borrowed from the backend Wave 2 spec. The runtime PR's success metric
is measured against three percentages, all reported via the analytics
events in §7 plus a server-side computed cohort table:

| Metric | Target after first 30 days post-flag-on | Failure mode |
|---|---|---|
| Client full path completion (10 steps) | ≥ 70 % within 24h of sign-in | Iterate on Step 6+ copy/layout (drop-off concentrates there in current data) |
| Client lean path completion (4 steps) | ≥ 90 % within 24h of invite redemption | Iterate on Q3 (intent) copy |
| Coach onboarding completion (5 steps) | ≥ 60 % within 7 days of sign-in | Iterate on Step 4 (style) — most easily abandoned |
| First-win modal acknowledged | ≥ 95 % of clients who log first food | Failure here is a UI bug, not a copy bug |

These are runtime PR acceptance criteria, not docs-PR criteria. They
are listed here so the runtime PR has them in one place.

---

## 7. Analytics events

Verb-noun, snake_case, registered against PR #93 brief 08:

| Event | When | Payload |
|---|---|---|
| `onboarding_step_started` | step screen mounts | `path`, `step` |
| `onboarding_step_completed` | Next pressed and save succeeds | `path`, `step`, `seconds_on_step` |
| `onboarding_step_skipped` | Skip pressed | `path`, `step` |
| `onboarding_path_completed` | Results screen mounts | `path`, `total_seconds` |
| `onboarding_resumed` | resume from a different device | `path`, `from_step` |
| `onboarding_dropoff_push_opened` | user taps a dropoff push | `path`, `topic`, `hours_since_dropoff` |
| `onboarding_banner_seen` | `<OnboardingBanner/>` mounts | `path`, `last_completed_step` |
| `onboarding_banner_dismissed` | user dismisses the banner | `path` |
| `first_win_modal_seen` | `FirstWinAck` mounts | (none) |
| `first_win_modal_acknowledged` | user taps Sounds good | `seconds_on_screen` |

Existing `app_opened` continues to fire from `App.tsx`.

---

## 8. State / storage keys

Net new AsyncStorage keys:

| Key | Owner | Cleared on signOut | Purpose |
|---|---|---|---|
| `coach_onboarding.profile` | `CoachOnboardingNavigator` step 1 | yes | Step partial |
| `coach_onboarding.niche` | step 2 | yes | Step partial |
| `coach_onboarding.experience` | step 3 | yes | Step partial |
| `coach_onboarding.style` | step 4 | yes | Step partial |
| `coach_onboarding.first_invite` | step 5 | yes | Step partial |
| `coach_onboarding.updated_at` | navigator | yes | Conflict resolution timestamp |
| `first_win_seen` | `FirstWinAck` | yes | Idempotency for the modal |
| `onboarding_banner_dismissed_session` | `<OnboardingBanner/>` | yes | Per-session dismiss state |

All seven are added to the `SIGN_OUT_KEYS` array in
`src/services/authActions.ts` in the runtime PR. The existing
`onboarding_data` key is unchanged.

The new `coach_onboarding_complete` field on `user_data` is written
server-side (mobile reads it). It is cleared automatically when the
backend re-issues a fresh `user_data` on login — the existing pattern.

---

## 9. Loading / error / empty states

Per PR #93 brief 07:

| Surface | Loading | Error | Empty |
|---|---|---|---|
| `OnboardingNavigator` step | per-step skeletons (existing) | "We could not load this step. Pull to retry." | n/a |
| `CoachOnboardingNavigator` step | header + skeleton card | same as above | n/a |
| Resume on launch | a 1.5s window with a centred spinner over the bone background; if state load takes longer, fall back to the existing first step | toast "We could not load your saved progress. Starting from the beginning." | n/a |
| `FirstWinAck` modal | n/a | inline error under Sounds good | n/a |
| `<OnboardingBanner/>` | n/a — read from `user_data` | hidden | hidden |

---

## 10. Acceptance criteria for the runtime PR

A runtime PR closing this spec is accepted when:

1. `useFlag('onboarding_v2')` and `useFlag('coach_onboarding_v1')` exist
   and both default to **off**. With both off, the build is functionally
   identical to the pre-spec build.
2. Each existing client onboarding step writes through to
   `/api/v1/onboarding/save` on Next. The existing AsyncStorage writes
   are preserved.
3. `RootNavigator.bootstrapAuth()` calls `/api/v1/onboarding/state` for
   any user with `onboarding_complete !== 'true'` (or
   `coach_onboarding_complete !== 'true'`) and resumes at the last
   incomplete step.
4. `CoachOnboardingNavigator` is registered as a new navigator under
   `RootNavigator` for coaches who have not completed coach onboarding.
   The navigator owns five steps + Results.
5. `FirstWinAck` modal is registered on `MoreStackParamList`. It mounts
   exactly once per device per user: the first time food-log succeeds
   AND `first_win_seen !== 'true'`.
6. `<OnboardingBanner/>` renders on `HomeScreen` (clients) and
   `CoachHomeScreen` (coaches) when `user_data` indicates an incomplete
   onboarding and the user is past the 72h push window.
7. Push handler routes the four new topics from §5.1 to the resume
   action.
8. All analytics events from §7 fire from the named callsites with
   typed payloads.
9. `SIGN_OUT_KEYS` includes the seven new keys from §8.
10. `src/__tests__/` adds:
    - a unit test for the conflict-resolution rule (last-write-wins on
      `updated_at`),
    - a render test for `CoachOnboardingNavigator` step 1 and Results,
    - a render test for `FirstWinAck` covering happy path and
      acknowledge-failure path,
    - a unit test for `<OnboardingBanner/>` visibility logic.
11. Sentry tags include `onboarding_path` on the user scope so
    onboarding-correlated crashes are filterable.
12. The runtime PR ships with both flags off. Bradley enables them
    progressively (probably client_v2 first, then coach_v1 a week
    later).

---

## 11. Out of scope

- **Onboarding copy.** Owned by the backend Wave 2 spec. Mobile reads
  copy strings server-side or from the spec — never invents.
- **Marketplace coach profile.** The fields collected in coach
  onboarding feed into the marketplace ranker but the marketplace
  surface is owned by [PR #96](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/96)
  brief 06.
- **Sub-coach onboarding.** Owned by
  [`role-experience-extension-org-mode.md`](./role-experience-extension-org-mode.md)
  §4.3 (the `CreateCoachAccount` path). When a sub-coach signs up,
  they go through the same coach onboarding as a head coach, and the
  org metadata (split, cap) is layered on after Results.
- **Trust-Center / data-export prompt** at the end of onboarding. The
  Trust Center is owned by `TrustCenterScreen` and is reached from
  `MoreScreen` — not from the onboarding flow.
- **AI Guide first-question prompt**. Owned by
  [`whop-ai-coach-copilot-mobile.md`](./whop-ai-coach-copilot-mobile.md)
  for coaches; client AI-Guide first-question copy is owned by the
  existing `AIGuideScreen` and is unchanged.

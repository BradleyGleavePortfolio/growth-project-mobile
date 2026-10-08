# Coach Command Center

The Coach Command Center is the new top-level landing screen for every coach in The Growth Project mobile app. It replaces the old `CoachHomeScreen` as the home tab, and consolidates the 5 most time-sensitive views a coach needs into a single tabbed surface.

---

## Purpose

A coach with 14 clients cannot manage their roster from a single-screen dashboard. The Command Center gives them five focused tabs that answer five distinct questions:

1. **Overview** — how is the roster performing right now? (KPI tiles)
2. **At risk** — which clients are disengaging and need contact today?
3. **Win Streaks** — which clients are on a roll and deserve acknowledgement?
4. **Inbox** — who needs a reply, and how long have they been waiting?
5. **Action Queue** — what alerts require a specific coach action before they expire?

---

## Screens + State Machines

| Screen | File | States |
|---|---|---|
| Root tab host | `CommandCenterScreen.tsx` | Stateless host — delegates to child screens |
| Overview | `OverviewScreen.tsx` | `loading → data \| error`; the Home header renders in every state |
| At risk | `AtRiskScreen.tsx` | `loading → data \| error` |
| Streaks | `WinStreaksScreen.tsx` | `loading → data \| error` |
| Inbox | `InboxScreen.tsx` | `loading → data \| error` |
| Actions | `ActionQueueScreen.tsx` | `loading → data \| error`, optimistic dismiss |

All list screens support:
- Pull-to-refresh (`refreshing` state)
- Empty state (distinct copy per screen)
- Loading: the shared `SkeletonScreen` (testID `command-center-<tab>-loading`), never a bare spinner
- Error: `LoadFailedNotice`, one sentence naming what did not load ("The inbox could not load.") and a forest
  "Try again" text button with a 44 pt target (testID `command-center-<tab>-error-retry`). No red, no generic copy.

### Home header, numbers and tabs (QA-COACH-HOME-131)

- The Overview header (setup checklist, morning brief, Money card from `CoachHomeCards`) is the only way to Stripe
  setup and Money, so it renders in every state and mounts once. Only the roster block below it switches between
  the skeleton, the calm error ("Roster numbers could not load.") and the numbers.
- Numbers are monochrome ink. A need is said in words under the number: "Need attention" / "Needs attention" on
  Clients at risk, "Waiting in Actions" on Open alerts. No red, gold or green values.
- Top tabs: sentence case ("Overview", "At risk", "Streaks", "Inbox", "Actions"), Inter 14 pt (`typography.bodySmall`),
  `textMuted` when inactive and `accentText` with a 2 pt `accent` underline when active, `minHeight: 44`. Colours
  come from `useTheme().semanticColors`.

---

## Shared Components

| Component | File | Purpose |
|---|---|---|
| `KpiTile` | `src/components/command-center/KpiTile.tsx` | Single numeric KPI tile with label, value, optional subtext. The value is always ink; there is no colour prop. |
| `LoadFailedNotice` | `src/components/coach/LoadFailedNotice.tsx` | Calm failed-read block: one sentence and a forest "Try again" text button (44 pt). Also used by `TeamManagementScreen`. |
| `AlertRow` | `src/components/command-center/AlertRow.tsx` | Client alert row with left-border bucket accent and dismiss button |
| `MessagePreviewRow` | `src/components/command-center/MessagePreviewRow.tsx` | Inbox thread row with avatar initial, unread badge, timestamp |
| `MockDataBanner` | `src/components/command-center/MockDataBanner.tsx` | Preview mode banner shown when `__USING_MOCK_DATA = true` |

---

## API Endpoints Consumed

| Endpoint | Method | Auth | Purpose | Status |
|---|---|---|---|---|
| `/coach/command-center/overview` | GET | Coach | KPI tiles for the coach's roster | **MOCKED** |
| `/coach/command-center/at-risk` | GET | Coach | Clients with PTM bucket amber or red | **MOCKED** |
| `/coach/command-center/win-streaks` | GET | Coach | Clients with active streaks >= 3 days | **MOCKED** |
| `/coach/command-center/inbox` | GET | Coach | Coach-scoped message threads | **MOCKED** |
| `/coach/command-center/action-queue` | GET | Coach | Pending coach alerts | **MOCKED** |
| `/coach/command-center/action-queue/:alertId/dismiss` | POST | Coach | Dismiss an alert | **MOCKED** |

**To switch to live data:** Set `__USING_MOCK_DATA = false` in `src/services/commandCenterApi.ts` once the Phase 8 backend PR is merged and the endpoints are deployed.

**Inbox scope:** The Command Center Inbox (`/coach/command-center/inbox`) is coach-scoped message threading. It is different from the Phase 9 global notification center (system notifications at a different route). No conflict.

---

## Env Vars / Feature Flags

| Flag | Location | Default | Meaning |
|---|---|---|---|
| `__USING_MOCK_DATA` | `src/services/commandCenterApi.ts` | `true` | When `true`, all 6 API calls return hardcoded mock data. Set to `false` once backend ships. |

There are no additional environment variables for this feature. The API base URL is the same as all other services (`src/services/api.ts`).

---

## Test Coverage

| File | What it asserts |
|---|---|
| `src/__tests__/commandCenterScreens.test.tsx` | Render tests for all 5 screens (loading / data / error / empty). Shared component tests (KpiTile, AlertRow, MessagePreviewRow) including accessibility labels. Optimistic dismiss in ActionQueueScreen. |
| `src/__tests__/qaCoachHome131.test.tsx` | Header visible while numbers load and after a failure, mounted once; Try again reloads; no red or gold number and the words present; tab labels ≥ 13 pt, AA, 44 pt tall, "At risk"; every tab and KPI tile still opens its screen; each list tab shows the skeleton and the calm error; Team hides the false empty line on a failed load. |
| `src/__tests__/commandCenterNavigation.test.tsx` | File existence for all 5 screens + 3 components. CoachNavigator registers CommandCenterScreen. CoachNavigator non-regression: sessions, bloodwork, risk board still registered. commandCenterApi exports correct surface. READMEs exist. |

---

## Navigation Integration

`CommandCenterScreen` is mounted as the `CommandCenter` tab in `CoachNavigator` (replacing the old `Dashboard` tab). The `Dashboard` screen name is preserved inside `ClientsStack` so any existing `navigate('Dashboard')` calls in the codebase continue to resolve without a crash.

Child screens navigate up to `ClientsStack` entries (`ClientDetail`, `ClientMessages`) via the `onSelectClient` and `onOpenThread` props passed down from `CoachNavigator`. This avoids any cross-stack navigation coupling.

---

## Future Work / Known Limits

- Once the Phase 8 backend PR is merged, set `__USING_MOCK_DATA = false` and verify each endpoint response shape matches the DTO types in `commandCenterApi.ts`.
- The `risk_score` field on `AtRiskEntry` is always `null` for the coach-scoped endpoint (matching the existing PTM doctrine where raw scores are owner-only). The bucket value drives all visual treatment.
- Action Queue dismiss is currently optimistic with rollback on error. If the backend introduces idempotency keys, update `dismissAlert()` to pass them.
- Inbox does not yet support pagination. The backend endpoint should return cursor-paginated results; the screen will need a `FlatList` `onEndReached` handler when the roster grows beyond ~50 active threads.
- The Win Streaks screen uses the `check_in`, `workout`, and `weight_log` streak types. If the backend introduces new streak types, add them to `STREAK_TYPE_LABEL` in `WinStreaksScreen.tsx`.

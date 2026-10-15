# Day 1 Win Sequence — Phase 7A

The Day 1 Win flow is a one-time interstitial shown to every new client on their first cold app open after onboarding completes. It presents three quick-win actions (log starting weight, tick a habit, log first meal). A card opens the existing logger without requesting or showing a note. Only that logger's confirmed save returns to this interstitial and asks the backend to mark `firstWinCompletedAt` and return the note.

The phone displays `response.data.aiMessage` verbatim, for coached and coachless clients alike. Coachless fixed notes and coached AI notes share the unchanged response contract ([backend #1018](https://github.com/BradleyGleavePortfolio/growth-project-backend/pull/1018)). Deploy this timing fix with or before backend #1018.

Once completed the screen never appears again. If the API is unreachable at boot the screen is skipped and the client goes straight to the main app — it will be offered again on next boot until completed.

---

## Screens

| Screen | Path | State | Description |
|--------|------|-------|-------------|
| `Day1WinScreen` | `src/screens/client/Day1WinScreen.tsx` | Local (`useState`) | Selection → existing app logger → completion note. `onComplete(target)` opens the logger; `savedWin` is supplied only after save. Continue/skip calls `onComplete(undefined)`. Every client sees the same three cards with no entitlement read. Only the later package sheet keeps `lib/packagePromptGate`. |

---

## State machine

```
student cold start
       │
       ▼
GET /me/first-win/status
       │
  ┌────┴────────────────┐
  │ completed: false    │ completed: true
  │ (or API error)      │
  ▼                     ▼
Day1WinScreen        ClientNavigator
  │
  ├── Card tapped ──► ClientNavigator: matching logger
  │                          │
  │                   confirmed save only
  │                          │
  │                   Day1WinScreen(savedWin)
  │                          │
  │                   POST /me/first-win/complete
  │                          │
  │                   ┌──────┴──────┐
  │                 success      error
  │                   │            │
  │             completion     Alert shown
  │              view shown    (retry)
  │                   │
  │              Continue pressed
  │                   │
  └── Skip pressed    ▼
              ClientNavigator
```

---

## API calls

| Call | Endpoint | When | Response used |
|------|----------|------|---------------|
| `firstWinApi.getStatus()` | `GET /me/first-win/status` | Every student cold start (in `RootNavigator.bootstrapAuth`) | `completed` boolean to decide whether to show the win screen |
| `firstWinApi.complete(winType)` | `POST /me/first-win/complete` | Once after the selected logger saves successfully | `aiMessage` displayed verbatim in the existing completion view; `completedAt` not used in UI |

`RootNavigator` holds the selected type and the committed user's id, accepts only its matching save, and consumes that selection before returning to the note. `ClientNavigator` forwards the success callbacks only while the logger is focused. No callback fires on validation failure, save failure, sheet cancellation, offline food enqueue, habit creation/deletion, habit unticking, or a daily check-in save. Search, manual food and a fully successful repeat meal count as a saved meal; a successful habit tick counts as `first_checkin`.

`set_first_goal` is still a valid backend `WinType`, but main has no goal card or completion caller. This change does not add a card, route or wording for it.

---

## Files changed

| File | Purpose |
|------|---------|
| `src/services/firstWinApi.ts` | Typed API client for the two endpoints |
| `src/screens/client/Day1WinScreen.tsx` | The win screen component |
| `src/navigation/RootNavigator.tsx` | Adds `'day1win'` auth state; calls `getStatus()` in `bootstrapAuth` |
| `src/__tests__/Day1WinScreen.test.tsx` | Source guards + RTL mount tests |
| `src/screens/client/first-win/README.md` | This file |

---

## Env vars

None. The AI message is generated on the backend; the mobile app just renders the string returned in the API response.

---

## Tests

`src/__tests__/Day1WinScreen.test.tsx` asserts:

| Test | What it checks |
|------|---------------|
| Source: testIDs for 3 win cards | `day1win-card-{winType}` present for all three cards |
| Source: testID for skip + continue buttons | Buttons are identifiable in test and automation |
| Source: every Pressable has `accessibilityLabel` | Doctrine accessibility requirement |
| Source: every Pressable has `accessibilityRole="button"` | Doctrine accessibility requirement |
| Source: no confetti/trophy/celebration chrome | Doctrine guard |
| Source: no hardcoded hex colors | Doctrine guard |
| Source: uses `useTheme().colors` | Doctrine guard |
| RTL: renders 3 win cards | Smoke test: screen mounts correctly |
| RTL: skip button calls onComplete without API call | Skip path works without network |
| RTL: each card opens its logger with no request on tap | No premature completion |
| RTL: `savedWin` requests once and displays exact server text | Save-to-note contract |
| RTL: Continue calls onComplete without a target | Does not reopen the saved logger |

CI also runs real-screen save callback assertions in the food journey, offline food, weigh-in and habit gate suites, plus the real root handoff in `rootNavigatorPackagePromptGate.test.tsx`.

---

## Future work / known limits

- The `winType` is not yet emitted as a `ClientSignal` for PTM analytics. When retention dashboards are needed, the backend's `complete()` method can emit a Phase 1A signal of type `first_win` with `winType` in `metadata`.
- An offline food enqueue is not a backend-confirmed log and requests no note. The client can save online later; adding a queue-completion note is outside this timing fix.
- A failed note request keeps the existing connection alert and skip/retry-via-logger paths. No local note claims the save; the actual saved log remains on the server.

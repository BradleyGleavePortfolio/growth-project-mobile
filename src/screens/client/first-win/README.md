# Day 1 Win Sequence — Phase 7A

The Day 1 Win flow is a one-time interstitial shown to every new client on their first cold app open after onboarding completes. It presents three quick-win actions (log starting weight, submit first check-in, log first meal). The client picks one. The backend marks their `firstWinCompletedAt` timestamp and returns a 2-sentence AI coaching message explaining what that first data point means.

Once completed the screen never appears again. If the API is unreachable at boot the screen is skipped and the client goes straight to the main app — it will be offered again on next boot until completed.

---

## Screens

| Screen | Path | State | Description |
|--------|------|-------|-------------|
| `Day1WinScreen` | `src/screens/client/Day1WinScreen.tsx` | Local (`useState`) | Two-phase: selection view (3 win cards) → completion view (AI message + continue button). Accepts an `onComplete` prop. Every client sees all three cards, coached or coachless, with or without a package: each is basic self logging (B-SMALLFIX-135), so the screen reads no entitlement for them. Only the coach-sold package sheet afterwards keeps its gate (`lib/packagePromptGate`). Test: `src/__tests__/coachlessGateVersionB.test.tsx`. |

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
  ├── Card tapped ──► POST /me/first-win/complete
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
| `firstWinApi.complete(winType)` | `POST /me/first-win/complete` | When user taps a win card | `aiMessage` displayed in completion view; `completedAt` not used in UI |

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
| RTL: tapping a card calls `firstWinApi.complete` with correct winType | API wiring correct |
| RTL: continue button in completion view calls onComplete | Exit path after win |

---

## Future work / known limits

- The `winType` is not yet emitted as a `ClientSignal` for PTM analytics. When retention dashboards are needed, the backend's `complete()` method can emit a Phase 1A signal of type `first_win` with `winType` in `metadata`.
- The win screen is shown on every cold start until the API call succeeds. On repeated offline boots, a client may see the screen multiple times. A local `AsyncStorage` flag could suppress it after the first offline skip — but that risks the backend timestamp never being set. Current behaviour is correct.
- The 3 win-card actions are informational — tapping "Log your starting weight" does not automatically navigate to the weight log screen. A future improvement would navigate to the relevant screen and mark the win automatically when the user saves data there.

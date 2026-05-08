# Leaderboard Screens — Phase 7C

Two new client-facing screens for the opt-in peer leaderboard, scoped
to the requesting user's coach roster.

---

## Screens

### `LeaderboardScreen.tsx`

Entry point for viewing the leaderboard.

**States:**

| State | What renders |
|-------|-------------|
| Loading | Centered activity indicator. |
| Error | Error message + "Try again" button. |
| Not opted in | Opt-in card (empty-state copy + toggle + display name input). |
| Opted in, no peers | "No peers have opted in yet" copy. |
| Populated | Ranked list of rows. |

**Row anatomy:**

- Rank number.
- Display name (user-configured or derived `"{firstName} {lastInitial}."`).
- Score bar (0–100 mapped to full width).
- Combined score (integer, 18px Inter SemiBold).
- Week delta (`+4` / `-2`) in forest/oxblood; hidden when zero or null.

**Requesting user's row:** always rendered. Highlighted with a 2px oxblood
bottom border (`testID="leaderboard-self-row"`). Position in list matches
their actual rank.

### `LeaderboardSettingsScreen.tsx`

Full opt-in management screen, accessible from the MoreStack.

**Sections:**

1. **Toggle** — opt in / out with a single Switch. Optimistic update; reverts on error.
2. **Display name** — text input (max 40 chars), shown only when opted in. Save button
   appears only when the name has changed.
3. **Explainer** — plain-English breakdown of what is measured, what is never shared,
   and who can see the user.

---

## Navigation

Both screens are registered in `MoreStackParamList` in `ClientNavigator.tsx`:

```typescript
Leaderboard:         undefined;
LeaderboardSettings: undefined;
```

Navigate from `MoreScreen` (or any screen in the MoreStack):

```typescript
navigation.navigate('Leaderboard');
navigation.navigate('LeaderboardSettings');
```

---

## API Service

`src/services/leaderboardApi.ts` — two exported functions:

| Function | Endpoint | Description |
|----------|----------|-------------|
| `getLeaderboard()` | `GET /me/leaderboard` | Fetch ranked roster leaderboard. |
| `setLeaderboardOptIn(payload)` | `POST /me/leaderboard/opt-in` | Toggle opt-in, set display name. |

---

## Privacy

- `combinedScore` is an integer `[0, 100]`. Never contains weight, body fat, income, or finance data.
- Display names are coach-roster visible only. Never platform-wide.
- Default is opt-out. Explicit user action required to appear.
- Opt-out removes the row immediately; the backend clears the cached score.

---

## Design Doctrine

- Bone (`#F5EFE4`) background, ink (`#1A1A18`) text.
- Oxblood (`#4A0404`) for the self-row underline accent.
- Cormorant SemiBold for headings, Inter for body and scores.
- No emoji, no podiums, no medals, no confetti.
- Numbers over adjectives throughout.

---

## Tests

`src/__tests__/LeaderboardScreen.test.tsx` — source-level guards:

- Self-row testID and oxblood highlight.
- `combinedScore` field used; no raw health/finance fields.
- Canonical empty-state copy present.
- Display name `maxLength={40}`.
- Cormorant + Inter font references.
- No emoji or podium language.
- LeaderboardSettingsScreen: toggle testID, metric labels, privacy copy.
- `leaderboardApi.ts`: exports, endpoint path, score range comment.

# TimelineScreen — Phase 7B

The Transformation Timeline is a reverse-chronological record of a client's
entire journey. It covers 4 lanes, is paginated via infinite scroll, and is
filtered via lane chips at the top.

## Design

- **Palette:** Bone background, ink text, forest/mutedGold/ink/stone lane dots
- **Typography:** Cormorant Garamond for `h1` / `h2` headers; Inter for body and metadata
- **No emoji.** No gamification. No magic inline colors — all values from `src/theme/tokens.ts`
- Lane dots provide accessible `accessibilityLabel` and `accessibilityRole="image"`

## Lanes

| Lane | Dot color | What appears |
|------|-----------|--------------|
| Body | Forest (`#2C4A36`) | Weight logs with delta, body composition, progress photos |
| Wins | Muted gold (`#C5A253`) | Streak milestones (7, 14, 30, 60, 90 days), Build Week Day 7 completion, finance milestones |
| Coach | Ink (`#1A1A18`) | Text notes from coach, voice notes from coach |
| Friction | Stone (`#B1A89F`) | Missed check-in markers — honest, non-punitive |

## Navigation

`TimelineScreen` is registered in `MoreStackNavigator` under the name
`Timeline`. It is reachable from `MoreScreen` and can be deep-linked as a
"Story" entry-point on Home if the Home screen exposes a shortcut.

The nav param type is registered in `MoreStackParamList` in `ClientNavigator.tsx`.

## Empty state

> "Your transformation timeline starts the day you log your first weight."

Shown when the user has no events in the requested window/lanes.

## Key files

| File | What it owns |
|------|--------------|
| `TimelineScreen.tsx` | Full screen: filter chips, FlatList, event cards, empty/error states |
| `src/services/timelineApi.ts` | Typed client for `GET /me/timeline` |
| `TIMELINE.md` | This file |

## Tests

`src/__tests__/TimelineScreen.test.tsx` covers:
- Renders lane filter chips
- Renders events from mocked API response
- Shows empty state when API returns 0 events
- Shows error state and retry button on API failure
- Selecting a single lane chip calls the API with that lane
- Pull-to-refresh triggers a fresh API call

## Accessibility

- Screen title has `accessibilityRole="header"`
- Filter toolbar has `accessibilityRole="toolbar"` with an `accessibilityLabel`
- Each chip has `accessibilityRole="button"` and `accessibilityState={{ selected }}`
- Each event card has `accessibilityRole="text"` and a composed `accessibilityLabel`
- Lane dots have `accessibilityRole="image"` and descriptive `accessibilityLabel`
- Pull-to-refresh has `accessibilityLabel`
- ActivityIndicator loading states are rendered with no interactive labels (decorative)

## API contract

Calls `GET /me/timeline` with optional query parameters:
- `since_days` (default: 365 on client, 180 on backend default)
- `lanes` (comma-separated, omitted for All)
- `cursor` (opaque, for pagination)
- `limit` (default: 20)

Response: `{ events[], nextCursor, total }`

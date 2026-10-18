# Share Card

Phase 11 / progress share card for organic referral.

SHARE-A (owner 10-17 #SHARE-SEND op 1): with `featureFlags.shareSheetV2` (off in every build) the route below is not
registered. Share on the Progress run line and under each recent best on the Session summary opens
`src/components/share/ShareSheet.tsx` over the screen, with `runCard` / `bestCard` from `shareCards.tsx` (number, words,
dates, app name; each says what is in it and what is not). Coached with `featureFlags.shareSendV1` (off), Send to {coach}
posts `{ card: { type: 'share', snapshot }, client_message_id }` to `POST /messages` (`src/api/shareCardApi.ts`, backend
SHARE-BE). The outbox retains a NO_COACH_ASSIGNED card and waits for a valid current coach; other permanent 4xx refusals
use the unavailable path.

SHARE-B (same flag): thread rows carry `card` (`readShareCard` keeps a `share` card it can draw). Both threads draw it
as the same forest card under "Shared progress" on cream (`SharedCard`), the client's on the right and the coach's
view on the left; the coach inbox, and the client's, say "Shared a card" when the newest message is one. The sheet
sends through the client's thread outbox in either thread style (`outboxOn`: `c3StyleB` or `shareSendV1`), so offline
the card waits in the thread ("Waiting to send") and sends on reconnect, thread open or not; a failed one says "Not
sent. Tap to send again" in the sheet and in the Style B thread, and "Not sent. Long press to send again" in the
other.

## Implementation

- Screen: `src/screens/share/ShareCardScreen.tsx`
- Navigation: `MoreStackParamList.ShareCard` — registered in `ClientNavigator.tsx`
- Capture: `react-native-view-shot` (`captureRef`)
- Share: `expo-sharing` (`Sharing.shareAsync`)

## Variants

| Variant | `card_type` | Trigger | Icon |
|---|---|---|---|
| Streak | `streak` | Logging streak >= 3 days | `flame-outline` |

## Card anatomy

1. Brand mark: "The Growth Project" (small caps, `Inter_500Medium`)
2. Icon: Ionicons 48px in `colors.primaryLight` circle
3. Headline: large numeric value (Cormorant Garamond 72px)
4. Subheadline: milestone label (Cormorant Garamond 24px)
5. Tagline: variant-specific copy (italic, muted)

Typography: Cormorant Garamond for headline/subheadline (project display serif). Falls back to system serif if fonts have not yet loaded.

## Trigger points

| Location | Variant | Condition |
|---|---|---|
| `ProgressScreen` header | streak | `loggingStreak >= 3` |

Additional trigger points to wire in later phases:
- `ActiveWorkoutScreen` — PR detected after workout completion
- `HomeScreen` — milestone card share button

## Analytics event

```typescript
track(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED, {
  card_type: 'streak' | 'pr', // pr: the sheet's recent-best card
  coach_tenant_id?: string,
  destination: 'native_share_sheet' | 'coach_thread',
});
```

Fired after `Sharing.shareAsync` resolves (regardless of completion).

## Share sheet targets

The native share sheet (`expo-sharing`) routes to any installed app. Expected targets:
- Instagram Stories
- WhatsApp
- iMessage / Messages
- Copy to clipboard

## Native build requirement

`react-native-view-shot` requires a native build. Where it is missing, or sharing fails, the screen and the sheet (`src/components/share/sharePicture.ts`) say "The picture could not be made. Try again." in place with the error haptic, never an alert; no success haptic fires before the picture exists.

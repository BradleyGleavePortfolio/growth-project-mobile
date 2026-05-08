# Share Card

Phase 11 / progress share card for organic referral.

## Implementation

- Screen: `src/screens/share/ShareCardScreen.tsx`
- Navigation: `MoreStackParamList.ShareCard` — registered in `ClientNavigator.tsx`
- Capture: `react-native-view-shot` (`captureRef`)
- Share: `expo-sharing` (`Sharing.shareAsync`)

## Variants

| Variant | `card_type` | Trigger | Icon |
|---|---|---|---|
| Streak | `streak` | Logging streak >= 3 days | `flame-outline` |
| PR | `pr` | Personal record set | `barbell-outline` |
| Transformation | `transformation` | Body-composition milestone | `trending-up-outline` |

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
  card_type: 'streak' | 'pr' | 'transformation',
  coach_tenant_id?: string,
  destination: 'native_share_sheet',
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

`react-native-view-shot` requires a native build (`eas build`). In Expo Go the share button shows an in-app alert explaining this. Production builds are unaffected.

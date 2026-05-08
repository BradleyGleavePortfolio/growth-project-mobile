# Skeleton Loader Library

Phase 11 / Track 2 — `feat/phase-11-skeleton-loaders`

## Purpose

Provides animated placeholder components that replace `ActivityIndicator`
spinners during data-fetch loading states. The result is a content-aware
loading experience that matches the shape of the real UI, reducing perceived
wait time and eliminating layout shift.

## Architecture

All skeletons are built on `react-native-reanimated` (bundled with Expo SDK 51).
No additional npm dependency is introduced.

### Pulse animation

```
opacity  0.4 ─────── 1.0 ─────── 0.4   (repeat, ping-pong)
             1 500 ms      1 500 ms
easing:  Easing.inOut(Easing.sine)
```

### Color tokens

| Token | Role |
| --- | --- |
| `tokens.colors.cream` (`#F1E8D5`) | Skeleton fill (surface token) |

No hardcoded hex values. Colors are sourced exclusively from the theme provider.

### Accessibility

All skeleton containers set:
```tsx
accessibilityElementsHidden
importantForAccessibility="no-hide-descendants"
```
This ensures VoiceOver and TalkBack skip placeholders entirely.

## Components

### `Skeleton` (primitive)

```tsx
import { Skeleton } from '../ui/skeletons';

<Skeleton width={200} height={16} />
<Skeleton width="100%" height={48} borderRadius={4} />
```

Props:

| Prop | Type | Required | Default |
| --- | --- | --- | --- |
| `width` | `DimensionValue` | yes | — |
| `height` | `number` | yes | — |
| `borderRadius` | `number` | no | `tokens.radius.md` (2) |
| `testID` | `string` | no | — |

### `SkeletonClientCard`

Matches the coach client list card shape used in `ClientsListScreen`.

```tsx
<SkeletonClientCard />
```

### `SkeletonWorkoutRow`

Matches a workout assignment row used in workout screens.

```tsx
<SkeletonWorkoutRow />
```

### `SkeletonStatTile`

Matches a dashboard stat tile (icon + value + label).

```tsx
<SkeletonStatTile />
```

### `SkeletonProgressChart`

Bar chart placeholder with 6 bars of varying heights.

```tsx
<SkeletonProgressChart />
```

### `SkeletonProfileHeader`

Client/coach profile header (avatar + name + role + 2 stat chips).

```tsx
<SkeletonProfileHeader />
```

## Wired screens

| Screen file | Component(s) used | Trigger |
| --- | --- | --- |
| `src/screens/coach/CoachHomeScreen.tsx` | `SkeletonStatTile` | `isLoading && !refreshing`; also `dashboardLoading` metric tiles |
| `src/screens/coach/ClientsListScreen.tsx` | `SkeletonClientCard` (×5) | `isLoading` |
| `src/screens/coach/ClientDetailScreen.tsx` | `SkeletonProfileHeader`, `SkeletonStatTile` (×3), `SkeletonWorkoutRow` (×3) | `isLoading && !refreshing` |

## Tests

`src/__tests__/skeleton.test.tsx`

- Source-level contract guards for `Skeleton.tsx` and `SkeletonClientCard.tsx`
- Barrel export completeness check (`index.ts`)
- Wiring assertions for all three wired screens
- RTL render test confirming the primitive mounts without errors

Run: `npm test -- --testPathPattern="skeleton"`

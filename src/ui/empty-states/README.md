# Empty State Component Library

**Module:** `src/ui/empty-states/`
**Added:** Phase 11, Track 1

## Overview

A unified, composable empty-state system for the Growth Project mobile app.
All components consume theme tokens exclusively (no hardcoded hex values).
Icons are SVG-based (no emoji). Every interactive element carries
`accessibilityLabel` and `accessibilityRole` in compliance with the
Quiet Luxury Doctrine.

## Components

| Component | Usage |
|---|---|
| `EmptyState` | Generic base — compose with any SVG icon, headline, body, optional CTA |
| `EmptyStateNoClients` | Coach client roster — no clients enrolled yet |
| `EmptyStateNoWorkouts` | Client workout screen — no routines assigned by coach |
| `EmptyStateNoData` | Generic data-not-yet-loaded fallback (charts, logs, analytics) |
| `EmptyStateNoResults` | Search / filter — zero results, accepts `query` prop |
| `EmptyStateOffline` | Network-down state with optional retry CTA |

## Props

### `EmptyState` (base)

```tsx
interface EmptyStateProps {
  icon: React.ReactElement;   // SVG icon element
  headline: string;           // Short primary message
  body?: string;              // Optional supporting copy
  ctaLabel?: string;          // Optional CTA button label
  onCta?: () => void;         // CTA handler (required when ctaLabel is set)
  style?: ViewStyle;          // Optional container style override
}
```

### `EmptyStateNoResults`

```tsx
interface Props {
  query: string;              // Active search query — shown in body copy
  onClearSearch?: () => void; // Optional handler to clear search
}
```

### `EmptyStateNoData`

```tsx
interface Props {
  headline?: string;          // Override default "Nothing here yet"
  body?: string;              // Override default body copy
  ctaLabel?: string;          // Optional action label
  onCta?: () => void;
}
```

### `EmptyStateOffline`

```tsx
interface Props {
  onRetry?: () => void;       // Shows "Try again" CTA when provided
}
```

## Usage

```tsx
import {
  EmptyState,
  EmptyStateNoClients,
  EmptyStateNoResults,
  EmptyStateOffline,
} from '../../ui/empty-states';

// Variant
<EmptyStateNoClients onInvite={() => navigation.navigate('InviteCodes')} />

// Search zero-results
<EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />

// Base — custom composition
import { IconChartEmpty } from '../../ui/empty-states';

<EmptyState
  icon={<IconChartEmpty size={64} color={colors.textMuted} />}
  headline="No progress data"
  body="Log your first workout to unlock progress charts."
  ctaLabel="Start workout"
  onCta={handleStart}
/>
```

## Screens wired

| Screen | File | Empty State Used |
|---|---|---|
| `ClientsListScreen` | `src/screens/coach/ClientsListScreen.tsx` | `EmptyStateNoClients` (no clients), `EmptyStateNoResults` (search) |
| `MessagesScreen` (coach) | `src/screens/coach/MessagesScreen.tsx` | `EmptyStateNoClients` (no active clients), `EmptyStateNoResults` (search) |
| `WorkoutScreen` (client) | `src/screens/client/WorkoutScreen.tsx` | `EmptyStateNoWorkouts` (no routines), `EmptyStateNoData` (no recent sessions) |

## Icon set

All icons live in `icons.tsx` and are exported from the `index.ts` barrel.

| Export | Description |
|---|---|
| `IconPeople` | Two figures — client roster |
| `IconClipboard` | Clipboard — workouts / plans |
| `IconChartEmpty` | Bar chart — data / analytics |
| `IconSearchEmpty` | Magnifier with X — no results |
| `IconOffline` | Signal bars with cross — offline |

## Tests

`src/ui/empty-states/__tests__/EmptyState.test.tsx`

Covers: headline renders, body renders, body omitted when absent, CTA fires
`onCta`, no CTA without props, `accessibilityRole`, `accessibilityLabel`,
all five variant headlines, query interpolation in `EmptyStateNoResults`.

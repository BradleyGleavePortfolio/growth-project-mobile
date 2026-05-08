# Dark Mode — Semantic Token System

Phase 11 / Track 4 adds a semantic colour-token layer that powers automatic light/dark mode switching across The Growth Project mobile app.

---

## Overview

The app uses two layers of colour tokens:

| Layer | Purpose | File |
|-------|---------|------|
| **Palette tokens** (`colors`, `neutral`, `brand`, etc.) | Raw colour values — never used directly in components | `src/theme/tokens.ts` |
| **Semantic tokens** (`lightTokens` / `darkTokens`) | Context-aware tokens that switch with the colour scheme | `src/theme/tokens.ts` |

Components should read only from semantic tokens via `useTheme().semanticColors`.

---

## Semantic Token Reference

```ts
export interface SemanticTokens {
  bgPrimary:   string;  // Screen / page background
  bgSurface:   string;  // Card / surface background
  textPrimary: string;  // Primary body text
  textMuted:   string;  // Secondary / supporting text
  accent:      string;  // Brand accent (oxblood; lifted in dark for AA contrast)
  border:      string;  // Default border / hairline
}
```

### Light values

| Token | Value | Name |
|-------|-------|------|
| `bgPrimary`   | `#F5EFE4` | bone |
| `bgSurface`   | `#FFFDF8` | off-white |
| `textPrimary` | `#1A1A18` | ink |
| `textMuted`   | `#78736E` | warm grey |
| `accent`      | `#4A0404` | oxblood |
| `border`      | `#DCD5CC` | hairline |

### Dark values

| Token | Value | Name |
|-------|-------|------|
| `bgPrimary`   | `#121110` | near-black |
| `bgSurface`   | `#1C1A18` | dark surface |
| `textPrimary` | `#EBE6DE` | near-white |
| `textMuted`   | `#A09B94` | muted warm grey |
| `accent`      | `#B43C3C` | lifted oxblood (AA compliant on dark bg) |
| `border`      | `#2D2A26` | dark hairline |

---

## Using semantic tokens in a component

```tsx
import { useTheme } from '../theme/useTheme';

export default function MyScreen() {
  const { semanticColors: colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <Text style={{ color: colors.textPrimary }}>Hello</Text>
      <Text style={{ color: colors.textMuted }}>Supporting copy</Text>
    </View>
  );
}
```

If you also need `ThemeColors` (the legacy palette):

```tsx
const { colors: themeColors, semanticColors: sc } = useTheme();
```

---

## Appearance override (user setting)

The `ThemeProvider` exposes three values to allow the Settings screen to read and mutate the user's preference:

```ts
const {
  colorScheme,           // 'light' | 'dark' — the resolved scheme
  appearanceOverride,    // 'system' | 'light' | 'dark' — what the user selected
  setAppearanceOverride, // (override: AppearanceOverride) => void — persists to AsyncStorage
} = useTheme();
```

The override is stored in AsyncStorage under the key `gp_appearance` and loaded on mount.

---

## Migrating an old screen

Follow these steps when retrofitting a screen that uses hardcoded hex values or the static `colors` import from `tokens.ts`.

### Step 1 — Identify hardcoded colours

```bash
grep -n "#[0-9A-Fa-f]\{6\}" src/screens/client/MyScreen.tsx
```

### Step 2 — Import `useTheme`

```tsx
// Before
import { colors } from '../../theme/tokens';

// After
import { useTheme } from '../../theme/useTheme';
```

### Step 3 — Call the hook inside your component

```tsx
const { semanticColors: colors } = useTheme();
```

### Step 4 — Map hardcoded values to semantic tokens

| Was | Use instead |
|-----|-------------|
| `#F5EFE4` (bone) | `colors.bgPrimary` |
| `#F1E8D5` (cream) | `colors.bgSurface` |
| `#1A1A18` (ink) | `colors.textPrimary` |
| `#B1A89F` (stone) | `colors.textMuted` |
| `#4A0404` (oxblood) | `colors.accent` |
| `#DCD5CC` (hairline) | `colors.border` |

### Step 5 — Move `StyleSheet.create` inside a `useMemo`

If the screen uses module-level styles that reference colours, wrap them:

```tsx
const styles = useMemo(() => makeStyles(colors), [colors]);

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
    container: { backgroundColor: colors.bgPrimary },
    // ...
  });
```

### Step 6 — What NOT to migrate

Data-visualisation swatches (habit colour pickers, chart bar fills, macro colours) are intentionally hardcoded palette values. They are exempt from the semantic-token rule because they represent user-assigned content colours, not structural UI colours.

---

## Screens migrated in Phase 11

| Screen | Migration type |
|--------|---------------|
| `HomeScreen.tsx` | Full — replaced `colors` import with `useTheme().semanticColors` |
| `HabitsScreen.tsx` | Structural — container background + makeStyles updated; data-viz swatches left unchanged |
| `LeaderboardScreen.tsx` | Full — converted module-level StyleSheet to `makeStyles(sc)`; hardcoded OXBLOOD constant replaced with `sc.accent` |

---

## Screens deferred to Phase 11.5

The following screens still use the static `colors` import or hardcoded hex values and are scheduled for migration in the next sweep:

- `ActiveWorkoutScreen.tsx`
- `ProgressScreen.tsx`
- `LogScreen.tsx`
- `ProfileScreen.tsx`
- `WorkoutScreen.tsx`
- `PlanScreen.tsx`
- `RecipesScreen.tsx`
- All coach-side screens under `src/screens/coach/`

Run `grep -rn "from '../../theme/tokens'" src/screens/` to get a live list.

---

## Testing

All new theme files ship with tests in `src/__tests__/darkMode.test.ts`:

- Token shape: both `lightTokens` and `darkTokens` expose the full `SemanticTokens` interface
- Value correctness: specific colour values are pinned to prevent silent regressions
- Token distinctness: light and dark values differ for every key
- ThemeProvider source-level contract: resolution logic, AsyncStorage persistence, context exposure

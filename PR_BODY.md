## EW3 P1 Safe-Area Pack — Android edge-to-edge status bar + push banner inset

Fixes the two **code-level** P1 safe-area surfaces flagged in the EW3 Android-parity
triage (**PR #11 @ `41c6186`**). Expo SDK 56 enables Android edge-to-edge by default, so
the app now draws behind the system status bar. Two surfaces still used pre-SDK-56
patterns that broke the bone (`#F5EFE4`) status-bar band and the foreground push banner on
tall / notched Android devices.

### EW3-001 — Status-bar background under SDK 56 edge-to-edge (`App.tsx`)

**Before**
```ts
import { Platform, StatusBar as RNStatusBar } from 'react-native';
if (Platform.OS === 'android') {
  RNStatusBar.setBackgroundColor('#F5EFE4', false); // deprecated / no-op under edge-to-edge
}
```

**After** — removed the deprecated imperative call; the bone band is now painted by a
top-inset `View` sized to `useSafeAreaInsets().top`, rendered at the very top of the root
tree inside a `SafeAreaProvider`. `expo-status-bar` keeps `style="dark"` for icon contrast.

```tsx
// src/components/StatusBarBand.tsx
export function StatusBarBand() {
  const insets = useSafeAreaInsets();
  return <View testID="status-bar-band"
    style={{ height: insets.top, backgroundColor: '#F5EFE4' }} />;
}

// App.tsx
<SafeAreaProvider>
  <StatusBarBand />
  <ErrorBoundary>…<StatusBar style="dark" />…</ErrorBoundary>
</SafeAreaProvider>
```

> **Note:** the triage assumed a `SafeAreaProvider` was already at the top of the tree. It
> was **not** present in `App.tsx`, so `useSafeAreaInsets()` would have resolved to `0`.
> This PR adds the `SafeAreaProvider` wrapper at the root so the inset reflects the real
> device cutout height. The band logic was extracted to `src/components/StatusBarBand.tsx`
> so it can be unit-tested without importing App's full native dependency graph
> (`expo-video` etc. crash under jest at module load).

### EW3-003 — Foreground push banner top inset (`src/components/ForegroundNotificationBanner.tsx`)

**Before** (`StyleSheet`, line 182)
```ts
paddingTop: Platform.OS === 'ios' ? 44 : 12,  // magic numbers; Android ignores status-bar height
```

**After** — driven by the real safe-area inset with a 12px floor:
```ts
const insets = useSafeAreaInsets();
// …
paddingTop: Math.max(insets.top, 12),
```

### Out of scope — EW3-002 (deferred)

This pack fixes the **2 code-level P1 surfaces (EW3-001, EW3-003)**. **EW3-002**
(`https://app.trygrowthproject.com/.well-known/assetlinks.json` App Links hosting) is an
**ops/config gap and tracked separately** — the operator decides hosting + SHA-256
fingerprints. No code change here. P2/P3 triage items (`OfflineBanner.tsx`,
`PlanScreen.tsx`, EW3-004..011) are untouched.

## Files changed

| File | Change |
| --- | --- |
| `App.tsx` | Remove deprecated `RNStatusBar.setBackgroundColor`; wrap root in `SafeAreaProvider`; render `<StatusBarBand>` (+19/−16) |
| `src/components/StatusBarBand.tsx` | **new** — bone status-bar band painted at the top inset (21 lines) |
| `src/components/ForegroundNotificationBanner.tsx` | `paddingTop: Math.max(useSafeAreaInsets().top, 12)` (+7/−1) |
| `App.test.tsx` | **new** — smoke + snapshot test of the bone band at a mocked 47px inset (38 lines) |
| `src/components/__tests__/ForegroundNotificationBanner.test.tsx` | **new** — render test asserting `paddingTop: 47` from a mocked inset (72 lines) |
| `PR_BODY.md` | this body, committed so the audit can reproduce gate output |

No `package.json` / `package-lock.json` changes — **no new dependencies**
(`react-native-safe-area-context` and `expo-status-bar` were already deps).

## Test plan

Gates (all green):

```
$ npm run lint
✖ 82 problems (0 errors, 82 warnings)   # all warnings pre-existing, none in changed files

$ npm run typecheck
> tsc --noEmit                            # 0 errors

$ npm test -- --testPathPattern='(App|ForegroundNotificationBanner)'
Test Suites: 4 passed, 4 total
Tests:       32 passed, 32 total
Snapshots:   1 written, 1 total
```

**Manual device-test plan (pending QA):**
- Android API 30 / 33 / 34 device capture of the welcome screen showing the bone status-bar
  band painted behind the system status-bar icons (no black/white gap under edge-to-edge).
- Trigger a foreground push banner on a notched Android device and confirm the banner text
  clears the status bar / cutout.
- iOS regression: confirm the banner still clears the notch (inset replaces the old `44`).

## Risk + rollback

- **Risk: cosmetic-only.** On iOS there is no behaviour change — `useSafeAreaInsets().top`
  on a notched iPhone covers the notch the same way the previous `44` magic number did, with
  a `Math.max(…, 12)` floor for devices reporting a smaller/zero inset. The added
  `SafeAreaProvider` wraps the existing tree without altering layout for descendants that
  don't read insets.
- **Rollback:** revert the single commit.

Triage source of truth: PR #11 @ `41c6186` (EW3-001, EW3-003).

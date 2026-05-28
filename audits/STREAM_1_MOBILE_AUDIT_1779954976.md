# Stream 1 Mobile Audit — 2026-05-28T10:36:16Z

## Builder PR
https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/201

## CI / Local verification
- `npm run build`:    n/a (RN/Expo — no build script; `npm run typecheck` is the equivalent gate)
- `npm run typecheck`: **PASS** (0 errors)
- `npm run lint`:     **PASS** (0 errors, 72 pre-existing warnings — none in new Stream 1 files)
- `npm test` (Stream 1 scope, `--testPathPattern='ai-budget|coachAIBudget|useAIBudget|creditPackCheckout|CreditPackCheckout'`): **36 / 36 passing**, 6 / 6 suites

## Verdict
**DIRTY** — 1 P0 (two integration contract mismatches with the backend), 2 P1, 4 P2, 2 P3.

The PR is high-quality on the in-component invariants the spec calls out (BLOCKING tutorial, no IAP, Intl money, Reanimated transitions, Stripe-host allow-list on the WebView, dark-mode coverage). It fails on the wire contract with the backend PR #296 — the request shape the mobile sends does not pass the backend's `class-validator` guard, and the response field names the mobile reads do not match the backend's DTO. Checkout is end-to-end broken until P0-1 is fixed.

---

## P0 findings (BLOCKERS — must fix before merge)

### P0-1: `POST /coach/ai/credit-packs/checkout` request **and** response contract drift from backend
- Files:
  - `src/api/coachAiBudgetApi.ts:19-50` (mobile request + response types)
  - `src/screens/coach/CreditPackCheckoutScreen.tsx:100-116` (consumes response)
  - Backend authority: `/home/user/workspace/tgp/backend-ai-credits-build/src/ai-credits/credit-pack-checkout.dto.ts:20-58`
- 50-Failures category: #7 "Schema / Contract Drift" (sibling of #36 "Errors not codes") — the wire contract drifted silently between the two halves of the same feature, and neither side has a contract test that would have caught it.
- Code (mobile request — `coachAiBudgetApi.ts:27-30`):
    ```ts
    export interface CreateCheckoutInput {
      /** Face-value cents the coach is paying. 1000 = $10, 9900 = $99. */
      amount_cents: number;
    }
    // ...
    createCheckout: (input: CreateCheckoutInput) =>
      api.post<CreateCheckoutResponse>('/coach/ai/credit-packs/checkout', input),
    ```
  Backend request DTO (`backend …/credit-pack-checkout.dto.ts:20-30`):
    ```ts
    export class CreditPackCheckoutRequestDto {
      @IsIn(['small', 'medium', 'large', 'custom'])
      tier!: CreditPackTier;                  // REQUIRED — no default
      @IsOptional() @IsInt() @Min(1000) @Max(50000)
      amount_cents?: number;                  // required only when tier === 'custom'
      // success_url?, cancel_url? — optional
    }
    ```
  Code (mobile response — `coachAiBudgetApi.ts:20-25`):
    ```ts
    export interface CreateCheckoutResponse {
      url: string;
      session_id: string;
    }
    ```
  Backend response DTO (`backend …/credit-pack-checkout.dto.ts:53-66`):
    ```ts
    export class CreditPackCheckoutResponseDto {
      checkout_session_id!: string;
      checkout_url!: string;
      amount_cents!: number;
    }
    ```
- Issue: TWO contract breaks in a single endpoint.
  1. **Request side**: mobile POSTs `{ amount_cents: 1000 }` for the locked tiers (no `tier` key). Backend's `class-validator` `@IsIn(['small','medium','large','custom']) tier!` fails — the request 400s before the controller body even executes. Every single $10/$25/$99 button on the tutorial, banner, hard-pause, and checkout screen will surface as a 400 from `coachAiBudgetApi.createCheckout`.
  2. **Response side**: even if a coach happened to bypass the request-validation failure (they cannot), the response is read as `data.url` (line 102) and the explicit null-check `if (!data?.url) throw new Error('Checkout session URL missing')` (line 103) fires because the backend returns `checkout_url`, not `url`. Same for `session_id` ↔ `checkout_session_id`.
- Severity: **P0** — checkout is broken end-to-end in 100% of cases. Affects every CTA in the new mobile surface (tutorial card 4, banner CTA, hard-pause modal pack buttons, custom-amount input).
- Suggested fix (smallest surface):
  - `coachAiBudgetApi.ts`:
    - `CreateCheckoutInput` → `{ tier: 'small' | 'medium' | 'large' | 'custom'; amount_cents?: number; success_url?: string; cancel_url?: string }`.
    - `CreateCheckoutResponse` → `{ checkout_url: string; checkout_session_id: string; amount_cents: number }`.
  - `CreditPackCheckoutScreen.tsx`:
    - Map cents → tier at the call site (`1000 → 'small'`, `2500 → 'medium'`, `9900 → 'large'`, else `'custom'` with `amount_cents`).
    - Read `data.checkout_url` / `data.checkout_session_id`.
  - Wherever `onSelectPack(amount)` is invoked from `PackOptionsRow` / `AIBudgetTutorialModal` / `AIBudgetHardPauseModal`: the orchestrator (`AIBudgetMount.goToCheckout`) already passes `number | 'custom'`. Add a small tier-mapper at the API boundary so the rest of the codebase keeps speaking in cents.
  - Add a contract test that mocks `api.post` once and asserts the body shape the mobile sends matches `CreditPackCheckoutRequestDto.@IsIn(['small','medium','large','custom'])`.

---

## P1 findings (BLOCKERS — must fix before merge)

### P1-1: WebView `originWhitelist` is the wildcard `['https://*']` despite a hand-rolled allow-list existing
- File: `src/screens/coach/CreditPackCheckoutScreen.tsx:259`
- 50-Failures category: #14 "Trust Boundary Bypass" + #46 "Defence in Depth Missing"
- Code:
    ```tsx
    <WebView
      source={{ uri: phase.url }}
      originWhitelist={['https://*']}
      onNavigationStateChange={handleWebViewNavigation}
      onShouldStartLoadWithRequest={handleShouldStartLoad}
      ...
    />
    ```
- Issue: The screen IS protected by `isOriginAllowed` in `onShouldStartLoadWithRequest` (line 196) and by validating `data.url` against the same allow-list at mint time (line 108). But `originWhitelist={['https://*']}` is the *outer* gate on Android/iOS WebView — it permits any https origin. If an `onShouldStartLoadWithRequest` race or a future refactor drops the inline check, the outer wildcard becomes the only line of defence and would allow arbitrary phishing pages. The `CHECKOUT_ALLOWED_HOSTS` constant from `BrandedCheckoutWebViewScreen` is already imported here — pass it through.
- Suggested fix: build the originWhitelist from `CHECKOUT_ALLOWED_HOSTS`:
    ```tsx
    originWhitelist={CHECKOUT_ALLOWED_HOSTS.map((h) => `https://${h}`)}
    ```
  This mirrors the posture the existing `BrandedCheckoutWebViewScreen` should follow (verify there too — if it has the same wildcard, that is a sibling P1 in the legacy code, not this PR's responsibility to land).

### P1-2: `useAIBudget` polls on a 60-second interval whenever the screen is mounted, with no `useFocusEffect` gating
- Files:
  - `src/hooks/useAIBudget.ts:60-67`
  - `src/components/coach/ai-budget/AIBudgetMount.tsx:55`
- 50-Failures category: #21 "Resource Exhaustion in Steady State" (battery / data drain) + #5 "Over-specification of the happy path"
- Code:
    ```ts
    return useQuery<CoachAIBudgetResponse, Error>({
      queryKey: COACH_AI_BUDGET_QUERY_KEY,
      ...
      enabled,
      refetchInterval: enabled ? COACH_AI_BUDGET_REFETCH_MS : false,
      refetchIntervalInBackground: false,
      ...
    });
    ```
- Issue: The brief's deliverable #1 reads "Refetch every 60s **while Coach Home mounted**." The hook honours mount-state (RN unmounts unfocused stack screens when configured to) but RN's default native-stack keeps prior screens mounted as you push new ones. So when a coach navigates from CoachHome → ClientDetail → MessagesScreen, the budget query keeps polling in the background of the navigation stack until the user pops back or the app backgrounds. The brief also requires "polling only when screen mounted+focused" (Builder Brief §"Anti-Patterns to AVOID": "Polling without focus check (only poll when screen mounted)"). The `refetchIntervalInBackground: false` only covers app-level background, not navigation focus.
- Suggested fix: in `AIBudgetMount`, gate `enabled` with `useIsFocused()` from `@react-navigation/native`:
    ```ts
    import { useIsFocused } from '@react-navigation/native';
    // ...
    const isFocused = useIsFocused();
    const { data: budget } = useAIBudget({ enabled: enabled && isFocused });
    ```
  This collapses to no-op when the host screen (Coach Home) is off-focus, which is the brief's intent.

---

## P2 findings (SHOULD FIX — not blockers but noted)

### P2-1: Custom-amount validation routes a `kind:'error'` state but reads bounds from the spec defaults when no budget is loaded
- File: `src/screens/coach/CreditPackCheckoutScreen.tsx:90-94, 125-148`
- 50-Failures category: #6 "Silent fallback that masks an upstream failure"
- Code:
    ```ts
    const packOptions = budget?.pack_options_cents ?? [1000, 2500, 9900];
    const bounds = budget?.custom_pack_bounds_cents ?? {
      min: CUSTOM_PACK_MIN_CENTS,
      max: CUSTOM_PACK_MAX_CENTS,
    };
    ```
- Issue: When the budget query is mid-flight (cold-start into the checkout screen) the screen renders pack options and bounds from the hard-coded constants. The constants match the spec today but they are the very numbers the operator already overrode once (5.0× → 3.125×, $25 small → $10 small). The defensive defaults make a future tier change a multi-place edit. Either (a) gate the screen behind `if (!budget) return <Skeleton />` so the source of truth is always the wire DTO, or (b) drop the constants from the API boundary and let the screen show a loading state.
- Suggested fix: render an `ActivityIndicator` until `budget` is loaded; remove the constant fallbacks from the screen.

### P2-2: Confetti uses RN `Animated.timing` rather than Reanimated v3
- File: `src/screens/coach/CreditPackCheckoutScreen.tsx:324-373`
- 50-Failures category: #41 "Vanilla Style" (mixing animation systems)
- Code:
    ```ts
    Animated.timing(p.opacity, { toValue: 1, duration: 120, useNativeDriver: true })
    ```
- Issue: Builder brief tech-choices says "Reanimated v3+ for the tutorial card transitions (no `Animated.timing` — use Reanimated)". The confetti is not the tutorial, but the doctrine of "no Animated.timing in new UI" is repo-wide per the brief's anti-pattern list. The inline comment justifies the choice ("each particle only needs simple opacity + translateY + rotate; building it on Reanimated would not buy us anything"), but the choice still violates the literal brief guidance, and 18 simultaneous JS-side Animated.timing instances do produce noticeable jank on mid-range Android devices.
- Suggested fix: rewrite the confetti loop with `useSharedValue` + `withSequence(withTiming, withDelay, withTiming)`. The fade-in `Animated.timing(fade, ...)` is fine to leave or convert at the author's discretion.

### P2-3: Push notification kind is documented but never imported / asserted by a registry test
- File: `src/notifications/ai-budget-push.ts:33-39`
- 50-Failures category: #44 "Documentation as Implementation"
- Code: the file exports `AI_BUDGET_95_WARNING_KIND` and `AI_BUDGET_PUSH_TARGET_SCREEN` constants but nothing imports them. The existing `pushNotifications.ts` pipeline routes by `data.actionScreen` generically, so the kind is "registered" only by virtue of the backend stamping it on the payload — there is no mobile-side guarantee that a future refactor of the screen name doesn't silently break the deep-link route.
- Suggested fix: add a one-line registry import where `pushNotifications.ts` builds its known-screens whitelist (if one exists) OR add a unit test that asserts `AI_BUDGET_PUSH_TARGET_SCREEN === 'CreditPackCheckout'` and that the navigator registers a `CreditPackCheckout` route. (The latter test is trivial — read `CoachNavigator.tsx` and assert the string is present.)

### P2-4: `AIBudgetHardPauseModal` is dismissible without a re-trigger gate on the same period
- Files:
  - `src/components/coach/ai-budget/AIBudgetHardPauseModal.tsx:45-69`
  - `src/components/coach/ai-budget/AIBudgetMount.tsx:86-90, 136-146`
- 50-Failures category: #2 "Skin-deep solution"
- Code (`AIBudgetMount.tsx:86-90`):
    ```ts
    const [hardPauseDismissed, setHardPauseDismissed] = useState(false);
    useEffect(() => {
      // Reset dismissal when the period rolls over (period_start changes).
      setHardPauseDismissed(false);
    }, [budget?.period_start]);
    ```
- Issue: Spec §4 row 100% reads "**Hard pause modal (blocks AI features)** — 'AI paused. Top up to continue.'" The modal is dismissible (close X), and once dismissed in the current process tick it never re-renders until `period_start` changes (a month). The brief's deliverable #6 reads "Blocks AI features. CTA = pack tiers" — the modal copy is correct but the actual block-AI-features enforcement is deferred to "the AI feature surfaces" per the modal's own header comment (lines 11-13). That deferred enforcement is not in this PR. As implemented, a coach can hit the modal once, tap X, and continue to invoke AI features that still call into the backend (the backend will 402, but the mobile produces no friendly surface).
- Suggested fix: this is a half-implemented invariant. Either (a) tighten this PR by adding a Zustand/Context "paused" flag the AI feature surfaces read, or (b) explicitly carve the AI-feature-block work out as a follow-up issue (and reference it in the PR description). The current state is the half-finished implementation 50 Failures #2 calls out.

---

## P3 findings (advisory)

### P3-1: Tutorial advance fires two haptics per tap (HapticPressable medium + manual Haptics.impactAsync medium)
- File: `src/components/coach/ai-budget/AIBudgetTutorialModal.tsx:137-151`
- Issue: `HapticPressable intent="medium"` already fires a medium haptic on press. The `advance()` callback then calls `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` again. The double-tap feel may be intentional (signature feel for a forced walkthrough) but no design doc cites it as such.
- Suggested fix: drop the manual `Haptics.impactAsync` from `advance` (the `HapticPressable` already covers it) OR drop the `intent="medium"` from the Continue button. Verify against the Mobile Design Intelligence doctrine if the double-pulse is desired.

### P3-2: `formatPeriodEnd` swallows errors silently
- Files:
  - `src/components/coach/ai-budget/AIBudgetBanner.tsx:68-77`
  - `src/components/coach/ai-budget/AIBudgetHardPauseModal.tsx:94-103`
- Issue: A malformed `period_end` ISO string falls through to `''` (banner) or `'the 1st'` (hard pause). The banner's subtitle then reads "$X left until period ends on " with a trailing blank. Not a P1 because the backend pins ISO strings, but the divergence between the two screens' fallback text is a minor consistency issue.
- Suggested fix: extract a single `formatPeriodEnd` to `src/api/types/coachAIBudget.ts` and use it from both surfaces.

---

## Spec Compliance Checklist

### STREAM_1_AI_CREDITS_SPEC.md §4 — UI Thresholds

| Threshold | Spec surface | Implemented? | File | Notes |
|---|---|---|---|---|
| 0–59% | Hidden | ✅ | `coachAIBudget.ts:71-77`, `AIBudgetMount.tsx:105-107` | `surfaceFor` returns `'hidden'`. |
| 60–79% | Subtle chip — "AI Usage: $X / $125" | ✅ | `AIBudgetMeter.tsx:36-72`, `surfaceFor` test row | Chip rendered with `formatCents(used)/formatCents(total)`. |
| 80–94% | **BLOCKING** forced 4-card walkthrough | ✅ | `AIBudgetTutorialModal.tsx:178-253` | `onRequestClose={()=>{}}` is a no-op; no X / no tap-outside; tests cover the no-dismiss invariant. AsyncStorage key includes `period_start` (rollover-safe). |
| 95–99% | Persistent banner + 1× push | ✅ banner / ⚠️ push | `AIBudgetBanner.tsx`; `ai-budget-push.ts` | Banner correct; push side is "documented constants" only — see P2-3. The existing generic pipeline (`data.actionScreen`) suffices in practice. |
| 100%+ | Hard pause modal | ⚠️ | `AIBudgetHardPauseModal.tsx`, `AIBudgetMount.tsx:136-146` | Modal renders correctly but is dismissible and "block AI features" enforcement is deferred to other surfaces — see P2-4. |

### BUILDER_BRIEF_MOBILE.md Deliverables 1-8

| # | Deliverable | Status | File(s) |
|---|---|---|---|
| 1 | `useAIBudget()` TanStack hook, 60s refetch, consumes §5 DTO | ⚠️ | `src/hooks/useAIBudget.ts` — see P1-2 (no focus gating). |
| 2 | `<AIBudgetMeter />` Coach Home chip | ✅ | `src/components/coach/ai-budget/AIBudgetMeter.tsx`; mounted via `AIBudgetMount` in `CoachHomeScreen.tsx:240`. |
| 3 | `<AIBudgetTutorialModal />` BLOCKING 4-card | ✅ | `src/components/coach/ai-budget/AIBudgetTutorialModal.tsx` — fully blocking, haptic on transition, AsyncStorage key per period. |
| 4 | `<AIBudgetBanner />` 95% surface | ✅ | `src/components/coach/ai-budget/AIBudgetBanner.tsx`. |
| 5 | Push handler for `AI_BUDGET_95_WARNING` | ⚠️ | `src/notifications/ai-budget-push.ts` — constants + docs only; relies on existing generic pipeline. See P2-3. |
| 6 | `<AIBudgetHardPauseModal />` 100% surface | ⚠️ | `src/components/coach/ai-budget/AIBudgetHardPauseModal.tsx` — modal renders; "block AI features" deferred. See P2-4. |
| 7 | `CreditPackCheckoutScreen` Stripe webview + confetti | ❌ (functionally broken) | `src/screens/coach/CreditPackCheckoutScreen.tsx` — code structure is good (allow-listed origin, confetti only on success, no IAP) BUT the request/response shape does not match the backend DTO. See P0-1. |
| 8 | Tests for hook + tutorial blocking + 95 + 100 | ✅ | 36 / 36 passing across 6 suites; tutorial-blocking test verifies `onClose` is not called pre-card-4. |

---

## Mobile-Specific P0 Spot-Check Results
| # | Check | Result | Note |
|---|---|---|---|
| 1 | Tutorial actually BLOCKING (onRequestClose no-op, no X on cards 1–3, no tap-outside) | ✅ | `AIBudgetTutorialModal.tsx:185-187`; test `AIBudgetTutorialModal.test.tsx` asserts `onClose` not called pre-card-4. |
| 2 | NO IAP (StoreKit / RNIap / expo-iap) anywhere | ✅ | `grep -rin "react-native-iap\|RNIap\|StoreKit\|expo-iap\|InAppPurchase"` — zero hits. |
| 3 | AsyncStorage tutorial-seen key includes `period_start` (rolls over) | ✅ | `tutorialSeenKey()` returns `aiTutorialSeenAt:${periodStart}` — see `AIBudgetTutorialModal.tsx:60-66`. |
| 4 | Push kind `AI_BUDGET_95_WARNING` registered + dispatches | ⚠️ | Constants exported, generic `data.actionScreen` pipeline routes; no per-kind registry test. See P2-3. |
| 5 | Error boundaries around new screens | ✅ | `AIBudgetMount.tsx:119-148` wraps surfaces in `<ErrorBoundary>`. |
| 6 | `Intl.NumberFormat` for money | ✅ | `coachAIBudget.ts:86-103` — both whole-dollar and cents formatters use Intl. |
| 7 | Reanimated v3 for tutorial transitions | ✅ | `AIBudgetTutorialModal.tsx:45-50` uses `useSharedValue`, `useAnimatedStyle`, `withTiming` from `react-native-reanimated`. Confetti uses RN `Animated.timing` — see P2-2. |
| 8 | WebView CSP / origin allowlist | ⚠️ | JS-level `isOriginAllowed` enforces Stripe-only at mint time and `onShouldStartLoadWithRequest`. Outer `originWhitelist` is wildcard `https://*`. See P1-1. |
| 9 | Confetti only on actual success | ✅ | `CreditPackCheckoutScreen.tsx:151-166` — `handleSuccess` is invoked solely from the deep-link success branch (lines 176-180, 189-193); cancel routes to `handleCancel`. |
| 10 | No `console.log` in shipped code; structured error capture | ✅ | grep over `src/api/types/coachAIBudget.ts`, `src/api/coachAiBudgetApi.ts`, `src/hooks/useAIBudget.ts`, `src/components/coach/ai-budget/**`, `src/screens/coach/CreditPackCheckoutScreen.tsx`, `src/screens/coach/creditPackCheckoutHelpers.ts`, `src/notifications/ai-budget-push.ts` — zero hits. |
| 11 | Haptic medium on each tutorial card transition | ✅ | `AIBudgetTutorialModal.tsx:144` — `Haptics.impactAsync(Medium)` in `advance()`. Note: double-fires with HapticPressable; see P3-1. |
| 12 | Dark mode coverage | ✅ | Every new surface imports `useTheme()` from `ThemeProvider`. No hard-coded light-mode colors except modal backdrops (which are dark masks intentional in both themes). |
| 13 | Polling only when CoachHome mounted+focused | ⚠️ | `refetchIntervalInBackground: false` covers app-background. NOT navigation-focus. See P1-2. |
| 14 | DTO type matches spec §5 exactly | ✅ | `coachAIBudget.ts:24-48` mirrors §5 field-for-field including `value_multiplier: string` and `custom_pack_bounds_cents: { min, max }`. |

---

## Rule Compliance
- **R4 commit author**: ✅ `git log origin/main..HEAD --format="%an <%ae>" | sort -u` = `Dynasia G <dynasia@trygrowthproject.com>` only.
- **R4 no Co-Authored-By**: ✅ `git log origin/main..HEAD --grep="Co-Authored-By"` = empty.
- **R56 worktree isolation**: ✅ Builder worked in `mobile-ai-credits-build`, audit in `mobile-ai-credits-audit` — separate worktrees.
- **R14 latest plumbing**: ✅ `@tanstack/react-query ^5.100.1`, `react-native-reanimated 4.3.1`, `react-native-webview ^13.16.1`, `expo-haptics ~56.0.3` — all current stable.

---

## Notes for Fixer (if dirty)

The PR is structurally clean and visually faithful to the spec. There is exactly one wire-contract defect that breaks every checkout path; fixing it is small.

**Priority queue:**

1. **P0-1 — Fix the wire contract for `POST /coach/ai/credit-packs/checkout`.**
   - In `src/api/coachAiBudgetApi.ts`:
     - Add `tier: 'small' | 'medium' | 'large' | 'custom'` to `CreateCheckoutInput`. Keep `amount_cents` as the optional secondary field (required only when tier === 'custom').
     - Rename `CreateCheckoutResponse.url` → `checkout_url`, `session_id` → `checkout_session_id`. Add `amount_cents: number` to the response.
   - In `src/screens/coach/CreditPackCheckoutScreen.tsx`:
     - Map cents → tier at `mintCheckout`: `1000 → 'small'`, `2500 → 'medium'`, `9900 → 'large'`, else `'custom'` with the cents in `amount_cents`.
     - Read `data.checkout_url` / `data.checkout_session_id` instead of `data.url` / `data.session_id`.
   - Add a contract test in `src/screens/coach/__tests__/CreditPackCheckoutScreen.test.ts` (or a new contract-test file) that asserts the body shape sent for each tier matches the backend `class-validator` constraints (`tier ∈ {small,medium,large,custom}`).

2. **P1-1 — Lock the WebView outer origin gate**: replace `originWhitelist={['https://*']}` with the `CHECKOUT_ALLOWED_HOSTS`-derived list in `CreditPackCheckoutScreen.tsx`.

3. **P1-2 — Gate `useAIBudget` polling on screen focus**: import `useIsFocused` in `AIBudgetMount` and AND it into the hook's `enabled` flag.

4. **P2-1 through P2-4, P3-1 / P3-2** — apply in order or carve into a follow-up issue; none block merge if items 1-3 land.

The Fixer should NOT touch the tutorial blocking logic, the AsyncStorage key, the WebView allow-list constants, or any DTO field on the backend — those are correct as-is. Stay in `src/api/coachAiBudgetApi.ts`, `src/screens/coach/CreditPackCheckoutScreen.tsx`, and `src/components/coach/ai-budget/AIBudgetMount.tsx`.

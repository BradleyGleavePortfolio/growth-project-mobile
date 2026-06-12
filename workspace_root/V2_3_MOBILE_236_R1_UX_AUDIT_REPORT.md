# v2-3 mobile #236 R1 UX audit

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: `#236`  
HEAD audited: `a79880745e7e2e33d933c4a09701f7b3559488b8`  
Worktree: `/home/user/workspace/tgp/audit-v2-3-mobile-r1-ux`

## VERDICT: NOT CLEAN

No P0 findings found. The feature flag defaults OFF and is declared in `.env.example`, and no added-line quiet-luxury scan found actionable raw hex, pictograph emoji, banned empty-state copy, `fontWeight > 600`, or added `Colors.*` usage in the event slice. However, the PR is NOT CLEAN due to accessibility/tap-target regressions on the audited event surfaces.

## Findings

### P0

None.

### P1 — Multiple added event controls are below the required 48dp tap target

The audit brief requires interactive targets to be `>= 48dp`. Several added event controls are styled at `minHeight: 44`, which is below the requirement:

- `src/screens/community/CommunityEventDetailScreen.tsx:623-630` — `styles.rsvpQuiet` sets `minHeight: 44` for secondary RSVP controls (`Maybe`, `Can’t make it`, `Withdraw`, etc.).
- `src/screens/community/CommunityEventDetailScreen.tsx:668-670` — `styles.retry` sets `minHeight: 44` for the event-detail error retry button.
- `src/screens/community/CoachCommunityEventsScreen.tsx:1026-1030` — `styles.reflectTrigger` sets `minHeight: 44` for the coach reflect/close control.
- `src/screens/community/CoachCommunityEventsScreen.tsx:1042-1045` — `styles.modalButton` sets `minHeight: 44` for modal actions, including create cancel/submit, manage close, and reflect confirmation controls.

Why this matters: these are primary mobile interaction points in RSVP, error recovery, and coach event management. Shipping sub-48dp targets violates the explicit mobile UX invariant and weakens accessibility.

### P1 — Loading states lack accessible labels

The brief requires loading states to have an a11y label. The event loading spinners render only `ActivityIndicator` color/testID, without `accessibilityLabel`, `accessibilityRole`, or busy state:

- `src/screens/community/CommunityEventDetailScreen.tsx:116-119` — event detail loading spinner has no accessible label.
- `src/screens/community/CoachCommunityEventsScreen.tsx:222-225` — coach events loading spinner has no accessible label.

Why this matters: screen-reader users can land on an apparently silent loading screen, which fails the stated loading-state requirement.

### P1 — Coach event list is missing required list/listitem semantics

The brief requires lists to declare `accessibilityRole="list"` and items to declare `accessibilityRole="listitem"`.

- `src/screens/community/CoachCommunityEventsScreen.tsx:272-283` — the `FlatList` renders event rows and refresh control, but has no `accessibilityRole="list"`.
- `src/components/community/EventCard.tsx:115-120` — each row’s root is a `HapticPressable` with `accessibilityRole="button"`, but no `listitem` semantics are provided by the card or a wrapper.

Why this matters: the event list visually behaves as a list, but assistive tech does not receive the list structure required by the audit brief.

### P2 — Event detail RSVP/link failure messages are visible but not announced

The brief requires state changes to be announced. RSVP success uses `CompletionToast`, but event-detail inline failures are plain `Text` nodes without `accessibilityLiveRegion` or an `AccessibilityInfo.announceForAccessibility` call:

- `src/screens/community/CommunityEventDetailScreen.tsx:97-100` — RSVP mutation failure sets `rsvpError` after rollback/conflict handling.
- `src/screens/community/CommunityEventDetailScreen.tsx:314-320` — `rsvpError` renders as plain inline text with no live region.
- `src/screens/community/CommunityEventDetailScreen.tsx:82-88` — unsafe/open-failed external link attempts set `linkError`.
- `src/screens/community/CommunityEventDetailScreen.tsx:295-301` — `linkError` renders as plain inline text with no live region.

Why this matters: a sighted user sees the error, but a screen-reader user may not be told the RSVP failed or the link could not open.

### P2 — Coach events error copy points to a gesture that is not available in the error branch

The coach events error message says “Pull to retry,” but the error branch renders `CoachErrorState` rather than the `FlatList` with `RefreshControl`:

- `src/screens/community/CoachCommunityEventsScreen.tsx:235-241` — error branch renders `CoachErrorState` with message `Could not load your events. Pull to retry.` and a retry handler.
- `src/screens/community/CoachCommunityEventsScreen.tsx:272-283` — pull-to-refresh exists only inside the non-error `FlatList` branch.

Why this matters: error copy should give the available next action. Here the available action is the retry button, not pull-to-refresh, so the message is misleading despite being calm.

## Clean checks / notes

- Feature flag posture is correct: `src/config/featureFlags.ts:158-159` sets `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` with fallback `false`, and `.env.example:102-103` documents it as default OFF.
- FACE+VOICE: event-specific empty states are intentionally neutral/non-Roman in `src/screens/community/CoachCommunityEventsScreen.tsx:23-32`; the coach error state that uses Roman voice also renders `RomanAvatar` in `src/components/community/coach/CoachErrorState.tsx:45-49`.
- Empty/error copy scan found no actionable “Coming soon,” “We’re working on it,” “Oops,” “Sorry,” sonnet/florid copy, or pictograph emoji in the added event-surface code.
- Focused test/typecheck commands could not run in this isolated worktree because local dependencies are not installed (`jest: not found`, `tsc: not found`). No code modifications were made.

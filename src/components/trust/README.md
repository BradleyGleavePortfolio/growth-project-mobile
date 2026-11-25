# AI Gateway — Mobile Readiness

---

## Screens and state machines

| Screen / Component | File | State machine |
|---|---|---|
| `AIGatewayDisabledState` | `src/components/trust/AIGatewayDisabledState.tsx` | Stateless. Renders `disabled` or `error` response shape. Never renders a result-shaped treatment. |
| `AISourceBadge` | `src/components/trust/AISourceBadge.tsx` | Stateless. Renders provider/model/grounded-at/approval actor from an `ok` response. Returns `null` when `showSourceBadge` flag is off. |

---

## Types

| Type | File | Notes |
|---|---|---|
| `AIGatewayCapability` | `src/types/aiGateway.ts` | Enum of 4 mobile-visible capabilities |
| `AIGatewayDraftResponse` | `src/types/aiGateway.ts` | Discriminated union: `ok` | `disabled` | `error` |
| `AIGatewayStatusResponse` | `src/types/aiGateway.ts` | Per-capability enabled/reason map |
| `AIGatewayFlags` | `src/config/aiGatewayFlags.ts` | Shape of the client-side flag object |

---

## Environment variables

| Variable | Default (prod) | Default (dev) | Meaning |
|---|---|---|---|
| `EXPO_PUBLIC_FF_AI_GATEWAY` | `false` | `true` | Master gate. When off, no AI Gateway requests are made. |
| `EXPO_PUBLIC_FF_AI_COACH_BRIEF_DRAFT` | `false` | `false` | Enable `coach_brief_draft` capability. |
| `EXPO_PUBLIC_FF_AI_CLIENT_PATH_SUMMARY` | `false` | `false` | Enable `client_path_summary` capability. |
| `EXPO_PUBLIC_FF_AI_CHECK_IN_SUMMARY` | `false` | `false` | Enable `check_in_summary` capability. |
| `EXPO_PUBLIC_FF_AI_FOOD_LOG_EXPLAIN` | `false` | `false` | Enable `food_log_explain` capability. |
| `EXPO_PUBLIC_FF_AI_SOURCE_BADGE` | `true` | `true` | Show audit/source attribution chip on AI-drafted content. |

All variables are `EXPO_PUBLIC_FF_*` — they are baked into the JS bundle at build time by Expo. Changing them requires a new build.

---

## Security posture

- **Approval lifecycle enforced.** `AISourceBadge` refuses to render an approver when `approval.actor === null`. A coach/admin must sign off server-side before the badge shows an approved state.

---

## Test coverage

| File | What it asserts |
|---|---|
| `src/__tests__/aiGatewayDtos.test.ts` | DTO discriminated union, type guards for all `disabled` and `error` reasons, approval.actor null contract |
| `src/config/__tests__/aiGatewayFlags.test.ts` | Both master and capability flag required; fail-closed defaults |
| `src/components/trust/__tests__/aiGatewayDisabledState.copy.test.ts` | Copy doctrine: forbidden autonomy phrases absent, every error reason offers a path forward |
| `src/components/trust/__tests__/aiGatewayDisabledState.render.test.tsx` | RTL render: disabled title, kill_switch title, retry button present/absent, correlation ID render, accessibilityRole and accessibilityLabel |

---

## Future work

- **Approval UI.** The `approval.actor` field is set server-side by coach/admin sign-off. The mobile-side approval flow (where a coach taps "approve" on a draft) is not yet built.
- **`AINote` integration.** PR #100 ships `AINote` (disclaimer wrapper). When the two PRs merge, `AIGatewayDisabledState` and `AISourceBadge` should be co-located with `AINote` under a unified trust component surface.

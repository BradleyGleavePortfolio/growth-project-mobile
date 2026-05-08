# AI Gateway — Mobile Readiness

This module provides the mobile-side infrastructure for the AI Gateway: a typed HTTP client, request/response data contracts, feature-flag gating, a fail-closed disabled-state component, and an audit/source attribution badge.

The app never holds a provider key and never calls a provider SDK directly. All AI traffic goes through the backend gateway. The module defaults to fail-closed in production (every flag off, no network calls) and flips on per-capability via `EXPO_PUBLIC_FF_AI_*` environment variables set at build time.

---

## Screens and state machines

| Screen / Component | File | State machine |
|---|---|---|
| `AIGatewayDisabledState` | `src/components/trust/AIGatewayDisabledState.tsx` | Stateless. Renders `disabled` or `error` response shape. Never renders a result-shaped treatment. |
| `AISourceBadge` | `src/components/trust/AISourceBadge.tsx` | Stateless. Renders provider/model/grounded-at/approval actor from an `ok` response. Returns `null` when `showSourceBadge` flag is off. |

---

## Endpoints called

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| `POST` | `/ai/gateway/drafts` | JWT (user role gated server-side) | `AIGatewayDraftRequest` | `AIGatewayDraftResponse` (discriminated union) |
| `GET` | `/ai/gateway/status` | JWT | none | `AIGatewayStatusResponse` |

**Important:** Neither endpoint is deployed on the backend yet. The client short-circuits to `disabled.feature_flag_off` for all calls when the master flag `EXPO_PUBLIC_FF_AI_GATEWAY` is off (the production default). No live backend call is made until an operator flips the flag in a build.

---

## Types

| Type | File | Notes |
|---|---|---|
| `AIGatewayCapability` | `src/types/aiGateway.ts` | Enum of 4 mobile-visible capabilities |
| `AIGatewayDraftRequest` | `src/types/aiGateway.ts` | Sent to `POST /ai/gateway/drafts` |
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

- **No provider keys on device.** `aiGatewayClient.ts` imports no provider SDK and holds no credentials. The backend gateway is the sole path to any model provider.
- **No PII assembled client-side.** The mobile app sends only capability name + opaque server-side IDs (`subjectRef`). The backend resolves these against the caller's auth context and assembles the prompt.
- **Token usage tracked server-side.** The client never trusts or reports token counts. Usage is metered and rate-limited on the backend.
- **Fail-closed by default.** Every flag is off in production unless explicitly set. The client returns `disabled.feature_flag_off` without touching the network when flags are off.
- **Approval lifecycle enforced.** `AISourceBadge` refuses to render an approver when `approval.actor === null`. A coach/admin must sign off server-side before the badge shows an approved state.

---

## Test coverage

| File | What it asserts |
|---|---|
| `src/__tests__/aiGatewayDtos.test.ts` | DTO discriminated union, type guards for all `disabled` and `error` reasons, approval.actor null contract |
| `src/config/__tests__/aiGatewayFlags.test.ts` | Both master and capability flag required; fail-closed defaults |
| `src/services/__tests__/aiGatewayClient.test.ts` | Flag-gate short-circuits (no network), HTTP 401/403/429/500/400/no-response mapping, idempotency key generation, `getStatus` synthesised response |
| `src/components/trust/__tests__/aiGatewayDisabledState.copy.test.ts` | Copy doctrine: forbidden autonomy phrases absent, every error reason offers a path forward |
| `src/components/trust/__tests__/aiGatewayDisabledState.render.test.tsx` | RTL render: disabled title, kill_switch title, retry button present/absent, correlation ID render, accessibilityRole and accessibilityLabel |

---

## Future work

- **Backend `POST /ai/gateway/drafts` and `GET /ai/gateway/status`** are not yet deployed. Until they are, all capabilities return `disabled.feature_flag_off`. When the backend ships, flip `EXPO_PUBLIC_FF_AI_GATEWAY=1` and the relevant per-capability flag in a build to test end-to-end.
- **Per-screen entry points.** This module ships the infrastructure (client, flags, disabled state, audit badge) but no screen surfaces that call it. Entry points should be added when a Brief phase defines where AI-drafted content should appear (e.g. coach brief screen, check-in summary).
- **Approval UI.** The `approval.actor` field is set server-side by coach/admin sign-off. The mobile-side approval flow (where a coach taps "approve" on a draft) is not yet built.
- **`AINote` integration.** PR #100 ships `AINote` (disclaimer wrapper). When the two PRs merge, `AIGatewayDisabledState` and `AISourceBadge` should be co-located with `AINote` under a unified trust component surface.

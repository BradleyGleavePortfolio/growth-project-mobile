# Stream 2 Mobile Audit — Round 2

**PR:** [#205 — Stream 2 mobile (coach AI draft invocation + pending-drafts inbox)](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/205)
**Branch under audit:** `agent/builder/ai-execution-mobile/e12ea641` (fixer pushed onto the existing PR branch — audit history is contiguous)
**Fixer R1 commit:** `0e9d963d` ("fix(ai-execution): align Stream 2 mobile to backend wire contract; mock OFF by default")
**Backend source-of-truth:** `growth-project-backend` main @ `b023853d` (Stream 2 backend PR #309 merged 2026-05-28).
**Auditor:** independent (R31)
**Worktree:** `/home/user/workspace/tgp/mobile-ai-execution-audit` (READ-ONLY for source)
**Date:** 2026-05-28T20:36Z

---

## SUMMARY

Verdict: **CLEAN**. Every R1 P0 and P2 finding has been remediated correctly. Wire contract now matches backend `b023853d` byte-for-byte across URLs, request DTOs, response envelope, and list/decide endpoints. Mock posture is opt-in and dev-only with a production guard that warns + falls through. Defence-in-depth role guards are in place on both the sheet and the inbox screen. Test-only mock helpers are gated behind `NODE_ENV === 'test'`. Doctrine clean. tsc, eslint, doctrine test, and Stream 2 API tests all pass locally.

The fixer deferred two of the three structured-payload capabilities (`assign_workout`, `assign_meal_plan`) to a follow-up rather than ship invoke buttons that fabricate UUIDs — that deferral is honest: the sheet has no code path that calls `invokeAssignWorkout` or `invokeAssignMealPlan`. `send_notification` ships end-to-end through the sheet today.

CI for PR #205 remains FAILURE on a pre-existing release-validate blocker unrelated to this branch (fixed separately by PR #206 which moves the release check to release branches). Local checks are the operative signal per the audit brief.

---

## P0 FINDINGS

None.

## P1 FINDINGS

None.

## P2 FINDINGS

None.

---

## CONTRACT CROSS-REF

### URL matrix

| Capability / action | Mobile (`coachAiExecutionApi.ts`) | Backend (controller / decorator) | Match |
|---|---|---|---|
| `draft.assign_workout` invoke | `POST /v1/coach/ai/draft/assign-workout` (L134) | `@Controller('v1/coach/ai/draft') @Post('assign-workout')` (L154, 179) | ✓ |
| `draft.assign_meal_plan` invoke | `POST /v1/coach/ai/draft/assign-meal-plan` (L135) | `@Post('assign-meal-plan')` (L211) | ✓ |
| `draft.send_notification` invoke | `POST /v1/coach/ai/draft/send-notification` (L136) | `@Post('send-notification')` (L248) | ✓ |
| List pending | `GET /ai/gateway/drafts?status=pending&clientId=&limit=` (L137, 242-244) | `@Controller('ai/gateway') @Get('drafts')` accepting `limit, clientId, status` query params (L41, 116-132) | ✓ |
| Approve / reject | `PATCH /ai/gateway/drafts/:id` body `{decision, note?}` (L138-139, 274-278, 296-300) | `@Patch('drafts/:id')` body `{decision: 'approved'|'rejected', note?}` (L134-151) | ✓ |

Mobile axios `API_BASE` includes the `/api` global prefix from `EXPO_PUBLIC_API_URL` (see `.env.example:22` + backend `main.ts:169 setGlobalPrefix('api')`). All paths are sent as bare `/v1/...` and `/ai/...` from mobile, which is consistent with every sibling api/ module (`coachAi.ts`, `coachAiBudgetApi.ts`, etc.). No `/api` prefix duplication, no missing prefix.

### Request DTO matrix (camelCase on the wire — backend class-validator preserves JSON keys as-is)

| Field | Mobile type | Backend class-validator | Match |
|---|---|---|---|
| **AssignWorkoutInvokeRequest** | `coachAiExecution.ts:101-107` | `DraftAssignWorkoutDto` (`controller.ts:42-64`) | |
| `workoutPlanId` | `string` (UUID) | `@IsUUID()` | ✓ |
| `clientId` | `string` (UUID) | `@IsUUID()` | ✓ |
| `scheduledFor` | `string` (ISO 8601 datetime) | `@IsString @MinLength(8) @MaxLength(64)` | ✓ |
| `prompt` | `string` | `@IsString @MinLength(1) @MaxLength(4000)` | ✓ |
| `notificationBody?` | `string \| undefined` (≤160) | `@IsOptional @IsString @MaxLength(160)` | ✓ |
| **AssignMealPlanInvokeRequest** | `coachAiExecution.ts:109-116` | `DraftAssignMealPlanDto` (`controller.ts:66-94`) | |
| `dailyMealPlanId` | `string` (UUID) | `@IsUUID()` | ✓ |
| `clientId` | `string` (UUID) | `@IsUUID()` | ✓ |
| `startsOn` | `string` (YYYY-MM-DD) | `@IsString @Matches(/^\d{4}-\d{2}-\d{2}$/)` | ✓ |
| `endsOn?` | `string \| undefined` (YYYY-MM-DD) | `@IsOptional @IsString @Matches(...)` | ✓ |
| `prompt` | `string` | `@MaxLength(4000)` | ✓ |
| `notificationBody?` | `string \| undefined` (≤160) | `@MaxLength(160)` | ✓ |
| **SendNotificationInvokeRequest** | `coachAiExecution.ts:118-125` | `DraftSendNotificationDto` (`controller.ts:96-123`) | |
| `clientId` | `string` (UUID) | `@IsUUID()` | ✓ |
| `kind` | `string` (1-64) | `@MinLength(1) @MaxLength(64)` | ✓ |
| `body` | `string` (1-160) | `@MinLength(1) @MaxLength(160)` | ✓ |
| `prompt` | `string` | `@MaxLength(4000)` | ✓ |
| `deepLink?` | `string \| undefined` (≤512) | `@IsOptional @MaxLength(512)` | ✓ |
| `channel?` | `'push' \| 'inapp' \| undefined` | typed as union | ✓ |

### Response envelope matrix

| Field | Mobile (`InvokeDraftResponse`, L139-147) | Backend (`draftResponse()` in `controller.ts:279-295`) | Match |
|---|---|---|---|
| `request_id` | `string` | `result.requestId` mapped to `request_id` | ✓ |
| `audit_id` | `string` | `result.auditId` mapped to `audit_id` | ✓ |
| `approval.required` | `boolean` | `result.approvalRequired` | ✓ |
| `approval.status` | union including 'pending', 'approved', etc. | `result.approvalStatus` (`'not_required'\|'pending'\|'approved'\|'rejected'\|'expired'` per `AiGatewayResult`) | ✓ |
| `approval.draft_id` | `string \| null` | `result.approvalDraftId` (`string \| null`) | ✓ |

### List + decide row shape

`AiActionDraftRow` (mobile, L154-168) mirrors the Prisma `AiActionDraft` row returned by `findMany`/`findUnique` on the backend (snake_case schema columns: `tenant_coach_id`, `subject_user_id`, `requester_id`, `created_at`, `decided_at`, `decided_by_id`, `decision_note`, `materialised_ref`, `payload`). The shape is consumed correctly by the inbox card renderer + the `previewFor` helper.

`DecideRequest` (mobile, L174-177): `{decision: 'approved'|'rejected', note?: string}`. Backend `decide()` body is `{decision, note?}` (`ai-gateway.controller.ts:140`). ✓.

`DecideResponse = AiActionDraftRow` — backend `AiApprovalService.decide` returns the updated `AiActionDraft` row (L301). ✓.

No drift.

---

## LOCAL CHECK RESULTS

| Check | Command | Result | Notes |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✓ (exit 0, no output) | Full repo. |
| Lint (Stream 2 surface) | `npx eslint src/api/coachAiExecutionApi.ts src/api/types/coachAiExecution.ts src/hooks/usePendingAiDrafts.ts src/components/coach/ai-execution src/screens/coach/PendingAiDraftsScreen.tsx src/api/__tests__/coachAiExecutionApi.test.ts` | ✓ (exit 0) | 0 errors, 0 warnings. |
| Doctrine static scan | `grep -rnE "confetti\|FirstWinCelebration\|TrophyArtifact\|TrophyShareScreen\|🎉\|🚀\|🔥\|✨\|⭐\|🏆\|🎊" <PR files>` | ✓ (exit 1, zero matches) | Doctrine-clean. |
| Doctrine jest | `npx jest src/__tests__/quietLuxuryDoctrine.test.ts --runInBand` | ✓ | 10/10 pass (incl. `does not contain TODO / FIXME / XXX comments` — fixer correctly avoided that footgun by rewording the deferral note). |
| Stream 2 API tests | `npx jest src/api/__tests__/coachAiExecutionApi.test.ts --runInBand` | ✓ | 19/19 pass. Coverage includes the new mock OFF-by-default posture, `isStream2Capability` filter, list/approve/reject round-trip with snake_case fields, clientId filter, note round-trip on reject, empty-string preview for unknown capabilities. |
| Combined doctrine + API | `npx jest src/__tests__/quietLuxuryDoctrine.test.ts src/api/__tests__/coachAiExecutionApi.test.ts --runInBand` | ✓ | 29/29 pass, 3.27 s. |

CI on PR #205 remains FAILURE on `Validate release readiness (placeholders, store URLs, version)` — that step pre-existed on `origin/main` (verified in R1) and is being fixed by parallel PR #206. Local checks above are the operative CLEAN signal per the audit brief.

---

## R4 AUTHOR

```
$ git log --format='%an <%ae>' origin/main..HEAD | sort -u
Dynasia G <dynasia@trygrowthproject.com>
```

All 4 commits (`f730072c`, `a9e7fc95`, `768c0623`, `0e9d963d`) authored by `Dynasia G`. No Co-Authored-By trailers, no Generated-with trailers. ✓.

---

## DOCTRINE

Static scan: zero hits across all Stream 2 mobile files for `confetti`, `FirstWinCelebration`, `TrophyArtifact`, `TrophyShareScreen`, or any of the banned pictograph emoji (🎉 🚀 🔥 ✨ ⭐ 🏆 🎊).

`quietLuxuryDoctrine.test.ts`: 10/10 tests pass — including the trap-test from the fixer's first attempt (`does not contain TODO / FIXME / XXX comments`). The fixer initially included a `TODO(stream2-pickers)` marker, hit the test failure during local validation, and reworded the deferral note to "deferred to a follow-up" — visible in the commit's `AskAiActionSheet.tsx` body. Catching this before pushing matters; R32 self-mark-clean would have been the failure mode otherwise.

No emoji, no exclamation marks in user-visible copy, no springs (`grep -rnE "withSpring|Animated\.spring" src/components/coach/ai-execution src/screens/coach/PendingAiDraftsScreen.tsx` → zero hits; Modal uses default RN slide animation).

---

## DELIBERATE DEFERRAL HONESTY

The fixer's commit message claims:
> `draft.assign_workout` / `draft.assign_meal_plan` are deferred to a follow-up: the backend requires `workoutPlanId` / `dailyMealPlanId` UUIDs the coach must select from their library. The proper picker surface is the existing Workouts / Meal Plans tab. Refusing to ship a sheet that fabricates UUIDs (audit's explicit no-go).

Verification:

```
$ grep -n "invokeAssignWorkout\|invokeAssignMealPlan\|workoutPlanId\|dailyMealPlanId\|00000000" src/components/coach/ai-execution/AskAiActionSheet.tsx
6: * the full structured payload (workoutPlanId UUID + scheduledFor ISO,
7: * dailyMealPlanId UUID + startsOn YYYY-MM-DD, or kind + body for the
217:                  follow-up: the backend Zod schemas require workoutPlanId /
218:                  dailyMealPlanId UUIDs the coach must select from their
```

All four matches are inside doc/comment blocks. The sheet has **no code path** that calls `invokeAssignWorkout` or `invokeAssignMealPlan`. The pick-list UI shows a single option ("Draft a check-in nudge" → `draft.send_notification`) and a sober "follow-up" note row explaining why workout/meal-plan suggestions are not yet wired (`AskAiActionSheet.tsx:215-220`). No zero UUIDs, no string-coerced empty UUIDs, no placeholder substitution.

The `coachAiExecutionApi.invokeAssignWorkout` and `invokeAssignMealPlan` methods DO exist (they are still part of the typed API surface for the future picker integration), but they are unreachable from the UI today. That's correct shape — types remain available for the follow-up PR; runtime cannot reach them.

Deferral honest ✓.

---

## RECOMMENDED FOLLOW-UPS (P3 — not gating)

These are *not* blockers for CLEAN; they are observations for the operator's follow-up backlog.

- **P3-1**: `isMockMode()` is still exported but unused by any UI. The R1 audit's recommendation was to either render a dev banner or remove the export. The fixer left it in. Recommend remove on the next touch.
- **P3-2**: `previewFor()` + `truncate()` + `formatScheduledFor()` are pure helpers now living inside the types file. Sibling api/ modules tend to put helpers in a separate `*.helpers.ts` — cosmetic.
- **P3-3 (follow-up scope)**: ship the workout/meal-plan pickers in the next PR. The right surface is `src/screens/coach/workouts/*` (existing workout-plan picker) and `src/screens/coach/meal-plans/*` (existing meal-plan picker) — add an "Ask AI to schedule this" affordance from those screens that opens a date/window picker, then submits to `coachAiExecutionApi.invokeAssignWorkout` / `invokeAssignMealPlan`. The typed API + DTOs are already in place; only the UI is missing.
- **P3-4**: the `decide` route on the gateway is `PATCH /ai/gateway/drafts/:id` (not the `/coach/ai/...` namespace). That's correct — the backend gateway approval surface is intentionally shared across coach AI + execution flows. But mobile mixes the URL families (`/v1/coach/ai/draft/*` for invoke, `/ai/gateway/drafts/*` for list/decide). Document the rationale in the file header so future maintainers don't see the asymmetry as drift. Cosmetic.

---

## VERDICT

**CLEAN.** 0 P0, 0 P1, 0 P2. CLEAN bar met:
- Wire contract verified end-to-end against backend `b023853d`.
- Mock posture inverted; production guard wired; non-test exports inert.
- Defence-in-depth role guards on both UI surfaces.
- Doctrine static scan + jest both pass.
- tsc, eslint, Stream 2 API tests all green.
- R4 author clean.
- Deferral honesty verified — no fabricated UUIDs.

R32 reminder: the auditor does not merge. Operator may merge PR #205 once parallel PR #206 lands and CI on this branch re-runs green. If the operator wants belt-and-braces, they can also flip `EXPO_PUBLIC_AI_EXECUTION_MOCK=on` in a dev build to smoke-test the inbox + sheet against the mock store; flip it off + point at a real staging backend to smoke-test the live wire contract.

No fix brief required.

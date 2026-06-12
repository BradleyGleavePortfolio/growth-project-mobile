# v2-3 mobile #236 R1 — 50-Failures sweep notes

Scope: added/changed lines in PR #236 at `a79880745e7e2e33d933c4a09701f7b3559488b8`, worktree `/home/user/workspace/tgp/audit-v2-3-mobile-r1-code`. D-011 React-Query/Jest leak warning carved out as requested.

## Category 1 — Security
- #1 secrets: no new committed key/secret found; grep false-positives were `tokens` wording and `.env.example` placeholders.
- #2 RLS/tenant scope: mobile delegates to backend events contract; backend list/detail checked for workspace/cohort access. Mobile routes use authenticated `api` client.
- #3 SQL injection: no raw SQL in mobile diff.
- #4 XSS / unsafe URL: no `dangerouslySetInnerHTML`; external link opener calls `safeExternalEventUrl` and rejects non-https schemes before `Linking.openURL`.
- #5 IDOR: mobile does not trust client-side role for data scope; event IDs/workspace IDs are sent to authenticated backend routes. Backend route verification saved under `/home/user/workspace/v2_3_mobile_236_backend_contract/`.
- #8 runtime validation: response schemas are strict Zod; request validation remains backend-side DTOs.

## Category 2 — Architecture
- API, hooks, components, screens separated cleanly.
- No new package dependency or monolithic cross-layer data access added.
- Type unsafety: one `as unknown as` test cast in `src/hooks/__tests__/useReducedMotion.test.tsx:49` (non-blocking unless policy treats test casts as P2).

## Category 3 — Performance
- No DB queries in mobile loops.
- Backend list defaults to a page size, but mobile exposes `next_before` without load-more/cursor support. Filed as P2 in report because large event lists become truncated/inaccessible and the list cache does not key all request-shaping options.

## Category 4 — Concurrency / State
- RSVP and create mutations use React Query optimistic update + rollback.
- Finding: event list query key excludes `limit` even though `limit` is forwarded to the API, so different page-size callers collide in cache.
- Conflict errors are mapped to calm copy and refetch in screen paths.

## Category 5 — Error handling / Observability
- Production mutation failures surface user-visible errors.
- Finding: added tests contain `.catch(() => undefined)` swallowed rejections, matching Bradley Law / Failure #36 text.
- D-011 Jest open-handle warning observed after full pass is carved out.

## Category 6 — Code quality
- No dead added imports after lint (warnings only across repo).
- No duplicated business logic above merge-bar level found in added production code.

## Category 7 — Data integrity
- Mobile sends idempotency keys for create/update/rsvp/replay/reflect mutations.
- No local destructive data writes; reflect close has a confirm modal.
- Backend owns transactions/soft-delete constraints; no Prisma/schema/mobile SQL changes.

## Category 8 — Infra / Deployment
- `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` defaults OFF in `src/config/featureFlags.ts:159` and `.env.example:103`.
- Event routes are registered only behind `featureFlags.communityEvents` in both client and coach navigators.
- No schema/prisma/migration changes found.

## R0 / Hectacorn checks
- No raw hex color in production added code; one false positive in a comment referencing backend SHA.
- No pictograph emoji added in the v2-3 event surface.
- FACE+VOICE: no Roman-voiced event empty state is rendered without RomanAvatar; event empty states are explicitly neutral.
- Finding: several new interactive controls use 44dp minHeight, below the brief's 48dp tap-target floor.

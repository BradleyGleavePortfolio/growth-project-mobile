# AUDITOR BRIEF — v2-4 Mobile #239 R1 CODE AUDIT

You are an independent CODE AUDITOR. You did NOT write this code. Be adversarial and precise. Cite every finding with `file:line`. Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` and `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md` before starting. Also read `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md` and `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md` and `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`.

## PR under audit
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #239 — `feature/community-v2-ai-triage-mobile`
- HEAD: `97954d253eb5517948d66421bebbc285f7c93604`
- CI status: 1/1 GREEN (Typecheck/lint/test passed 2026-06-12T02:27:26Z)
- Pairs with backend PR #391 (NOT yet merged — be alert to contract drift between mobile Zod and backend schemas).

## Files touched (1091 added, 0 deleted, 8 files)
- `src/api/__tests__/communityAiTriageApi.test.ts` (191)
- `src/api/communityAiTriageApi.ts` (110)
- `src/components/community/AiTriageCard.tsx` (316)
- `src/components/community/__tests__/AiTriageCard.test.tsx` (204)
- `src/config/featureFlags.ts` (16)
- `src/hooks/useInboxTriage.ts` (36)
- `src/screens/community/CoachCommunityInboxScreen.tsx` (45)
- `src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx` (173)

## Worktree setup
```bash
mkdir -p /home/user/workspace/tgp/audit-v2-4-mobile-code
cd /home/user/workspace/tgp/audit-v2-4-mobile-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/239/head:pr-239
git checkout pr-239
git log -1 --format='%H %s'  # MUST equal 97954d253eb5517948d66421bebbc285f7c93604
```
All clones use `https://github.com/...` (NOT the agent proxy). Use `api_credentials=["github"]` on every `gh` and `git` call.

## Severity scale (the merge bar)
- **P0** — broken/incorrect behavior, data loss, security hole, money bug, crash, calls a route/field that doesn't exist, idempotency violation that double-charges or double-acts.
- **P1** — significant correctness/robustness gap: unhandled error path, race, missing transaction, N+1 on a hot path, swallowed error, missing validation, broken on replay.
- **P2** — meaningful quality issue: wrong-but-not-fatal behavior, missing test for critical branch, misleading UX state, type unsafety, leak, inconsistent with repo conventions.
- **P3** — nits/style/polish (does NOT block merge).

**MERGE BAR: CLEAN of P0+P1+P2.** Report P3 separately.

## 50-Failures sweep — ALL EIGHT CATEGORIES are mandatory
Per `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, sweep all 8 categories on added lines:
1. **Foundation** (#1 schema/migrations, #2 RLS, #3 indexes/Ns+1, #4 secrets, #5 IDOR/authz)
2. **Data integrity** (#6 nullability/defaults, #7 enums, #8 validation, #9 timezone, #10 currency/decimals)
3. **API contract** (#11 versioning, #12 idempotency, #13 pagination, #14 error envelope, #15 OpenAPI drift)
4. **Concurrency** (#16 races, #17 transactions, #18 deadlocks, #19 retry+backoff, #20 dedupe)
5. **Frontend correctness** (#21 stale closures, #22 effects, #23 cleanup, #24 keys/lists, #25 a11y, #26 mobile gestures, #27 i18n, #28 race conditions, #29 abort signals, #30 optimistic-rollback)
6. **Performance/observability** (#31 cache invalidation, #32 logs/PII, #33 traces, #34 bundle, #35 image opt)
7. **Security/compliance** (#36 swallowed errors = Bradley Law, #37 SSRF, #38 XSS, #39 CSRF, #40 secrets in client)
8. **Testing/CI** (#41 missing tests, #42 flake, #43 coverage on critical branch, #44 transaction tests, #45 soft-delete tests, #46 fixture drift, #47 mocks-of-mocks, #48 E2E gaps, #49 contract tests, #50 release readiness)

## R0 grep battery (run inside the worktree on added lines only)
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' | grep -nE 'as any|as unknown as|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|catch *\(([^)]*)\) *=> *(undefined|null)|\.catch\(\(\) *=> *(undefined|null)\)' || echo "GREP CLEAN"
```
Any non-empty match → **P0 or P1**. Pictograph emoji (🤖 ⚡ 🎯 etc.) on added lines is **P0**. Raw hex outside design tokens is **P1**.

## FACE+VOICE invariant (Roman copy locator)
This PR does NOT introduce Roman copy — but verify by grepping added lines for any Roman-attributed string (greetings, "Hey Coach", AI-attributed copy). If found AND no `<RomanAvatar/>` sibling in the same component tree → **P0**. (Likely none here; this is the AI-triage card, which is system-voice, not Roman-voice. Confirm in audit.)

## Bradley Law (Failure #36)
`grep -nE 'catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)|catch *\(([^)]*)\) *\{ *console' src/**/*.ts src/**/*.tsx`
ZERO tolerance. Any swallow on added lines → **P0**.

## Contract verification (anti-fabrication)
The PR body lists explicit backend file:line citations for the Zod contract. VERIFY each citation against the actual backend repo:

```bash
# In a separate sibling clone:
mkdir -p /home/user/workspace/tgp/audit-v2-4-mobile-code/backend-verify
cd /home/user/workspace/tgp/audit-v2-4-mobile-code/backend-verify
git clone https://github.com/BradleyGleavePortfolio/growth-project-backend.git .
git fetch origin pull/391/head:pr-391
git checkout pr-391
```

For EACH claim in PR body, verify with file:line match:
- `triage-output.schema.ts:26-32` — `TRIAGE_CATEGORIES` exists, exactly five categories `urgent|win_to_celebrate|form_check|general|no_action_needed`
- `triage-output.schema.ts:40` — `TRIAGE_SOURCE_KINDS` = `['message','post']`
- `triage-output.schema.ts:48-55` — `TriageItemSchema` `.strict()`: `source_item_id` uuid, `source_kind`, `category`, `summary` 1..280
- `triage-output.schema.ts:61-66` — `TriageBucketSchema` `.strict()`: `category` + `items`
- `triage-output.schema.ts:85-92` — `TriageResponseSchema` `.strict()`: `generated_at` datetime, `is_empty`, `buckets` length 5, `source_item_ids` uuid[]
- `ai-triage.controller.ts:43-64` — `GET /community/ai-triage` exists with coach/owner auth
- `triage-cache.service.ts:21` — `TRIAGE_CACHE_TTL_MS` = 5 minutes

ANY mismatch → **P0** (anti-fabrication failure).

## Mobile-specific R0 checks
- Feature flag default OFF on `featureFlags.ts` — verify reading `EXPO_PUBLIC_FF_COMMUNITY_AI_TRIAGE` defaults to `false`.
- `useInboxTriage.ts` — `retry: false` confirmed (per PR body); confirm `staleTime` = 5 minutes (matches backend cache TTL).
- `AiTriageCard.tsx` — verify a11y labels on every state (loading/error/empty/ready), 48dp header tap target, reduced-motion safe.
- `CoachCommunityInboxScreen.tsx` — verify the change is purely additive (flag-gated `ListHeaderComponent` insert) with NO breaking change to v2-2 ack badges.
- `coachCommunityInboxAiTriageFlagOff.test.tsx` — verify it asserts the triage hook is NOT called when flag OFF (network never reached).

## Run the tests yourself
```bash
cd /home/user/workspace/tgp/audit-v2-4-mobile-code
npm ci
npx tsc --noEmit
npm run lint
npx jest --runInBand src/api/__tests__/communityAiTriageApi.test.ts \
  src/components/community/__tests__/AiTriageCard.test.tsx \
  src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx
# Then full suite:
npx jest --runInBand
```
Report exact pass/fail counts.

## Output
Write the report to `/home/user/workspace/V2_4_MOBILE_239_R1_CODE_AUDIT_REPORT.md` in this format:
```
# AUDIT — Community v2-4 AI inbox triage (mobile, PR #239)
VERDICT: CLEAN | NOT CLEAN
Typecheck: pass/fail (what you ran)
Lint: pass/fail
Tests: pass/fail (counts)

## P0 findings
- [file:line] description + why P0 + concrete fix
## P1 findings
...
## P2 findings
...
## P3 (non-blocking)
...
## Verification of PR claims
- claim → verified true / FALSE because ...
## 50-Failures sweep result
- Category 1 (Foundation): N findings
- Category 2 (Data integrity): N findings
... (all 8 categories)
```

End with the literal line `VERDICT: CLEAN` or `VERDICT: NOT CLEAN`. Do NOT modify any code — audit only.

## Model & process
- Model: GPT-5.5 (FRESH context — you are NOT the builder).
- Sonnet 4.6 forbidden.
- You may use `bash` with `api_credentials=["github"]` for `gh` calls.
- Take as long as needed. Quality > speed.

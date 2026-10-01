# Consultation onboarding (consult-v1)

The full personal-training consultation a new client completes before their first day: Roman's welcome, a single "I agree" box straight after it, eight chapters of questions, the readiness screening, a summary, and the macro and plan reveals. It replaces the lean flow when `featureFlags.consultationOnboarding` is on.

## Rollout and rollback

| Flag | Env var | Default | Clinic build |
| --- | --- | --- | --- |
| `consultationOnboarding` | `EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING` | off in every general build (not `isDev`) | on, via the `clinic` profile in `eas.json` |

`RootNavigator` mounts `ConsultationOnboardingNavigator` for `authState === 'onboarding'` when the flag is on, and `LeanOnboardingNavigator` when it is off. Rollback is the flag; no code path changes for flag-off builds.

The lean flow's skip-to-finish path (LeanQ2 "Skip, I'll set this later" calling `finalizeLeanOnboarding`) is not reachable with the flag on. The consultation can only finish from the plan reveal, which is reached only after a successful `POST /me/onboarding/complete`.

## Architecture

| File | What it does |
| --- | --- |
| `src/lib/consultation/definitions.ts` | Every screen as data: `id`, `chapter`, `template`, copy, `options`, `validation`, `detail` (same-screen expansions) and `showWhen` conditions. Reordering or adding a question is a data change. |
| `src/lib/consultation/engine.ts` | Pure rules: condition evaluation, visible screens, validation, next/previous, chapter progress and save points, resume, the save payload (`answersForSave` drops answers of hidden screens and collapsed details), copy filling. |
| `src/lib/consultation/copy.ts` | Versioned P0 consent copy, P8 copy, deterministic summary sentences, macro and plan reveal copy helpers. |
| `src/lib/consultation/storage.ts` | Encrypted local resume draft per user (see Local draft). |
| `src/lib/consultation/resume.ts` | `reconcileResume(local, server)`: which copy wins on resume (see Resume). |
| `src/lib/consultation/consentVersion.ts` | `CONSULT_CONSENT_COPY_VERSION` and the server versions the P0 copy is bound to (`CONSENT_BINDING`). |
| `src/api/consultationApi.ts` | Typed DTOs and calls for the contract (see Endpoints). 409 bodies are mapped to a machine code. |
| `ConsultationFlow.tsx` | The flow state machine (question, summary, preparing, macro, plan, paused, problem). Takes an injectable `api` so every screen is testable with a mocked API. |
| `QuestionScreen.tsx` | Renders one screen from its definition. Templates: `intro` (T-A), `rows` (T-B), `chips` (T-C), `dob` / `measure` / `goalWeight` (T-D wheels), `yesno` (T-E), `consent` (P0), `message` (P8). |
| `RevealScreens.tsx` | Summary (T-F), preparing state, macro reveal and plan reveal (T-G), paused state, completion problem state. |
| `components.tsx` | `AnalyticsExcluded`, Frame (safe-area insets), chapter progress bar, rows, chips, wheels (VoiceOver `adjustable`), checkbox, buttons, Roman's line. |
| `src/navigation/ConsultationOnboardingNavigator.tsx` | Mounts the flow with the cached user; on finish stores `onboarding_complete` and `consultation_complete` and emits `authEvents` so `RootNavigator` re-bootstraps. |

## Screens

W1 welcome; P0 the single "I agree" box (before any question); G1 goal; G2 why it matters; B1 formula; B2 date of birth (16 to 100); B3 height and weight (unit tabs convert in place); B4 goal weight (optional, soft notes only); L1 activity; L2 sleep; T1 experience; T2 enjoyed; T3 injury check (yes expands areas and a note); T4 session length; S1 days per week; S2 preferred time; S3 where you train; S3b home equipment (only for "At home, with some equipment"); N1 to N5 nutrition; P1 to P7 screening (no consent box in this chapter) (yes reveals an optional note, never blocks); P8 message (only when any P answer is yes); C1 first session (tomorrow preselected); SUM; PREP; MACRO; PLAN.

## P0: one "I agree" box

One box covers the personal-training waiver and "The Growth Project, your coach and Roman can see your in-app logs and answers". The copy lists what Roman sees and states plainly that Roman is powered by Anthropic, a third-party AI provider, and that the information is sent to Anthropic to answer the client (App Store 5.1.2(i)). It also says Roman conversations are private from the coach, stored securely on The Growth Project's servers for 180 days, deletable by the client at any time, and opened by staff only for support, safety or debugging (owner ruling 2026-09-30 17:42). Continue stays disabled until the box is ticked. There is no separate AI-consent screen.

P0 comes straight after W1 (operator decision, fix round). Nothing is sent to the server before it is ticked and recorded:

1. Continue posts `POST /me/ai-consent/onboarding { ai_consent_version: 'client-ai-v2', waiver_version: 'pt-waiver-v1', copy_sha256, platform }` (backend #601). Only a 2xx records the agreement. A network error or 404 keeps the client on P0 with a short message; `409 CONSENT_VERSION_MISMATCH` clears the box and asks for an app update. Nothing is saved in either case.
2. The flow then stores `P0 = { agreed: true, copy_version: 'consult-consent-v1', agreed_at }` and sends it as the first `PUT /me/onboarding/consultation`, on its own (backend #607 is consent-first: answers sent before or bundled with the first agreement get `409 consent_missing` and are not stored). Every later save sends P0 alone first if the server does not hold it yet.
3. A stored P0 counts only when `copy_version` equals the displayed copy and `agreed_at` is a valid date (`isConsentAnswerCurrent`). Stale, malformed or revoked records (from `GET /me/ai-consent`) route back to P0 with the box unticked; the app never re-grants on the client's behalf. If the record cannot be read (offline) answers are kept on the device and no save goes up until it can.
4. `409 consent_missing` from a save, or from complete after a fresh re-check, routes back to P0. At Prepare the record is re-read first, so a revocation made in Settings wins.

Any change to `CONSENT_PARAGRAPHS` or `CONSENT_CHECKBOX_LABEL` bumps `CONSULT_CONSENT_COPY_VERSION` (and the backend's `CONSULT_CONSENT_COPY_VERSIONS`) and needs T4 review.

## Privacy

- **Analytics.** The whole flow (every question, P0, summary, reveals, paused and problem states) renders inside `AnalyticsExcluded` (`ph-no-capture`), and the frame, scroll view and footer carry the marker too, so PostHog touch autocapture never records labels, answers or screen ids. `consultationPrivacy.test.tsx` runs the SDK's own `autocaptureFromTouchEvent` on every element.
- **Local draft.** Stored in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), split into chunks of at most 600 characters under `consult_draft.<userId>.*`, with a manifest. Never in AsyncStorage; the old plaintext `consultation_v1:<userId>` key is deleted on first read. On web nothing is persisted. Drafts not touched for 30 days (`DRAFT_RETENTION_MS`) are deleted on read; corrupt drafts are deleted.
- **Purge.** `purgeConsultationDraft(userId)` runs on sign-out (`authActions.signOut`, which also clears the legacy prefix), on an account deletion request (Delete account and Trust Center), and when onboarding finishes. A per-user epoch fences late writes: a write from a screen opened before the purge is dropped.

## Saves and resume

- Saves are serialized and coalesced: one request in flight, the newest snapshot queued. Prepare drains the queue with the final snapshot and closes it before `complete`, so an older write can never land after the final one.
- A pending auto-advance is cancelled by any answer change, Back or Pause, and a screen whose answers do not validate is never left.
- On resume the local draft wins only when it holds unsynced edits and the server has not changed since this device last synced (revision, then `saved_at`), or the edits are newer than the server copy. Otherwise the server copy wins. Cross-device last-write-wins needs a conditional write on the backend (not available yet).

## P8: never blocks

Shown only after a yes on P1 to P7. Order: a calm opening, general habits (conversational effort, warm-up and rest, stop signs), what happens next with a safe next step (book a physician visit, then message the coach), then the physician line, the 911 / 988 routing, and the disclaimer. Continue is always enabled.

## Endpoints

| Call | When |
| --- | --- |
| `PUT /me/onboarding/consultation` `{ version: 'consult-v1', answers }` | First: P0 alone, right after the agreement. Then the end of every chapter, on Finish later / Pause, and before complete. Idempotent. A failed chapter save is non-blocking (kept locally); a failed final save shows the offline state and never calls complete. |
| `GET /me/onboarding` | On mount. A completed onboarding replays the macro reveal from `result`. 404 falls back to local state. |
| `POST /me/onboarding/complete` | "Prepare my plan". 200 drives the macro and plan reveals. 409 `consultation_incomplete` routes to the first missing answer, `consent_missing` re-reads the record, saves again and retries once (never re-grants), then routes to P0; `consent_version_mismatch` routes to P0; `not_attached`, `clinic_not_configured` and `completion_in_progress` show their own message. |
| `POST /me/ai-consent/onboarding` | P0 Continue (see above). |
| `GET /me/ai-consent` | On resume with a stored P0, and before complete. |

Answer values: single selects are option values; multi selects are arrays; `B2` is `YYYY-MM-DD`; `B3` is `{ height_cm, weight_lbs, unit }`; `B4` is lbs or null; `C1` is the first-session date `YYYY-MM-DD`; detail keys are `G2_other`, `T3_areas`, `T3_note`, `N2_other`, `P1_note` to `P7_note`.

Macros and the program come only from the server. Nothing on the device computes targets.

## Quiet Luxury and accessibility

- Tokens only (`theme/tokens`), weights 400 and 500, radius 4 or less (pills on chips only), forest accent, no confetti, no count-up, no emoji, no exclamation marks.
- Fades are 280ms decelerate, staggered 80ms; with Reduce Motion on they render at rest (`useReducedMotion`).
- Every control has an accessibility role, label and state. Wheels are `adjustable` with increment and decrement actions; the progress bar exposes "Chapter n of 8, name".
- Roman appears with his face through `RomanAvatar` (`crop="neutral"`), which resolves `romanFaceAsset` from `src/components/roman/romanAvatarAssets.ts`.

## Tests

```bash
npx jest src/lib/consultation src/screens/consultation --maxWorkers=1
```

- `src/lib/consultation/__tests__/consultationEngine.test.ts`: definitions, copy rules, conditions, validation, chapter progress, resume, save payload, summary.
- `src/screens/consultation/__tests__/ConsultationFlow.test.tsx`: W1 render, auto-advance and back, per-chapter save, the P0 gate and consent record, the P8 branch, complete happy path, 409 handling, offline save, replay, Finish later, accessibility labels.
- `src/lib/consultation/__tests__/consultationResume.test.ts`: resume reconciliation rules.
- `src/screens/consultation/__tests__/consultationPrivacy.test.tsx`: analytics exclusion, agreement before any upload and consent-first PUT, copy-version, revocation and 409 handling, encrypted draft, retention, sign-out purge and late-write fence.
- `src/screens/consultation/__tests__/consultationOrdering.test.tsx`: auto-advance timer, serialized saves, resume reconciliation in the flow, safe-area insets, identity fencing.
- `src/screens/consultation/__tests__/consultationTemplates.test.tsx`: wheels, unit tabs, soft notes, T3 expansion, summary Edit, API client routes and 409 mapping, the rollback flag.

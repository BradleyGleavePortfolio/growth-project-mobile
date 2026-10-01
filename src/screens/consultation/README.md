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
| `src/navigation/ConsultationOnboardingNavigator.tsx` | Mounts the flow with the cached user; on finish stores `onboarding_complete`, marks the cached profile `onboarding_completed`, and emits `authEvents` so `RootNavigator` re-bootstraps straight into the app (with the flag on the old Day-1 flow and Day-1 win are skipped; Opus B-05). |
| `src/lib/consultation/aiConsent.ts` | Box 2 grant body (`client-ai-v3`, copy hash, platform) and the one-retry, non-blocking grant. |
| `src/api/aiConsentApi.ts` | `GET /me/ai-consent`, `POST` / `DELETE /me/ai-consent/roman` (backend R2a). Never throws; 404 / 503 is `unavailable`. |
| `src/screens/settings/RomanAiConsentScreen.tsx` | Settings > Privacy > Roman and AI: shows, allows and withdraws box 2. |

## Screens

W1 welcome; P0 "Before we start", two boxes (before any question); G1 goal; G2 why it matters; B1 formula; B2 date of birth (16 to 100); B3 height and weight (unit tabs convert in place); B4 goal weight (optional, soft notes only); L1 activity; L2 sleep; T1 experience; T2 enjoyed; T3 injury check (yes expands areas and a note); T4 session length; S1 days per week; S2 preferred time; S3 where you train; S3b home equipment (only for "At home, with some equipment"); N1 to N5 nutrition; P1 to P7 screening (no consent box in this chapter) (yes reveals an optional note, never blocks); P8 message (only when any P answer is yes); C1 first session (tomorrow preselected); SUM; PREP; MACRO; PLAN.

## P0: two boxes on one screen (D2, ops/CONSENT_D2_CONTRACT.md)

Copy is the contract copy v2 (approved by the owner 2026-10-01 09:07), verbatim with straight apostrophes: title "Before we start", three paragraphs (personal training only, risk, what The Growth Project and the coach collect and use; the clinic does not see it), box 1, paragraph 4 (Roman is powered by Anthropic), box 2, and the footer. `AI_CONSENT_COPY_SHA256` equals the `copy.sha256` that backend #622 pins for `client-ai-v3` (`d8738c90...840f`).

- **Box 1 (required).** The training waiver, and The Growth Project and the coach collecting and using the client's information to coach them. Continue stays disabled until it is ticked. It is recorded by the intake only.
- **Box 2 (optional, unticked by default).** Roman and the coach's AI tools may use the client's information, processed by Anthropic. It never gates anything: onboarding, plan assignment, coach messaging, community, wearables, Roman's scripted tour, the welcome message and reminders all work with it unticked.

P0 comes straight after W1. Nothing is sent before Continue:

1. Continue stores `P0 = { agreed: true, copy_version: 'consult-consent-v2', agreed_at, text_sha256 }` and sends it as the first `PUT /me/onboarding/consultation`, on its own (backend #607 is consent-first: answers sent before or bundled with the first agreement get `409 consent_missing` and are not stored). `text_sha256` is the sha256 of the whole P0 screen text (`consentCopyText()`, pinned as `CONSENT_COPY_SHA256`). Every later save sends P0 alone first if the server does not hold it yet. Continue acts once per visit, so a double tap records once (Opus C-1).
2. If box 2 is ticked, after that P0 save settles the flow posts `POST /me/ai-consent/roman { version: 'client-ai-v3', copy_sha256, platform }` (backend R2a), where `copy_sha256` is the sha256 of paragraph 4 and the box 2 label (`AI_CONSENT_COPY_SHA256`). It is fire and forget and never shows a message: one retry on a failure (network, 5xx other than 503, `409 AI_CONSENT_CONFLICT`); skipped silently with no retry on `404` (ledger not deployed) and `503 AI_CONSENT_UNAVAILABLE` (switch off); no retry on `400` or `409 CONSENT_VERSION_MISMATCH`. The client can set it later in Settings. Request and response shapes follow the final contract in backend #622. If the client comes back to P0 and unticks box 2 after ticking it, the flow sends `DELETE /me/ai-consent/roman`. Box 2 is never part of the intake answers.
3. A stored P0 counts only when `copy_version` equals the displayed copy, `agreed_at` is a valid date and any `text_sha256` is lowercase hex (`isConsentAnswerCurrent`). Stale (including the single-box `consult-consent-v1`) or malformed records route back to P0 with both boxes unticked. Box 1 is not read from the AI consent ledger.
4. A P0-only PUT rejected with `409 consent_missing` means the server does not accept this copy version: the box is cleared, Continue stays disabled and the client is asked to update the app. A `409 consent_missing` on a later save, or from complete after resending P0 once, routes back to P0.

Any change to the P0 copy bumps `CONSULT_CONSENT_COPY_VERSION` (and the backend's accepted versions); a change to paragraph 4 or box 2 also bumps `AI_CONSENT_VERSION` and the R2a server copy. The unit test recomputes both pinned hashes. Consent copy changes need T4 review.

## Privacy

- **Analytics.** The whole flow (every question, P0, summary, reveals, paused and problem states) renders inside `AnalyticsExcluded` (`ph-no-capture`), and the frame, scroll view and footer carry the marker too, so PostHog touch autocapture never records labels, answers or screen ids. `consultationPrivacy.test.tsx` runs the SDK's own `autocaptureFromTouchEvent` on every element.
- **Local draft.** Stored in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), split into chunks of at most 600 characters under `consult_draft.<userId>.*`, with a manifest. Never in AsyncStorage; the old plaintext `consultation_v1:<userId>` key is deleted on first read. On web nothing is persisted. Drafts not touched for 30 days (`DRAFT_RETENTION_MS`) are deleted on read; corrupt drafts are deleted.
- **Purge.** `purgeConsultationDraft(userId)` runs on sign-out (`authActions.signOut`, which also clears the legacy prefix), on an account deletion request (Delete account and Trust Center), and when onboarding finishes. A per-user epoch fences late writes: a write from a screen opened before the purge is dropped.

## Saves and resume

- Saves are serialized and coalesced: one request in flight, the newest snapshot queued. Prepare drains the queue with the final snapshot and closes it before `complete`, so an older write can never land after the final one.
- A pending auto-advance is cancelled by any answer change, Back or Pause, and a screen whose answers do not validate is never left.
- On resume the local draft wins only when it holds unsynced edits and the server has not changed since this device last synced (revision, then `saved_at`), or the edits are newer than the server copy. Otherwise the server copy wins. Across two devices the last save wins (Opus C-10, accepted for this slice): the backend has no conditional write yet, so a second device can overwrite answers saved from the first.
- A save clears what the client cleared: answers of screens that are now hidden, and detail keys (notes, "other" text, areas) that are closed or emptied, go up as `null` so the server deletes them rather than keeping the old value (Opus B-06).
- The encrypted draft is tied to this install: an AsyncStorage marker (`consult_draft_install:<userId>`, no answer data) is written with each draft, and a draft found without it (left in the Keychain by an earlier install) is deleted rather than resumed (Opus C-7).

## P8: never blocks

Shown only after a yes on P1 to P7. Order: a calm opening, general habits (conversational effort, warm-up and rest, stop signs), what happens next with a safe next step (book a physician visit, then message the coach), then the physician line, the 911 / 988 routing, and the disclaimer. Continue is always enabled.

## Endpoints

| Call | When |
| --- | --- |
| `PUT /me/onboarding/consultation` `{ version: 'consult-v1', answers }` | First: P0 alone, right after the agreement. Then the end of every chapter, on Finish later / Pause, and before complete. Idempotent. A failed chapter save is non-blocking (kept locally); a failed final save shows the offline state and never calls complete. |
| `GET /me/onboarding` | On mount. A completed onboarding replays the macro reveal from `result`. 404 falls back to local state. |
| `POST /me/onboarding/complete` | "Prepare my plan". 200 drives the macro and plan reveals (`macro_display_mode: 'simple'` shows calories and protein only; Opus C-4). 409 `consultation_incomplete` routes to the first missing answer, `consent_missing` resends the saved P0 alone, saves again and retries once, then routes to P0; `consent_version_mismatch` routes to P0; `not_attached`, `clinic_not_configured` and `completion_in_progress` show their own message. A final save rejected with `409 completion_in_progress` or `400 invalid_answers` shows its own message, not the connection one (Opus C-2). |
| `POST /me/ai-consent/roman` | After the P0 save, only when box 2 is ticked. Non-blocking. |
| `DELETE /me/ai-consent/roman` | Back on P0, when box 2 is unticked after being ticked. |
| `GET /me/ai-consent` | Settings > Privacy > Roman and AI only. The flow does not read it. |

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
- `src/screens/consultation/__tests__/consultationPrivacy.test.tsx`: analytics exclusion, agreement before any upload and consent-first PUT, copy-version and 409 handling, box 2 grant / withdraw / retry / 404-503 and double tap, encrypted draft, install marker, retention, sign-out purge and late-write fence.
- `src/screens/settings/__tests__/RomanAiConsentScreen.test.tsx`: Roman and AI settings screen.
- `src/__tests__/rootNavigatorConsultationComplete.test.tsx`: after the consultation the real `RootNavigator` goes straight to the app with the flag on.
- `src/screens/consultation/__tests__/consultationOrdering.test.tsx`: auto-advance timer, serialized saves, resume reconciliation in the flow, safe-area insets, identity fencing.
- `src/screens/consultation/__tests__/consultationTemplates.test.tsx`: wheels, unit tabs, soft notes, T3 expansion, summary Edit, API client routes and 409 mapping, the rollback flag.

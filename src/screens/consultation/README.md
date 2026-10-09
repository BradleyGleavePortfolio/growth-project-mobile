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
| `RevealScreens.tsx` | Summary (T-F), preparing state, macro reveal and plan reveal (T-G), paused state, completion problem state. Active semantic theme, hairline sections, Inter supporting copy and tabular serif targets; the illustrative week is labelled suggested and setup errors make no timing promise. All edits, explanations, support and completion actions retained (`consultationQuietLook.test.tsx`). |
| `components.tsx` | `AnalyticsExcluded`, Frame (safe-area insets and footer spacing from `src/ui` Screen, the shared `ScreenTopBar` with an underlined "Finish later"), chapter progress bar, unfilled hairline rows/chips, wheels (VoiceOver `adjustable`), checkbox, Roman's line. `PrimaryButton`, `TextLink` and the question `Headline` are the shared `src/ui` primitives (DS-PRIMITIVES-133, #577), re-exported. Corners come from the semantic radius tokens (chips `radius.chip`, inputs `radius.input`, checkbox cards `radius.card`, boxes `radius.control`). `useConsultationStyles` follows the active semantic theme; primary buttons use its forest accent in launch light mode. Legacy `s`/`palette` exports remain semantic-light defaults for untouched consumers. Consent wording/handlers, analytics exclusion and 280ms STEP_MS are unchanged. |
| `src/navigation/ConsultationOnboardingNavigator.tsx` | Mounts the flow with the cached user; on finish stores `onboarding_complete`, marks the cached profile `onboardingCompleted` (the backend key that `profileOnboardingCompleted` reads, #320), and emits `authEvents` so `RootNavigator` re-bootstraps straight into the app (with the flag on the old Day-1 flow and Day-1 win are skipped; Opus B-05). |
| `src/lib/consultation/aiConsent.ts` | Box 2 grant body (`client-ai-v4`, copy hash, platform) and the one-retry, non-blocking grant. |
| `src/api/aiConsentApi.ts` | `GET /me/ai-consent`, `POST` / `DELETE /me/ai-consent/roman` (backend R2a). Never throws; 404 / 503 is `unavailable`. |
| `src/screens/settings/RomanAiConsentScreen.tsx` | Settings > Privacy > Roman and AI: shows, allows and withdraws box 2. |

## Screens

W1 welcome; P0 "Before we start", two boxes (before any question); G1 goal; G2 why it matters; B1 formula; B2 date of birth (16 to 100); B3 height and weight (unit tabs convert in place); B4 goal weight (optional, soft notes only); L1 activity; L2 sleep; T1 experience; T2 enjoyed; T3 injury check (yes expands areas and a note); T4 session length; S1 days per week; S2 preferred time; S3 where you train; S3b home equipment (only for "At home, with some equipment"); N1 to N5 nutrition; P1 to P7 screening (no consent box in this chapter) (yes reveals an optional note, never blocks); P8 message (only when any P answer is yes); C1 first session (tomorrow preselected); SUM; PREP; MACRO; PLAN.

N2 explains food avoidances as information for the coach: "So your coach knows what you avoid." It does not promise automatic filtering of food suggestions. Its choices include Sesame after Soy (ALLERGY-CHOICES-131; the backend accepts it from growth-project-backend#880) and Fish after Sesame (FISH-CONSULT-132; accepted from growth-project-backend#881); validation and the Continue action are unchanged.

## P0: two boxes on one screen (D2, ops/CONSENT_D2_CONTRACT.md)

Copy is the contract copy v2 (approved by the owner 2026-10-01 09:07), verbatim with straight apostrophes, with paragraph 4's retention sentence from `client-ai-v4` (owner 2026-10-01 20:32; backend #635): "Your conversations with Roman are private from your coach and are kept until you delete them or delete your account." That change moved P0 to `consult-consent-v3` (backend #607 must accept it). The parts: title "Before we start", three paragraphs (personal training only, risk, what The Growth Project and the coach collect and use; the clinic does not see it), box 1, paragraph 4 (Roman is powered by Anthropic), box 2, and the footer. `AI_CONSENT_COPY_SHA256` equals the `copy.sha256` that backend #635 pins for `client-ai-v4` (`fbf82140...34f4`).

- **Box 1 (required).** The training waiver, and The Growth Project and the coach collecting and using the client's information to coach them. Continue stays disabled until it is ticked. It is recorded by the intake only.
- **Box 2 (optional, unticked by default).** Roman and the coach's AI tools may use the client's information, processed by Anthropic. It never gates anything: onboarding, plan assignment, coach messaging, community, wearables, Roman's scripted tour, the welcome message and reminders all work with it unticked.

P0 comes straight after W1. Nothing is sent before Continue:

1. Continue stores `P0 = { agreed: true, copy_version: 'consult-consent-v3', agreed_at, text_sha256 }` and sends it as the first `PUT /me/onboarding/consultation`, on its own (backend #607 is consent-first: answers sent before or bundled with the first agreement get `409 consent_missing` and are not stored). `text_sha256` is the sha256 of the whole P0 screen text (`consentCopyText()`, pinned as `CONSENT_COPY_SHA256`). Every later save sends P0 alone first if the server does not hold it yet. Continue acts once per visit, so a double tap records once (Opus C-1).
2. If box 2 is ticked, the flow posts `POST /me/ai-consent/roman { version: 'client-ai-v4', copy_sha256, platform }` (backend R2a) only after the intake save carrying box 1 succeeded (Opus B-310-1). If that save fails (offline, 5xx, `409 completion_in_progress`), the grant is held and sent after the next save that lands the agreement (a chapter end, Finish later or Prepare); if none lands in this session it is left for Settings. A rejected agreement (back to P0) drops it. `copy_sha256` is the sha256 of paragraph 4 and the box 2 label (`AI_CONSENT_COPY_SHA256`). It never shows a message: one retry on a failure (network, 5xx other than 503, `409 AI_CONSENT_CONFLICT`); skipped silently with no retry on `404` (ledger not deployed) and `503 AI_CONSENT_UNAVAILABLE` (switch off); no retry on `400` or `409 CONSENT_VERSION_MISMATCH`. Request and response shapes follow the final contract in backend #622. Box 2 is never part of the intake answers.
3. Box 2 on P0 shows the client's latest choice while the ledger is catching up, otherwise only CONFIRMED ledger state (Opus B-310-2): a grant or withdrawal that returned ok in this session, the last confirmed value kept in the encrypted draft (`aiRoman`, a yes/no flag) after a restart, or `GET /me/ai-consent` when it answers (a late answer never overrides a box the client has just tapped). Unticking a confirmed grant on a return to P0 sends `DELETE /me/ai-consent/roman` with exactly one retry; if it is still unconfirmed, the withdrawal stays wanted (see B-310-5 below): box 2 shows the client's no with "Switching this off is not confirmed yet", and one calm notice says it may still be allowed for now and points to Settings > Privacy > Roman and AI.
   - **The latest choice wins (Sol / Opus B-310-3).** The client's latest explicit choice is kept (in memory and in the draft as `aiWant`, so it survives a restart) until the ledger confirms it. Grants and withdrawals go one at a time, and each step decides what to send only when it runs: a grant still in flight when the client unticks is followed by exactly one `DELETE`; a slow `GET` that reports a grant after the client chose no is withdrawn; a held grant the client unticks is never sent. A choice is cleared only when the server has said the same on this load.
   - **A grant that could not be saved (Opus C-310-6)** shows one calm notice (`AI_GRANT_NOTICE`): not allowed yet, training not affected, allow it in Settings > Privacy > Roman and AI. `404` / `503` stay silent (D2: skipped).
   - **A lost grant response never defeats a newer no (Sol B-310-5).** A grant whose answer does not prove it was not written (no response, timeout, 5xx other than 503, `409 AI_CONSENT_CONFLICT`) counts as possibly on file (`aiAttempted` in the draft): its retry goes out only while yes is still the latest choice, box 2 keeps showing yes, and the notice says the choice is not confirmed (never that it is off). A later no then sends an idempotent `DELETE` behind the attempted `POST`, even though no grant was ever confirmed; a `GET` never settles that no, only a confirmed `DELETE` does. A wanted withdrawal that is not confirmed stays wanted: in the draft and under a per-user AsyncStorage key (`consultation_ai_withdraw_pending:<user id>`, a timestamp only) that outlives the draft purge at finish. It is retried after the next save that lands, on the next launch, when the client app opens or returns to the foreground (`useAiWithdrawalDrain`, ClientNavigator) and when Settings > Privacy > Roman and AI opens (which says so if it is still not confirmed). A newer yes, on P0 or in Settings, clears the key (in Settings at the grant's own turn in the queue). The toggle and the queued step share one in-flight marker write, so there is only ever one stamp (C-310-11). Every ledger write in the app (P0, the drain, Settings) goes through one queue (`runAiLedgerWrite`), so a request never overtakes an earlier one on the wire; a write waits at most 65 s for the one before it. Settings writes are fenced by the account that chose them (`grantAiChoiceAs` / `withdrawAiChoiceAs`, Sol B-310-7): if another account is signed in when the turn comes, nothing is sent, no marker is touched, and Settings says the choice was not saved. Sign-out leaves the key in place so the no is still carried out the next time that user signs in; it is sent only while that same user is signed in.
   - **Box 2 waits for the ledger (Opus C-310-7).** When this phone knows nothing yet (no confirmed value, no pending choice), box 2 is disabled ("Checking your saved choice") until `GET /me/ai-consent` settles or 3 seconds pass (`AI_STATUS_WAIT_MS`). Box 1 and Continue are never held up.
   - **After the hand-off.** Steps already queued when the client taps "Show me around" still run after the flow unmounts, but only while the same user is signed in (`api.sessionUserId()`); every attempt, including the one retry, is checked, so nothing is ever sent under another user's session.
3. A stored P0 counts only when `copy_version` equals the displayed copy, `agreed_at` is a valid date and any `text_sha256` is lowercase hex (`isConsentAnswerCurrent`). Stale (including the single-box `consult-consent-v1`) or malformed records route back to P0 with both boxes unticked. Box 1 is not read from the AI consent ledger.
4. A P0-only PUT rejected with `409 consent_missing` means the server does not accept this copy version: the box is cleared, Continue stays disabled and the client is asked to update the app. A `409 consent_missing` on a later save, or from complete after resending P0 once, routes back to P0.

Roman memory on by default (R11-C2B, owner 2026-10-07 10:18): while `GET /me/ai-consent` says `memory_on` and sends a well-formed `memory_copy` (client-ai-v5, sha256 equal to the pinned `AI_CONSENT_MEMORY_COPY_SHA256`, same box 2 label), box 2 shows that paragraph, its tick grants `{ version: 'client-ai-v5', copy_sha256 }`, and P0 records `consult-consent-v4` with `CONSENT_MEMORY_COPY_SHA256`. Same box, same label, unticked by default. Otherwise (the current production server sends no `memory_copy`) box 2, its grant and P0 stay exactly as above. A live v4 holder keeps seeing the v4 text; a live v5 holder sees the v5 text.

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
| `GET /me/onboarding` | On mount. A completed onboarding replays the macro reveal from `result`. 404 falls back to local state. Also read by `TutorialHost` to start a tour that never started after a completed consultation (B-310-4, see `src/tutorial/README.md`). |
| `POST /me/onboarding/complete` | "Prepare my plan". 200 drives the macro and plan reveals (`macro_display_mode: 'simple'` shows calories and protein only; Opus C-4). 409 `consultation_incomplete` routes to the first missing answer, `consent_missing` resends the saved P0 alone, saves again and retries once, then routes to P0; `consent_version_mismatch` routes to P0; `not_attached`, `clinic_not_configured` and `completion_in_progress` show their own message. A final save rejected with `409 completion_in_progress` or `400 invalid_answers` shows its own message, not the connection one (Opus C-2). |
| `GET /me/ai-consent` (flow) | Once per load, non-blocking, to show box 2 truthfully on P0. |
| `POST /me/ai-consent/roman` | Only after a save that landed box 1, when box 2 is ticked and not already confirmed. Non-blocking. |
| `DELETE /me/ai-consent/roman` | Back on P0, when a confirmed grant is unticked. One retry, then a notice. |
| `GET /me/ai-consent` (Settings) | Settings > Privacy > Roman and AI. |

Answer values: single selects are option values; multi selects are arrays; `B2` is `YYYY-MM-DD`; `B3` is `{ height_cm, weight_lbs, unit }`; `B4` is lbs or null; `C1` is the first-session date `YYYY-MM-DD`; detail keys are `G2_other`, `T3_areas`, `T3_note`, `N2_other`, `P1_note` to `P7_note`.

Macros and the program come only from the server. Nothing on the device computes targets.

## Errors (owner rule 2026-10-01 13:34)

Every failure says what happened and offers a next step that works; known statuses and machine codes have their own copy (`PROBLEM_COPY` in `RevealScreens.tsx`, `ROMAN_AI_COPY` in `RomanAiConsentScreen.tsx`). No response at all is a connection problem. Anything unexpected (5xx, an unknown `409` code, a `400` on save) shows a short reference (the first 8 characters of the request's `X-Request-Id` / `request_id`, `supportReferenceOf` in `src/utils/correlation.ts`), the support address, and goes to Sentry with status, code and reference only (`src/lib/consultation/report.ts`), never answers or notes. The Privacy Policy link, if the phone cannot open it, gives the address to type into a browser.

## Quiet Luxury and accessibility

- Tokens only (`theme/tokens`), weights 400 and 500, radius from the tokens only (pills on chips; owner 17:07 rounded corners), forest accent, no confetti, no count-up, no emoji, no exclamation marks.
- Fades are 280ms decelerate, staggered 80ms; with Reduce Motion on they render at rest (`useReducedMotion`).
- Every control has an accessibility role, label and state. Wheels are `adjustable` with increment and decrement actions; the progress bar exposes "Chapter n of 8, name".
- Roman appears with his face through `RomanAvatar` (`crop="neutral"`), which resolves `romanFaceAsset` from `src/components/roman/romanAvatarAssets.ts`.

## Prototype parity (CONSULT-PARITY-133, prototype screens 03-36)

- Roman's chapter lines use the serif italic voice (`ROMAN_VOICE_FONT`, Cormorant Garamond 400 italic from the font package the app already ships; regular serif until it loads), 18/25, never clipped.
- Wheels show serif numerals: the selected value 28/34 in ink, neighbours fading (`wheelOpacity`: 1, 0.6, 0.3), the hairline band behind the selected value.
- B3 Imperial / Metric are quiet text tabs with a forest underline, not a second filled control. They open on the phone's region (`defaultMeasureUnit`: US, Liberia and Myanmar imperial, everywhere else metric, unknown imperial), the rule the lean flow had; a resumed answer keeps its unit.
- S1 and N3 (`big`) use the large two-column grid (56 pt, serif numerals). Chips are pills (owner 17:07: rounded corners).
- Coach names: a coached client sees the coach's name from the server or the coach-sharing notice. A coachless client (`coachless`, from `!user.coach_id` in the navigator; owner 15:29) gets `COACHLESS_COPY` in place of every line that names a coach, and P8's "Your coach will be told" line is dropped. P0 is never changed this way (its copy is hashed).
- P8 opens "Thanks for answering honestly, {first}." with Roman: "That helps me keep you safe."
- Deliberate differences from the prototype: P0 stays straight after W1 with two boxes (D2); T3's reason stays impersonal; N2 keeps "So your coach knows what you avoid."; P7 uses commas; P8's body keeps the approved safety copy.

## Reveals and states (CONSULT-PARITY-133, prototype screens 37-45)

- 43 Summary offline: every chapter works offline; only Prepare needs the network. While `useNetworkStatus` reports no connection the summary's action reads "Prepare when I'm back online" (disabled) and Roman says "I'll prepare your numbers the moment you're connected. Nothing you've told me is lost."; the app-wide `OfflineBanner` shows above the flow. Back online, the plan is prepared by itself on the first reconnect (once per visit, only if the phone was offline on this screen).
- 44 Calm error: every problem screen shows Roman's face above the serif sentence; no red, no error haptic.
- 39 Macro reveal: one success haptic when the numbers appear (no count-up); the 64 pt calorie number has a 77 pt line height (never clipped).
- 40 Plan reveal: training days carry an accent dot and the C1 first-session day is ring-highlighted; the week line adds the session length from T4 ("About 30 to 45 minutes each."). Program content (A Foundations, B Build, C Gentle Start) comes from the server.
- 42 Welcome back: after a resume (reopening the app or Continue on the paused screen), Roman's line on the screen the client lands on is "Welcome back, {first}. You were telling me about {topic}." (`welcomeBackLine`); the chapter line returns on the next screen.
- 45 Under 16: Continue on B2 with an age under 16 opens a calm, final stop screen ("The Growth Project is for ages 16 and up.", "If the date was entered by mistake, go back and change it.", "Change my date of birth"); nothing is saved or sent.
- Coachless clients: the plan's physician line, the plan and macro "message your coach" lines and the paused line have `COACHLESS_COPY` versions.

## Tests

```bash
npx jest src/lib/consultation src/screens/consultation --maxWorkers=1
```

- `src/lib/consultation/__tests__/consultationEngine.test.ts`: definitions, copy rules, conditions, validation, chapter progress, resume, save payload, summary.
- `src/screens/consultation/__tests__/ConsultationFlow.test.tsx`: W1 render, auto-advance and back, per-chapter save, the P0 gate and consent record, the P8 branch, complete happy path, 409 handling, offline save, replay, Finish later, accessibility labels.
- `src/lib/consultation/__tests__/consultationResume.test.ts`: resume reconciliation rules.
- `src/screens/consultation/__tests__/consultationPrivacy.test.tsx`: analytics exclusion, agreement before any upload and consent-first PUT, copy-version and 409 handling, box 2 grant / withdraw / retry / 404-503 and double tap, grant held until box 1 lands (B-310-1), confirmed-only box 2 after restart and GET, withdraw retry and notice (B-310-2), the latest choice wins over an in-flight grant or a slow GET and survives a restart (B-310-3), the grant notice (C-310-6), box 2 waiting for the ledger (C-310-7), hand-off steps only for the same user, the Prepare guard (C-310-1), Contact support and Sign out on the problem and paused screens (C-310-3), encrypted draft, install marker, retention, sign-out purge and late-write fence.
- `src/screens/settings/__tests__/RomanAiConsentScreen.test.tsx`: Roman and AI settings screen.
- `src/__tests__/rootNavigatorConsultationComplete.test.tsx`: after the consultation the real `RootNavigator` goes straight to the app with the flag on.
- `src/__tests__/rootNavigatorConsultationColdBoot.test.tsx`: B-310-4, a shutdown between the server's completion and "Show me around": the real `RootNavigator` and `TutorialHost` start the tour from `GET /me/onboarding`; a finished or paused tour never restarts; no consultation, offline, or flag off start nothing.
- `src/lib/consultation/__tests__/aiConsentRetry.test.ts`: the one retry and the stop check between attempts.
- `src/screens/consultation/__tests__/consultationOrdering.test.tsx`: auto-advance timer, serialized saves, resume reconciliation in the flow, safe-area insets, identity fencing.
- `src/screens/consultation/__tests__/consultationTemplates.test.tsx`: wheels, unit tabs, soft notes, T3 expansion, summary Edit, API client routes and 409 mapping, the rollback flag.
- `src/screens/consultation/__tests__/consultationParity133States.test.tsx`: summary offline, calm error with Roman, macro haptic and line height, first-day ring and session length, welcome back after a resume, coachless reveals.
- `src/screens/consultation/__tests__/consultationParity133.test.tsx`: prototype parity at 360x800 and 390x844 (Roman's italic voice, quiet unit tabs and region default, serif wheels and band, the large grid, P8), and the coachless copy never naming a coach.

## Problem and paused screens

"Try again" (or "Continue my consultation") stays the primary action. Below it, "Contact support" opens an email to the owner-approved support contact (`SUPPORT_EMAIL`) and "Sign out" (when the host passes `onSignOut`; `ConsultationOnboardingNavigator` does) asks first, then signs out. This is the way out of a permanent `not_attached` or `clinic_not_configured` (operator ruling C-310-3).

/**
 * Every key the app saves on the phone, with its lifetime (KT-13, KNOWN_TRAPS.md). Test-only data for
 * src/__tests__/savedKeyLifetimes.test.ts. `{uid}` is the signed-in account's id; `*` is any other part (a thread,
 * a month, a source). A row covers every key its pattern matches.
 *
 *   DEVICE  the phone's own: survives sign out, the same for every account on the phone.
 *   ACCOUNT one account's: gone after sign out.
 *   MARK    a one-time mark: keyed to the account, survives sign out (it never shows again for that
 *           account), never applies to another account, gone after account deletion.
 *   QUEUE   unsent work: survives a restart, never sends for another account (keyed to the account,
 *           or gone after sign out).
 */
import type { Store } from './scanSavedKeys';

export type Lifetime = 'DEVICE' | 'ACCOUNT' | 'MARK' | 'QUEUE';
/** store, key pattern, lifetime, owning file (under src/), what it holds, sample for `*` when seeded. */
export type Row = [Store, string, Lifetime, string, string, string?];

export const REGISTRY: Row[] = [
  ['async', '@activeWorkoutSession/v1', 'QUEUE', 'storage/activeWorkoutSession.ts', 'old one-slot workout in progress'],
  ['async', 'TGP_RQ_CACHE_V1:{uid}', 'ACCOUNT', 'services/queryClient.ts', "sealed copy of the account's server data"],
  ['async', 'active_workout_session:{uid}', 'QUEUE', 'storage/activeWorkoutSession.ts', 'workout in progress'],
  ['async', 'aiTutorialSeenAt:*', 'MARK', 'components/coach/ai-budget/AIBudgetTutorialModal.tsx', 'AI budget tour seen this month'],
  ['async', 'allergy_prompt_shown', 'MARK', 'screens/client/RecipesScreen.tsx', 'allergy question asked once'],
  ['async', 'analytics_onboarding_completed_fired', 'ACCOUNT', 'lib/finalizeLeanOnboarding.ts', 'onboarding event sent'],
  ['async', 'coach_consult_v1:{uid}', 'QUEUE', 'lib/coachConsultation/draft.ts', 'coach consultation answers not synced yet'],
  ['async', 'consult_draft_install:{uid}', 'ACCOUNT', 'lib/consultation/storage.ts', 'this install wrote the draft'],
  ['async', 'consultation_ai_withdraw_pending:{uid}', 'QUEUE', 'lib/consultation/aiConsent.ts', 'AI consent withdrawal not sent yet'],
  ['async', 'consultation_v1:{uid}', 'ACCOUNT', 'lib/consultation/storage.ts', 'old plain draft, only deleted now'],
  ['async', 'day_one_completed', 'ACCOUNT', 'screens/day-one/ReadyScreen.tsx', 'Day One finished (server holds it too)'],
  ['async', 'day_one_onboarding_state_v1', 'ACCOUNT', 'screens/day-one/resume.ts', 'Day One step to resume'],
  ['async', 'fasting:scheduled_notification_id:{uid}', 'ACCOUNT', 'utils/fastingAlert.ts', 'scheduled fasting reminder id'],
  ['async', 'gp_appearance', 'DEVICE', 'theme/ThemeProvider.tsx', 'light or dark'],
  ['async', 'gp_chat_{uid}', 'ACCOUNT', 'db/chatDb.ts', 'last 50 AI guide chat messages'],
  ['async', 'gp_client_settings', 'DEVICE', 'hooks/useSettings.ts', 'units, haptics, reminder switches'],
  ['async', 'gp_coach_bio_{uid}', 'ACCOUNT', 'screens/coach/SettingsScreen.tsx', 'copy of the coach bio'],
  ['async', 'gp_coach_settings_{uid}', 'ACCOUNT', 'screens/coach/SettingsScreen.tsx', 'copy of the coach settings'],
  ['async', 'gp_last_app_version', 'DEVICE', 'services/appLifecycleEvents.ts', 'last app version opened'],
  ['async', 'gp_notif_category_prefs', 'DEVICE', 'screens/settings/NotificationPreferencesScreen.tsx', 'notification kinds on this phone'],
  ['async', 'gp_synced_timezone', 'DEVICE', 'services/timezoneSync.ts', '"<account>|<zone>" last sent'],
  ['async', 'import_offer_decision:{uid}', 'ACCOUNT', 'storage/importOfferDecision.ts', "coach's answer to the import offer"],
  ['async', 'import_pairing_session:{uid}', 'ACCOUNT', 'storage/importPairingMirror.ts', 'import pairing in progress'],
  ['async', 'lean_onboarding_done', 'ACCOUNT', 'hooks/useLeanOnboardingReconcile.ts', 'short onboarding finished'],
  ['async', 'lean_onboarding_synced', 'ACCOUNT', 'lib/finalizeLeanOnboarding.ts', 'short onboarding sent'],
  ['async', 'macro_targets', 'ACCOUNT', 'hooks/useMacroTargets.ts', 'old one-slot macro targets'],
  ['async', 'macro_targets:{uid}', 'ACCOUNT', 'hooks/useMacroTargets.ts', 'macro targets copy'],
  ['async', 'messages_thread_outbox_{uid}', 'QUEUE', 'services/messageOutbox.ts', 'messages waiting to send'],
  ['async', 'mwb_autosave_mirror:*', 'QUEUE', 'storage/autosaveMirror.ts', 'workout builder edits not saved yet'],
  ['async', 'needs_role_selection', 'ACCOUNT', 'lib/roleSelectionGate.ts', 'role still to choose'],
  ['async', 'needs_role_selection_owner', 'ACCOUNT', 'lib/roleSelectionGate.ts', 'whose role choice that is'],
  ['async', 'onboarding_complete', 'ACCOUNT', 'navigation/RootNavigator.tsx', 'onboarding finished (server holds it too)'],
  ['async', 'onboarding_data', 'ACCOUNT', 'utils/onboardingStore.ts', 'onboarding answers'],
  ['async', 'onboarding_standard_path:{uid}', 'MARK', 'navigation/RootNavigator.tsx', 'sent the standard onboarding once'],
  ['async', 'pending_email', 'ACCOUNT', 'screens/auth/CreateAccountScreen.tsx', 'email waiting for confirmation'],
  ['async', 'pending_food_logs_{uid}', 'QUEUE', 'services/foodLogQueue.ts', 'food logs waiting to send'],
  ['async', 'pending_food_logs_anonymous', 'QUEUE', 'services/foodLogQueue.ts', 'food logs from before an id was known'],
  ['async', 'pending_invite_code', 'ACCOUNT', 'lib/pendingInviteCode.ts', 'invite code from a link'],
  ['async', 'pending_join_package.v1', 'ACCOUNT', 'lib/joinPackage.ts', 'unpaid package join'],
  ['async', 'roman.p3.completion-consumed:{uid}:*', 'MARK', 'screens/client/WorkoutScreen.tsx', 'a workout finish already answered'],
  ['async', 'roman_join_offer:{uid}', 'MARK', 'lib/romanJoinOffer.ts', 'Roman join offer due or answered'],
  ['async', 'signup_coach_recovery_gate', 'ACCOUNT', 'lib/roleSelectionGate.ts', 'coach sign-up recovery step'],
  ['async', 'signup_coach_unconfirmed', 'ACCOUNT', 'lib/coachSignupAttempt.ts', 'coach sign-up not confirmed'],
  ['async', 'signup_role_notice', 'ACCOUNT', 'lib/signupRoleNotice.ts', 'role notice after sign-up'],
  ['async', 'tgp.clientTutorial.v1:{uid}', 'MARK', 'tutorial/tutorialStorage.ts', 'tour progress and the numbers it shows'],
  ['async', 'tgp.coachCredits.moment.v1:{uid}:*:*', 'MARK', 'components/coach/credits/CreditMomentsHost.tsx', 'credit moment seen this month'],
  ['async', 'tgp.macroDisplay.v1:{uid}', 'MARK', 'macros/macroDisplayStore.ts', 'macro view and its intro dismissed'],
  ['async', 'tgp.recent_clients.v1', 'ACCOUNT', 'lib/recentClients.ts', "coach's recently opened clients"],
  ['async', 'tgp.voiceOutbox.v1', 'QUEUE', 'hooks/useVoiceOutbox.ts', 'voice notes waiting to send, each with its author'],
  ['async', 'tgp.voiceReported.v1:{uid}', 'ACCOUNT', 'components/community/voiceReportedStore.ts', 'voice notes this account reported'],
  ['async', 'user_data', 'ACCOUNT', 'lib/userCache.ts', 'old copy of the signed-in user'],
  ['async', 'wearables_on_device:auth:*:{uid}', 'ACCOUNT', 'services/health/onDeviceState.ts', 'health source grant', 'healthkit'],
  ['async', 'wearables_on_device:progress:*:{uid}:*', 'ACCOUNT', 'services/health/onDeviceState.ts', 'health import progress', 'healthkit'],
  ['async', 'wearables_on_device_session', 'DEVICE', 'services/health/onDeviceState.ts', 'consent session nonce, replaced at sign out'],
  ['cache', 'chat_draft_{uid}', 'QUEUE', 'lib/chatDrafts.ts', "half-typed chat text and a failed send's key"],
  ['cache', 'coach_lookup_recent:{uid}', 'ACCOUNT', 'utils/coach/clientLookup.ts', 'clients the coach opened lately'],
  ['cache', 'messages_thread_client_{uid}', 'ACCOUNT', 'screens/client/MessagesScreen.tsx', "copy of the client's thread"],
  ['prefs', 'auth.user_data', 'ACCOUNT', 'lib/userCache.ts', 'the signed-in user'],
  ['prefs', 'blocked_user_ids_v1:{uid}', 'ACCOUNT', 'store/blockedUsersStore.ts', 'people this account blocked'],
  ['prefs', 'coach.onboarding.is_complete:{uid}', 'ACCOUNT', 'navigation/CoachWizardNavigator.tsx', 'coach set-up finished (server holds it)'],
  ['prefs', 'coach.revenue_sharing_*:{uid}', 'ACCOUNT', 'screens/coach/TeamMembersScreen.tsx', 'revenue sharing switch copy'],
  ['prefs', 'coach.setup.invite_shared:{uid}', 'MARK', 'lib/coachSetup/setupStatus.ts', 'the coach shared the invite link'],
  ['prefs', 'coach.stripe_banner_dismissed:{uid}', 'MARK', 'components/coach/StripeSetupBanner.tsx', 'Stripe banner dismissed'],
  ['prefs', 'coach.stripe_was_unconfigured:{uid}', 'ACCOUNT', 'components/coach/NewClientBanner.tsx', 'Stripe was not set up before'],
  ['prefs', 'coach.wizard.step_2_invite_code:{uid}', 'ACCOUNT', 'ui/empty-states/EmptyStateNoClients.tsx', 'invite code copy'],
  ['prefs', 'coachPackages.editorCreate.v1:{uid}', 'ACCOUNT', 'lib/coachSetup/packageCreateIntent.ts', 'package editor opened to create'],
  ['prefs', 'coachSetup.packageCreate.v1:{uid}', 'ACCOUNT', 'lib/coachSetup/packageCreateIntent.ts', 'package creation started in set-up'],
  ['prefs', 'community_terms_agreed:v1:{uid}', 'MARK', 'components/community/CommunityTermsGate.tsx', 'community terms agreed'],
  ['prefs', 'home.coach_intro_banner_dismissed:{uid}', 'MARK', 'components/home/CoachIntroductionBanner.tsx', 'coach intro banner dismissed'],
  ['prefs', 'home.profile_nudge_hidden_until:{uid}', 'ACCOUNT', 'components/home/ProfileNudge.tsx', 'profile nudge hidden for 3 days'],
  ['prefs', 'onboarding.day1_answers:{uid}', 'ACCOUNT', 'screens/day-one/answers.ts', 'Day One answers'],
  ['prefs', 'onboarding.day1win_skipped_at:{uid}', 'MARK', 'lib/day1WinSkip.ts', 'Day One win skipped'],
  ['prefs', 'onboarding.package_prompt_dismissed_at:{uid}', 'ACCOUNT', 'lib/packagePromptGate.ts', 'package prompt hidden for 24 hours'],
  ['prefs', 'plan_renewal.house_join:{uid}', 'ACCOUNT', 'lib/planRenewal.ts', 'house coach join started'],
  ['prefs', 'plan_renewal.seen:{uid}', 'MARK', 'lib/planRenewal.ts', 'renewal step already shown'],
  ['prefs', 'plan_renewal.shown_once:{uid}', 'MARK', 'lib/planRenewal.ts', 'first renewal offer shown once'],
  ['prefs', 'push_primer_dismissed:{uid}', 'MARK', 'components/home/PushPermissionCard.tsx', 'push permission card dismissed'],
  ['prefs', 'roman.ed3.first-payment-seen.{uid}', 'MARK', 'screens/coach/ed/firstPaymentGate.ts', 'first payment celebration seen'],
  ['prefs', 'support.crisp_session_owner', 'ACCOUNT', 'services/support/crisp.service.ts', 'who the support chat is bound to'],
  ['secure', 'biometric_fail_count', 'ACCOUNT', 'security/biometric-lock.service.ts', 'wrong PIN count'],
  ['secure', 'biometric_pin_hash', 'ACCOUNT', 'security/biometric-lock.service.ts', 'app PIN hash'],
  ['secure', 'biometric_timeout_minutes', 'ACCOUNT', 'security/biometric-lock.service.ts', 'lock after minutes'],
  ['secure-store', 'biometric_unlock_enabled', 'DEVICE', 'hooks/useBiometricGate.ts', 'Face ID / fingerprint unlock on'],
  ['secure-store', 'bloodwork_disclaimer_ack_v1_{uid}', 'MARK', 'lib/bloodworkDisclaimerHelper.ts', 'bloodwork notice acknowledged'],
  ['secure-store', 'consult_draft.{uid}.*', 'QUEUE', 'lib/consultation/storage.ts', 'consultation draft, in parts', 'a0'],
  ['secure-store', 'health_connect_last_sync_at', 'ACCOUNT', 'services/authActions.ts', 'last Health Connect sync'],
  ['secure-store', 'healthkit_last_sync_at', 'ACCOUNT', 'services/authActions.ts', 'last Apple Health sync'],
  ['secure-store', 'supabase_refresh_token', 'ACCOUNT', 'utils/supabaseAuth.ts', 'refresh token'],
  ['secure-store', 'supabase_token', 'ACCOUNT', 'utils/supabaseAuth.ts', 'session token'],
  ['secure-store', 'tgp_rq_cache_aes_key_v1', 'DEVICE', 'services/queryCacheCrypto.ts', 'key that seals the query cache copy'],
  ['secure-store', 'wearables_on_device_authority', 'ACCOUNT', 'services/health/onDeviceState.ts', 'consent authority nonce'],
];

export type Rule = 'signout' | 'keyed' | 'deletion' | 'restart';
export const RULES: Record<Rule, string> = {
  signout: 'ACCOUNT keys are gone after sign out; a MARK and DEVICE key survive it (a MARK never shows again)',
  keyed: 'a MARK carries the account id; a QUEUE carries it or is gone after sign out (never for another account)',
  deletion: 'a MARK is gone after the real account deletion path',
  restart: 'a MARK, QUEUE or DEVICE key is read back with an async read (a sync getString on the AsyncStorage shim reads nothing after a restart)',
};

const M898 = 'https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/898';
const JOINOFFER_DEL = "closed by M898-FOLLOW's JOINOFFER-DEL PR m#906 (base op180/first-payment-m, not main)";
/** store, key pattern, rule it misses, one-line why, AUDIT link or the PR that closes it. Found, not fixed. */
export type Gap = [Store, string, Rule, string, string?];

export const KNOWN_GAPS: Gap[] = [
  ['async', 'aiTutorialSeenAt:*', 'keyed', 'keyed by month only: one coach seeing the tour hides it for every coach on the phone that month'],
  ['async', 'aiTutorialSeenAt:*', 'deletion', 'no deletion cleanup; deletion runs the plain sign out'],
  ['async', 'allergy_prompt_shown', 'keyed', 'one flag for the phone: the first account answering hides the question from every later account'],
  ['async', 'allergy_prompt_shown', 'deletion', 'no deletion cleanup'],
  ['async', 'gp_chat_{uid}', 'signout', 'AI guide chat stays on the phone after sign out (keyed, so another account cannot read it)'],
  ['async', 'gp_coach_settings_{uid}', 'signout', 'not in any sign-out sweep (its sibling gp_coach_bio_ is)'],
  ['async', 'onboarding_standard_path:{uid}', 'deletion', 'kept across sign out by design; no deletion cleanup'],
  ['async', 'roman.p3.completion-consumed:{uid}:*', 'deletion', 'kept across sign out by design; no deletion cleanup'],
  ['async', 'roman_join_offer:{uid}', 'deletion', 'kept across sign out by design; deletion leaves it', `${M898}#issuecomment-6492516366; ${JOINOFFER_DEL}`],
  ['async', 'tgp.clientTutorial.v1:{uid}', 'deletion', 'tour state and its numbers stay after deletion'],
  ['async', 'tgp.coachCredits.moment.v1:{uid}:*:*', 'deletion', 'no deletion cleanup'],
  ['async', 'tgp.macroDisplay.v1:{uid}', 'deletion', 'no deletion cleanup'],
  ['async', 'tgp.voiceReported.v1:{uid}', 'signout', 'removed at sign out only when the feed was read in that session (voiceReportedStore drop: owner is null otherwise)'],
  ['prefs', 'coach.setup.invite_shared:{uid}', 'signout', 'prefs namespace is wiped at sign out: the set-up step shows as not done again'],
  ['prefs', 'coach.stripe_banner_dismissed:{uid}', 'signout', 'in USER_SCOPED_PREFIXES and the prefs wipe: the banner shows again'],
  ['prefs', 'community_terms_agreed:v1:{uid}', 'signout', 'prefs wipe at sign out: the terms are asked again'],
  ['prefs', 'home.coach_intro_banner_dismissed:{uid}', 'signout', 'in USER_SCOPED_PREFIXES and the prefs wipe: the banner shows again'],
  ['prefs', 'onboarding.day1win_skipped_at:{uid}', 'signout', 'prefs wipe at sign out: the Day One screen shows again'],
  ['prefs', 'plan_renewal.seen:{uid}', 'signout', 'prefs wipe at sign out: the renewal step shows again'],
  ['prefs', 'plan_renewal.shown_once:{uid}', 'signout', 'prefs wipe at sign out: the once-only offer shows again'],
  ['prefs', 'push_primer_dismissed:{uid}', 'signout', 'prefs wipe at sign out: the push card shows again'],
  ['prefs', 'roman.ed3.first-payment-seen.{uid}', 'signout', 'prefs wipe at sign out: the celebration shows again', `${M898}#issuecomment-6487393324; closed by m#898 (moves it to AsyncStorage) and ${JOINOFFER_DEL}`],
  ['secure-store', 'bloodwork_disclaimer_ack_v1_{uid}', 'deletion', 'SecureStore mark kept across sign out; no deletion cleanup'],
];

/**
 * Settings > Privacy > Roman and AI (D2 ruling 2026-10-01; Opus A-05).
 *
 * Box 2 of the onboarding agreement, at any time: shows the current choice
 * from GET /me/ai-consent and lets the client allow it
 * (POST /me/ai-consent/roman with this build's version and copy hash) or
 * withdraw it (DELETE /me/ai-consent/roman), each after a confirmation.
 *
 * Box 1 (the training waiver, and The Growth Project and the coach
 * collecting and using the client's information to coach them) cannot be
 * withdrawn while keeping an account; the screen points to Settings > Account > Delete account.
 *
 * While the consent ledger is not deployed (404 / 503) the screen says the
 * choice is unavailable right now and records nothing.
 *
 * Sol B-310-5: a "no" given during onboarding that the ledger has not
 * confirmed yet is sent first when this screen opens (behind any ledger write
 * already queued); if it still does not go through, the screen says so.
 * Allow here is a newer choice and clears that pending "no" before it is
 * sent; a confirmed Withdraw here settles it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { aiConsentApi as defaultApi, AiConsentOutcome, AiConsentStatusResponse } from '../../api/aiConsentApi';
import {
  AI_LEDGER_NOT_SENT,
  drainAiWithdrawal,
  grantAiChoiceAs,
  readAiWithdrawalPending,
  romanGrantBody,
  withdrawAiChoiceAs,
} from '../../lib/consultation/aiConsent';
import { readUserCacheSync } from '../../lib/userCache';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH, SUPPORT_EMAIL } from '../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../lib/consultation/consentVersion';
import { reportUnexpected } from '../../lib/consultation/report';
import { shortReference } from '../../utils/correlation';
import { logger } from '../../utils/logger';
import { ROMAN_CHATS_COPY } from './romanChatsCopy';

export type RomanAiConsentApi = Pick<typeof defaultApi, 'getStatus' | 'grantRoman' | 'withdrawRoman'>;

type View_ =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'error'; offline: boolean; reference: string | null }
  | { phase: 'ready'; status: AiConsentStatusResponse };

export type RomanAiChoice = 'allowed' | 'not_allowed' | 'reconsent' | 'update_app';

export const ROMAN_AI_COPY = {
  title: 'Roman and AI',
  allowedHead: 'Allowed',
  allowedBody: 'Roman and your coach\u2019s AI tools may use your information, processed by Anthropic.',
  notAllowedHead: 'Not allowed',
  notAllowedBody: 'Roman and your coach\u2019s AI tools do not use your information. Your coaching, plan, messages and Roman\u2019s guided tour work as usual.',
  reconsentBody: 'The wording of this choice has changed since you last chose, so it is off for now. You can allow it again below.',
  updateApp: 'This choice has been updated since this version of the app. Please update the app to change it.',
  notSent: 'You were signed out before this choice was saved, so nothing changed. Sign in and choose again.',
  unavailable: `The Roman and AI setting is switched off on our side at the moment, so it cannot be changed here yet. Nothing is recorded. You can check back later, or write to support at ${SUPPORT_EMAIL}.`,
  loadOffline: 'I could not reach the server to load your choice. Check your connection, then tap Try again.',
  loadServer: (ref: string | null) =>
    `The server could not load your choice. Tap Try again. If it keeps happening, write to support at ${SUPPORT_EMAIL}${ref ? ` and mention reference ${ref}` : ''}.`,
  actionOffline:
    'I could not reach the server, so your change is not confirmed. The choice shown above is the current one. Check your connection, then try again.',
  actionBusy: 'Your choice was changed several times in a row, so this change was not saved. Wait a minute, then try again.',
  actionConflict: 'Your choice was being changed somewhere else at the same moment, so this change was not saved. The choice shown above is the current one. You can change it again.',
  actionServer: (ref: string | null) =>
    `The server could not save your change, so the choice shown above still stands. Try again. If it keeps happening, write to support at ${SUPPORT_EMAIL}${ref ? ` and mention reference ${ref}` : ''}.`,
  allow: 'Allow',
  withdraw: 'Withdraw',
  retry: 'Try again',
  confirmAllowTitle: 'Allow Roman and AI?',
  confirmWithdrawTitle: 'Withdraw your permission?',
  confirmWithdrawBody:
    'Roman and your coach\u2019s AI drafts will stop using your information. Your coaching, plan and messages carry on as before. You can allow it again at any time.',
  cancel: 'Cancel',
  accountLine:
    'Your training agreement, and The Growth Project and your coach using your information to coach you, stay in place while you have an account. To stop all collection, delete your account in Settings > Account > Delete account.',
  deleteAccount: 'Delete account',
  pendingWithdraw:
    'You switched Roman and AI off during setup, and that is not confirmed yet, so the choice above may still be in place. Tap Withdraw to try again now.',
} as const;

/**
 * What the status means for this build (backend #622 `state`).
 * Withdraw is offered whenever the latest decision is a grant, even of older
 * copy, so a client can always stop it.
 */
export function choiceOf(status: AiConsentStatusResponse): { choice: RomanAiChoice; withdrawable: boolean } {
  const latestIsGrant = status.state === 'granted' || status.state === 'needs_reconsent';
  if (status.current_version !== AI_CONSENT_VERSION) return { choice: 'update_app', withdrawable: latestIsGrant };
  if (status.state === 'granted' && status.granted && status.version === AI_CONSENT_VERSION) {
    return { choice: 'allowed', withdrawable: true };
  }
  if (latestIsGrant) return { choice: 'reconsent', withdrawable: true };
  return { choice: 'not_allowed', withdrawable: false };
}

/** The heading: "Allowed" only for a live server grant (C-310-2). */
export function headOf(status: AiConsentStatusResponse): string {
  return status.granted === true && status.state === 'granted' && !status.needs_reconsent
    ? ROMAN_AI_COPY.allowedHead
    : ROMAN_AI_COPY.notAllowedHead;
}

function toView(out: AiConsentOutcome): View_ {
  if (out.kind === 'ok' && out.status) return { phase: 'ready', status: out.status };
  if (out.kind === 'unavailable') return { phase: 'unavailable' };
  const status = out.kind === 'error' ? out.status : null;
  const requestId = out.kind === 'error' ? out.requestId ?? null : null;
  if (status === null && out.kind === 'error') return { phase: 'error', offline: true, reference: null };
  // Unexpected: a short reference, a support path, and a Sentry report.
  reportUnexpected('GET /me/ai-consent', { status, code: out.kind === 'error' ? out.code : out.kind, requestId });
  return { phase: 'error', offline: false, reference: shortReference(requestId) };
}

/**
 * What to say when Allow or Withdraw did not go through (owner rule
 * 2026-10-01 13:34: say what happened and what to do next).
 */
export function actionNoticeOf(out: Extract<AiConsentOutcome, { kind: 'error' }>, op: 'allow' | 'withdraw'): string {
  if (out.status === null) return ROMAN_AI_COPY.actionOffline;
  if (out.status === 429) return ROMAN_AI_COPY.actionBusy;
  if (out.status === 409 && out.code === 'AI_CONSENT_CONFLICT') return ROMAN_AI_COPY.actionConflict;
  reportUnexpected(op === 'allow' ? 'POST /me/ai-consent/roman' : 'DELETE /me/ai-consent/roman', out);
  return ROMAN_AI_COPY.actionServer(shortReference(out.requestId));
}

const defaultSessionUserId = () => readUserCacheSync()?.id ?? null;

export default function RomanAiConsentScreen({
  navigation,
  api = defaultApi,
  sessionUserId = defaultSessionUserId,
}: {
  navigation: NavigationProp<ParamListBase>;
  api?: RomanAiConsentApi;
  /** The signed-in user right now (pending onboarding withdrawal, B-310-5). */
  sessionUserId?: () => string | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState<View_>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** An onboarding "no" that is still not confirmed after trying again here. */
  const [pendingWithdraw, setPendingWithdraw] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const load = useCallback(async () => {
    setView({ phase: 'loading' });
    setNotice(null);
    const uid = sessionUserId();
    if (await readAiWithdrawalPending(uid)) {
      const drained = await drainAiWithdrawal(uid, api.withdrawRoman, () => sessionUserId() === uid);
      if (!mounted.current) return;
      setPendingWithdraw(drained === 'failed');
    } else {
      setPendingWithdraw(false);
    }
    const out = await api.getStatus();
    if (!mounted.current) return;
    if (out.kind === 'ok' && out.status) {
      const c = out.status.copy;
      // C-9: the server copy for this version must be the text shown here.
      const differs =
        c?.version === AI_CONSENT_VERSION &&
        ((!!c.sha256 && c.sha256.toLowerCase() !== AI_CONSENT_COPY_SHA256) ||
          (!!c.paragraph && c.paragraph.text !== AI_CONSENT_PARAGRAPH) ||
          (!!c.box_label && c.box_label.text !== AI_CONSENT_CHECKBOX_LABEL));
      if (differs) logger.warn('RomanAiConsent', 'server AI copy differs from the app copy for this version');
    }
    setView(toView(out));
  }, [api, sessionUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (kind: 'allow' | 'withdraw') => {
      if (busy) return;
      setBusy(true);
      setNotice(null);
      const uid = sessionUserId();
      // One queue, fenced by the account that made the choice (Sol B-310-7):
      // if that account is no longer signed in when the write's turn comes,
      // nothing is sent under the new session. Allow is newer than any
      // pending onboarding "no", so it clears that marker at its own turn.
      const out =
        kind === 'allow'
          ? await grantAiChoiceAs(uid, sessionUserId, () => api.grantRoman(romanGrantBody()))
          : await withdrawAiChoiceAs(uid, sessionUserId, () => api.withdrawRoman());
      if (!mounted.current) return;
      setBusy(false);
      if (out === AI_LEDGER_NOT_SENT) {
        setNotice(ROMAN_AI_COPY.notSent);
        return;
      }
      if (kind === 'allow' || out.kind === 'ok') setPendingWithdraw(false);
      if (out.kind === 'ok') {
        if (out.status) setView({ phase: 'ready', status: out.status });
        else await load();
        return;
      }
      if (out.kind === 'version_mismatch') {
        // #622: the 409 carries no version; re-read the current state, then explain.
        await load();
        if (mounted.current) setNotice(ROMAN_AI_COPY.updateApp);
        return;
      }
      if (out.kind === 'unavailable') {
        setNotice(ROMAN_AI_COPY.unavailable);
        return;
      }
      // Re-read, so the screen shows the choice that actually stands, then explain.
      const notice = actionNoticeOf(out, kind);
      await load();
      if (mounted.current) setNotice(notice);
    },
    [api, busy, load, sessionUserId],
  );

  const confirmAllow = () =>
    Alert.alert(ROMAN_AI_COPY.confirmAllowTitle, AI_CONSENT_CHECKBOX_LABEL.replace(/^Optional: /, ''), [
      { text: ROMAN_AI_COPY.cancel, style: 'cancel' },
      { text: ROMAN_AI_COPY.allow, onPress: () => void act('allow') },
    ]);
  const confirmWithdraw = () =>
    Alert.alert(ROMAN_AI_COPY.confirmWithdrawTitle, ROMAN_AI_COPY.confirmWithdrawBody, [
      { text: ROMAN_AI_COPY.cancel, style: 'cancel' },
      { text: ROMAN_AI_COPY.withdraw, style: 'destructive', onPress: () => void act('withdraw') },
    ]);

  const button = (label: string, onPress: () => void, testID: string, quiet = false) => (
    <HapticPressable
      intent="light"
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={[quiet ? styles.buttonQuiet : styles.button, busy && styles.disabled]}
      testID={testID}
    >
      <Text style={quiet ? styles.buttonQuietText : styles.buttonText}>{label}</Text>
    </HapticPressable>
  );

  function renderState() {
    if (view.phase === 'loading') {
      return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your choice" testID="roman-ai-loading" />;
    }
    if (view.phase === 'unavailable' || view.phase === 'error') {
      return (
        <View style={styles.card} testID={`roman-ai-${view.phase}`}>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {view.phase === 'unavailable'
              ? ROMAN_AI_COPY.unavailable
              : view.offline
                ? ROMAN_AI_COPY.loadOffline
                : ROMAN_AI_COPY.loadServer(view.reference)}
          </Text>
          {button(ROMAN_AI_COPY.retry, () => void load(), 'roman-ai-retry', true)}
        </View>
      );
    }
    const { choice, withdrawable } = choiceOf(view.status);
    // Opus C-310-2: "Allowed" only when the server says it is granted now
    // (never for an older grant waiting for a new choice).
    const head = headOf(view.status);
    const line =
      choice === 'allowed'
        ? ROMAN_AI_COPY.allowedBody
        : choice === 'reconsent'
          ? ROMAN_AI_COPY.reconsentBody
          : choice === 'update_app'
            ? ROMAN_AI_COPY.updateApp
            : ROMAN_AI_COPY.notAllowedBody;
    return (
      <View style={styles.card} testID={`roman-ai-${choice}`}>
        <Text style={styles.head} accessibilityRole="header" testID="roman-ai-state">{head}</Text>
        <Text style={styles.body}>{line}</Text>
        {choice === 'not_allowed' || choice === 'reconsent'
          ? button(ROMAN_AI_COPY.allow, confirmAllow, 'roman-ai-allow')
          : null}
        {withdrawable && pendingWithdraw ? (
          <Text style={styles.body} accessibilityLiveRegion="polite" testID="roman-ai-pending-withdraw">
            {ROMAN_AI_COPY.pendingWithdraw}
          </Text>
        ) : null}
        {withdrawable ? button(ROMAN_AI_COPY.withdraw, confirmWithdraw, 'roman-ai-withdraw', true) : null}
        {busy ? <ActivityIndicator color={colors.primary} accessibilityLabel="Saving your choice" /> : null}
      </View>
    );
  }

  return (
    // C-310-4: excluded from analytics autocapture, so the Allow / Withdraw
    // choice never reaches product analytics.
    <View style={styles.container} testID="roman-ai-screen" ph-no-capture>
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle} accessibilityRole="header">{ROMAN_AI_COPY.title}</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body} testID="roman-ai-paragraph">{AI_CONSENT_PARAGRAPH}</Text>
        {renderState()}
        {notice ? (
          <Text style={styles.notice} accessibilityLiveRegion="polite" testID="roman-ai-notice">{notice}</Text>
        ) : null}
        {/* Owner 10-01 20:32 + OR-110-1: chats are kept until the client deletes
            them or their account, so they can be found and deleted here. */}
        {button(ROMAN_CHATS_COPY.entryLabel, () => navigation.navigate('RomanConversations'), 'roman-ai-conversations', true)}
        <View style={styles.divider} />
        <Text style={styles.caption} testID="roman-ai-account-line">{ROMAN_AI_COPY.accountLine}</Text>
        {button(ROMAN_AI_COPY.deleteAccount, () => navigation.navigate('DeleteAccount'), 'roman-ai-delete-account', true)}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    topTitle: { fontFamily: 'Inter_500Medium', fontSize: 17, color: colors.textPrimary },
    content: { padding: 24, paddingBottom: 48, gap: 16 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 16,
      gap: 12,
      backgroundColor: colors.surface,
    },
    head: { fontFamily: 'Inter_500Medium', fontSize: 17, color: colors.textPrimary },
    body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: colors.textPrimary },
    caption: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    notice: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    divider: { height: 1, backgroundColor: colors.divider },
    button: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
    },
    buttonText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textOnPrimary },
    buttonQuiet: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
    },
    buttonQuietText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
    disabled: { opacity: 0.5 },
  });
}

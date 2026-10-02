import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import {
  approvalFor,
  dunningApi,
  formatDunningAmount,
  formatDunningTotals,
  type ApprovedInvoice,
  type CardUpdateResponse,
  type ClientDunningStatus,
  type PaymentQuote,
} from './dunningApi';
import {
  cancelOutcomeCopy,
  cardUpdateOutcomeCopy,
  describeDunningError,
  SUPPORT_EMAIL,
  type DunningErrorCopy,
} from './dunningErrorCopy';
import { useDunning } from './DunningLockoutProvider';
import { supportMailto } from './DunningLockoutScreen';
import { confirmWithBank, handleStripeReturnUrl, runNativeCardUpdate } from './updateCard';

/**
 * Native "Update card" screen (OR-110-2). Target of the in-app banner, the
 * lockout screen, ClientPackages, `tgp://billing/update-card` and the
 * universal link https://app.trygrowthproject.com/billing/update-card that
 * the dunning emails carry. Reachable while locked (REACHABLE_WHILE_LOCKED;
 * the backend allow-list keeps its three routes open).
 */

export const UPDATE_CARD_ROUTE = 'UpdateCard';

export interface UpdateCardScreenProps {
  route?: { params?: { autostart?: boolean } };
  navigation?: {
    canGoBack?: () => boolean;
    goBack?: () => void;
    navigate?: (name: string, params?: object) => void;
  };
}

type Busy = null | 'card' | 'bank' | 'cancel' | 'confirming';

/** What the screen can still do after a run that did not settle. */
type Pending =
  | null
  | { kind: 'bank'; setupIntentId: string; clientSecret: string }
  | { kind: 'unconfirmed'; setupIntentId: string }
  | { kind: 'approval'; setupIntentId: string; quote: PaymentQuote };

function inDunning(status: ClientDunningStatus | null | undefined): boolean {
  return Boolean(status?.enabled && (status.state === 'past_due' || status.state === 'locked'));
}

/** What this screen will do with the money, said before the client acts. */
export function updateCardIntro(status: ClientDunningStatus | null | undefined): string {
  const amount = formatDunningAmount(status?.amount_cents ?? null, status?.currency ?? null);
  const coach = status?.coach_name ?? 'your coach';
  if (inDunning(status) && status?.state === 'locked') {
    return amount
      ? `Your payment of ${amount} to ${coach} did not go through, so your plan is paused. Add a card that works and we charge ${amount} to it right away. Your plan comes back as soon as it clears.`
      : `Your last payment to ${coach} did not go through, so your plan is paused. Add a card that works and we charge the open balance right away. Your plan comes back as soon as it clears.`;
  }
  if (inDunning(status)) {
    return amount
      ? `Your payment of ${amount} to ${coach} did not go through. Add a card that works and we charge ${amount} to it right away. You keep full access while you sort it out.`
      : `Your last payment to ${coach} did not go through. Add a card that works and we charge the open balance right away. You keep full access while you sort it out.`;
  }
  return 'Add a new card for your plan. If a payment is overdue, we charge it to this card right away. Otherwise your next payment will use it.';
}

/**
 * B-322-6: the label names exactly what the confirm will charge, from the
 * quote read just before the sheet opens (per currency, never summed).
 */
export function sheetButtonLabel(quote: PaymentQuote | null | undefined): string {
  const total = formatDunningTotals(quote?.totals ?? []);
  return total ? `Save card and pay ${total}` : 'Save card';
}

/** C-322-1: "access ends now" only while a payment is overdue; otherwise period end. */
export function endPlanAlertBody(status: ClientDunningStatus | null | undefined): string {
  const amount = formatDunningAmount(status?.amount_cents ?? null, status?.currency ?? null);
  if (inDunning(status) && status?.kind !== 'dispute') {
    return `${amount ? `The unpaid ${amount} is canceled, so you are not charged for it.` : 'The unpaid balance is canceled, so you are not charged for it.'} Your access ends now. If a payment went through in the meantime, you keep the period you paid for instead. Your data stays in your account.`;
  }
  return 'Your plan ends at the end of the period you already paid for, and you will not be charged again. There is no refund for the current period. Your data stays in your account.';
}

export function UpdateCardScreen({ route, navigation }: UpdateCardScreenProps) {
  const dunning = useDunning();
  const { semanticColors, colorScheme } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const status = dunning?.status ?? null;
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<DunningErrorCopy | null>(null);
  const [result, setResult] = useState<{
    response: CardUpdateResponse;
    setupIntentId: string;
  } | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const approvedRef = useRef<ApprovedInvoice[]>([]);
  const autostarted = useRef(false);

  // Bank redirects during 3DS come back on tgp://stripe-redirect.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleStripeReturnUrl(url);
    });
    return () => sub.remove();
  }, []);

  const settle = useCallback(
    async (next: Awaited<ReturnType<typeof runNativeCardUpdate>>) => {
      setPending(null);
      if (next.kind === 'error') {
        setError(next.error);
      } else if (next.kind === 'done') {
        setResult({
          response: next.response,
          setupIntentId: next.setupIntentId,
        });
        if (next.response.outcome === 'approval_required' && next.response.quote) {
          setPending({
            kind: 'approval',
            setupIntentId: next.setupIntentId,
            quote: next.response.quote,
          });
        } else if (next.response.outcome === 'requires_action' && next.response.payment_intent_client_secret) {
          setPending({
            kind: 'bank',
            setupIntentId: next.setupIntentId,
            clientSecret: next.response.payment_intent_client_secret,
          });
        }
      } else if (next.kind === 'bank_pending') {
        if (next.response)
          setResult({
            response: next.response,
            setupIntentId: next.setupIntentId,
          });
        setError(next.error);
        setPending({
          kind: 'bank',
          setupIntentId: next.setupIntentId,
          clientSecret: next.clientSecret,
        });
      } else if (next.kind === 'unconfirmed') {
        setError(next.error);
        setPending({ kind: 'unconfirmed', setupIntentId: next.setupIntentId });
      }
      // Re-read either way: a payment may have cleared the lock, and a
      // failure may have been a lost answer on a payment that went through.
      if (next.kind !== 'canceled') await dunning?.refresh();
    },
    [dunning],
  );

  /** Every screen action runs through here so no rejection goes uncaught (autostart included). */
  const run = useCallback(
    async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
      if (busy) return;
      setBusy(kind);
      setError(null);
      try {
        await work();
      } catch (err) {
        setError(describeDunningError(err, kind === 'card' ? 'update_card' : 'confirm_card'));
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const startCard = useCallback(
    () =>
      run('card', async () => {
        setResult(null);
        setPending(null);
        // B-322-6: read what is owed right now, before the sheet opens.
        let fresh: PaymentQuote;
        try {
          fresh = await dunningApi.getPaymentQuote();
        } catch (err) {
          setError(describeDunningError(err, 'update_card'));
          return;
        }
        setQuote(fresh);
        approvedRef.current = approvalFor(fresh);
        await settle(
          await runNativeCardUpdate({
            surface: 'UpdateCardScreen',
            colorScheme,
            primaryButtonLabel: sheetButtonLabel(fresh),
            approved: approvedRef.current,
            onConfirming: () => setBusy('confirming'),
          }),
        );
      }),
    [colorScheme, run, settle],
  );

  const resume = useCallback(
    () =>
      run(pending?.kind === 'bank' ? 'bank' : 'confirming', async () => {
        if (!pending) return;
        if (pending.kind === 'approval') {
          // Re-approve the fresh amounts the server just quoted, same card.
          setQuote(pending.quote);
          approvedRef.current = approvalFor(pending.quote);
        }
        await settle(
          await confirmWithBank({
            surface: 'UpdateCardScreen',
            setupIntentId: pending.setupIntentId,
            clientSecret: pending.kind === 'bank' ? pending.clientSecret : null,
            approved: approvedRef.current,
            onConfirming: () => setBusy('confirming'),
          }),
        );
      }),
    [pending, run, settle],
  );

  useEffect(() => {
    if (route?.params?.autostart && !autostarted.current) {
      autostarted.current = true;
      void startCard();
    }
  }, [route?.params?.autostart, startCard]);

  const leave = useCallback(() => {
    if (navigation?.canGoBack?.()) navigation.goBack?.();
    else navigation?.navigate?.('Home');
  }, [navigation]);

  const endPlan = useCallback(() => {
    if (!dunning || busy) return;
    Alert.alert(inDunning(status) ? 'End your plan now?' : 'End your plan?', endPlanAlertBody(status), [
      { text: 'Keep my plan', style: 'cancel' },
      {
        text: 'End my plan',
        style: 'destructive',
        onPress: () => {
          setBusy('cancel');
          setError(null);
          void dunning
            .endPlan('UpdateCardScreen')
            .then((out) => {
              if (out.ok) {
                const c = cancelOutcomeCopy(out.response);
                Alert.alert(c.title, c.body);
                leave();
              } else {
                setError(out.error);
              }
            })
            .finally(() => setBusy(null));
        },
      },
    ]);
  }, [dunning, busy, status, leave]);

  const contactSupport = useCallback(async () => {
    setMailError(null);
    const reference = error?.reference ?? null;
    try {
      await Linking.openURL(supportMailto(reference));
    } catch {
      setMailError(
        `No email app opened on this device. Write to ${SUPPORT_EMAIL}${reference ? ` and include reference ${reference}` : ''}.`,
      );
    }
  }, [error]);

  const outcome = result ? cardUpdateOutcomeCopy(result.response) : null;
  const settled = !pending && result && ['paid', 'saved', 'processing'].includes(result.response.outcome);
  const needsBank = pending?.kind === 'bank';
  const quoteTotal = formatDunningTotals(quote?.totals ?? []);
  const resumeLabel =
    pending?.kind === 'approval'
      ? `Pay ${formatDunningTotals(pending.quote.totals) ?? 'the new amount'}`
      : pending?.kind === 'unconfirmed'
        ? 'Check my payment again'
        : null;
  const cardOnFile = status?.card_last4
    ? `The card on file ends in ${status.card_last4}${inDunning(status) ? ' and was declined' : ''}.`
    : null;

  return (
    <SafeAreaView style={styles.root} testID="update-card-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={Boolean(dunning?.refreshing)} onRefresh={() => void dunning?.refresh()} />
        }
      >
        <TouchableOpacity onPress={leave} accessibilityRole="button" testID="update-card-back" style={styles.back}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.eyebrow}>Payment</Text>
        <Text style={styles.title} accessibilityRole="header">
          Update your card
        </Text>
        <Text style={styles.body} testID="update-card-intro">
          {updateCardIntro(status)}
        </Text>
        {cardOnFile ? <Text style={styles.meta}>{cardOnFile}</Text> : null}
        {quoteTotal && !settled ? (
          <Text style={styles.meta} testID="update-card-quote">
            {`Saving this card pays ${quoteTotal} now.`}
          </Text>
        ) : null}
        {busy === 'confirming' ? (
          <Text style={styles.meta} testID="update-card-confirming" accessibilityRole="alert">
            Confirming your payment with the server. This can take a few seconds.
          </Text>
        ) : null}

        {outcome ? (
          <View
            style={[styles.result, outcome.tone === 'done' ? styles.resultDone : styles.resultAction]}
            testID={`update-card-result-${result?.response.outcome}`}
            accessibilityRole="alert"
          >
            <Text style={styles.resultTitle}>{outcome.title}</Text>
            <Text style={styles.resultBody}>{outcome.body}</Text>
          </View>
        ) : null}
        {error ? (
          <Text style={styles.notice} testID="update-card-error" accessibilityRole="alert">
            {error.message}
          </Text>
        ) : null}

        {settled ? (
          <TouchableOpacity style={styles.primary} onPress={leave} accessibilityRole="button" testID="update-card-done">
            <Text style={styles.primaryText}>Done</Text>
          </TouchableOpacity>
        ) : resumeLabel ? (
          <TouchableOpacity
            style={[styles.primary, busy ? styles.disabled : null]}
            onPress={resume}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="update-card-resume"
          >
            {busy ? (
              <ActivityIndicator color={semanticColors.textOnDisabled} />
            ) : (
              <Text style={styles.primaryText}>{resumeLabel}</Text>
            )}
          </TouchableOpacity>
        ) : needsBank ? (
          <TouchableOpacity
            style={[styles.primary, busy ? styles.disabled : null]}
            onPress={resume}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="update-card-confirm-bank"
          >
            {busy === 'bank' ? (
              <ActivityIndicator color={semanticColors.textOnDisabled} />
            ) : (
              <Text style={styles.primaryText}>Confirm with my bank</Text>
            )}
          </TouchableOpacity>
        ) : null}
        {needsBank ? (
          <TouchableOpacity
            style={styles.secondary}
            onPress={startCard}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="update-card-different"
          >
            <Text style={styles.secondaryText}>Use a different card</Text>
          </TouchableOpacity>
        ) : null}
        {settled || needsBank ? null : (
          <TouchableOpacity
            style={[styles.primary, busy ? styles.disabled : null]}
            onPress={startCard}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="update-card-add"
          >
            {busy === 'card' ? (
              <ActivityIndicator color={semanticColors.textOnDisabled} />
            ) : (
              <Text style={styles.primaryText}>
                {result?.response.outcome === 'declined' ? 'Try a different card' : 'Add a card'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {inDunning(status) && status?.purchase_id && !settled ? (
          <TouchableOpacity
            style={styles.secondary}
            onPress={endPlan}
            disabled={busy !== null}
            accessibilityRole="button"
            testID="update-card-end-plan"
          >
            {busy === 'cancel' ? (
              <ActivityIndicator color={semanticColors.textPrimary} />
            ) : (
              <Text style={styles.secondaryText}>End my plan instead</Text>
            )}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.row}
          onPress={contactSupport}
          accessibilityRole="button"
          testID="update-card-support"
        >
          <Text style={styles.rowText}>Email support</Text>
        </TouchableOpacity>
        {mailError ? <Text style={styles.notice}>{mailError}</Text> : null}

        <Text style={styles.footnote}>
          Card details go straight to Stripe, our payment provider. The Growth Project never sees your full card number.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default UpdateCardScreen;

const makeStyles = (c: SemanticTokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bgPrimary },
    content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
    back: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 16 },
    backText: { fontSize: 15, color: c.accentText },
    eyebrow: {
      fontSize: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: c.textMuted,
      marginBottom: 8,
    },
    title: {
      fontSize: 26,
      fontWeight: '600',
      color: c.textPrimary,
      marginBottom: 16,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: c.textPrimary,
      marginBottom: 8,
    },
    meta: { fontSize: 13, lineHeight: 19, color: c.textMuted, marginBottom: 8 },
    result: {
      borderWidth: 1,
      padding: 14,
      marginTop: 12,
      backgroundColor: c.bgSurface,
    },
    resultDone: { borderColor: c.border },
    resultAction: { borderColor: c.accent },
    resultTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textPrimary,
      marginBottom: 4,
    },
    resultBody: { fontSize: 14, lineHeight: 20, color: c.textPrimary },
    notice: {
      fontSize: 13,
      lineHeight: 19,
      color: c.accentText,
      marginTop: 12,
    },
    primary: {
      backgroundColor: c.accent,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 20,
    },
    disabled: { backgroundColor: c.disabledBg },
    primaryText: { color: c.textOnAccent, fontSize: 15, fontWeight: '600' },
    secondary: {
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
    },
    secondaryText: { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
    row: {
      paddingVertical: 14,
      marginTop: 24,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowText: { fontSize: 15, color: c.textPrimary },
    footnote: {
      fontSize: 12,
      lineHeight: 17,
      color: c.textMuted,
      marginTop: 24,
    },
  });

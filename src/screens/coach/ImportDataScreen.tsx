/**
 * ImportDataScreen — coach-facing entry to the v0.3 site-agnostic import.
 *
 * Scope: intro → data-driven platform picker (incl. Custom/Other) → safe
 * external login-site open → live pairing (PR-M2). Once the coach has opened
 * their prior platform's login page, the ExtensionPairingPanel mints a pairing
 * code and polls it to the `paired` terminal so the browser extension can take
 * over. This screen NEVER claims import progress or completion: the mobile
 * contract has no progress read, so `paired` ("running in the extension") is
 * the truthful terminal it can show.
 *
 * Gated by featureFlags.extensionImport (default OFF): when OFF the route and
 * Settings row do not register, so the screen — and its only network path, the
 * pairing panel — never mount.
 *
 * Process-restart continuity (M5-C): the flow sends the coach out of the app, so
 * an OS kill mid-pairing relaunches into this screen's `intro` phase with the
 * pairing panel unmounted — the durable mirror written by useExtensionPairing
 * would never be read. On mount, once the signed-in coach is known and the flag
 * is ON, this screen peeks that user-scoped mirror and, if a pending session
 * exists, re-enters `awaitingExtension` for the platform it was minted for so
 * the panel mounts and the hook restores (and server-validates) the session.
 * The peek is a local read only; it never claims the session is still live and
 * never overrides a phase the coach has already moved to.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import type { ThemeColors } from '../../theme/ThemeProvider';
import { CUSTOM_PLATFORM_ID, findImportPlatform } from '../../constants/importPlatforms';
import { safeImportLoginUrl } from '../../utils/safeImportLoginUrl';
import { track } from '../../analytics/posthog.service';
import { AnalyticsEvents } from '../../analytics/events';
import type { ImportFlowState } from '../../types/extensionImport';
import ExtensionPairingPanel from '../../components/coach/ExtensionPairingPanel';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { readImportPairingMirror } from '../../storage/importPairingMirror';
import { useImportOfferDecision } from '../../hooks/useImportOfferDecision';
import { ImportSetupView } from './import-journey/ImportSetupView';

export default function ImportDataScreen(): React.ReactElement {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [state, setState] = useState<ImportFlowState>({ phase: 'intro' });
  const userId = useCurrentUser()?.id ?? null;
  // UX-01 account-scoped offer-decision consumer (accepted contract; this
  // screen does not own storage/identity). Used ONLY to give the J3 restyle's
  // "Later" a truthful action — deferring the import per J1 — never to infer
  // eligibility or mount anything on Home.
  const { recordDecision } = useImportOfferDecision();
  // Ephemeral, screen-local UI state (same category as the existing
  // `intro`/`customUrlEntry` phases per the state matrix's "UI-only phases"
  // allowance): holds what the coach has highlighted in the ImportSetupView
  // radio group BEFORE they confirm with Continue. It is never persisted,
  // never a new ImportFlowState phase, and never itself triggers navigation
  // or a login open — only Continue does, via the existing selectPlatform.
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);

  React.useEffect(() => {
    track(AnalyticsEvents.IMPORT_ENTRY_OPENED);
  }, []);

  // Resume a pairing session that survived a process death (see header). Runs
  // when the coach identity resolves; a flag-OFF build reads no storage at all.
  useEffect(() => {
    if (!featureFlags.extensionImport || !userId) return;
    let abandoned = false;
    void (async () => {
      const pending = await readImportPairingMirror(userId);
      if (abandoned || !pending) return;
      setState((prev) =>
        prev.phase === 'intro'
          ? { phase: 'awaitingExtension', platformId: pending.platformId }
          : prev,
      );
    })();
    return () => {
      abandoned = true;
    };
  }, [userId]);

  const openLogin = useCallback(async (platformId: string, rawUrl: string | null) => {
    const safe = safeImportLoginUrl(rawUrl);
    if (!safe) {
      setState({
        phase: 'failed',
        message:
          'That site link is not a valid, secure (https) web address. Check it and try again.',
      });
      track(AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: platformId, reason: 'invalid_url' });
      return;
    }
    setState({ phase: 'openingLogin', platformId, loginUrl: safe });
    try {
      const supported = await Linking.canOpenURL(safe);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(safe);
      track(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: platformId });
      setState({ phase: 'awaitingExtension', platformId });
    } catch {
      track(AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: platformId, reason: 'open_failed' });
      setState({ phase: 'failed', message: "We couldn't open that site in your browser. Please try again." });
    }
  }, []);

  const selectPlatform = useCallback(
    (platformId: string) => {
      track(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: platformId });
      if (platformId === CUSTOM_PLATFORM_ID) {
        setState({ phase: 'customUrlEntry', url: '', valid: false });
        return;
      }
      const platform = findImportPlatform(platformId);
      void openLogin(platformId, platform?.loginUrl ?? null);
    },
    [openLogin],
  );

  const onCustomUrlChange = useCallback((text: string) => {
    setState({ phase: 'customUrlEntry', url: text, valid: safeImportLoginUrl(text) != null });
  }, []);

  // J3 source-selection presentation (bounded T2 variant, per parent
  // disposition (a)): the donor `ImportSetupView` is used exactly as
  // exported and its default two-step contract is preserved unchanged
  // (`onSourceChange` remains pure selection state; only `onContinue` —
  // the same primary action the donor's own tests assert fires only on
  // the Continue button — triggers the real, pre-existing controller
  // action). No `computerHandoff` step, no new endpoint/flag/storage.
  const onSourceHighlighted = useCallback((platformId: string) => {
    setHighlightedSourceId(platformId);
  }, []);

  const onSourceContinue = useCallback(() => {
    if (!highlightedSourceId) return; // Continue is disabled by ImportSetupView until a selection exists.
    selectPlatform(highlightedSourceId);
  }, [highlightedSourceId, selectPlatform]);

  const onCustomSourceContinue = useCallback(() => {
    if (state.phase !== 'customUrlEntry') return;
    void openLogin(CUSTOM_PLATFORM_ID, state.url);
  }, [state, openLogin]);

  const onBackFromSourceSelection = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const onLaterFromSourceSelection = useCallback(() => {
    // Truthful J1 defer through the accepted UX-01 contract. The write is
    // awaited (serialized inside the hook regardless of this screen's mount
    // state) before navigating away; a `false` result — disabled, unresolved
    // identity, or a failed write — needs no error UI per the contract's own
    // rule, and no "saved to your account" claim is ever shown either way.
    void (async () => {
      await recordDecision('later');
      navigation.goBack();
    })();
  }, [navigation, recordDecision]);

  // R2/R3 closure (independent T2 review, Finding A + parent grant clause
  // "preserve the preexisting post-login reselection affordance where the
  // removed base picker allowed it"): the base screen kept its platform
  // picker mounted alongside both the `failed` banner AND the pairing panel
  // in `awaitingExtension`, so a coach could switch platforms in place from
  // either state. The J3 restyle's early-return branching lost both paths;
  // this single pure local state reset restores both (reused verbatim by
  // the `failed` and `awaitingExtension` render branches below) — no new
  // endpoint/flag/storage/timer, no navigation, no pairing/auth change, no
  // controller change — back to the same `intro` phase the coach started
  // from, also clearing the ephemeral highlight so the picker opens
  // unselected, matching intro. `openingLogin` intentionally keeps no such
  // action: it is transient and resolves on its own within moments, and no
  // prior test required reselection to be reachable from it.
  const onTryAnotherPlatform = useCallback(() => {
    setHighlightedSourceId(null);
    setState({ phase: 'intro' });
  }, []);

  const styles = makeStyles(colors);

  // J3 source selection (bounded T2 presentation variant): the donor
  // ImportSetupView, used exactly as exported, owns the full screen body
  // for these two phases (it renders its own KeyboardAvoidingView/
  // ScrollView, exactly as every donor test mounts it standalone — nesting
  // it inside this screen's own ScrollView would be an invalid nested-
  // scroll layout, not a presentation choice). Its default two-step
  // contract is preserved unchanged: `onSourceChange` is pure highlight
  // state (the donor's own tested meaning); Continue — enabled only once a
  // selection/valid URL exists, exactly per the donor's own `canContinue`
  // logic — is the single explicit action that invokes the real existing
  // controller (`selectPlatform` / `openLogin`). No `computerHandoff` step,
  // no new endpoint/flag/storage. openingLogin/awaitingExtension below keep
  // the screen's original shell untouched; `failed` keeps it too, plus one
  // small restored affordance (R2 closure, Finding A, below).
  // R2 closure (independent T2 review, Finding B): the base screen showed
  // this exact credential-handling reassurance above the platform list, so
  // it was visible before the coach committed to a platform. ImportSetupView
  // does not render this copy itself, so it is composed above it here —
  // same existing copy, same existing styles/role, no new donor authority,
  // no new string — for both source-selection phases, visible before
  // Continue can ever be pressed.
  const sourceSelectionPrereq = (
    <View style={styles.prereq} accessibilityRole="summary">
      <Ionicons name="information-circle-outline" size={18} color={colors.info} />
      <Text style={styles.prereqText}>
        You'll log in with your own account. The Growth Project browser extension then
        asks to start the import — we never see or store your other platform's password.
      </Text>
    </View>
  );

  if (state.phase === 'intro') {
    return (
      <View style={styles.setupShell}>
        {sourceSelectionPrereq}
        <ImportSetupView
          step="source"
          romanEnabled={featureFlags.romanChat}
          selectedSourceId={highlightedSourceId}
          customSourceUrl=""
          validation="idle"
          onSourceChange={onSourceHighlighted}
          onCustomSourceChange={onCustomUrlChange}
          onCustomSourceBlur={() => {}}
          onContinue={onSourceContinue}
          onBack={onBackFromSourceSelection}
          onLater={onLaterFromSourceSelection}
        />
      </View>
    );
  }

  if (state.phase === 'customUrlEntry') {
    return (
      <View style={styles.setupShell}>
        {sourceSelectionPrereq}
        <ImportSetupView
          step="customSource"
          romanEnabled={featureFlags.romanChat}
          selectedSourceId={CUSTOM_PLATFORM_ID}
          customSourceUrl={state.url}
          validation={state.url.length > 0 && !state.valid ? 'invalid' : 'idle'}
          onSourceChange={onSourceHighlighted}
          onCustomSourceChange={onCustomUrlChange}
          onCustomSourceBlur={() => {}}
          onContinue={onCustomSourceContinue}
          onBack={onBackFromSourceSelection}
          onLater={onLaterFromSourceSelection}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="import-data-screen">
      <Text style={styles.title} accessibilityRole="header">
        Import your coaching data
      </Text>
      <Text style={styles.body}>
        Bring your clients and history across from a platform you already use. Pick a
        service below to open its login page in your browser.
      </Text>

      <View style={styles.prereq} accessibilityRole="summary">
        <Ionicons name="information-circle-outline" size={18} color={colors.info} />
        <Text style={styles.prereqText}>
          You'll log in with your own account. The Growth Project browser extension then
          asks to start the import — we never see or store your other platform's password.
        </Text>
      </View>

      {state.phase === 'failed' && (
        <View style={[styles.status, styles.statusError]} accessibilityLiveRegion="polite" testID="import-status">
          <Text style={styles.statusText}>{state.message}</Text>
          {/* R2 closure (independent T2 review, Finding A): the base screen
              kept the platform picker mounted alongside this banner so a
              coach could immediately retry a different (or the same)
              platform in place. This restores that in-screen path as a
              pure local phase reset back to `intro` — no navigation, no
              new endpoint/flag/storage, no controller change. */}
          <TouchableOpacity
            style={styles.retryLink}
            onPress={onTryAnotherPlatform}
            accessibilityRole="button"
            accessibilityLabel="Choose a different platform"
            testID="import-try-another-platform"
          >
            <Text style={styles.retryLinkText}>Choose a different platform</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.phase === 'openingLogin' && (
        <View style={[styles.status, styles.statusInfo]} accessibilityLiveRegion="polite" testID="import-status">
          <Text style={styles.statusText}>Opening the login page…</Text>
        </View>
      )}

      {state.phase === 'awaitingExtension' && (
        <View style={styles.awaiting} accessibilityLiveRegion="polite" testID="import-status">
          {/* Reached both right after opening the login page and when a pending
              session is resumed after a relaunch, so it must not assert that a
              page "was just opened". */}
          <Text style={styles.statusText}>
            Log in to {awaitingPlatformLabel(state.platformId)} in your browser, then enter the
            pairing code below in the Growth Project browser extension. Nothing is imported until
            you confirm in the extension.
          </Text>
          {/* Keyed so choosing a different platform remounts the panel: the
              hook re-hydrates for the new slug and a mirrored session for the
              old one is discarded, never shown under the wrong platform. */}
          <ExtensionPairingPanel key={state.platformId} platformId={state.platformId} />
          {/* R3 closure (independent T2 review, parent grant clause: preserve
              the preexisting post-login reselection affordance where the
              removed base picker allowed it). The base kept every platform
              row reachable here too, so the coach could switch mid-pairing;
              this reuses the exact same pure local-reset action already
              restored for `failed`, with the same semantics — no new state,
              no pairing/auth change, no probe. Leaving the transient
              `openingLogin` phase without this action is unchanged from r2:
              no prior test required it there, and it resolves to either
              `awaitingExtension` or `failed` almost immediately on its own. */}
          <TouchableOpacity
            style={styles.retryLink}
            onPress={onTryAnotherPlatform}
            accessibilityRole="button"
            accessibilityLabel="Choose a different platform"
            testID="import-try-another-platform"
          >
            <Text style={styles.retryLinkText}>Choose a different platform</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function awaitingPlatformLabel(platformId: string): string {
  if (platformId === CUSTOM_PLATFORM_ID) return 'your platform';
  return findImportPlatform(platformId)?.label ?? 'your platform';
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 12 },
    // R2 closure (Finding B): stacks the restored prereq banner above
    // ImportSetupView, which owns its own flex:1 scroll body beneath it.
    setupShell: { flex: 1, backgroundColor: colors.background },
    title: { fontSize: 24, fontWeight: '600', color: colors.textPrimary },
    body: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
    prereq: {
      flexDirection: 'row',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    prereqText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    status: { padding: 14, borderRadius: 12 },
    statusInfo: { backgroundColor: colors.surface },
    statusError: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error },
    statusText: { fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    awaiting: { gap: 12, marginTop: 4 },
    // R2 closure (Finding A): a plain in-place text action, matching the
    // screen's existing understated link styling elsewhere (e.g. Later).
    retryLink: { marginTop: 10, minHeight: 44, justifyContent: 'center' },
    retryLinkText: { fontSize: 14, fontWeight: '600', color: colors.primary, textDecorationLine: 'underline' },
  });
}

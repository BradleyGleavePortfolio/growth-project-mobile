/**
 * AiRefusalNotice: the one inline notice every AI surface shows for the two
 * backend R2b refusals (see src/lib/ai/aiRefusal.ts).
 *
 *   consent_required, client  "AI help is off" + "Allow AI help", which opens
 *                             AiConsentSheet (box 2 of the D2 consent). After
 *                             a recorded grant the surface retries the request.
 *   consent_required, coach   "This client has not allowed AI help" + the
 *                             coach can still coach as usual; "Try again".
 *   egress_blocked (503)      "AI help is paused on our side" + the short
 *                             reference, "Contact support" and "Copy reference".
 *
 * Never a generic "Something went wrong"; never asks the person to change
 * consent for a server defect.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AiConsentSheet, { type AiConsentSheetApi } from './AiConsentSheet';
import { useOpenSupport } from './useOpenSupport';
import {
  aiRefusalCopy,
  type AiAudience,
  type AiRefusal,
  type AiSurface,
} from '../../lib/ai/aiRefusal';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';

export const AI_REFUSAL_ACTIONS = {
  allow: 'Allow AI help',
  tryAgain: 'Try again',
  contactSupport: 'Contact support',
  copyReference: 'Copy reference',
  copied: 'Reference copied',
} as const;

export interface AiRefusalNoticeProps {
  refusal: AiRefusal;
  audience: AiAudience;
  surface: AiSurface;
  /** Re-run the refused request (after a grant, or the coach's "Try again"). */
  onRetry?: () => void;
  /** Injected in tests. */
  consentApi?: AiConsentSheetApi;
  /** Overrides the navigator-based support path (tests, or a custom route). */
  onContactSupport?: () => void;
  /** Compact layout for small cards (wearable insight, triage). */
  compact?: boolean;
  testID?: string;
}

export default function AiRefusalNotice({
  refusal,
  audience,
  surface,
  onRetry,
  consentApi,
  onContactSupport,
  compact = false,
  testID = 'ai-refusal',
}: AiRefusalNoticeProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = makeStyles(colors, compact);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const navSupport = useOpenSupport();
  const openSupport = onContactSupport ?? navSupport;
  const copy = aiRefusalCopy(refusal, audience, surface);

  const onGranted = useCallback(() => {
    setSheetOpen(false);
    onRetry?.();
  }, [onRetry]);

  const copyReference = useCallback(async () => {
    if (refusal.kind !== 'egress_blocked' || !refusal.reference) return;
    try {
      await Clipboard.setStringAsync(refusal.reference);
      setCopied(true);
    } catch {
      // The reference stays visible and selectable; nothing else to do.
      setCopied(false);
    }
  }, [refusal]);

  const button = (label: string, onPress: () => void, id: string, primary: boolean) => (
    <TouchableOpacity
      key={id}
      style={primary ? styles.primary : styles.secondary}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`${testID}-${id}`}
    >
      <Text style={primary ? styles.primaryLabel : styles.secondaryLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const actions: React.ReactElement[] = [];
  if (refusal.kind === 'consent_required') {
    if (audience === 'client') {
      actions.push(button(AI_REFUSAL_ACTIONS.allow, () => setSheetOpen(true), 'allow', true));
    } else if (onRetry) {
      actions.push(button(AI_REFUSAL_ACTIONS.tryAgain, onRetry, 'retry', true));
    }
  } else {
    if (openSupport) {
      actions.push(button(AI_REFUSAL_ACTIONS.contactSupport, () => void openSupport(), 'support', true));
    }
    if (refusal.reference) {
      actions.push(
        button(
          copied ? AI_REFUSAL_ACTIONS.copied : AI_REFUSAL_ACTIONS.copyReference,
          () => void copyReference(),
          'copy-reference',
          !openSupport,
        ),
      );
    }
  }

  // Without an in-app support route, the server's own message names the
  // support address, so the person still has a working path.
  const fallbackSupportLine =
    refusal.kind === 'egress_blocked' && !openSupport ? refusal.serverMessage : null;

  return (
    <View
      style={styles.card}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Text style={styles.title} testID={`${testID}-title`}>
        {copy.title}
      </Text>
      <Text style={styles.body} testID={`${testID}-body`}>
        {copy.body}
      </Text>
      {fallbackSupportLine ? (
        <Text selectable style={styles.body} testID={`${testID}-server-message`}>
          {fallbackSupportLine}
        </Text>
      ) : null}
      {copy.referenceLine ? (
        <Text selectable style={styles.reference} testID={`${testID}-reference`}>
          {copy.referenceLine}
        </Text>
      ) : null}
      {actions.length > 0 ? <View style={styles.actions}>{actions}</View> : null}
      {refusal.kind === 'consent_required' && audience === 'client' ? (
        <AiConsentSheet
          visible={sheetOpen}
          onGranted={onGranted}
          onClose={() => setSheetOpen(false)}
          onContactSupport={openSupport ? () => void openSupport() : undefined}
          api={consentApi}
          testID={`${testID}-consent-sheet`}
        />
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors, compact: boolean) {
  return StyleSheet.create({
    card: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: compact ? 12 : 16,
      marginHorizontal: compact ? 0 : 16,
      marginVertical: 8,
    },
    title: { fontSize: compact ? 15 : 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: 6 },
    reference: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    primary: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '600' },
    secondary: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLabel: { color: colors.primary, fontSize: 15, fontWeight: '500' },
  });
}

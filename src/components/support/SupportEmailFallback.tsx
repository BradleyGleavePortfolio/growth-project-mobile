/**
 * One way to open the support email, shared by every support entry point
 * (Support screen, "Request access" on Create account, the consultation
 * problem and paused screens).
 *
 * Owner rule 2026-10-01 13:34 (no silent or vague failures), Sol B-324-1: when
 * the phone cannot open an email app, the user is told so in plain words, sees
 * the support address as selectable text, can copy it, and can try again. The
 * rejection is always handled, so nothing is swallowed and nothing is left
 * unhandled. Pattern from the community safety email (mobile #314, B-314-3),
 * kept here so it does not depend on #314.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SUPPORT_EMAIL, supportMailto } from '../../constants/support';

export type SupportEmailState = 'idle' | 'failed' | 'copied' | 'copy_failed';

export const SUPPORT_EMAIL_COPY = {
  failed:
    'This phone could not open an email app. Copy the address below and write to us from any email app or device.',
  copied: 'Address copied. Paste it into any email app to write to us.',
  copyFailed: 'The address could not be copied. Press and hold the address to select it.',
  copy: 'Copy address',
  retry: 'Try again',
} as const;

export function supportEmailStatusText(state: SupportEmailState): string | null {
  switch (state) {
    case 'failed':
      return SUPPORT_EMAIL_COPY.failed;
    case 'copied':
      return SUPPORT_EMAIL_COPY.copied;
    case 'copy_failed':
      return SUPPORT_EMAIL_COPY.copyFailed;
    default:
      return null;
  }
}

export interface SupportEmailHandle {
  state: SupportEmailState;
  /** Opens a draft to SUPPORT_EMAIL. Never rejects. */
  open: () => Promise<void>;
  /** Copies SUPPORT_EMAIL. Never rejects. */
  copy: () => Promise<void>;
}

export function useSupportEmail(subject?: string): SupportEmailHandle {
  const [state, setState] = useState<SupportEmailState>('idle');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = useCallback((next: SupportEmailState) => {
    if (mounted.current) setState(next);
  }, []);

  const open = useCallback(async () => {
    try {
      await Linking.openURL(supportMailto(subject));
      set('idle');
    } catch {
      set('failed');
    }
  }, [subject, set]);

  const copy = useCallback(async () => {
    try {
      const ok = await Clipboard.setStringAsync(SUPPORT_EMAIL);
      set(ok === false ? 'copy_failed' : 'copied');
    } catch {
      set('copy_failed');
    }
  }, [set]);

  return { state, open, copy };
}

interface FallbackProps {
  handle: SupportEmailHandle;
  /** Body text style of the host screen. */
  textStyle?: StyleProp<TextStyle>;
  /** Colour for the Copy and Try again actions. */
  linkColor: string;
  /** testID prefix; children get `-status`, `-address`, `-copy`, `-retry`. */
  testID?: string;
  /** Centre the actions under centred host text. */
  centered?: boolean;
}

/**
 * Shown under a support email action once opening it failed (and after a
 * copy). Renders nothing while the email opened normally.
 */
export function SupportEmailFallback({
  handle,
  textStyle,
  linkColor,
  testID = 'support-email-fallback',
  centered = false,
}: FallbackProps) {
  const status = supportEmailStatusText(handle.state);
  if (!status) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text
        style={textStyle}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={`${testID}-status`}
      >
        {status}
      </Text>
      <Text selectable style={[textStyle, styles.address]} testID={`${testID}-address`}>
        {SUPPORT_EMAIL}
      </Text>
      <View style={[styles.actions, centered && styles.centered]}>
        <Pressable
          onPress={() => void handle.copy()}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${SUPPORT_EMAIL}`}
          hitSlop={8}
          style={styles.action}
          testID={`${testID}-copy`}
        >
          <Text style={[styles.actionText, { color: linkColor }]}>{SUPPORT_EMAIL_COPY.copy}</Text>
        </Pressable>
        <Pressable
          onPress={() => void handle.open()}
          accessibilityRole="button"
          accessibilityLabel="Try opening your email app again"
          hitSlop={8}
          style={styles.action}
          testID={`${testID}-retry`}
        >
          <Text style={[styles.actionText, { color: linkColor }]}>{SUPPORT_EMAIL_COPY.retry}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 8, alignSelf: 'stretch' },
  address: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 24 },
  centered: { justifyContent: 'center' },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});

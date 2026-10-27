/**
 * Roman's notices on "Your path" (style A frames 07, 08, 09, 10, 11; Opus B-G2, B-G4, Sol B-851-G3): one white ledger
 * card with Roman's face. A title is bold beside the face with the body under it (AI help off, daily cap, offline);
 * a notice with only a line sets it in regular body text beside the face (credits out, frame 08).
 *
 * CopilotRefusal: "AI help is off" for a client is this card with the full-width "Allow AI help" (frame 07), which
 * opens main's AiConsentSheet, so the grant, its ledger and its identity fence are main's. The words are main's
 * (aiRefusalCopy, CP-A-38). Every other refusal keeps main's AiRefusalNotice.
 *
 * The same file holds Copilot's own controls and feedback, so every Copilot surface draws them one way (GOAL index
 * sections 3 and 6; Sol B-S1, B-S4, B-878-G): LedgerButton (.btn), LedgerLink (.lnk), CalmIn (the 200 ms fade) and
 * useSayOnChange (a status line said once when it changes).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, forestPop, radius, withAlpha } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import AiRefusalNotice, { AI_REFUSAL_ACTIONS } from '../../../components/ai/AiRefusalNotice';
import AiConsentSheet from '../../../components/ai/AiConsentSheet';
import { useOpenSupport } from '../../../components/ai/useOpenSupport';
import { aiRefusalCopy, type AiRefusal } from '../../../lib/ai/aiRefusal';
import { ledger, ledgerType } from './ledger';

export function RomanNotice({ title, body, children, testID }: { title?: string; body?: string; children?: React.ReactNode; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  const ink = { color: ledger.ink };
  return (
    <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <View style={[s.who, !title && s.top]}>
        <RomanAvatar crop="neutral" size={40} testID={testID ? `${testID}-roman` : undefined} />
        {title
          ? <Text style={[ledgerType.title, s.grow, { color: sc.textPrimary }]} testID={testID ? `${testID}-title` : undefined}>{title}</Text>
          : <Text style={[ledgerType.body, s.grow, ink]}>{body}</Text>}
      </View>
      {title && body ? <Text style={[ledgerType.body, s.body, ink]}>{body}</Text> : null}
      {children ? <View style={s.act}>{children}</View> : null}
    </View>
  );
}

export function CopilotRefusal({ refusal, onRetry, testID }: { refusal: AiRefusal; onRetry: () => void; testID: string }) {
  const [open, setOpen] = useState(false);
  const support = useOpenSupport();
  if (refusal.kind !== 'consent_required') {
    return <AiRefusalNotice refusal={refusal} audience="client" surface="roman" onRetry={onRetry} testID={testID} />;
  }
  const copy = aiRefusalCopy(refusal, 'client', 'roman');
  return (
    <RomanNotice title={copy.title} body={copy.body} testID={testID}>
      <LedgerButton label={AI_REFUSAL_ACTIONS.allow} onPress={() => setOpen(true)} haptic={false} testID={`${testID}-allow`} />
      <AiConsentSheet visible={open} onGranted={() => { setOpen(false); onRetry(); }} onClose={() => setOpen(false)}
        onContactSupport={support ? () => void support() : undefined} testID={`${testID}-consent-sheet`} />
    </RomanNotice>
  );
}

/**
 * Style A's one forest button (.btn: min 52, 16/600; Sol B-878-G) for Copilot's own actions: Send, Try again, Allow AI
 * help, Join a coach. Main's PrimaryButton rules otherwise: forest fill, the pressed veil, a spinner while busy with
 * presses ignored and the label kept for screen readers, two lines at most, one soft tap on press unless `haptic` is off.
 */
export function LedgerButton({ label, onPress, loading = false, disabled = false, haptic = true, style, testID }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean; haptic?: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { semanticColors: sc } = useTheme();
  const inert = disabled || loading;
  const ink = disabled ? sc.textOnDisabled : sc.textOnAccent;
  const press = () => {
    if (inert) return;
    if (haptic) void HapticService.softImpact();
    onPress();
  };
  return (
    <Pressable onPress={press} disabled={inert} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: loading }} testID={testID}
      style={[s.button, { backgroundColor: disabled ? sc.disabledBg : sc.accent }, style]}>
      {({ pressed }) => (
        <>
          {pressed && !inert ? <View pointerEvents="none" style={s.veil} /> : null}
          {loading
            ? <ActivityIndicator color={ink} testID={testID ? `${testID}-spinner` : undefined} />
            : <Text style={[ledgerType.button, s.center, { color: ink }]} numberOfLines={2} maxFontSizeMultiplier={1.6}>{label}</Text>}
        </>
      )}
    </Pressable>
  );
}

/** Style A's quiet link (.lnk: 15/500 forest, no underline, 44 tall; Sol B-S1): "Show older questions". */
export function LedgerLink({ label, onPress, disabled = false, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      hitSlop={{ left: 8, right: 8 }} style={({ pressed }) => [s.link, pressed && !disabled && s.linkPressed]} testID={testID}>
      <Text style={[ledgerType.link, s.center, { color: disabled ? ledger.muted : forestPop.forest }]} maxFontSizeMultiplier={1.6}>{label}</Text>
    </Pressable>
  );
}

/**
 * GOAL motion (index section 3): a new answer, status line or Sent line fades in over 200 ms. It is opacity only, never
 * movement, so with Reduce Motion on it is the same cross-fade the GOAL asks for.
 */
export function CalmIn({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fade]);
  return <Animated.View style={[style, { opacity: fade }]} testID={testID}>{children}</Animated.View>;
}

/**
 * Status lines are said once each when they are new or change, never on the first draw and never on a poll that brings
 * the same lines (main's ImportStatusFrame): Android reads the polite live region they sit in, iOS is told once, queued
 * (GOAL index section 3, Sol B-S4).
 */
export function useSayOnChange(lines: string | readonly string[]) {
  const key = (typeof lines === 'string' ? [lines] : lines).filter(Boolean).join('\n');
  const said = useRef<Set<string> | null>(null);
  if (said.current === null) said.current = new Set(key ? key.split('\n') : []);
  useEffect(() => {
    const before = said.current ?? new Set<string>();
    const now = key ? key.split('\n') : [];
    said.current = new Set(now);
    if (Platform.OS !== 'ios') return;
    for (const line of now) if (!before.has(line)) AccessibilityInfo.announceForAccessibilityWithOptions(line, { queue: true });
  }, [key]);
}

const s = StyleSheet.create({
  // Style A's state card (.stc, .stc h3, .stc p, .btn; Sol B-G2): the body 10 under the title, the button 14 under them.
  card: { borderWidth: 1, borderRadius: radius.card, paddingVertical: 20, paddingHorizontal: 18 },
  body: { marginTop: 10 },
  act: { marginTop: 14 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  top: { alignItems: 'flex-start' },
  grow: { flex: 1 },
  button: { alignSelf: 'stretch', minHeight: 52, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  veil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: withAlpha(colors.ink, 0.16) },
  center: { textAlign: 'center' },
  link: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  linkPressed: { opacity: 0.6 },
});

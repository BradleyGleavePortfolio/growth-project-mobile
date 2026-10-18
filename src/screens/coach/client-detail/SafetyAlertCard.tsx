/**
 * SAFETY-CARD (agent 157): a client's open Roman safety alert, at the top of their file on every tab, while the
 * summary's `open_safety_alert` is set (b#1075: an id and a type, never the client's words, and only for the
 * client's current coach). One calm card: the approved line with the first name, never a quote. Message {first}
 * opens their chat (the screen says where); Dismiss is the Actions queue's own route, so it clears there too.
 * A soft haptic on Message; success or error when the server answers Dismiss; none on arrival. Kept out of
 * analytics capture (`ph-no-capture`), as on the alert screen and in Actions.
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FadeInView from '../../../components/FadeInView';
import { SAFETY_ALERT_SUMMARY } from '../CoachSafetyAlertScreen';
import type { SafetyAlertType } from '../../../services/commandCenterApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';

export interface OpenSafetyAlert { alert_id: string; alert_type: SafetyAlertType; created_at: string }

const CAP = 1.3;
const CHECK_IN = 'Please check in with them today.';

/** Crisis: #ROMAN-CRISIS-ALERT word for word. Urgent: 22a / C6a without the client's words. Eating disorder: 57x, the same close. */
export function safetyCardLine(type: string, first: string): string | null {
  if (type === 'roman_crisis_reply') return SAFETY_ALERT_SUMMARY.roman_crisis_reply.replace('{first name}', first);
  if (type === 'roman_urgent_reply') {
    return `Urgent: Roman sent ${first} a medical safety reply. ${SAFETY_ALERT_SUMMARY.roman_urgent_reply} ${CHECK_IN}`;
  }
  if (type === 'roman_eating_disorder_reply') return `Roman sent ${first} an eating-disorder safety reply. ${CHECK_IN}`;
  return null;
}

export function SafetyAlertCard({ alert, first, clientName, onMessage, onDismiss }: {
  alert: OpenSafetyAlert; first: string; clientName: string; onMessage: () => void; onDismiss: (alertId: string) => Promise<void>;
}) {
  const sc = useTheme().semanticColors;
  const [busy, setBusy] = useState(false);
  const line = safetyCardLine(alert.alert_type, first);
  if (!line) return null;
  const dismiss = async () => {
    setBusy(true);
    try {
      await onDismiss(alert.alert_id);
      HapticService.success();
    } catch {
      setBusy(false);
      HapticService.error();
      Alert.alert('Could not dismiss alert', `The alert for ${clientName} could not be dismissed. Please try again.`, [{ text: 'OK' }]);
    }
  };
  return (
    <FadeInView duration={300}>
      <View ph-no-capture style={[s.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} testID="file-safety-alert">
        <View style={s.row}>
          <Ionicons name="shield-outline" size={22} color={sc.accentText} />
          <Text maxFontSizeMultiplier={CAP} style={[typography.body, s.flex, { color: sc.textPrimary }]}>{line}</Text>
        </View>
        <View style={s.actions}>
          <Pressable
            onPress={() => { HapticService.softImpact(); onMessage(); }} accessibilityRole="button"
            style={({ pressed }) => [s.button, { borderColor: sc.accentText }, pressed && s.pressed]} testID="file-safety-message"
          >
            <Text maxFontSizeMultiplier={CAP} style={[typography.bodyMd, { color: sc.accentText }]}>{`Message ${first}`}</Text>
          </Pressable>
          <Pressable
            onPress={dismiss} disabled={busy} accessibilityRole="button" accessibilityLabel={`Dismiss alert for ${clientName}`}
            accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [s.quiet, (pressed || busy) && s.pressed]} testID="file-safety-dismiss"
          >
            <Text maxFontSizeMultiplier={CAP} style={[typography.bodyMd, { color: sc.textMuted }]}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </FadeInView>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: 1, padding: 20, marginTop: 12, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  button: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 20, borderRadius: radius.button, borderWidth: 1.5 },
  quiet: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  pressed: { opacity: 0.6 },
});

/**
 * CoachSafetyAlertScreen: one Roman safety alert, opened from its card in the
 * coach's action queue (owner 22a, 57, 57w, 57x; backend B-R1F).
 *
 * Shows the client's name, when they sent the message, that one message in
 * full (nothing else from the chat), one fixed line saying what Roman told
 * them, and a "Message {first name}" button that opens the coach-client chat.
 * Everything comes from the queue item (route params), which the server gives
 * only to the client's current coach, so the screen makes no request of its
 * own. Light and dark from the theme; the client's words stay out of
 * analytics capture (`ph-no-capture`).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { SafetyAlertType } from '../../services/commandCenterApi';
import { Headline, PrimaryButton, Screen, ScreenTopBar } from '../../ui';
import { useTheme } from '../../theme/useTheme';
import { radius, spacing, typography } from '../../theme/tokens';

/** Owner 57: the one line under the client's message, word for word. */
export const SAFETY_ALERT_SUMMARY: Record<SafetyAlertType, string> = {
  roman_urgent_reply:
    'Roman told them to contact their prescribing clinic today, and to call 911 if symptoms are severe.',
  roman_eating_disorder_reply: 'Roman answered with eating-disorder safety guidance.',
};

type Props = NativeStackScreenProps<ClientsStackParamList, 'CoachSafetyAlert'>;

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

/** The local date and time the client sent the message, e.g. "Mon, Oct 12, 9:41 AM". */
export function formatSentAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CoachSafetyAlertScreen({ route, navigation }: Props): React.ReactElement {
  const { alertType, clientId, clientName, quote, sentAt } = route.params;
  const { semanticColors: sc } = useTheme();
  const first = firstName(clientName);
  const sent = formatSentAt(sentAt);
  const openChat = () => navigation.navigate('ClientMessages', { clientId, clientName });

  return (
    <View ph-no-capture style={styles.fill} testID="coach-safety-alert-excluded">
      <Screen
        edges={['top', 'bottom']}
        testID="coach-safety-alert-screen"
        header={<ScreenTopBar onBack={() => navigation.goBack()} />}
        footer={
          <PrimaryButton
            label={`Message ${first || clientName}`}
            onPress={openChat}
            testID="coach-safety-alert-message"
          />
        }
      >
        <View ph-no-capture style={styles.body}>
          <Headline testID="coach-safety-alert-name">{clientName}</Headline>
          {sent ? (
            <Text style={[styles.sent, { color: sc.textMuted }]} testID="coach-safety-alert-sent">
              {sent}
            </Text>
          ) : null}
          {quote ? (
            <View
              style={[styles.quote, { backgroundColor: sc.bgSurface, borderLeftColor: sc.border }]}
              testID="coach-safety-alert-quote"
            >
              <Text style={[styles.quoteText, { color: sc.textPrimary }]} selectable>
                {quote}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.summary, { color: sc.textPrimary }]} testID="coach-safety-alert-summary">
            {SAFETY_ALERT_SUMMARY[alertType]}
          </Text>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    gap: spacing.md,
  },
  sent: {
    ...typography.bodySmall,
  },
  quote: {
    borderLeftWidth: 3,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  quoteText: {
    ...typography.body,
  },
  summary: {
    ...typography.body,
    marginTop: spacing.sm,
  },
});

/**
 * CoachSafetyAlertScreen: one Roman safety alert, opened from its card in the
 * coach's action queue (owner 22a, 57, 57w, 57x; backend B-R1F), or from its
 * push or inbox row by id (owner 57d; backend R1F-2).
 *
 * Shows the client's name, when they sent the message, that one message in
 * full (nothing else from the chat), one fixed line saying what Roman told
 * them, and a "Message {first name}" button that opens the coach-client chat.
 * A crisis alert (owner #ROMAN-CRISIS-ALERT) never shows the client's words:
 * only its own fixed line, with the client's first name.
 * From the card everything comes from the queue item (route params). By id
 * the screen reads that one alert (shared skeleton while it loads); the
 * server gives it only to the client's current coach, and anything it won't
 * give (another coach's, a deleted message, offline) lands on Command Center
 * > Actions, as before 57d. The alert opens with one warning haptic
 * (docs/HAPTICS.md). Light and dark from the theme; the client's words stay
 * out of analytics capture (`ph-no-capture`).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type {
  ClientsStackParamList,
  CoachTabParamList,
  SafetyAlertParams,
} from '../../navigation/CoachNavigator';
import { openInboxChat } from '../../navigation/coachInbox';
import { commandCenterApi, isSafetyAlert, safetyQuote, type SafetyAlertType } from '../../services/commandCenterApi';
import { Headline, PrimaryButton, Screen, ScreenTopBar } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { QuietLoading } from '../../ui/states/QuietStates';
import { useTheme } from '../../theme/useTheme';
import { radius, spacing, typography } from '../../theme/tokens';

/** Owner 57, C6a, #ROMAN-CRISIS-ALERT: the one fixed line, word for word. */
export const SAFETY_ALERT_SUMMARY: Record<SafetyAlertType, string> = {
  roman_urgent_reply:
    'Roman told them to contact their doctor or prescriber today, and to call 911 if symptoms are severe.',
  roman_eating_disorder_reply: 'Roman answered with eating-disorder safety guidance.',
  roman_crisis_reply: 'Roman sent {first name} a crisis safety reply. Please check in with them today.',
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
  const { params } = route;
  const alertId = 'alertId' in params ? params.alertId : null;
  const [loaded, setLoaded] = useState<{ id: string; alert: SafetyAlertParams } | null>(null);
  const alert = !('alertId' in params) ? params : loaded?.id === params.alertId ? loaded.alert : null;
  const { semanticColors: sc } = useTheme();

  useEffect(() => {
    if (alertId === null) return undefined;
    let live = true;
    const toActions = () => {
      if (!live) return;
      if (navigation.canGoBack()) navigation.goBack();
      navigation
        .getParent<BottomTabNavigationProp<CoachTabParamList>>()
        ?.navigate('CommandCenter', { tab: 'action-queue' });
    };
    commandCenterApi.getSafetyAlert(alertId).then(({ data }) => {
      if (!isSafetyAlert(data)) {
        toActions();
        return;
      }
      if (!live) return;
      setLoaded({
        id: alertId,
        alert: {
          alertType: data.alert_type,
          clientId: data.client_id,
          clientName: data.client_name,
          quote: data.quote ?? null,
          sentAt: data.sent_at ?? data.created_at,
        },
      });
    }, toActions);
    return () => {
      live = false;
    };
  }, [alertId, navigation]);

  useEffect(() => {
    if (alert) void HapticService.warning();
  }, [alert]);

  if (!alert) {
    return (
      <Screen
        edges={['top', 'bottom']}
        testID="coach-safety-alert-screen"
        header={<ScreenTopBar onBack={() => navigation.goBack()} />}
      >
        <QuietLoading label="Loading" testID="coach-safety-alert-loading" />
      </Screen>
    );
  }

  const { alertType, clientId, clientName, sentAt } = alert;
  const quote = safetyQuote(alertType, alert.quote);
  const first = firstName(clientName);
  const sent = formatSentAt(sentAt);
  const openChat = () => openInboxChat(navigation, clientId, clientName); // COACH-CHAT-BACK: in Messages with the six tabs

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
            {SAFETY_ALERT_SUMMARY[alertType].replace('{first name}', first || clientName)}
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

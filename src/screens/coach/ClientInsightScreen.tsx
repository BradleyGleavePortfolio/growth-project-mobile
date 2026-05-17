/**
 * ClientInsightScreen — render an AI-generated weekly insight digest
 * for a client.
 *
 * Sections (per audit + spec):
 *   - Summary
 *   - Wins
 *   - Concerns
 *   - Suggested actions
 *   - Questions for coach
 *
 * One-tap actions:
 *   - "Send check-in": navigates to ClientMessages with a templated
 *     check-in prefilled in the composer via `initialDraft` route param.
 *   - "Schedule call": booking surface deferred. There is no first-class
 *     coach-side booking screen yet (the existing CoachBookingInbox is
 *     the trainer-facing booking *inbox*, not a "schedule a call with
 *     this client" flow). For v1 we surface a toast and log the
 *     deferral in the rollout report rather than inventing calendar UI.
 *
 * Doctrine-clean: theme tokens, no emoji, no hex literals.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import coachAiApi from '../../api/coachAi';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { Draft, InsightPayload } from '../../types/coachAi';
import { errorMessage } from '../../types/common';

type Nav = NativeStackNavigationProp<ClientsStackParamList, 'ClientInsight'>;
type R = RouteProp<ClientsStackParamList, 'ClientInsight'>;

function emptyPayload(): InsightPayload {
  return {
    summary: '',
    wins: [],
    concerns: [],
    suggested_actions: [],
    questions_for_coach: [],
  };
}

/**
 * Build the message body that prefills the messaging composer when the
 * coach taps "Send check-in". Intentionally short — the coach edits in
 * the composer before sending.
 */
function buildCheckInTemplate(clientName: string, insight: InsightPayload): string {
  const wins = (insight.wins || []).slice(0, 2);
  const concerns = (insight.concerns || []).slice(0, 1);
  const lines: string[] = [
    `Hey ${clientName.split(' ')[0] || clientName} — quick check-in.`,
  ];
  if (wins.length > 0) {
    lines.push(`Wins I noticed: ${wins.join('; ')}.`);
  }
  if (concerns.length > 0) {
    lines.push(`One thing I want to dig into: ${concerns[0]}.`);
  }
  lines.push('How are you feeling about the week ahead?');
  return lines.join('\n\n');
}

export default function ClientInsightScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { draftId, clientId, clientName } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft<InsightPayload> | null>(null);
  const [payload, setPayload] = useState<InsightPayload>(emptyPayload());
  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useMemo(() => new Animated.Value(0), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await coachAiApi.getDraft<InsightPayload>(draftId);
      setDraft(res.data);
      setPayload({ ...emptyPayload(), ...(res.data.generatedPayload || {}) });
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load insight.'));
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      Animated.sequence([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(2200),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setToast(null));
    },
    [toastOpacity],
  );

  const handleSendCheckIn = () => {
    const initialDraft = buildCheckInTemplate(clientName, payload);
    navigation.navigate('ClientMessages', {
      clientId,
      clientName,
      // The composer reads this and prefills its input. Falls back to
      // no-op if the screen has not been redeployed with the param.
      initialDraft,
    });
  };

  const handleScheduleCall = () => {
    // Deferred: wire to a coach-to-client booking composer once one
    // exists. The current CoachBookingInbox is read-only for incoming
    // bookings, not a "schedule a call with X" surface. Until that
    // ships we degrade to a toast — see README "Coach AI" section.
    showToast('Booking integration pending — please reach out via message for now');
  };

  if (loading) {
    return <SkeletonScreen count={6} />;
  }
  if (loadError || !draft) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={styles.errorText}>{loadError || 'Insight not available.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Weekly insight
          </Text>
          <Text style={styles.headerSubtitle}>For {clientName}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Section icon="document-text-outline" title="Summary">
          <Text style={styles.summaryText}>
            {payload.summary || 'No summary returned.'}
          </Text>
        </Section>

        <Section icon="trophy-outline" title="Wins" iconColor={colors.success}>
          <BulletList items={payload.wins} emptyText="No wins called out." />
        </Section>

        <Section icon="alert-circle-outline" title="Concerns" iconColor={colors.warning}>
          <BulletList items={payload.concerns} emptyText="No concerns called out." />
        </Section>

        <Section
          icon="checkmark-done-outline"
          title="Suggested actions"
          iconColor={colors.primary}
        >
          <BulletList
            items={payload.suggested_actions}
            emptyText="No suggested actions."
          />
        </Section>

        <Section
          icon="help-circle-outline"
          title="Questions for coach"
          iconColor={colors.info}
        >
          <BulletList
            items={payload.questions_for_coach}
            emptyText="No follow-up questions."
          />
        </Section>

        <Text style={styles.provenance}>
          {`Model used: ${draft.modelUsed} · ${draft.tokensIn}+${draft.tokensOut} tokens · $${(
            draft.costCents / 100
          ).toFixed(2)}`}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.actionPrimary}
          onPress={handleSendCheckIn}
          accessibilityRole="button"
          accessibilityLabel="Send check-in"
          testID="insight-send-checkin"
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.textOnPrimary} />
          <Text style={styles.actionPrimaryText}>Send check-in</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionSecondary}
          onPress={handleScheduleCall}
          accessibilityRole="button"
          accessibilityLabel="Schedule call"
          testID="insight-schedule-call"
        >
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          <Text style={styles.actionSecondaryText}>Schedule call</Text>
        </TouchableOpacity>
      </View>

      {toast ? (
        <Animated.View
          style={[styles.toast, { opacity: toastOpacity }]}
          accessibilityLiveRegion="polite"
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Section({
  icon,
  title,
  iconColor,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  iconColor?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name={icon} size={16} color={iconColor || colors.textSecondary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function BulletList({
  items,
  emptyText,
}: {
  items: string[];
  emptyText: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!items || items.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }
  return (
    <View style={{ gap: 6 }}>
      {items.map((item, idx) => (
        <View key={idx} style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 24,
      gap: 12,
    },
    errorText: { color: colors.textSecondary, textAlign: 'center' },
    retryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 4,
    },
    retryBtnText: {
      fontFamily: 'Inter_500Medium',
      color: colors.textOnPrimary,
      fontWeight: '600',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    headerSubtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    section: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    sectionTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
      letterSpacing: 0.4,
    },
    summaryText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    bulletRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    bulletDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.textMuted,
      marginTop: 7,
    },
    bulletText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textPrimary,
      lineHeight: 19,
    },
    emptyText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    provenance: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 8,
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingVertical: 12,
      flexDirection: 'row',
      gap: 8,
    },
    actionPrimary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    actionPrimaryText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
    actionSecondary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.primaryPale,
    },
    actionSecondaryText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.primary,
    },
    toast: {
      position: 'absolute',
      bottom: 92,
      alignSelf: 'center',
      paddingVertical: 10,
      paddingHorizontal: 16,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toastText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      color: colors.textPrimary,
    },
  });

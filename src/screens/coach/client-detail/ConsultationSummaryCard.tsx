/**
 * ConsultationSummaryCard — the entry from client detail > Summary to the
 * client's consultation answers (owner decision 2026-09-30: the coach sees
 * every client's answers, easily). One tap opens ClientConsultationScreen.
 *
 * The card shares the screen's query (same key, persisted cache off), so it
 * shows the one thing the coach must not miss before opening anything: how
 * many readiness questions were answered yes. Failures here stay quiet and
 * point to the screen, which owns the specific error copy and actions.
 */
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  consultationQueryKey,
  loadClientConsultation,
  formatConsultationDate,
  screeningSummary,
  type ConsultationResult,
} from '../../../api/coachConsultationApi';
import type { ThemeColors } from '../../../theme/ThemeProvider';

export function consultationCardLine(
  data: ConsultationResult | undefined,
  state: 'loading' | 'error' | 'ready',
): { line: string; flagged: boolean } {
  if (state === 'loading') return { line: 'Loading answers', flagged: false };
  if (state === 'error') return { line: 'The answers did not load. Open to try again.', flagged: false };
  if (!data || data.kind === 'none') return { line: 'No answers on file yet', flagged: false };
  const { view } = data;
  const when = view.submitted_at
    ? `Completed ${formatConsultationDate(view.submitted_at)}`
    : `In progress, saved ${formatConsultationDate(view.saved_at)}`;
  const s = screeningSummary(view);
  if (s.yes > 0) {
    return {
      line: `${when}. Yes to ${s.yes === 1 ? 'one readiness question' : `${s.yes} readiness questions`}.`,
      flagged: true,
    };
  }
  return { line: when, flagged: false };
}

export function ConsultationSummaryCard({
  clientId,
  clientName,
  colors,
}: {
  clientId: string;
  clientName: string;
  colors: ThemeColors;
}) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const q = useQuery({
    queryKey: consultationQueryKey(clientId),
    queryFn: () => loadClientConsultation(clientId),
    meta: { persist: false },
    retry: false,
    staleTime: 30_000,
  });
  const state = q.isLoading ? 'loading' : q.isError ? 'error' : 'ready';
  const { line, flagged } = consultationCardLine(q.data, state);
  return (
    <Pressable
      onPress={() => navigation.navigate('ClientConsultation', { clientId, clientName })}
      accessibilityRole="button"
      accessibilityLabel={`Consultation answers. ${line}`}
      accessibilityHint="Opens everything the client answered in the consultation"
      testID="summary-consultation-card"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 56,
          paddingVertical: 12,
          paddingHorizontal: 16,
          marginTop: 12,
          borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: flagged ? 1 : 0,
          borderColor: flagged ? colors.primary : 'transparent',
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Ionicons name="document-text-outline" size={20} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>Consultation</Text>
        <Text
          style={{ fontSize: 13, color: flagged ? colors.primary : colors.textSecondary }}
          testID="summary-consultation-line"
        >
          {line}
        </Text>
      </View>
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      )}
    </Pressable>
  );
}

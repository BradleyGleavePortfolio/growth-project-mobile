/**
 * ClientPathCopilotScreen: "Your path" (Path Copilot style A, owner #162-1, board planning/MOCKUP3/COPILOT frames 04-05).
 *
 * PR-1 surfaces: the client's sent suggestions with where each stands (GET /client/copilot, backend #1120). The
 * suggestion card with "Send to {coach}" is ./copilot/SuggestionCard (COPILOT-M2 mounts it under Roman's answer, with
 * the week block, the sources and past questions). Behind `featureFlags.clientPathCopilot` (off) and the server
 * switch: a server without Copilot (404) shows the calm empty state, nothing new (truthful fallback).
 */
import React from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from '../../components/EmptyState';
import AiRefusalNotice from '../../components/ai/AiRefusalNotice';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { Screen, useScreenInsets } from '../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';
import { aiRefusalOf } from '../../lib/ai/aiRefusal';
import { featureFlags } from '../../config/featureFlags';
import { useMyCoaches } from '../../hooks/useCalendar';
import { copilotApi } from '../../api/copilotApi';
import { COPILOT_COPY as C } from './copilot/pathChangeWords';
import { SuggestionStatusList } from './copilot/SuggestionStatusList';

export const COPILOT_RECENT_KEY = ['copilot', 'recent'] as const;

/** The coach's first name for "Send to {coach}" and the status lines, or "your coach" when it is not known yet. */
export function useCoachFirstName(): string {
  const { data } = useMyCoaches();
  return data?.[0]?.name?.trim().split(/\s+/)[0] || C.yourCoach;
}

export default function ClientPathCopilotScreen() {
  if (!featureFlags.clientPathCopilot) {
    return (
      <View style={s.flagOff} accessibilityLabel="Path suggestions unavailable" accessibilityRole="none">
        <EmptyState icon="lock-closed-outline" title="Your path" subtitle="Path suggestions are not available on this account." />
      </View>
    );
  }
  return <PathCopilot />;
}

function PathCopilot() {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const navigation = useNavigation();
  const coach = useCoachFirstName();
  const q = useQuery({ queryKey: COPILOT_RECENT_KEY, queryFn: () => copilotApi.recent() });
  const refusal = q.error ? aiRefusalOf(q.error) : null;
  const items = q.data ?? [];
  const light = { color: sc.textOnAccent };

  return (
    <>
      <ForestStatusBar />
      <Screen edges={[]} testID="copilot-screen" contentStyle={s.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={sc.textMuted} />}>
        <View style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={`Back to ${C.back}`} style={s.back} testID="copilot-back">
            <Ionicons name="chevron-back" size={22} color={sc.textOnAccent} />
            <Text style={[typography.bodyMd, light]}>{C.back}</Text>
          </Pressable>
          <Text style={[typography.h1, light]} accessibilityRole="header">{C.title}</Text>
        </View>
        <View style={s.body}>
          {q.isPending ? <QuietLoading label="Loading your path" rows={3} testID="copilot-loading" /> : null}
          {refusal ? <AiRefusalNotice refusal={refusal} audience="client" surface="roman" onRetry={() => void q.refetch()} /> : null}
          {q.error && !refusal ? (
            <QuietError message={loadFailureMessage(q.error, 'Your path')} onRetry={() => void q.refetch()} retrying={q.isRefetching} testID="copilot-error" />
          ) : null}
          {q.isSuccess && items.length === 0 ? <EmptyState icon="sparkles-outline" title={C.emptyTitle} subtitle={C.emptyBody} /> : null}
          {items.length > 0 ? <SuggestionStatusList items={items} coach={coach} /> : null}
        </View>
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  flagOff: { flex: 1, justifyContent: 'center' },
  page: { paddingHorizontal: 0 },
  mast: { paddingHorizontal: 20, paddingBottom: 24, gap: 8, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  back: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  body: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
});

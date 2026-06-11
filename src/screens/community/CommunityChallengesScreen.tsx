/**
 * CommunityChallengesScreen — the discovery surface for community challenges
 * (v3-1, F6). Lists the workspace's challenges as ChallengeCards; tapping a card
 * opens its detail (where the caller's own participation is loaded). Without a
 * discovery surface the detail screen was unreachable except by deep link — this
 * surface is what makes challenges findable.
 *
 * BEHAVIORAL DESIGN (DESIGN_INTELLIGENCE Part III):
 *   - Each row foregrounds the challenge itself (a calm "Join" affordance), not a
 *     ranking — competence over comparison (§3.7, §3.4).
 *   - Real loading / empty / error states (no spinner-only screens, no dead
 *     ends). The list-level fetch only knows the challenge definitions, so the
 *     card shows the neutral "Join" affordance until the detail confirms the
 *     caller's own progress.
 *
 * FLAG POSTURE: registered in CommunityNavigator ONLY when
 * `featureFlags.communityChallenges` is true. A defense-in-depth guard renders a
 * neutral "not available" state if it is somehow reached with the flag off.
 *
 * Tokens only (no raw hex); line Ionicons only (no emoji).
 */
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { ThreadHeader, ChallengeCard } from '../../components/community';
import HapticPressable from '../../components/HapticPressable';
import {
  communityChallengesApi,
  type CommunityChallenge,
} from '../../api/communityChallengesApi';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  embedded?: boolean;
  /** Workspace id — challenges are workspace-scoped on the backend. */
  workspaceId?: string | null;
}

export default function CommunityChallengesScreen({
  embedded,
  workspaceId,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();

  const challenges = useQuery({
    queryKey: ['community', 'challenges', workspaceId ?? '∅'],
    queryFn: () => communityChallengesApi.listChallenges(workspaceId as string),
    enabled: !!workspaceId && featureFlags.communityChallenges,
  });

  const open = (challenge: CommunityChallenge) =>
    navigation.navigate('CommunityChallengeDetail', { challengeId: challenge.id });

  const Container: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <View style={styles.flex}>{children}</View>
    : ({ children }) => (
        <SafeAreaView
          style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
          edges={['top']}
        >
          {children}
        </SafeAreaView>
      );

  // Defense-in-depth: never reachable with the flag off (the route is not
  // registered), but render a neutral state rather than a blank screen.
  if (!featureFlags.communityChallenges) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Challenges are not available right now.
          </Text>
        </View>
      </Container>
    );
  }

  if (challenges.isLoading) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-loading">
          <ActivityIndicator color={semanticColors.accent} />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading challenges…
          </Text>
        </View>
      </Container>
    );
  }

  if (challenges.isError) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load challenges. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void challenges.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-challenges-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accent }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  const data = challenges.data ?? [];

  if (data.length === 0) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-empty">
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            No challenges yet. Your coach will add one when it is time.
          </Text>
        </View>
      </Container>
    );
  }

  return (
    <Container>
      <ThreadHeader title="Challenges" testID="community-challenges-header" />
      <FlatList
        data={data}
        renderItem={({ item }) => (
          <ChallengeCard
            challenge={item}
            participation={null}
            onPress={open}
            testID={`community-challenge-card-${item.id}`}
          />
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        testID="community-challenges-list"
      />
    </Container>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
  listContent: { padding: spacing.lg, gap: spacing.sm },
});

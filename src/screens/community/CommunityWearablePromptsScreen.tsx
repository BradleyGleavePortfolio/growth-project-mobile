/**
 * CommunityWearablePromptsScreen — the v3-4 COACH-ONLY wearable coaching prompts
 * surface. For a given client (passed as a route param), it lists the coach's
 * active AI-generated coaching prompts (sourced from the client's already
 * opted-in wearable insights) and lets the coach (a) generate fresh prompts and
 * (b) dismiss / mark-acted-on each one.
 *
 * Defense-in-depth gating (this surface is NEVER client-visible):
 *   1. Registered in the COACH navigator ONLY when
 *      `featureFlags.communityWearablePrompts` is true.
 *   2. Re-checks the flag here and renders a neutral "not available" state if
 *      reached with the flag off.
 *   3. Re-checks the caller's role from `useCommunityMe`; a non-coach/owner
 *      sees a neutral "not available" state, never the prompts (the backend is
 *      the authority and would 403, but the UI must not flash coach data).
 *
 * The workspace + role prerequisite resolves BEFORE any prompt state so a
 * still-loading / failed prerequisite is never shown as "no prompts". States
 * are distinct: prereq-loading / prereq-error / list-loading / list-error /
 * empty / populated. No raw health VALUE is shown to a client (this screen is
 * coach-only and the source pills are a coach audit surface).
 *
 * Tokens only (no raw hex); line Ionicons only (no emoji); fontWeight <= '600'.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useCommunityMe } from '../../hooks/useCommunity';
import {
  useWearablePrompts,
  useGenerateWearablePrompts,
  useDismissWearablePrompt,
  useActOnWearablePrompt,
} from '../../hooks/useWearablePrompts';
import { dedupeById } from '../../utils/dedupeById';
import { ThreadHeader } from '../../components/community';
import WearablePromptCard from '../../components/community/WearablePromptCard';
import HapticPressable from '../../components/HapticPressable';
import type { PromptView } from '../../api/communityWearablePromptsApi';

/** Route params: which client these prompts are for. */
interface RouteParams {
  clientId: string;
  clientName?: string;
}

export default function CommunityWearablePromptsScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute();
  const params = (route.params ?? {}) as Partial<RouteParams>;
  const clientId = params.clientId;

  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? undefined;
  const role = me.data?.membership?.role;
  const isCoachOrOwner = role === 'coach' || role === 'owner';
  const prerequisiteLoading = me.isLoading;
  const prerequisiteError = me.isError;

  const list = useWearablePrompts({ workspaceId, clientId });
  const generate = useGenerateWearablePrompts(workspaceId);
  const dismiss = useDismissWearablePrompt(workspaceId);
  const actOn = useActOnWearablePrompt(workspaceId);

  // Track which prompt id has an inflight mutation so only its card disables.
  const [busyId, setBusyId] = useState<string | null>(null);

  const data = useMemo(
    () => dedupeById(list.data?.prompts ?? []),
    [list.data],
  );

  // The mutation error is surfaced via the hook's isError flag; this handler
  // absorbs the rejected promise so it does not bubble as an unhandled
  // rejection (it is NOT a silent swallow — the error state still renders).
  const absorbRejection = useCallback((): void => undefined, []);

  const onGenerate = useCallback(() => {
    if (!clientId) return;
    void generate.mutateAsync({ clientId }).catch(absorbRejection);
  }, [clientId, generate, absorbRejection]);

  const onDismiss = useCallback(
    (promptId: string) => {
      setBusyId(promptId);
      void dismiss
        .mutateAsync(promptId)
        .catch(absorbRejection)
        .finally(() => setBusyId(null));
    },
    [dismiss, absorbRejection],
  );

  const onActOn = useCallback(
    (promptId: string) => {
      setBusyId(promptId);
      void actOn
        .mutateAsync(promptId)
        .catch(absorbRejection)
        .finally(() => setBusyId(null));
    },
    [actOn, absorbRejection],
  );

  const Container: React.ComponentType<{ children: React.ReactNode }> = ({
    children,
  }) => (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
    >
      <ThreadHeader
        title="Wearable prompts"
        testID="wearable-prompts-header"
      />
      {children}
    </SafeAreaView>
  );

  const neutralUnavailable = (testID: string) => (
    <Container>
      <View style={styles.center} testID={testID}>
        <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
          This is not available right now.
        </Text>
      </View>
    </Container>
  );

  // Defense-in-depth #2: flag off.
  if (!featureFlags.communityWearablePrompts) {
    return neutralUnavailable('wearable-prompts-flag-off');
  }

  if (prerequisiteLoading) {
    return (
      <Container>
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="wearable-prompts-prereq-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading prompts"
          />
        </View>
      </Container>
    );
  }

  if (prerequisiteError) {
    return (
      <Container>
        <View style={styles.center} testID="wearable-prompts-prereq-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load prompts. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void me.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="wearable-prompts-prereq-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  // Defense-in-depth #3: non-coach/owner (or missing client target) sees the
  // neutral state, never coach data.
  if (!isCoachOrOwner || !clientId) {
    return neutralUnavailable('wearable-prompts-not-coach');
  }

  const generateButton = (
    <View style={styles.generateWrap}>
      <HapticPressable
        intent="medium"
        onPress={onGenerate}
        disabled={generate.isPending}
        accessibilityRole="button"
        accessibilityLabel="Generate prompts"
        accessibilityState={{ disabled: generate.isPending, busy: generate.isPending }}
        testID="wearable-prompts-generate"
        style={[
          styles.generateBtn,
          {
            backgroundColor: semanticColors.accent,
            opacity: generate.isPending ? 0.6 : 1,
          },
        ]}
      >
        {generate.isPending ? (
          <ActivityIndicator
            color={semanticColors.textOnAccent}
            accessibilityRole="progressbar"
            accessibilityLabel="Generating prompts"
          />
        ) : (
          <Text style={[styles.generateLabel, { color: semanticColors.textOnAccent }]}>
            Generate prompts
          </Text>
        )}
      </HapticPressable>
      {generate.isError ? (
        <Text
          style={[styles.errorNote, { color: semanticColors.accentText }]}
          testID="wearable-prompts-generate-error"
        >
          Could not generate prompts. Please try again.
        </Text>
      ) : null}
    </View>
  );

  if (list.isLoading) {
    return (
      <Container>
        {generateButton}
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="wearable-prompts-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading prompts"
          />
        </View>
      </Container>
    );
  }

  if (list.isError) {
    return (
      <Container>
        {generateButton}
        <View style={styles.center} testID="wearable-prompts-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load prompts. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void list.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="wearable-prompts-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  if (data.length === 0) {
    return (
      <Container>
        {generateButton}
        <View
          style={styles.center}
          accessibilityRole="text"
          accessibilityLabel="No prompts yet. Generate prompts from this client's recent wearable insights."
          testID="wearable-prompts-empty"
        >
          <Ionicons
            name="pulse-outline"
            size={32}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.emptyTitle, { color: semanticColors.textPrimary }]}>
            No prompts yet
          </Text>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Generate prompts from this client&apos;s recent wearable insights.
          </Text>
        </View>
      </Container>
    );
  }

  return (
    <Container>
      {generateButton}
      <FlatList
        data={data}
        accessibilityRole="list"
        accessibilityLabel={`Prompts, ${data.length} ${
          data.length === 1 ? 'item' : 'items'
        }`}
        renderItem={({ item }: { item: PromptView }) => (
          <View role="listitem" testID={`wearable-prompt-listitem-${item.id}`}>
            <WearablePromptCard
              prompt={item}
              onDismiss={onDismiss}
              onActOn={onActOn}
              busy={busyId === item.id}
            />
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        testID="wearable-prompts-list"
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
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  generateWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  generateBtn: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateLabel: { fontSize: 15, fontWeight: '600' },
  errorNote: { fontSize: 13, textAlign: 'center' },
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

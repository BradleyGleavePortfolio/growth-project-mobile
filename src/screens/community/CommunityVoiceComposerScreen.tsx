/**
 * CommunityVoiceComposerScreen — the v3-3 record→review→send voice surface.
 *
 * This is a thin screen: it resolves the workspace prerequisite (useCommunityMe),
 * derives the REAL audience target from the route params, and hands the orchestration
 * to <VoiceNoteComposer> (which owns the recorder + upload glue). On a successful
 * publish it pops back to wherever the user came from.
 *
 * The audience disclosure is computed from the route params, never a placeholder:
 *   - target 'hall'   → the whole community (no name in /community/me, so the copy
 *                       degrades to the honest "your community", never "everyone");
 *   - target 'cohort' → a named cohort (cohortName threaded through);
 *   - target 'dm'     → a single recipient (recipientName threaded through).
 *
 * Registered in CommunityNavigator ONLY when `featureFlags.communityVoiceNotes`
 * is true (default OFF). A defense-in-depth guard renders a neutral "not
 * available" state if the route is somehow reached with the flag off, rather than
 * a blank screen. Tokens only; line Ionicons only; fontWeight ≤ 600.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useCommunityMe } from '../../hooks/useCommunity';
import { ThreadHeader } from '../../components/community';
import VoiceNoteComposer from '../../components/community/VoiceNoteComposer';
import type { VoiceAudienceTarget } from '../../components/community/VoicePrivacyCopy';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

export default function CommunityVoiceComposerScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityVoiceComposer'>>();
  const params = route.params;

  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? null;

  // Derive the concrete audience disclosure + the publish scope from the route
  // params. The scope ids (cohortId / conversationId) are forwarded to the
  // composer so the backend publishes into the right place; the *Name fields
  // only drive the human-readable disclosure.
  const { target, cohortId, conversationId } = useMemo<{
    target: VoiceAudienceTarget;
    cohortId?: string;
    conversationId?: string;
  }>(() => {
    if (params.target === 'cohort') {
      return {
        target: { kind: 'cohort', cohortName: params.cohortName ?? null },
        cohortId: params.cohortId,
      };
    }
    if (params.target === 'dm') {
      return {
        target: { kind: 'dm', recipientName: params.recipientName ?? null },
        conversationId: params.conversationId,
      };
    }
    return { target: { kind: 'hall' } };
  }, [params]);

  // Defense-in-depth: the route is not registered with the flag off, but render
  // a neutral state rather than a blank screen if it is ever reached.
  if (!featureFlags.communityVoiceNotes) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-voice-composer-screen"
      >
        <ThreadHeader title="Voice note" testID="community-voice-composer-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Voice notes are not available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-voice-composer-screen"
    >
      <ThreadHeader title="Voice note" testID="community-voice-composer-header" />
      <View style={styles.content}>
        <VoiceNoteComposer
          workspaceId={workspaceId}
          target={target}
          {...(cohortId ? { cohortId } : {})}
          {...(conversationId ? { conversationId } : {})}
          onPublished={() => navigation.goBack()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

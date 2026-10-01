/**
 * CommunitySafetyScreen — published community safety + contact surface
 * (Apple App Review 1.2). Reachable from the Community tab ("Community
 * safety"). Shows:
 *   - the community guidelines and how reports are handled (GET /community/safety)
 *   - how to report and block (every post, comment and message has a More menu)
 *   - the contact email (mailto), with a static fallback if the request fails
 *   - the member's block list with Unblock (GET/DELETE /community/blocks)
 */
import React from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../../components/HapticPressable';
import { ThreadHeader } from '../../components/community';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import {
  communitySafetyApi,
  COMMUNITY_SAFETY_FALLBACK_EMAIL,
} from '../../api/communitySafetyApi';

export const communitySafetyKeys = {
  info: ['community', 'safety', 'info'] as const,
  blocks: ['community', 'safety', 'blocks'] as const,
};

const FALLBACK_GUIDELINES = [
  'Be respectful. No harassment, bullying, hate speech or threats.',
  'No sexual or explicit content.',
  'No spam, advertising or scams.',
  'Share training experience, not medical advice.',
  'Report anything that breaks these rules.',
];

export default function CommunitySafetyScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: communitySafetyKeys.info,
    queryFn: () => communitySafetyApi.getSafetyInfo(),
  });
  const blocks = useQuery({
    queryKey: communitySafetyKeys.blocks,
    queryFn: () => communitySafetyApi.listBlocks(),
  });
  const unblock = useMutation({
    mutationFn: (userId: string) => communitySafetyApi.unblock(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['community'] }),
    onError: () => Alert.alert('Could not unblock', 'Please try again.'),
  });

  const email = info.data?.contact_email || COMMUNITY_SAFETY_FALLBACK_EMAIL;
  const guidelines = info.data?.guidelines?.length ? info.data.guidelines : FALLBACK_GUIDELINES;
  const commitment =
    info.data?.response_commitment ??
    'Reports are reviewed by your coach and the team. Content that breaks the rules is removed and repeat offenders lose access.';

  const confirmUnblock = (userId: string, name: string) =>
    Alert.alert(`Unblock ${name}?`, 'You will see their community content again and can message each other.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', onPress: () => unblock.mutate(userId) },
    ]);

  const card = [
    styles.card,
    { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
  ];
  const body = [styles.body, { color: semanticColors.textPrimary }];
  const heading = [styles.heading, { color: semanticColors.textMuted }];

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-safety-screen"
    >
      <ThreadHeader title="Community safety" testID="community-safety-header" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={heading}>Community guidelines</Text>
        <View style={card}>
          {info.isLoading ? <ActivityIndicator color={semanticColors.accent} /> : null}
          {guidelines.map((g) => (
            <Text key={g} style={[body, styles.item]}>
              {g}
            </Text>
          ))}
        </View>

        <Text style={heading}>Report or block</Text>
        <View style={card}>
          <Text style={body}>
            Every post, comment and message has a More button. Tap it to report the content (choose
            a reason) or to block the person. Blocking hides their posts, comments, messages and
            voice notes from you and stops direct messages both ways. They are not told.
          </Text>
          <Text style={[body, styles.item]} testID="community-safety-commitment">
            {commitment}
          </Text>
          <Text style={[body, styles.item]}>
            Posts and messages with abusive or explicit language are blocked before they are
            published.
          </Text>
        </View>

        <Text style={heading}>Contact the team</Text>
        <View style={card}>
          <Text style={body}>
            To report a safety concern, including about a coach, email us. If someone is in
            immediate danger, contact local emergency services.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void Linking.openURL(`mailto:${email}?subject=Community%20safety`)}
            accessibilityRole="link"
            accessibilityLabel={`Email ${email}`}
            style={styles.linkRow}
            testID="community-safety-email"
          >
            <Ionicons name="mail-outline" size={18} color={semanticColors.accent} />
            <Text style={[styles.link, { color: semanticColors.accent }]}>{email}</Text>
          </HapticPressable>
        </View>

        <Text style={heading}>Blocked members</Text>
        <View style={card} testID="community-safety-blocks">
          {blocks.isLoading ? (
            <ActivityIndicator color={semanticColors.accent} />
          ) : blocks.isError ? (
            <Text style={body}>Could not load your block list.</Text>
          ) : (blocks.data ?? []).length === 0 ? (
            <Text style={[body, { color: semanticColors.textMuted }]}>
              You have not blocked anyone.
            </Text>
          ) : (
            (blocks.data ?? []).map((b) => (
              <View key={b.user_id} style={styles.blockRow} testID={`community-safety-block-${b.user_id}`}>
                <Text style={[body, styles.flex]}>{b.name}</Text>
                <HapticPressable
                  intent="light"
                  onPress={() => confirmUnblock(b.user_id, b.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${b.name}`}
                  style={styles.unblock}
                  testID={`community-safety-unblock-${b.user_id}`}
                >
                  <Text style={[styles.link, { color: semanticColors.accent }]}>Unblock</Text>
                </HapticPressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  heading: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  body: { fontSize: 15, lineHeight: 22 },
  item: { marginTop: spacing.sm },
  linkRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  link: { fontSize: 15, fontWeight: '600' },
  blockRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  unblock: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});

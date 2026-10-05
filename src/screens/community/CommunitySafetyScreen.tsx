/**
 * CommunitySafetyScreen — published community safety + contact surface
 * (Apple App Review 1.2). Reachable from the Community tab and, with the tab
 * off, from More > Community (B-314-4), wherever member wins are live. Shows:
 *   - notices from moderators about the member's own content (warn / hide /
 *     ban; GET /community/safety/notices, B-314-6), marked read once shown
 *   - the community guidelines and how reports are handled (GET /community/safety)
 *   - how to report and block (every post, comment and message has a More menu)
 *   - the app's one support email (SUPPORT_EMAIL, owner ruling 2026-10-01
 *     14:19 PDT), opened through the shared useSupportEmail hook with a
 *     "Community safety" subject. If no email app opens (B-314-3), the shared
 *     SupportEmailFallback keeps the address selectable, copyable and lets the
 *     member try again (B-314-11). The server's contact_email is not used to
 *     build a mailto or shown: the support address is written once, in
 *     src/constants/support.ts.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContext } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../../components/HapticPressable';
import { ThreadHeader } from '../../components/community';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { describeCommunityFailure } from '../../api/communityErrors';
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';
import { SUPPORT_EMAIL } from '../../constants/support';
import {
  communitySafetyApi,
  COMMUNITY_GUIDELINES,
  COMMUNITY_RESPONSE_COMMITMENT,
  communitySafetyKeys,
  type CommunityModerationNotice,
} from '../../api/communitySafetyApi';

export { communitySafetyKeys };

const NOTICE_TITLES: Record<CommunityModerationNotice['action'], string> = {
  warn: 'Warning from a moderator',
  hide: 'Something you shared was removed',
  ban: 'Your community access was removed',
};

function noticeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Subject line of the draft the safety contact opens. */
export const COMMUNITY_SAFETY_EMAIL_SUBJECT = 'Community safety';

export default function CommunitySafetyScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  // Both stacks that host this screen hide the native header; a visible Back
  // keeps it from being a dead end. Context (not useNavigation) so the screen
  // also renders outside a navigator.
  const navigation = React.useContext(NavigationContext);
  const canGoBack = navigation?.canGoBack() ?? false;
  const info = useQuery({
    queryKey: communitySafetyKeys.info,
    queryFn: () => communitySafetyApi.getSafetyInfo(),
  });
  const blocks = useQuery({
    queryKey: communitySafetyKeys.blocks,
    queryFn: () => communitySafetyApi.listBlocks(),
  });
  const notices = useQuery({
    queryKey: communitySafetyKeys.notices,
    queryFn: () => communitySafetyApi.listNotices(),
  });
  // Shown means read: mark unread notices once, then refresh the badge count.
  const markedRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    const unread = (notices.data?.notices ?? []).filter(
      (n) => !n.read && !markedRef.current.has(n.id),
    );
    if (unread.length === 0) return;
    unread.forEach((n) => markedRef.current.add(n.id));
    void Promise.allSettled(unread.map((n) => communitySafetyApi.markNoticeRead(n.id))).then(() =>
      qc.invalidateQueries({ queryKey: communitySafetyKeys.notices }),
    );
  }, [notices.data, qc]);
  // B-314-11: one support address and one shared mailto path (#324 guard).
  const supportEmail = useSupportEmail(COMMUNITY_SAFETY_EMAIL_SUBJECT);
  const email = SUPPORT_EMAIL;
  const unblock = useMutation({
    mutationFn: (userId: string) => communitySafetyApi.unblock(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['community'] }),
    onError: (err: unknown) => {
      const failure = describeCommunityFailure(err, 'unblock', email);
      Alert.alert(failure.title, failure.message);
    },
  });

  const guidelines = info.data?.guidelines?.length ? info.data.guidelines : COMMUNITY_GUIDELINES;
  const commitment = info.data?.response_commitment || COMMUNITY_RESPONSE_COMMITMENT;
  // Described once per error (an unexpected one is reported to Sentry once).
  const blocksFailure = React.useMemo(
    () => (blocks.isError ? describeCommunityFailure(blocks.error, 'load_blocks', email) : null),
    [blocks.isError, blocks.error, email],
  );

  const noticesFailure = React.useMemo(
    () => (notices.isError ? describeCommunityFailure(notices.error, 'load_notices', email) : null),
    [notices.isError, notices.error, email],
  );

  const confirmUnblock = (userId: string, name: string) =>
    Alert.alert(`Unblock ${name}?`, 'You will both see each other’s community content again, and you can message each other.', [
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
      {canGoBack ? (
        <HapticPressable
          intent="light"
          onPress={() => navigation?.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="community-safety-back"
        >
          <Ionicons name="chevron-back" size={22} color={semanticColors.accent} />
          <Text style={[styles.link, { color: semanticColors.accent }]}>Back</Text>
        </HapticPressable>
      ) : null}
      <ThreadHeader title="Community safety" testID="community-safety-header" />
      <ScrollView contentContainerStyle={styles.content}>
        {notices.isError ? (
          <>
            <Text style={heading}>Notices for you</Text>
            <View style={card} testID="community-safety-notices-error">
              <Text style={body}>{noticesFailure?.message}</Text>
              <HapticPressable
                intent="light"
                onPress={() => notices.refetch()}
                accessibilityRole="button"
                accessibilityLabel="Load your notices again"
                style={styles.unblock}
                testID="community-safety-notices-retry"
              >
                <Text style={[styles.link, { color: semanticColors.accent }]}>Try again</Text>
              </HapticPressable>
            </View>
          </>
        ) : (notices.data?.notices ?? []).length > 0 ? (
          <>
            <Text style={heading}>Notices for you</Text>
            <View style={card} testID="community-safety-notices">
              {(notices.data?.notices ?? []).map((n, i) => (
                <View
                  key={n.id}
                  style={i > 0 ? styles.noticeGap : undefined}
                  testID={`community-safety-notice-${n.id}`}
                >
                  <Text style={[body, styles.noticeTitle]}>{NOTICE_TITLES[n.action]}</Text>
                  <Text style={[styles.noticeDate, { color: semanticColors.textMuted }]}>
                    {noticeDate(n.created_at)}
                  </Text>
                  <Text style={[body, styles.item]}>{n.message}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

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
            onPress={() => void supportEmail.open()}
            accessibilityRole="link"
            accessibilityLabel={`Email ${email}`}
            style={styles.linkRow}
            testID="community-safety-email"
          >
            <Ionicons name="mail-outline" size={18} color={semanticColors.accent} />
            <Text style={[styles.link, { color: semanticColors.accent }]}>{email}</Text>
          </HapticPressable>
          {/* B-314-3 / B-314-11: no mail app is not a dead end. */}
          <SupportEmailFallback
            handle={supportEmail}
            textStyle={[body, styles.item]}
            linkColor={semanticColors.accent}
            testID="community-safety-email-fallback"
          />
        </View>

        <Text style={heading}>Blocked members</Text>
        <View style={card} testID="community-safety-blocks">
          {blocks.isLoading ? (
            <ActivityIndicator color={semanticColors.accent} />
          ) : blocks.isError ? (
            <View testID="community-safety-blocks-error">
              <Text style={body}>{blocksFailure?.message}</Text>
              <HapticPressable
                intent="light"
                onPress={() => blocks.refetch()}
                accessibilityRole="button"
                accessibilityLabel="Load the block list again"
                style={styles.unblock}
                testID="community-safety-blocks-retry"
              >
                <Text style={[styles.link, { color: semanticColors.accent }]}>Try again</Text>
              </HapticPressable>
            </View>
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
  back: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  noticeGap: { marginTop: spacing.lg },
  noticeTitle: { fontWeight: '600' },
  noticeDate: { fontSize: 13, marginTop: 2 },
  unblock: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});

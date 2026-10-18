/**
 * Messages list (C3B-S2, MOCK-C3 Style B slice 2): the client's two conversations, the coach and Roman. Home's coach
 * entry and Roman shortcut open it while Style B is on (components/home/HomeHeaderActions); it is reachable from
 * nowhere else.
 *
 * Coached: a forest card for the coach (name, unread count, last message) opens the thread; a cream card for Roman
 * (messages left today, GET /me/roman/usage) opens Roman's chat; the line under it opens Your conversations with Roman,
 * which states the safety exception in full. No coach: the coach card offers Join a coach and Contact support, the
 * Roman card says Roman works with a coach (with the app's crisis line), and the client's old Roman chats stay one tap
 * away. Each read fails on its own and only hides its part (the last good value stays); every card still opens.
 * Cards slide up 250 ms on the decel curve; with Reduce Motion they fade in 150 ms and nothing moves.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import api from '../../services/api';
import { messagingV2Api, type InboxThread } from '../../api/messagingV2Api';
import { inboxLine } from '../../components/messaging/threadV2';
import { COMMUNITY_REPORT_CRISIS_LINE } from '../../api/communitySafetyApi';
import { featureFlags } from '../../config/featureFlags';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { JOIN_A_COACH, ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE, useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import { useOpenSupport } from '../../components/ai/useOpenSupport';
import RomanAvatar from '../../components/roman/RomanAvatar';
import { ROMAN_COMPOSER_PLACEHOLDER } from '../../components/roman/romanVoice';
import { ROMAN_CHATS_COPY } from '../settings/romanChatsCopy';
import { Headline, Screen, ScreenTopBar } from '../../ui';
import { Skeleton } from '../../ui/skeletons/Skeleton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme } from '../../theme/ThemeProvider';
import { colors as palette, gold, layout, motion, radius, typography } from '../../theme/tokens';

interface CoachRow {
  name: string | null;
  unread: number;
  preview: string | null;
}

/** The thread's last line, by CoachInboxV2's inboxPreview rules (the server already hides a blocked sender's). */
export function previewOf(t: InboxThread | undefined): string | null {
  if (!t) return null;
  if (t.blocked_by_me) return 'Blocked';
  const m = t.last_message;
  if (!m) return 'No messages yet';
  return m.is_mine ? `You: ${inboxLine(m)}` : inboxLine(m);
}

/** Roman messages left today, or null when the answer is missing or malformed (an older backend: no line). */
export function romanLeft(d: unknown): number | null {
  const u = d as { used?: { messages?: unknown }; limits?: { messages?: unknown } } | null;
  const used = u?.used?.messages;
  const limit = u?.limits?.messages;
  return typeof used === 'number' && typeof limit === 'number' && limit > 0 ? Math.max(0, Math.floor(limit - used)) : null;
}

const firstName = (name: string | null) => name?.split(/\s+/)[0] ?? null;
const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);

/** Reads on focus and every 30 s while the list is open; a failed read keeps the last good value. */
function useInbox(coached: boolean) {
  const v2 = useFeatureFlags().flags.messaging_core_v2;
  const [coach, setCoach] = useState<CoachRow | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  useFocusEffect(useCallback(() => {
    if (!coached) return undefined;
    let live = true;
    const read = () => {
      void Promise.allSettled([
        api.get<{ name?: unknown }>('/v1/clients/me/coach'),
        api.get<{ total?: unknown }>('/messages/unread-count'),
        v2 ? messagingV2Api.getClientInbox() : Promise.reject(new Error('messaging v2 off')),
      ]).then(([who, count, inbox]) => {
        if (!live) return;
        const name = ok(who)?.data?.name;
        const total = Number(ok(count)?.data?.total);
        const thread = ok(inbox);
        setCoach((prev) => ({
          name: typeof name === 'string' && name.trim() ? name.trim() : (prev?.name ?? null),
          unread: count.status === 'fulfilled' ? (Number.isFinite(total) && total > 0 ? Math.floor(total) : 0) : (prev?.unread ?? 0),
          preview: thread ? previewOf(thread.items[0]) : (prev?.preview ?? null),
        }));
      });
      if (featureFlags.romanChat) {
        void api.get<unknown>('/me/roman/usage').then((r) => { if (live) setLeft((prev) => romanLeft(r?.data) ?? prev); }, () => undefined);
      }
    };
    read();
    const id = setInterval(read, 30000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [coached, v2]));
  return { coach, left };
}

/** One card: slides up 250 ms (decel), or fades in 150 ms under Reduce Motion. */
function Rise({ index, children }: { index: number; children: React.ReactNode }): React.ReactElement {
  const reduce = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Runs again if the setting is read after mount: the 150 ms fade replaces the rise (nothing has moved yet).
    Animated.timing(enter, {
      toValue: 1,
      duration: reduce ? 150 : 250,
      delay: reduce ? 0 : index * 60,
      easing: Easing.bezier(...motion.easing.decel),
      useNativeDriver: true,
    }).start();
  }, [enter, index, reduce]);
  const lift = reduce ? 0 : enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  return <Animated.View testID={`inbox-rise-${index}`} style={{ opacity: enter, transform: [{ translateY: lift }] }}>{children}</Animated.View>;
}

export default function MessagesInboxScreen({ navigation }: { navigation: NavigationProp<ParamListBase> }): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const needsCoach = useClientNeedsCoach();
  const { coach, left } = useInbox(!needsCoach);
  const { messageCoach } = useEntitlement();
  const openSupport = useOpenSupport();
  const roman = featureFlags.romanChat;
  const tap = (go: () => void) => () => {
    void HapticService.selection();
    go();
  };
  const openChats = tap(() => navigation.navigate('MoreTab', { screen: 'RomanConversations', initial: false }));

  let body: React.ReactNode;
  if (needsCoach) {
    body = (
      <>
        <Rise index={0}>
          <View style={[s.card, s.hero, { backgroundColor: sc.accent }]} testID="inbox-coach">
            <Text style={[s.over, { color: gold[200] }]}>Your coach</Text>
            <Text accessibilityRole="header" style={[s.heroTitle, { color: sc.textOnAccent }]}>No coach connected</Text>
            <Text style={[s.body, { color: sc.textOnAccent }]}>Messages open once you join a coach. Need help finding one? Contact support.</Text>
            <View style={s.actions}>
              <Pressable onPress={tap(messageCoach)} accessibilityRole="button" accessibilityLabel={JOIN_A_COACH} testID="inbox-join" style={({ pressed }) => [s.action, { backgroundColor: sc.textOnAccent }, pressed && s.pressed]}>
                <Text style={[s.actionText, { color: sc.accent }]}>{JOIN_A_COACH}</Text>
              </Pressable>
              {openSupport ? (
                <Pressable onPress={tap(openSupport)} accessibilityRole="button" accessibilityLabel={ROMAN_CHATS_COPY.contactSupport} testID="inbox-support" style={({ pressed }) => [s.action, s.outline, { borderColor: sc.textOnMastheadMuted }, pressed && s.pressed]}>
                  <Text style={[s.actionText, { color: sc.textOnAccent }]}>{ROMAN_CHATS_COPY.contactSupport}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Rise>
        {roman ? (
          <Rise index={1}>
            <View style={[s.card, { backgroundColor: palette.cream }]} testID="inbox-roman">
              <View style={s.top}>
                <View style={[s.ringed, { borderColor: palette.stone }]}><RomanAvatar crop="neutral" size={52} /></View>
                <View style={s.who}>
                  <Text style={[s.over, { color: sc.textMuted }]}>Your assistant</Text>
                  <Text style={[s.title, { color: sc.textPrimary }]}>{ROMAN_LOCK_TITLE}</Text>
                </View>
              </View>
              <Text style={[s.body, { color: sc.textPrimary }]}>{ROMAN_LOCK_BODY}</Text>
              <Text style={[s.small, s.crisis, { color: sc.textMuted, borderLeftColor: sc.textPrimary }]} testID="inbox-crisis">{COMMUNITY_REPORT_CRISIS_LINE}</Text>
            </View>
          </Rise>
        ) : null}
        <Rise index={2}>
          <Pressable onPress={openChats} accessibilityRole="button" accessibilityLabel={ROMAN_CHATS_COPY.entryLabel} accessibilityHint={ROMAN_CHATS_COPY.entryHint} testID="inbox-chats" style={({ pressed }) => [s.card, s.row, { backgroundColor: palette.cream }, pressed && s.pressed]}>
            <Text style={[s.rowText, { color: sc.textPrimary }]}>{ROMAN_CHATS_COPY.entryLabel}</Text>
            <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} />
          </Pressable>
        </Rise>
      </>
    );
  } else if (!coach) {
    body = (
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your messages" testID="inbox-loading" style={s.list}>
        <Skeleton width="100%" height={168} borderRadius={radius.sheet} />
        {roman ? <Skeleton width="100%" height={152} borderRadius={radius.card} /> : null}
      </View>
    );
  } else {
    const first = firstName(coach.name); // first name, as Home's "Message Sam"
    const unread = coach.unread > 99 ? '99+' : String(coach.unread);
    const coachLabel = `${first ? `${first}, your coach` : 'Your coach'}${coach.unread > 0 ? `, ${unread} unread` : ''}${coach.preview ? `. ${coach.preview}` : ''}`;
    const privacy = `${first ?? 'Your coach'} never sees this chat, with one safety exception.`;
    body = (
      <>
        <Rise index={0}>
          <Pressable onPress={tap(() => navigation.navigate('Messages'))} accessibilityRole="button" accessibilityLabel={coachLabel} testID="inbox-coach" style={({ pressed }) => [s.card, s.hero, { backgroundColor: sc.accent }, pressed && s.pressed]}>
            <View style={s.top}>
              <View style={[s.mono, { backgroundColor: sc.textOnAccent }]}>
                {first ? <Text style={[s.monoText, { color: sc.accent }]}>{first.charAt(0).toUpperCase()}</Text>
                  : <Ionicons name="person-outline" size={24} color={sc.accent} />}
              </View>
              <View style={s.who}>
                <Text style={[s.over, { color: gold[200] }]}>Your coach</Text>
                <Text style={[s.title, { color: sc.textOnAccent }]}>{first ?? 'Message your coach'}</Text>
              </View>
              {coach.unread > 0 ? (
                <View style={[s.unread, { borderColor: gold[300] }]} testID="inbox-unread">
                  <Text style={[s.unreadText, { color: sc.textOnAccent }]}>{unread}</Text>
                </View>
              ) : null}
            </View>
            {coach.preview ? <Text style={[s.preview, { color: sc.textOnAccent }]} testID="inbox-preview">{coach.preview}</Text> : null}
          </Pressable>
        </Rise>
        {roman ? (
          <>
            <Rise index={1}>
              <Pressable onPress={tap(() => navigation.navigate('MoreTab', { screen: 'RomanChat', initial: false }))} accessibilityRole="button" accessibilityLabel={`Roman, your assistant${left !== null ? `, ${left} left today` : ''}`} testID="inbox-roman" style={({ pressed }) => [s.card, { backgroundColor: palette.cream }, pressed && s.pressed]}>
                <View style={s.top}>
                  <View style={[s.ringed, { borderColor: gold[500] }]}><RomanAvatar crop="neutral" size={52} /></View>
                  <View style={s.who}>
                    <Text style={[s.over, { color: sc.textMuted }]}>Your assistant</Text>
                    <Text style={[s.title, { color: sc.textPrimary }]}>Roman</Text>
                  </View>
                  {left !== null ? (
                    <View style={s.left} testID="inbox-left">
                      <Text style={[s.count, { color: sc.textPrimary }]}>{left}</Text>
                      <Text style={[s.small, { color: sc.textMuted }]}>left today</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[s.body, { color: sc.textPrimary }]}>{ROMAN_COMPOSER_PLACEHOLDER}</Text>
              </Pressable>
            </Rise>
            <Rise index={2}>
              <Pressable onPress={openChats} accessibilityRole="button" accessibilityLabel={privacy} accessibilityHint={ROMAN_CHATS_COPY.entryHint} testID="inbox-privacy" style={({ pressed }) => [s.privacy, pressed && s.pressed]}>
                <Ionicons name="shield-outline" size={16} color={sc.textMuted} />
                <Text style={[s.small, s.shrink, { color: sc.textMuted }]}>{privacy}</Text>
              </Pressable>
            </Rise>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Screen edges={['top']} header={<ScreenTopBar onBack={() => navigation.goBack()} testID="inbox-top" />} testID="messages-inbox">
      <Headline level="h1" style={s.heading}>Messages</Headline>
      <View style={s.list}>{body}</View>
    </Screen>
  );
}

const s = StyleSheet.create({
  heading: { marginTop: 8, marginBottom: 16 },
  list: { gap: 12 },
  card: { borderRadius: radius.card, padding: 20, gap: 12 },
  hero: { borderRadius: radius.sheet },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  who: { flex: 1, gap: 4 },
  shrink: { flexShrink: 1 },
  over: { ...typography.eyebrow, lineHeight: 16 },
  heroTitle: { ...typography.h1 },
  title: { ...typography.h2 },
  mono: { width: 48, height: 48, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  monoText: { ...typography.h2 },
  ringed: { borderWidth: 2, borderRadius: radius.chip, padding: 2 },
  // A badge, not a tap target (the whole card is): 40 pt as drawn, so a long first name keeps its line.
  unread: { minWidth: 40, minHeight: 40, borderWidth: 2, borderRadius: radius.chip, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  unreadText: { ...typography.h3, fontVariant: ['tabular-nums'] },
  preview: { ...typography.body, fontSize: 17, lineHeight: 26 },
  left: { alignItems: 'flex-end' },
  count: { ...typography.h1, fontVariant: ['tabular-nums'] },
  body: { ...typography.body },
  small: { ...typography.bodySmall },
  crisis: { borderLeftWidth: 2, paddingLeft: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  action: { flexGrow: 1, flexBasis: 132, minHeight: 48, borderRadius: radius.button, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1 },
  actionText: { ...typography.bodyMd, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, paddingVertical: 12 },
  rowText: { ...typography.body, flex: 1 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin, paddingHorizontal: 4, justifyContent: 'center' },
});

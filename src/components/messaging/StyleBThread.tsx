/**
 * Style B "Focus" parts for the client's coach thread (C3B-THREAD, behind featureFlags.c3StyleB; MOCK-C3 slice 1). Coach
 * screens keep MessageBubble. Client bubbles are forest, the coach's cream. A failed send is warm (gold line, never red)
 * with a visible tap to send again; a message written offline has a dashed edge and waits. New messages slide in 250 ms
 * on the decel curve; with Reduce Motion they fade in 150 ms instead.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HapticService } from '../../ui/haptics/haptics.service';
import { Skeleton } from '../../ui/skeletons/Skeleton';
import { useTheme } from '../../theme/ThemeProvider';
import { colors as palette, gold, layout, motion, radius, typography, withAlpha } from '../../theme/tokens';
import type { BubbleMessage } from './MessageBubble';

export type SendState = 'sent' | 'failed' | 'waiting';

/** Style B time marks read "6:03 pm". */
export function timeB(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/, (_m, p: string) => ` ${p.toLowerCase()}`);
}

/** Day mark text: main's date label, set as a Style B serif mark. */
export function dayB(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function useB() {
  const { semanticColors: sc } = useTheme();
  return useMemo(() => ({
    page: sc.bgPrimary, surface: sc.bgSurface, ink: sc.textPrimary, muted: sc.textMuted,
    mine: sc.accent, onMine: sc.textOnAccent, theirs: palette.cream,
    // Warm, not red: gold 800 text (6.65:1 on bone) on a gold 700 edge.
    warm: gold[800], warmEdge: gold[700],
  }), [sc]);
}

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase();

export function StyleBHeader({ name, known, contactLabel, canOpenContact, onBack, onContact, right, topStyle }: {
  name: string;
  known: boolean;
  contactLabel: string;
  canOpenContact: boolean;
  onBack: () => void;
  onContact: () => void;
  right?: React.ReactNode;
  topStyle: { paddingTop: number };
}): React.ReactElement {
  const c = useB();
  return (
    <View style={[s.header, topStyle, { backgroundColor: c.page }]} testID="c3b-header">
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={s.icon}>
        <Ionicons name="chevron-back" size={24} color={c.ink} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onContact}
        disabled={!canOpenContact}
        accessibilityRole={canOpenContact ? 'button' : undefined}
        accessibilityState={{ disabled: !canOpenContact }}
        accessibilityLabel={contactLabel}
        style={s.who}
      >
        <View style={[s.avatar, { backgroundColor: c.mine }]}>
          {known ? <Text style={[s.avatarText, { color: c.onMine }]}>{initialOf(name)}</Text>
            : <Ionicons name="person-outline" size={20} color={c.onMine} />}
        </View>
        <View style={s.whoText}>
          <Text style={[s.name, { color: c.ink }]} numberOfLines={1}>{name}</Text>
          {known ? <Text style={[s.sub, { color: c.muted }]} numberOfLines={1}>Your coach</Text> : null}
        </View>
      </TouchableOpacity>
      {right ?? <View style={s.icon} />}
    </View>
  );
}

export function StyleBDayMark({ label }: { label: string }): React.ReactElement {
  const c = useB();
  return <Text style={[s.day, { color: c.ink }]}>{label}</Text>;
}

export interface StyleBBubbleProps {
  message: BubbleMessage;
  isMe: boolean;
  state: SendState;
  /** Last of a same-sender group: carries the time and the wider gap. */
  groupEnd: boolean;
  /** Newest read client message: "Read {time}" under it. */
  readAt?: string | null;
  /** Newest client message, not read yet: main's "Sent" under it. */
  showSent?: boolean;
  animateIn: boolean;
  reduceMotion: boolean;
  onLongPress: (m: BubbleMessage) => void;
  onRetry: () => void;
}

export function StyleBBubble({ message, isMe, state, groupEnd, readAt, showSent, animateIn, reduceMotion, onLongPress, onRetry }: StyleBBubbleProps): React.ReactElement {
  const c = useB();
  const failed = isMe && state === 'failed';
  const waiting = isMe && state === 'waiting';
  const filled = isMe && !failed && !waiting;
  const text = filled ? c.onMine : c.ink;
  const enter = useRef(new Animated.Value(animateIn ? 0 : 1)).current;
  useEffect(() => {
    if (!animateIn) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 150 : 250,
      easing: Easing.bezier(...motion.easing.decel),
      useNativeDriver: true,
    }).start();
    // Once per mount: a message slides in when it first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lift = reduceMotion ? 0 : enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const meta = `${message.pinned ? 'Pinned  ' : ''}${message.edited ? 'Edited  ' : ''}${groupEnd ? timeB(message.created_at) : ''}`.trim();

  return (
    <Animated.View testID={`c3b-row-${message.id}`} style={[isMe ? s.right : s.left, { marginBottom: groupEnd ? 16 : 4, opacity: enter, transform: [{ translateY: lift }] }]}>
      <Pressable
        onPress={failed ? onRetry : undefined}
        onLongPress={() => {
          HapticService.selection();
          onLongPress(message);
        }}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={message.deleted
          ? 'Message deleted.'
          : `Message: ${message.body}.${message.edited ? ' Edited.' : ''}${message.pinned ? ' Pinned.' : ''} Long press for actions.`}
        accessibilityHint="Long press for message actions."
        style={({ pressed }) => [
          s.bubble,
          { backgroundColor: filled ? c.mine : isMe ? c.surface : c.theirs },
          failed && [s.edge, { borderColor: c.warmEdge }],
          waiting && [s.edge, s.dashed, { borderColor: c.muted }],
          filled && groupEnd && s.tail,
          pressed && s.pressed,
        ]}
      >
        {message.parent && !message.deleted ? (
          <View accessibilityLabel={`Replying to: ${message.parent.body}`} style={[s.quote, { backgroundColor: filled ? withAlpha(c.onMine, 0.14) : c.page }]}>
            <Text numberOfLines={2} style={[s.quoteText, { color: filled ? c.onMine : c.muted }]}>{message.parent.body}</Text>
          </View>
        ) : null}
        {message.deleted
          ? <Text style={[s.body, s.deleted, { color: filled ? c.onMine : c.muted }]}>Message deleted</Text>
          : <Text style={[s.body, { color: text }]}>{message.body}</Text>}
      </Pressable>
      {!failed && !waiting && meta ? <Text style={[s.meta, { color: c.muted }]}>{meta}</Text> : null}
      {waiting ? (
        <View style={s.status}>
          <Ionicons name="time-outline" size={14} color={c.muted} />
          <Text style={[s.meta, { color: c.muted }]}>Waiting to send</Text>
        </View>
      ) : null}
      {failed ? (
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" accessibilityLabel="Not sent. Tap to send again" style={[s.status, s.retry]}>
          <Ionicons name="alert-circle-outline" size={14} color={c.warm} />
          <Text style={[s.meta, { color: c.warm }]}>Not sent. Tap to send again</Text>
        </TouchableOpacity>
      ) : null}
      {readAt ? <Text style={[s.meta, { color: c.muted }]}>{`Read ${timeB(readAt)}`}</Text> : null}
      {!readAt && showSent ? <Text style={[s.meta, { color: c.muted }]}>Sent</Text> : null}
    </Animated.View>
  );
}

/** Offline with two or more waiting: C3-S-58 under them (a single one says "Waiting to send" on its own). */
export function StyleBQueued({ count }: { count: number }): React.ReactElement | null {
  const c = useB();
  if (count < 2) return null;
  return (
    <View style={[s.queued, { backgroundColor: c.theirs }]}>
      <Text style={[s.meta, { color: c.ink, marginTop: 0 }]}>{`${count} messages send when you reconnect.`}</Text>
    </View>
  );
}

/** First message: one deep-forest hero card, then main's prompt. */
export function StyleBFirstCard({ coachName }: { coachName: string }): React.ReactElement {
  const c = useB();
  const fade = useRef(new Animated.Value(0)).current; // index section 5: the first card fades in (no movement)
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View style={[s.first, { opacity: fade }]} testID="c3b-first">
      <View style={[s.hero, { backgroundColor: c.mine }]}>
        <View style={s.heroTop}>
          <View style={[s.heroAvatar, { backgroundColor: c.onMine }]}>
            <Text style={[s.heroInitial, { color: c.mine }]}>{initialOf(coachName)}</Text>
          </View>
          <Text style={[s.overline, { color: palette.cream }]}>Your coach</Text>
        </View>
        <Text accessibilityRole="header" style={[s.heroTitle, { color: c.onMine }]}>{`Say hello to ${coachName}`}</Text>
      </View>
      <Text style={[s.hint, { color: c.muted }]}>Start a conversation with your coach</Text>
    </Animated.View>
  );
}

const SKELETON: ReadonlyArray<readonly ['flex-start' | 'flex-end', DimensionValue, number]> = [
  ['flex-start', '58%', 44], ['flex-end', '52%', 92], ['flex-start', '66%', 60], ['flex-end', '46%', 44], ['flex-start', '62%', 52],
];

/** Loading: bubble-shaped placeholders; the pulse holds still under Reduce Motion (Skeleton). */
export function StyleBLoading(): React.ReactElement {
  return (
    <View style={s.loading} accessible accessibilityRole="progressbar" accessibilityLabel="Loading your messages" testID="c3b-loading">
      {SKELETON.map(([side, width, height], i) => (
        <View key={i} style={{ alignItems: side, marginBottom: 12 }}>
          <Skeleton width={width} height={height} borderRadius={radius.card} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  icon: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, minHeight: layout.touchMin, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400' },
  whoText: { flex: 1 },
  name: { ...typography.h4 },
  sub: { ...typography.bodySmall, lineHeight: 20 },
  day: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', textAlign: 'center', marginTop: 8, marginBottom: 16 },
  right: { alignItems: 'flex-end' },
  left: { alignItems: 'flex-start' },
  // 44 x 44 pt at least: a one-letter reply ("k") is still a full tap and long-press target.
  bubble: { maxWidth: '80%', minWidth: layout.touchMin, minHeight: layout.touchMin, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  tail: { borderBottomRightRadius: radius.control },
  edge: { borderWidth: 1 },
  dashed: { borderStyle: 'dashed' },
  pressed: { opacity: 0.85 },
  body: { ...typography.body },
  deleted: { fontStyle: 'italic' },
  quote: { borderRadius: radius.control, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 6 },
  quoteText: { ...typography.bodySmall, fontSize: 13 },
  meta: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, marginTop: 4, paddingHorizontal: 4, fontVariant: ['tabular-nums'] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  retry: { minHeight: layout.touchMin },
  queued: { alignSelf: 'flex-end', borderRadius: radius.chip, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
  first: { flex: 1, justifyContent: 'center', paddingVertical: 48, gap: 20 },
  hero: { borderRadius: radius.sheet, padding: 24, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroAvatar: { width: 56, height: 56, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  heroInitial: { ...typography.h2 },
  overline: { ...typography.eyebrow, lineHeight: 16 },
  heroTitle: { ...typography.h1 },
  hint: { ...typography.bodySmall, textAlign: 'center' },
  loading: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
});

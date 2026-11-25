/**
 * RomanMessageBubble — one turn in the Roman room (B30, prototype 70-73; owner
 * 14:57 "a premium Anthropic mixed with iMessage"). Roman: serif reading text
 * on bone, no bubble, under a small portrait + ROMAN overline; blank lines,
 * "-", "*", "•" and "1." lines become paragraphs and hanging bullets, and
 * markdown emphasis markers are dropped. Client: a quiet right-aligned
 * bubble. `reveal` fades a fresh reply in paragraph by paragraph (Reduce
 * Motion: at once). FACE+VOICE: every assistant turn shows Roman's face.
 * Plain Text only (never HTML), so FIFTY_FAILURES #4 does not apply.
 * CRISIS-BTN (flag crisisActions): a reply the server marked carries its
 * crisis actions under the text, as the last block of the reveal.
 * ROMAN-HOLD-M (#197-D3): holding Roman's reply text opens the shared message
 * menu (`onLongPress`); a client turn sent as a reply shows its quote strip.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import RomanAvatar from './RomanAvatar';
import RomanCrisisActions from './RomanCrisisActions';
import RomanQuoteStrip from './RomanQuoteStrip';
import { featureFlags } from '../../config/featureFlags';
import { ROMAN_INTERRUPTED_NOTE } from './romanVoice';
import { splitRomanQuote } from './romanReply';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { RomanMessage } from '../../api/romanApi';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { RomanInterruptedNote } from './RomanHeldCard';

export interface RomanMessageBubbleProps {
  message: RomanMessage;
  /** Fade this reply in paragraph by paragraph (fresh replies only). */
  reveal?: boolean;
  /** Reduce Motion: when true a reveal shows the text at once. */
  reduceMotion?: boolean;
  /** Hold on Roman's reply: opens the message menu (Reply, Copy, Report). */
  onLongPress?: (message: RomanMessage) => void;
  testID?: string;
}

/** The people's chat hold timing and hint (MessageBubble), reused as is. */
const HOLD_MS = 350;
const HOLD_HINT = 'Long press for message actions.';
const HOLD_ACTIONS = [{ name: 'longpress' as const }];
/**
 * LS-950 B2 (FIX-950R1): a one-line reply reads 28 pt tall, so the hold reaches 8 pt above and
 * below it (44 pt at 100%, 52 at 130%). Nothing drawn moves: the reach sits in the row's own
 * speaker gap and bottom padding (both spacing.sm), so Android still delivers the touch.
 */
export const HOLD_SLOP = { top: spacing.sm, bottom: spacing.sm, left: 0, right: 0 } as const;

export type RomanBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; marker: string; text: string };

const BULLET = /^\s*(?:([-*\u2022])|(\d{1,2})[.)])\s+(.*)$/;

/** Split plain reply text into paragraphs and bullet items. */
export function romanBlocks(content: string): RomanBlock[] {
  const clean = content.replace(/\*\*|__/g, '').replace(/\r\n/g, '\n');
  const blocks: RomanBlock[] = [];
  for (const chunk of clean.split(/\n\s*\n/)) {
    let prose: string[] = [];
    const flush = () => {
      const text = prose.join('\n').trim();
      if (text !== '') blocks.push({ kind: 'paragraph', text });
      prose = [];
    };
    for (const line of chunk.split('\n')) {
      const m = BULLET.exec(line);
      if (m) {
        flush();
        blocks.push({ kind: 'bullet', marker: m[2] ? `${m[2]}.` : '\u2022', text: m[3].trim() });
      } else {
        prose.push(line);
      }
    }
    flush();
  }
  return blocks.length > 0 ? blocks : [{ kind: 'paragraph', text: content }];
}

/** Paragraph fade: 240 ms each, 120 ms apart (doctrine: 300 ms or less). */
const FADE_MS = 240;
const STAGGER_MS = 120;

function RomanMessageBubbleComponent({
  message,
  reveal = false,
  reduceMotion = false,
  onLongPress,
  testID,
}: RomanMessageBubbleProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  const isAssistant = message.role === 'assistant';
  const blocks = useMemo(() => (isAssistant ? romanBlocks(message.content) : []), [isAssistant, message.content]);
  const animate = isAssistant && reveal && !reduceMotion;
  const crisis = isAssistant && featureFlags.crisisActions ? message.safetyActions : undefined;
  const faded = blocks.length + (crisis ? 1 : 0);
  const opacities = useRef<Animated.Value[]>([]);
  if (opacities.current.length !== faded) {
    opacities.current = Array.from({ length: faded }, () => new Animated.Value(animate ? 0 : 1));
  }

  // faded: a reply whose paragraph (or action) count changes gets fresh opacities; run them too.
  useEffect(() => {
    if (!animate) {
      opacities.current.forEach((o) => o.setValue(1));
      return undefined;
    }
    const run = Animated.stagger(
      STAGGER_MS,
      opacities.current.map((o) => Animated.timing(o, { toValue: 1, duration: FADE_MS, useNativeDriver: true })),
    );
    run.start();
    return () => run.stop();
  }, [animate, faded]);

  const hold = useMemo(
    () =>
      onLongPress
        ? () => {
            HapticService.selection();
            onLongPress(message);
          }
        : undefined,
    [onLongPress, message],
  );
  const onHoldAction = useMemo(
    () => (hold ? (e: AccessibilityActionEvent) => { if (e.nativeEvent.actionName === 'longpress') hold(); } : undefined),
    [hold],
  );

  if (isAssistant) {
    const reading = [styles.reading, { color: c.textPrimary }];
    return (
      <View style={styles.assistantRow} testID={testID} role="listitem">
        <View style={styles.speakerRow}>
          <RomanAvatar crop="neutral" size={22} testID="roman-bubble-avatar" />
          <Text style={[styles.speakerLabel, { color: c.textMuted }]}>ROMAN</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.assistantBody, pressed && hold ? styles.held : null]}
          onLongPress={hold}
          delayLongPress={HOLD_MS}
          hitSlop={hold ? HOLD_SLOP : undefined}
          accessible
          accessibilityRole="text"
          // The interrupted note is part of what a screen reader speaks (B-602-C-1).
          accessibilityLabel={`Roman said: ${message.content}${message.interrupted ? ` ${ROMAN_INTERRUPTED_NOTE}` : ''}`}
          accessibilityHint={hold ? HOLD_HINT : undefined}
          accessibilityActions={hold ? HOLD_ACTIONS : undefined}
          onAccessibilityAction={onHoldAction}
          testID={testID ? `${testID}-reply` : undefined}
        >
          {blocks.map((b, i) => (
            <Animated.View
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={[b.kind === 'bullet' ? styles.bulletRow : null, { opacity: opacities.current[i] }]}
            >
              {b.kind === 'bullet' ? (
                <>
                  <Text style={[reading, styles.bulletMarker]}>{b.marker}</Text>
                  <Text style={[reading, styles.bulletText]}>{b.text}</Text>
                </>
              ) : (
                <Text style={reading}>{b.text}</Text>
              )}
            </Animated.View>
          ))}
          {message.interrupted ? (
            <RomanInterruptedNote testID={testID ? `${testID}-interrupted` : undefined} />
          ) : null}
        </Pressable>
        {crisis ? (
          <Animated.View style={[styles.crisis, { opacity: opacities.current[blocks.length] }]}>
            <RomanCrisisActions actions={crisis} testID={testID ? `${testID}-crisis` : undefined} />
          </Animated.View>
        ) : null}
      </View>
    );
  }

  const quoted = splitRomanQuote(message.content);
  const said = quoted ? quoted.body : message.content;
  return (
    <View style={styles.userRow} testID={testID} role="listitem">
      <View
        style={[styles.userBubble, { backgroundColor: c.bgSurface, borderColor: c.border }]}
        testID={testID ? `${testID}-bubble` : undefined}
      >
        {quoted ? <RomanQuoteStrip quote={quoted.quote} testID={testID ? `${testID}-quote` : undefined} /> : null}
        <Text style={[styles.userText, { color: c.textPrimary }]} accessibilityLabel={`You said: ${said}`}>
          {said}
        </Text>
      </View>
    </View>
  );
}

const RomanMessageBubble = React.memo(RomanMessageBubbleComponent);
export default RomanMessageBubble;

/** Serif reading text: Cormorant 19 on 28 (lineHeight 1.47x, no descender clip). */
export const ROMAN_READING = {
  fontFamily: typography.h2.fontFamily,
  fontSize: 19,
  lineHeight: 28,
  letterSpacing: 0.2,
} as const;

const styles = StyleSheet.create({
  assistantRow: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.sm, marginHorizontal: spacing.xl },
  speakerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  speakerLabel: { ...typography.eyebrow },
  assistantBody: { gap: spacing.md, borderRadius: radius.control },
  // A held reply dims a touch, like a held bubble in the people's chat (bubblePressed 0.85).
  held: { opacity: 0.85 },
  reading: { ...ROMAN_READING },
  bulletRow: { flexDirection: 'row', paddingLeft: spacing.xs },
  bulletMarker: { width: 22 },
  bulletText: { flex: 1 },
  crisis: { marginTop: spacing.sm },
  userRow: { alignItems: 'flex-end', paddingTop: spacing.lg, paddingBottom: spacing.xs, marginHorizontal: spacing.xl },
  // Owner 17:07: rounded, never a rectangle (radius token, Q10b).
  userBubble: {
    maxWidth: '82%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  userText: { ...typography.body, lineHeight: 24 },
});

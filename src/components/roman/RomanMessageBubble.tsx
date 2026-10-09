/**
 * RomanMessageBubble — one turn in the Roman room (B30, prototype 70-73; owner
 * 14:57 "a premium Anthropic mixed with iMessage"). Roman: serif reading text
 * on bone, no bubble, under a small portrait + ROMAN overline; blank lines,
 * "-", "*", "•" and "1." lines become paragraphs and hanging bullets, and
 * markdown emphasis markers are dropped. Client: a quiet right-aligned
 * bubble. `reveal` fades a fresh reply in paragraph by paragraph (Reduce
 * Motion: at once). FACE+VOICE: every assistant turn shows Roman's face.
 * Plain Text only (never HTML), so FIFTY_FAILURES #4 does not apply.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { ROMAN_INTERRUPTED_NOTE } from './romanVoice';
import type { RomanMessage } from '../../api/romanApi';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

export interface RomanMessageBubbleProps {
  message: RomanMessage;
  /** Fade this reply in paragraph by paragraph (fresh replies only). */
  reveal?: boolean;
  /** Reduce Motion: when true a reveal shows the text at once. */
  reduceMotion?: boolean;
  testID?: string;
}

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
  testID,
}: RomanMessageBubbleProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  const isAssistant = message.role === 'assistant';
  const blocks = useMemo(() => (isAssistant ? romanBlocks(message.content) : []), [isAssistant, message.content]);
  const animate = isAssistant && reveal && !reduceMotion;
  const opacities = useRef<Animated.Value[]>([]);
  if (opacities.current.length !== blocks.length) {
    opacities.current = blocks.map(() => new Animated.Value(animate ? 0 : 1));
  }

  // blocks.length: a reply whose paragraph count changes gets fresh opacities; run them too.
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
  }, [animate, blocks.length]);

  if (isAssistant) {
    const reading = [styles.reading, { color: c.textPrimary }];
    return (
      <View style={styles.assistantRow} testID={testID} role="listitem">
        <View style={styles.speakerRow}>
          <RomanAvatar crop="neutral" size={22} testID="roman-bubble-avatar" />
          <Text style={[styles.speakerLabel, { color: c.textMuted }]}>ROMAN</Text>
        </View>
        <View
          style={styles.assistantBody}
          accessible
          accessibilityRole="text"
          // The interrupted note is part of what a screen reader speaks (B-602-C-1).
          accessibilityLabel={`Roman said: ${message.content}${message.interrupted ? ` ${ROMAN_INTERRUPTED_NOTE}` : ''}`}
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
            <Text style={[styles.interruptedNote, { color: c.textMuted }]}>{ROMAN_INTERRUPTED_NOTE}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.userRow} testID={testID} role="listitem">
      <View
        style={[styles.userBubble, { backgroundColor: c.bgSurface, borderColor: c.border }]}
        testID={testID ? `${testID}-bubble` : undefined}
      >
        <Text style={[styles.userText, { color: c.textPrimary }]} accessibilityLabel={`You said: ${message.content}`}>
          {message.content}
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
  assistantBody: { gap: spacing.md },
  reading: { ...ROMAN_READING },
  bulletRow: { flexDirection: 'row', paddingLeft: spacing.xs },
  bulletMarker: { width: 22 },
  bulletText: { flex: 1 },
  interruptedNote: { ...typography.bodySmall, marginTop: spacing.xs },
  userRow: { alignItems: 'flex-end', paddingTop: spacing.lg, paddingBottom: spacing.xs, marginHorizontal: spacing.xl },
  // Owner 17:07: rounded, never a rectangle (radius token, Q10b).
  userBubble: {
    maxWidth: '82%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  userText: { ...typography.body, lineHeight: 24 },
});

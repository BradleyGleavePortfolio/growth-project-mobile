/**
 * One proposed change: kind badge (text plus colour, never colour alone),
 * exercise name, before -> after, reason, warnings and a keep switch.
 * Cards cascade in with a 60 ms stagger; Reduce Motion shows them at once.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { AiBuilderChange } from '../../../api/aiBuilderApi';
import type { SemanticTokens } from '../../../theme/tokens';
import { spacing, typography } from '../../../theme/tokens';
import { formatRow, KIND_LABELS } from './aiBuilderCopy';

export const CARD_STAGGER_MS = 60;

interface Props {
  change: AiBuilderChange;
  index: number;
  kept: boolean;
  reduceMotion: boolean;
  onToggle: (changeId: string) => void;
  sc: SemanticTokens;
}

export default function ChangeCard({ change, index, kept, reduceMotion, onToggle, sc }: Props) {
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      delay: index * CARD_STAGGER_MS,
      useNativeDriver: true,
    }).start();
  }, [anim, index, reduceMotion]);

  const kind = KIND_LABELS[change.kind];
  const before = formatRow(change.before);
  const after = formatRow(change.after);
  const delta = before && after ? `${before} -> ${after}` : after || before;
  const badgeColor = change.kind === 'removed' ? sc.textMuted : change.kind === 'added' ? sc.accent : sc.accentText;
  const a11y = `${kind}: ${change.exercise.name}. ${delta ? `${delta}. ` : ''}${change.reason}`;

  return (
    <Animated.View
      testID={`ai-change-${change.change_id}`}
      style={[
        styles.card,
        { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: anim },
        !reduceMotion && {
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.badge, { borderColor: badgeColor }]}>
          <Text style={[typography.caption, { color: badgeColor }]}>{kind}</Text>
        </View>
        <Text
          style={[
            typography.bodyMd,
            styles.name,
            { color: sc.textPrimary },
            change.kind === 'removed' && styles.strike,
          ]}
          numberOfLines={2}
        >
          {change.exercise.name}
        </Text>
        <Switch
          testID={`ai-keep-${change.change_id}`}
          accessibilityLabel={`Keep this change: ${kind} ${change.exercise.name}`}
          accessibilityHint={a11y}
          value={kept}
          onValueChange={() => onToggle(change.change_id)}
        />
      </View>
      {delta ? (
        <Text style={[typography.body, { color: sc.textPrimary }]}>{delta}</Text>
      ) : null}
      <Text style={[typography.caption, { color: sc.textMuted }]}>{change.reason}</Text>
      {change.warnings.map((w) => (
        <Text
          key={w}
          accessibilityRole="alert"
          style={[typography.caption, styles.warning, { color: sc.textPrimary, borderColor: sc.accentText }]}
        >
          {`Warning: ${w}`}
        </Text>
      ))}
      {!kept ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Keep this change again" onPress={() => onToggle(change.change_id)}>
          <Text style={[typography.caption, { color: sc.accentText }]}>Not applied. Tap to keep.</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  name: { flex: 1 },
  strike: { textDecorationLine: 'line-through' },
  warning: { borderLeftWidth: 3, paddingLeft: spacing.sm },
});

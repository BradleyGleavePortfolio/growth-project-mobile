/**
 * One proposed change: kind badge (text plus colour, never colour alone), name, before -> after,
 * reason, warnings, keep switch. 60 ms stagger cascade; Reduce Motion shows it at once.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Switch, Text, View } from 'react-native';
import type { AiBuilderChange } from '../../../api/aiBuilderApi';
import { spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { formatRow, KIND_LABELS } from './aiBuilderCopy';

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
    if (reduceMotion) return anim.setValue(1);
    Animated.timing(anim, { toValue: 1, duration: 220, delay: index * 60, useNativeDriver: true }).start();
  }, [anim, index, reduceMotion]);

  const kind = KIND_LABELS[change.kind];
  const before = formatRow(change.before);
  const after = formatRow(change.after);
  const delta = before && after ? `${before} -> ${after}` : after || before;
  const badge = change.kind === 'removed' ? sc.textMuted : change.kind === 'added' ? sc.accent : sc.accentText;
  const slide = reduceMotion ? null : { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] };

  return (
    <Animated.View testID={`ai-change-${change.change_id}`} style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: anim }, slide]}>
      <View style={styles.row}>
        <Text style={[typography.caption, styles.badge, { color: badge, borderColor: badge }]}>{kind}</Text>
        <Text numberOfLines={2} style={[typography.bodyMd, styles.name, { color: sc.textPrimary }, change.kind === 'removed' && styles.strike]}>
          {change.exercise.name}
        </Text>
        <Switch
          testID={`ai-keep-${change.change_id}`}
          accessibilityLabel={`Keep this change: ${kind} ${change.exercise.name}${delta ? `, ${delta}` : ''}. ${change.reason}`}
          value={kept}
          onValueChange={() => onToggle(change.change_id)}
        />
      </View>
      {delta ? <Text style={[typography.body, { color: sc.textPrimary }]}>{delta}</Text> : null}
      <Text style={[typography.caption, { color: sc.textMuted }]}>{change.reason}</Text>
      {change.warnings.map((w) => (
        <Text key={w} accessibilityRole="alert" style={[typography.caption, styles.warning, { color: sc.textPrimary, borderColor: sc.accentText }]}>
          {`Warning: ${w}`}
        </Text>
      ))}
      {!kept ? <Text style={[typography.caption, { color: sc.textMuted }]}>Not applied.</Text> : null}
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

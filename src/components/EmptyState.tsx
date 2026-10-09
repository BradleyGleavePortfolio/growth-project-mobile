import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from './HapticPressable';
import { useTheme } from '../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../theme/tokens';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

/** Bone empty state: Cormorant title, one muted Inter line, the same calm CTA as ui/empty-states. */
export default function EmptyState({ icon, title, subtitle, ctaLabel, onCta }: Props) {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={semanticColors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {ctaLabel && onCta ? (
        <HapticPressable
          intent="light"
          style={styles.cta}
          onPress={onCta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: 48,
      paddingHorizontal: 32,
      gap: 8,
    },
    title: {
      ...typography.h3,
      color: sc.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      ...typography.bodySmall,
      color: sc.textMuted,
      textAlign: 'center',
    },
    cta: {
      marginTop: 12,
      backgroundColor: sc.accent,
      paddingHorizontal: 24,
      paddingVertical: 8,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
    },
    ctaText: {
      ...typography.bodyMd,
      color: sc.textOnAccent,
    },
  });

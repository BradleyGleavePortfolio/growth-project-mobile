/**
 * ReplyComposer — quoted-parent strip that sits above the input bar when the
 * user is composing a reply.
 *
 * Renders the parent message's body as a quote with a small "×" button to
 * exit reply mode. The actual TextInput continues to live in the parent
 * screen — this component is purely the visual + interaction affordance for
 * the reply-to state.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export interface ReplyTarget {
  id: string;
  body: string;
  authorLabel: string;
}

export interface ReplyComposerProps {
  target: ReplyTarget | null;
  onCancel: () => void;
}

export function ReplyComposer({ target, onCancel }: ReplyComposerProps): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!target) return null;
  return (
    <View style={styles.container} accessibilityLabel={`Replying to ${target.authorLabel}`}>
      <View style={styles.bar} />
      <View style={styles.body}>
        <Text style={styles.author} numberOfLines={1}>
          Replying to {target.authorLabel}
        </Text>
        <Text style={styles.preview} numberOfLines={2}>
          {target.body}
        </Text>
      </View>
      <Pressable
        onPress={onCancel}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    bar: {
      width: 3,
      alignSelf: 'stretch',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    body: { flex: 1 },
    author: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    preview: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    close: { padding: 4 },
    closePressed: { opacity: 0.6 },
  });

export default ReplyComposer;

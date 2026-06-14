/**
 * SearchBar — the v3-4 community search input. A controlled text field with a
 * leading line search icon and a trailing clear button. Tokens only (no raw
 * hex), line Ionicons only (no emoji), fontWeight <= '600' (quiet-luxury
 * doctrine). Debouncing is the screen's responsibility; this is a pure input.
 */
import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
}

export default function SearchBar({
  value,
  onChangeText,
  placeholder,
  testID,
}: SearchBarProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
      ]}
      testID={testID ?? 'community-search-bar'}
    >
      <Ionicons name="search-outline" size={18} color={semanticColors.textMuted} />
      <TextInput
        style={[styles.input, { color: semanticColors.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search posts, lessons, events'}
        placeholderTextColor={semanticColors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search the community"
        testID="community-search-input"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          testID="community-search-clear"
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={semanticColors.textMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
});

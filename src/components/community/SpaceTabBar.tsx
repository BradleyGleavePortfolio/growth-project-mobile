/**
 * SpaceTabBar — sub-tab switcher for the Community tab's three fixed Space
 * types (Today / Hall / Cohorts / DMs), per product plan §2.1 (NOT infinite
 * Slack-style channels). Each tab is a >= 48dp touch target and can carry an
 * unread badge. Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import UnreadBadge from './UnreadBadge';

export type CommunitySpaceKey = 'today' | 'hall' | 'cohorts' | 'dms';

export interface SpaceTab {
  key: CommunitySpaceKey;
  label: string;
  /** Unread count for the badge (0 hides it). */
  unread?: number;
}

export interface SpaceTabBarProps {
  tabs: SpaceTab[];
  active: CommunitySpaceKey;
  onSelect: (key: CommunitySpaceKey) => void;
  testID?: string;
}

export default function SpaceTabBar({
  tabs,
  active,
  onSelect,
  testID,
}: SpaceTabBarProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={[styles.bar, { borderBottomColor: semanticColors.border }]}
      testID={testID}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <HapticPressable
            key={tab.key}
            intent="light"
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            testID={`space-tab-${tab.key}`}
            style={[
              styles.tab,
              {
                backgroundColor: isActive
                  ? semanticColors.accent
                  : 'transparent',
                borderColor: semanticColors.border,
              },
            ]}
          >
            <View style={styles.tabInner}>
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive
                      ? semanticColors.textOnAccent
                      : semanticColors.textMuted,
                  },
                ]}
              >
                {tab.label}
              </Text>
              {tab.unread ? (
                <View style={styles.badgeWrap}>
                  <UnreadBadge
                    count={tab.unread}
                    corner={false}
                    testID={`space-tab-${tab.key}-badge`}
                  />
                </View>
              ) : null}
            </View>
          </HapticPressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    minHeight: 48, // accessible touch target
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  badgeWrap: {
    marginLeft: spacing.xs,
  },
});

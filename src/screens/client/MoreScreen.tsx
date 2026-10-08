// Round 3: "More" tab screen — houses destinations that used to be separate bottom tabs
// (Recipes, Fasting, Community, Profile). Consolidation addresses iOS HIG 5-tab cap.
// Every previously-reachable screen remains reachable via this list.

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Platform,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { spacing as Spacing, typography, SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { isAndroidHealthConnectEnabled } from '../../config/healthConnect';
// FACE+VOICE contract (D-012): the Roman entry row is a Roman-branded surface,
// so it carries Roman's actual face rather than a disembodied sparkles glyph.
// Canonical avatar lives in the roman/ lane (D-013).
import RomanAvatar from '../../components/roman/RomanAvatar';
import TutorialTarget from '../../components/tutorial/TutorialTarget';
import type { TutorialTargetId } from '../../tutorial/tutorialSteps';
type MoreItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  section: string;
  // Either a screen inside a sibling tab's stack (opened through the tab
  // navigator) or a nested screen inside the More stack.
  target: { type: 'tab'; tab: string; screen: string } | { type: 'stack'; screen: string };
  a11yHint: string;
  // When true, the row renders Roman's face (RomanAvatar) in place of the
  // Ionicons glyph — the face+voice rule for the Roman-branded row.
  isRoman?: boolean;
  // Clinic tutorial spotlight id for this row (wearables step).
  tutorialTarget?: TutorialTargetId;
};

/**
 * S-REACH: the client's own coaching surfaces. Each screen was registered but
 * had no menu entry; each reads live production routes (docs/reachability.md).
 * None is flag-gated because each works end to end today, with or without a
 * coach (every screen has an honest empty state).
 */
export const PLAN_MORE_ITEMS: MoreItem[] = [
  {
    icon: 'calendar-outline',
    label: 'Meal plan',
    description: 'View meal plans',
    section: 'Your plan',
    target: { type: 'stack', screen: 'Plan' },
    a11yHint: 'Opens your meal plan',
  },
  {
    icon: 'nutrition-outline',
    label: 'Macro targets',
    description: 'View daily calorie and nutrient targets',
    section: 'Your plan',
    target: { type: 'stack', screen: 'ClientMacros' },
    a11yHint: 'Opens your daily targets',
  },
  {
    icon: 'trending-up-outline',
    label: 'Progress',
    description: 'View weight trends and daily totals',
    section: 'Your plan',
    target: { type: 'stack', screen: 'Progress' },
    a11yHint: 'Opens your progress',
  },
  {
    icon: 'checkmark-circle-outline',
    label: 'Habits and check-in',
    description: 'Daily habits and how you feel today',
    section: 'Your plan',
    target: { type: 'tab', tab: 'Home', screen: 'Habits' },
    a11yHint: 'Opens your habits and daily check-in',
  },
  {
    icon: 'time-outline',
    label: 'Timeline',
    description: 'View timeline entries',
    section: 'Your plan',
    target: { type: 'stack', screen: 'Timeline' },
    a11yHint: 'Opens your timeline',
  },
  {
    icon: 'library-outline',
    label: 'Exercise library',
    description: 'Browse exercise instructions',
    section: 'Your plan',
    target: { type: 'tab', tab: 'WorkoutTab', screen: 'ExerciseLibrary' },
    a11yHint: 'Opens the exercise library',
  },
];

const MORE_ITEMS: MoreItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    label: 'Guidance',
    description: 'Open AI guidance',
    section: 'Guidance and community',
    target: { type: 'stack', screen: 'AIGuide' },
    a11yHint: 'Opens AI guidance',
  },
  {
    icon: 'ribbon-outline',
    label: 'Membership',
    description: 'Membership and access details',
    section: 'Your plan',
    target: { type: 'stack', screen: 'Membership' },
    a11yHint: 'Opens membership and access details',
  },
  {
    icon: 'restaurant-outline',
    label: 'Recipes',
    description: 'Browse recipes and meal ideas',
    section: 'Food and preparation',
    target: { type: 'stack', screen: 'Recipes' },
    a11yHint: 'Opens the recipes browser',
  },
  {
    icon: 'timer-outline',
    label: 'Fasting',
    description: 'Track fasting windows',
    section: 'Food and preparation',
    target: { type: 'stack', screen: 'Fast' },
    a11yHint: 'Opens the fasting tracker',
  },
  {
    icon: 'people-outline',
    label: 'Community',
    description: 'Connect with other members',
    section: 'Guidance and community',
    target: { type: 'stack', screen: 'Community' },
    a11yHint: 'Opens the community feed',
  },
  {
    icon: 'person-outline',
    label: 'Profile',
    description: 'Your details and preferences',
    section: 'Account',
    target: { type: 'stack', screen: 'ProfileMain' },
    a11yHint: 'Opens your profile',
  },
  {
    icon: 'settings-outline',
    label: 'Settings',
    description: 'App preferences and account',
    section: 'Account',
    target: { type: 'stack', screen: 'Settings' },
    a11yHint: 'Opens app settings',
  },
  {
    icon: 'document-text-outline',
    label: 'Report',
    description: 'Your progress report',
    section: 'Your plan',
    target: { type: 'stack', screen: 'Report' },
    a11yHint: 'Opens your progress report',
  },
  {
    icon: 'book-outline',
    label: 'Learn',
    description: 'Education and lessons',
    section: 'Learning',
    target: { type: 'stack', screen: 'Learn' },
    a11yHint: 'Opens learning content',
  },
  {
    icon: 'apps-outline',
    label: 'Shortcuts',
    description: 'Quick log and start a fast',
    section: 'Account',
    target: { type: 'stack', screen: 'Widgets' },
    a11yHint: 'Opens shortcuts',
  },
  {
    icon: 'cart-outline',
    label: 'Grocery list',
    description: 'Your synced grocery list',
    section: 'Food and preparation',
    target: { type: 'stack', screen: 'GroceryList' },
    a11yHint: 'Opens your grocery list',
  },
  // One list (owner 10-07, CF-ONE-LIST-128): no Shopping list row; its saved items show on the Grocery list.
  {
    icon: 'clipboard-outline',
    label: 'Prep guide',
    description: 'View meal preparation guidance',
    section: 'Food and preparation',
    target: { type: 'stack', screen: 'PrepGuide' },
    a11yHint: 'Opens your weekly prep guide',
  },
];

/**
 * Roman P1 chat entry row (client surface). Only present when
 * featureFlags.romanChat is true (default OFF) — when the flag is OFF the row is
 * not in the list, so there is no dead-end into an unregistered route. Routes to
 * the MoreStack 'RomanChat' screen, which itself is registered only behind the
 * same flag (ClientNavigator).
 */
const ROMAN_MORE_ITEM: MoreItem = {
  icon: 'sparkles-outline',
  label: 'Roman',
  // Roman is not "your AI" — he is Roman, shared across surfaces (identity
  // spec). Client row keeps the plain open-a-conversation register
  // (R1 UX finding P2).
  description: 'Open a conversation with Roman',
  section: 'Guidance and community',
  target: { type: 'stack', screen: 'RomanChat' },
  a11yHint: 'Opens a conversation with Roman',
  isRoman: true,
};

/**
 * Wearables rows: the Connections hub and the Health shell (Fitness +
 * Recovery / sleep). The clinic tutorial's wearable step spotlights them.
 *
 * AUDIT-11-125: they used to ship only with featureFlags.clientTutorial,
 * which the iOS store (production) profile leaves off, so an iPhone client
 * had no way to connect Apple Health and the binary carried HealthKit with no
 * HealthKit screen (App Review 2.5.1). They now show wherever this build can
 * read a phone health store: always on iPhone, and on Android only in a build
 * with Health Connect (the clinic profile), or with the tutorial on as before.
 */
function showsWearableRows(): boolean {
  return (
    featureFlags.clientTutorial ||
    Platform.OS === 'ios' ||
    isAndroidHealthConnectEnabled()
  );
}

const WEARABLE_MORE_ITEMS: MoreItem[] = [
  {
    icon: 'heart-outline',
    label: 'Health and sleep',
    description: 'View activity, heart rate and sleep',
    section: 'Health and devices',
    target: { type: 'stack', screen: 'Health' },
    a11yHint: 'Opens your health and sleep data',
    tutorialTarget: 'more-health',
  },
  {
    icon: 'watch-outline',
    label: 'Connected devices',
    description: 'Apple Health, Health Connect and wearables',
    section: 'Health and devices',
    target: { type: 'stack', screen: 'Connections' },
    a11yHint: 'Opens your connected devices',
    tutorialTarget: 'more-connections',
  },
];

export default function MoreScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const items = useMemo<MoreItem[]>(
    () => {
      const roman = featureFlags.romanChat ? [ROMAN_MORE_ITEM] : [];
      // The clinic tutorial spotlights the wearables rows, so they stay at the
      // top there (unchanged); elsewhere they follow the plan rows.
      if (featureFlags.clientTutorial) {
        return [...WEARABLE_MORE_ITEMS, ...roman, ...PLAN_MORE_ITEMS, ...MORE_ITEMS];
      }
      const wearables = showsWearableRows() ? WEARABLE_MORE_ITEMS : [];
      return [...roman, ...PLAN_MORE_ITEMS, ...wearables, ...MORE_ITEMS];
    },
    [],
  );
  // Preserve the existing order within each group, including tutorial priority.
  const sections = Array.from(new Set(items.map((item) => item.section)));

  const handlePress = (item: MoreItem) => {
    if (item.target.type === 'stack') {
      navigation.navigate(item.target.screen);
      return;
    }
    // A screen in another tab's stack: go through the tab navigator and keep
    // that stack's first screen underneath (initial: false), so Back works.
    const tabs = navigation.getParent() ?? navigation;
    tabs.navigate(item.target.tab, { screen: item.target.screen, initial: false });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">More</Text>
        <Text style={styles.subtitle}>Everything else you can do</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        role="list"
      >
        {sections.map((section) => (
          <View key={section} style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{section}</Text>
            {items.filter((item) => item.section === section).map((item) => (
              // Keep list semantics and each row's button action (R3 P1-3).
              <View key={item.label} role="listitem">
                <TutorialTargetWrap id={item.tutorialTarget}>
                  <HapticPressable
                    intent="light"
                    style={styles.item}
                    onPress={() => handlePress(item)}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityHint={item.a11yHint}
                  >
                    <View style={styles.iconWrap}>
                      {item.isRoman ? (
                        <RomanAvatar crop="neutral" size={28} testID="client-roman-entry-avatar" />
                      ) : (
                        <Ionicons name={item.icon} size={22} color={colors.textMuted} />
                      )}
                    </View>
                    <View style={styles.textWrap}>
                      <Text style={styles.itemLabel}>{item.label}</Text>
                      <Text style={styles.itemDescription}>{item.description}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </HapticPressable>
                </TutorialTargetWrap>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function TutorialTargetWrap({
  id,
  children,
}: {
  id?: TutorialTargetId;
  children: React.ReactNode;
}): React.ReactElement {
  return id ? <TutorialTarget id={id}>{children}</TutorialTarget> : <>{children}</>;
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['2xl'],
  },
  section: {
    marginBottom: Spacing['2xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    paddingVertical: Spacing.lg,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 28,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  textWrap: {
    flex: 1,
  },
  itemLabel: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  itemDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },

  });

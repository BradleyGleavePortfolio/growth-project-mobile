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
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { Spacing, Radius } from '../../theme/index';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
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
    description: 'The meals planned for you this week',
    target: { type: 'stack', screen: 'Plan' },
    a11yHint: 'Opens your meal plan',
  },
  {
    icon: 'nutrition-outline',
    label: 'Macro targets',
    description: 'Your daily calories, protein and more',
    target: { type: 'stack', screen: 'ClientMacros' },
    a11yHint: 'Opens your daily targets',
  },
  {
    icon: 'trending-up-outline',
    label: 'Progress',
    description: 'Your weight trend and today\u2019s totals',
    target: { type: 'stack', screen: 'Progress' },
    a11yHint: 'Opens your progress',
  },
  {
    icon: 'checkmark-circle-outline',
    label: 'Habits and check-in',
    description: 'Daily habits and how you feel today',
    target: { type: 'tab', tab: 'Home', screen: 'Habits' },
    a11yHint: 'Opens your habits and daily check-in',
  },
  {
    icon: 'time-outline',
    label: 'Timeline',
    description: 'Your journey so far, week by week',
    target: { type: 'stack', screen: 'Timeline' },
    a11yHint: 'Opens your timeline',
  },
  {
    icon: 'library-outline',
    label: 'Exercise library',
    description: 'How each exercise is done, with video',
    target: { type: 'tab', tab: 'WorkoutTab', screen: 'ExerciseLibrary' },
    a11yHint: 'Opens the exercise library',
  },
];

const MORE_ITEMS: MoreItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    label: 'Guidance',
    description: 'Ask your coach’s guide anything',
    target: { type: 'stack', screen: 'AIGuide' },
    a11yHint: 'Opens guidance — your coach’s AI assistant',
  },
  {
    icon: 'ribbon-outline',
    label: 'Membership',
    description: 'Your access and coaching tier',
    target: { type: 'stack', screen: 'Membership' },
    a11yHint: 'Opens membership and access details',
  },
  {
    icon: 'restaurant-outline',
    label: 'Recipes',
    description: 'Browse recipes and meal ideas',
    target: { type: 'stack', screen: 'Recipes' },
    a11yHint: 'Opens the recipes browser',
  },
  {
    icon: 'timer-outline',
    label: 'Fasting',
    description: 'Track fasting windows',
    target: { type: 'stack', screen: 'Fast' },
    a11yHint: 'Opens the fasting tracker',
  },
  {
    icon: 'people-outline',
    label: 'Community',
    description: 'Connect with other members',
    target: { type: 'stack', screen: 'Community' },
    a11yHint: 'Opens the community feed',
  },
  {
    icon: 'person-outline',
    label: 'Profile',
    description: 'Your details and preferences',
    target: { type: 'stack', screen: 'ProfileMain' },
    a11yHint: 'Opens your profile',
  },
  {
    icon: 'settings-outline',
    label: 'Settings',
    description: 'App preferences and account',
    target: { type: 'stack', screen: 'Settings' },
    a11yHint: 'Opens app settings',
  },
  {
    icon: 'document-text-outline',
    label: 'Report',
    description: 'Your progress report',
    target: { type: 'stack', screen: 'Report' },
    a11yHint: 'Opens your progress report',
  },
  {
    icon: 'book-outline',
    label: 'Learn',
    description: 'Education and lessons',
    target: { type: 'stack', screen: 'Learn' },
    a11yHint: 'Opens learning content',
  },
  {
    icon: 'apps-outline',
    label: 'Widgets',
    description: 'Customize your dashboard',
    target: { type: 'stack', screen: 'Widgets' },
    a11yHint: 'Opens widgets configuration',
  },
  {
    icon: 'cart-outline',
    label: 'Grocery List',
    description: 'Your synced grocery list',
    target: { type: 'stack', screen: 'GroceryList' },
    a11yHint: 'Opens your grocery list',
  },
  {
    icon: 'bag-outline',
    label: 'Shopping List',
    description: 'Your synced shopping list',
    target: { type: 'stack', screen: 'ShoppingList' },
    a11yHint: 'Opens your shopping list',
  },
  {
    icon: 'clipboard-outline',
    label: 'Prep Guide',
    description: 'Weekly meal prep plan',
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
  target: { type: 'stack', screen: 'RomanChat' },
  a11yHint: 'Opens a conversation with Roman',
  isRoman: true,
};

/**
 * Clinic tutorial rows (featureFlags.clientTutorial, default OFF): the
 * wearable Connections hub and the Health shell (Fitness + Recovery / sleep)
 * are registered in MoreStack but had no menu entry. The tutorial's wearable
 * step points at these two rows, so they ship behind the same flag.
 */
const TUTORIAL_MORE_ITEMS: MoreItem[] = [
  {
    icon: 'heart-outline',
    label: 'Health and sleep',
    description: 'Activity, heart rate and sleep from your devices',
    target: { type: 'stack', screen: 'Health' },
    a11yHint: 'Opens your health and sleep data',
    tutorialTarget: 'more-health',
  },
  {
    icon: 'watch-outline',
    label: 'Connected devices',
    description: 'Apple Health, Health Connect and wearables',
    target: { type: 'stack', screen: 'Connections' },
    a11yHint: 'Opens your connected devices',
    tutorialTarget: 'more-connections',
  },
];

export default function MoreScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const items = useMemo<MoreItem[]>(
    () => {
      const base = [
        ...(featureFlags.romanChat ? [ROMAN_MORE_ITEM] : []),
        ...PLAN_MORE_ITEMS,
        ...MORE_ITEMS,
      ];
      return featureFlags.clientTutorial ? [...TUTORIAL_MORE_ITEMS, ...base] : base;
    },
    [],
  );

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
        {items.map((item) => (
          // listitem wrapper exposes the collection structure to assistive tech
          // while the inner pressable keeps its button role + action (R3 P1-3).
          // ARIA `role` is used because RN's AccessibilityRole union omits
          // "listitem".
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
                  <Ionicons name={item.icon} size={22} color={colors.primary} />
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.dark,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  textWrap: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.dark,
  },
  itemDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },

  });

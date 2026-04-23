// Round 3: "More" tab screen — houses destinations that used to be separate bottom tabs
// (Recipes, Fasting, Community, Profile). Consolidation addresses iOS HIG 5-tab cap.
// Every previously-reachable screen remains reachable via this list.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, Radius } from '../../theme/index';

type MoreItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  // Either a sibling tab (via getParent) or a nested screen inside the More stack.
  target: { type: 'tab'; tab: string } | { type: 'stack'; screen: string; parentScreen?: string };
  a11yHint: string;
};

const MORE_ITEMS: MoreItem[] = [
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
];

export default function MoreScreen() {
  const navigation = useNavigation<any>();

  const handlePress = (item: MoreItem) => {
    if (item.target.type === 'stack') {
      navigation.navigate(item.target.screen);
    }
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
      >
        {MORE_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.item}
            onPress={() => handlePress(item)}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.a11yHint}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={22} color={Colors.primary} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Text style={styles.itemDescription}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.dark,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryPale,
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
    color: Colors.dark,
  },
  itemDescription: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
});

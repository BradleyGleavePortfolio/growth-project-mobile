import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import FadeInView from '../../components/FadeInView';

const WIDGETS = [
  {
    id: 'calorie-ring',
    title: 'Calorie Ring',
    description: 'At-a-glance daily calorie progress on your home screen',
    icon: 'pie-chart-outline' as const,
    status: 'Coming Soon',
  },
  {
    id: 'macro-summary',
    title: 'Macro Summary',
    description: 'Protein, carbs & fat breakdown widget',
    icon: 'bar-chart-outline' as const,
    status: 'Coming Soon',
  },
  {
    id: 'water-tracker',
    title: 'Water Tracker',
    description: 'Quick-add water intake without opening the app',
    icon: 'water-outline' as const,
    status: 'Coming Soon',
  },
  {
    id: 'fasting-timer',
    title: 'Fasting Timer',
    description: 'Live countdown of your current fast on the home screen',
    icon: 'timer-outline' as const,
    status: 'Coming Soon',
  },
];

const QUICK_ACTIONS = [
  {
    id: 'quick-log',
    title: 'Quick Log',
    description: 'Log a meal directly from your home screen',
    icon: 'add-circle-outline' as const,
  },
  {
    id: 'start-fast',
    title: 'Start Fast',
    description: 'Begin a fasting session with one tap',
    icon: 'play-circle-outline' as const,
  },
  {
    id: 'scan-barcode',
    title: 'Scan Barcode',
    description: 'Open barcode scanner instantly',
    icon: 'barcode-outline' as const,
  },
];

const WEARABLES = [
  {
    id: 'apple-watch',
    title: 'Apple Watch',
    description: 'Sync calories, macros & fasting timer to your wrist',
    icon: 'watch-outline' as const,
    status: 'In Development',
  },
  {
    id: 'health-kit',
    title: 'Apple Health',
    description: 'Import workouts & export nutrition data',
    icon: 'heart-outline' as const,
    status: 'Planned',
  },
];

export default function WidgetsScreen() {
  const navigation = useNavigation();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Widgets & Shortcuts</Text>
      </View>

      {/* Home Screen Widgets */}
      <FadeInView>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Home Screen Widgets</Text>
          <Text style={styles.sectionSubtitle}>
            Add widgets to your device home screen for quick access
          </Text>
          {WIDGETS.map((widget) => (
            <View key={widget.id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={widget.icon} size={24} color={Colors.primary} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{widget.title}</Text>
                <Text style={styles.cardDesc}>{widget.description}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{widget.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </FadeInView>

      {/* Quick Actions */}
      <FadeInView delay={100}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Text style={styles.sectionSubtitle}>
            3D Touch / long-press shortcuts from your app icon
          </Text>
          {QUICK_ACTIONS.map((action) => (
            <View key={action.id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={action.icon} size={24} color={Colors.primary} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{action.title}</Text>
                <Text style={styles.cardDesc}>{action.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </View>
          ))}
        </View>
      </FadeInView>

      {/* Wearables */}
      <FadeInView delay={200}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wearables</Text>
          <Text style={styles.sectionSubtitle}>
            Connect your wearable devices for a seamless experience
          </Text>
          {WEARABLES.map((device) => (
            <View key={device.id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={device.icon} size={24} color={Colors.primary} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{device.title}</Text>
                <Text style={styles.cardDesc}>{device.description}</Text>
              </View>
              <View style={[styles.badge, device.status === 'In Development' && styles.badgeActive]}>
                <Text style={[styles.badgeText, device.status === 'In Development' && styles.badgeTextActive]}>
                  {device.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </FadeInView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 24,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  badge: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeActive: {
    backgroundColor: Colors.primaryDark,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  badgeTextActive: {
    color: '#ffffff',
  },
});

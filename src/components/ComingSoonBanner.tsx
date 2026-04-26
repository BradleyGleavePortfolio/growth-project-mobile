import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import { Colors } from '../constants/colors';

/**
 * ComingSoonBanner — placeholder for screens that don't yet have a real
 * backend.
 *
 * Why this exists (Fix #2 from the structural audit):
 *
 * Several client screens (Recipes, Grocery, Shopping, Education, AIGuide,
 * PrepGuide) historically wrote and read from local SQLite only. From the
 * user's point of view they looked finished — but the data was per-device,
 * the coach couldn't see it, and it disappeared on a reinstall. At a
 * $750–$2,200/mo coaching price point that's the single biggest path to a
 * refund: a client logs a week of recipes, factory-resets their phone, loses
 * everything, and posts the screenshot in their group chat.
 *
 * Until each surface is wired end-to-end against the backend, we ship them
 * as "Coming soon" — exactly what the audit prescribed. The screens still
 * exist in the navigator (so deep links and saved bookmarks don't break),
 * they just render this banner instead of a partly-faked surface.
 *
 * Usage: replace the screen body with `<ComingSoonBanner title="Recipes" />`.
 */
type Props = {
  title: string;
  description?: string;
};

export default function ComingSoonBanner({ title, description }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Coming soon</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>
            {description ||
              `${title} is being rebuilt to sync with your coach across every device. We'd rather ship it right than ship it half-real.`}
          </Text>
          <Text style={styles.footer}>
            Your existing data is safe. We'll bring this surface back the moment it can survive a phone reset and show up on your coach's dashboard.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    shadowColor: Colors.cardShadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: Colors.primary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  footer: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textMuted,
  },
});

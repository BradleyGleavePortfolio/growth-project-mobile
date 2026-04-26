/**
 * TrustCueRow — UX Psychology Report #2: Trust as Emotion
 *
 * Horizontal scroll of three pill-style trust-cue chips:
 *   🔒 End-to-end encrypted
 *   👤 Your data is yours
 *   🛡 Zero ads · Zero data sales
 *
 * Each chip opens TrustExplainerSheet with context-specific copy on tap.
 * Uses design tokens — no hardcoded hex values.
 * PII-safe analytics: fires `trust_cue_tapped` with `cue_id`.
 */

import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import TrustExplainerSheet, { TrustExplainerContent } from './TrustExplainerSheet';
import { Colors } from '../../constants/colors';
import { Spacing, Radius } from '../../theme/index';
import { typography } from '../../theme/tokens';
import { track } from '../../lib/analytics';

// ─── Cue definitions ─────────────────────────────────────────────────────────

interface TrustCue {
  id: string;
  label: string;
  explainer: TrustExplainerContent;
}

const TRUST_CUES: TrustCue[] = [
  {
    id: 'e2e_encrypted',
    label: '🔒 End-to-end encrypted',
    explainer: {
      title: '🔒 End-to-end encrypted',
      body:
        'All data between your phone and our servers travels over TLS 1.3 — the strongest transport encryption available. Your meals, workouts, and body stats are also encrypted at rest using AES-256, so even if our storage were ever accessed without authorisation, your data would be unreadable.',
    },
  },
  {
    id: 'your_data',
    label: '👤 Your data is yours',
    explainer: {
      title: '👤 Your data is yours',
      body:
        'You own everything you log in this app. You can request a full export of your data at any time from the Trust Center in Settings, and you can permanently delete your account with a 30-day grace period. We will never sell, license, or share your personal data with third parties for commercial purposes.',
    },
  },
  {
    id: 'zero_ads',
    label: '🛡 Zero ads · Zero data sales',
    explainer: {
      title: '🛡 Zero ads · Zero data sales',
      body:
        'The Growth Project runs on your subscription — not advertising revenue. We do not sell, rent, or trade your personal data to advertisers or data brokers. Analytics we collect are limited to anonymised, aggregate product-improvement signals and are never linked back to you individually.',
    },
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function TrustCueRow() {
  const [sheetContent, setSheetContent] = useState<TrustExplainerContent | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const handleCueTap = useCallback((cue: TrustCue) => {
    track('trust_cue_tapped', { cue_id: cue.id });
    setSheetContent(cue.explainer);
    setSheetVisible(true);
  }, []);

  const handleDismiss = useCallback(() => {
    setSheetVisible(false);
  }, []);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.container}
        accessible={false}
      >
        {TRUST_CUES.map((cue) => (
          <HapticPressable
            key={cue.id}
            intent="light"
            style={styles.chip}
            onPress={() => handleCueTap(cue)}
            accessibilityRole="button"
            accessibilityLabel={cue.label}
            accessibilityHint="Tap to learn more"
          >
            <Text style={styles.chipText}>{cue.label}</Text>
          </HapticPressable>
        ))}
      </ScrollView>

      <TrustExplainerSheet
        visible={sheetVisible}
        content={sheetContent}
        onDismiss={handleDismiss}
      />
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryPale,
    borderRadius: Radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: Colors.primary,
    letterSpacing: 0.1,
  },
});

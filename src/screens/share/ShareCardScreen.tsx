/**
 * ShareCardScreen — milestone/streak/PR progress share card.
 *
 * Phase 11 / Share Card.
 *
 * Three card variants:
 *   - streak        — consecutive-day streak celebration
 *   - pr            — personal record (lift / weight) celebration
 *   - transformation — body-composition milestone celebration
 *
 * Flow:
 *   1. Receives `milestone` prop (via navigation params) with variant + data.
 *   2. Renders a styled card into an off-screen View ref.
 *   3. On "Share" press: captureRef() produces a PNG URI.
 *   4. Opens the native share sheet via Sharing.shareAsync.
 *   5. Fires REFERRAL_SHARE_CARD_SHARED PostHog event with cardType + coachTenantId.
 *
 * Typography: Cormorant Garamond if available (project display font);
 * falls back to system serif so the card looks correct even when fonts
 * have not yet loaded.
 *
 * react-native-view-shot and expo-sharing are used for capture + share.
 * expo-sharing is already in the Expo SDK bundle; react-native-view-shot
 * must be installed separately (see package.json updates in this PR).
 *
 * Accessibility: every interactive element has accessibilityLabel + accessibilityRole.
 */

import React, { useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import type { ReferralShareCardSharedProps } from '../../analytics/events';
import { successTap } from '../../utils/haptics';

// ─── react-native-view-shot (lazy require so CI passes without native build) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let captureRef: ((ref: React.RefObject<View>, options?: Record<string, unknown>) => Promise<string>) | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const viewShot = require('react-native-view-shot');
  captureRef = viewShot.captureRef;
} catch {
  // react-native-view-shot not linked (Expo Go / CI) — share is disabled.
  captureRef = undefined;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShareCardVariant = 'streak' | 'pr' | 'transformation';

export interface ShareCardMilestone {
  variant: ShareCardVariant;
  /** Display value, e.g. "14" for a 14-day streak, "100kg" for a PR. */
  value: string;
  /** Human-readable label, e.g. "Day Streak", "Back Squat PR". */
  label: string;
  /** Optional coach tenant slug for analytics. */
  coachTenantId?: string;
}

// Navigation param list — compatible with MoreStackParamList extension.
export type ShareCardScreenParams = {
  ShareCard: { milestone: ShareCardMilestone };
};

type Props = NativeStackScreenProps<ShareCardScreenParams, 'ShareCard'>;

// ─── Card renderer ────────────────────────────────────────────────────────────

interface CardProps {
  milestone: ShareCardMilestone;
  colors: ThemeColors;
}

function ShareCard({ milestone, colors }: CardProps) {
  const styles = useMemo(() => makeCardStyles(colors), [colors]);

  const variantConfig: Record<ShareCardVariant, { headline: string; subheadline: string; iconName: string }> = {
    streak: {
      headline: milestone.value,
      subheadline: milestone.label,
      iconName: 'flame-outline',
    },
    pr: {
      headline: milestone.value,
      subheadline: milestone.label,
      iconName: 'barbell-outline',
    },
    transformation: {
      headline: milestone.value,
      subheadline: milestone.label,
      iconName: 'trending-up-outline',
    },
  };

  const config = variantConfig[milestone.variant];

  return (
    <View style={styles.card}>
      {/* Brand mark */}
      <Text style={styles.brandMark}>The Growth Project</Text>

      {/* Icon */}
      <View style={styles.iconContainer}>
        <Ionicons name={config.iconName as never} size={48} color={colors.primary} />
      </View>

      {/* Headline number / value */}
      <Text style={styles.headline}>{config.headline}</Text>

      {/* Subheadline */}
      <Text style={styles.subheadline}>{config.subheadline}</Text>

      {/* Tagline */}
      <Text style={styles.tagline}>
        {milestone.variant === 'streak'
          ? 'Consistency compounds.'
          : milestone.variant === 'pr'
          ? 'Every rep counted.'
          : 'Progress made visible.'}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShareCardScreen({ route, navigation }: Props) {
  const { milestone } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeScreenStyles(colors), [colors]);

  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (!captureRef) {
      Alert.alert(
        'Share unavailable',
        'Image sharing requires a native build. Run "eas build" to enable this feature.',
      );
      return;
    }

    setSharing(true);
    successTap();

    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1.0,
        result: 'tmpfile',
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Share unavailable', 'Sharing is not supported on this device.');
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your milestone',
        UTI: 'public.png',
      });

      // Analytics: fired after share sheet is dismissed (regardless of whether
      // the user completed the share — we track intent, not outcome).
      const props: ReferralShareCardSharedProps = {
        card_type: milestone.variant,
        coach_tenant_id: milestone.coachTenantId,
        destination: 'native_share_sheet',
      };
      track(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED, props as Record<string, unknown>);
    } catch (err) {
      if (__DEV__) console.warn('ShareCardScreen: share failed', err);
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Navigation bar */}
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle}>Share Progress</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Card preview — this ref is captured by view-shot */}
        <View ref={cardRef} collapsable={false} style={styles.cardWrapper}>
          <ShareCard milestone={milestone} colors={colors} />
        </View>

        <Text style={styles.helpText}>
          Your card is ready to share. Tap Share to post to Instagram Stories or
          any other app.
        </Text>
      </ScrollView>

      {/* Share CTA */}
      <View style={styles.footer}>
        <HapticPressable
          intent="medium"
          style={[styles.shareBtn, sharing && styles.shareBtnDisabled]}
          onPress={handleShare}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel="Share milestone card"
          accessibilityState={{ disabled: sharing }}
        >
          {sharing ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="share-outline" size={20} color={colors.white} style={{ marginRight: 8 }} />
              <Text style={styles.shareBtnText}>Share</Text>
            </>
          )}
        </HapticPressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeScreenStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.textPrimary,
    },
    content: {
      padding: 24,
      paddingBottom: 16,
      alignItems: 'center',
    },
    cardWrapper: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 20,
      overflow: 'hidden',
      // Shadow for the preview card
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 6,
      marginBottom: 20,
    },
    helpText: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    footer: {
      paddingHorizontal: 24,
      paddingBottom: 36,
      paddingTop: 12,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 15,
    },
    shareBtnDisabled: {
      opacity: 0.6,
    },
    shareBtnText: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.white,
    },
  });
}

function makeCardStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      padding: 36,
      alignItems: 'center',
    },
    brandMark: {
      fontSize: 11,
      fontFamily: 'Inter_500Medium',
      color: colors.textMuted,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 24,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    headline: {
      // Cormorant Garamond is the project display serif — falls back to system
      // serif if the font has not yet loaded (e.g. on first launch before
      // font bundle finishes hydrating).
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 72,
      lineHeight: 80,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subheadline: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 24,
      color: colors.textPrimary,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 16,
    },
    tagline: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      fontStyle: 'italic',
    },
  });
}

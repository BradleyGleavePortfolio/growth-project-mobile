/**
 * TrophyShareScreen — Psych Report #5 "Trophy-Grade Milestone Artifact"
 *
 * Full-screen trophy preview with two action buttons:
 *   • "Share" — uses React Native's built-in Share API (always available)
 *   • "Save to Camera Roll" — uses expo-media-library if installed (graceful
 *     no-op with an informational alert if not available)
 *
 * Rendering:
 *   The trophy card is rendered as a React Native view (TrophyArtifact) for
 *   the on-screen preview.
 *
 *   Image export uses expo-print if installed to generate a PDF/PNG for sharing.
 *   Falls back to sharing a text summary via the native Share sheet — always works.
 *
 * No new native deps — relies only on modules already in the Expo SDK build or
 * React Native core APIs.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../components/HapticPressable';
import TrophyArtifact, { buildTrophyHtml, MilestoneKind } from '../components/trophy/TrophyArtifact';
import { Colors } from '../constants/colors';
import tokens from '../theme/tokens';
import { track } from '../lib/analytics';

// ─── Route param type ─────────────────────────────────────────────────────────

export type TrophyShareScreenParams = {
  kind: MilestoneKind;
  headline: string;
  subtitle: string;
  identityTitle: string;
  isFoundingMember?: boolean;
  /** Where the trophy was triggered from — used for analytics */
  surface: 'first_win' | 'streak' | 'identity_upgrade' | 'badge';
};

// ─── Helpers: optional module loading ────────────────────────────────────────

/** Try to generate a PDF file URI from the trophy HTML template (expo-print). */
async function tryPrintToFile(html: string): Promise<string | null> {
  try {
    // expo-print is in the Expo SDK but not installed in all managed builds.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Print = require('expo-print') as { printToFileAsync: (opts: { html: string; base64: boolean }) => Promise<{ uri: string }> };
    const result = await Print.printToFileAsync({ html, base64: false });
    return result.uri;
  } catch {
    return null;
  }
}

/** Try to open the share sheet for a file URI (expo-sharing). */
async function tryShareFile(uri: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sharing = require('expo-sharing') as {
      isAvailableAsync: () => Promise<boolean>;
      shareAsync: (uri: string, opts?: Record<string, string>) => Promise<void>;
    };
    const available = await Sharing.isAvailableAsync();
    if (!available) return false;
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share your trophy',
      UTI: 'com.adobe.pdf',
    });
    return true;
  } catch {
    return false;
  }
}

/** Try to save a file URI to the camera roll (expo-media-library). */
async function trySaveToLibrary(uri: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ML = require('expo-media-library') as {
      requestPermissionsAsync: () => Promise<{ status: string }>;
      saveToLibraryAsync: (uri: string) => Promise<void>;
    };
    const { status } = await ML.requestPermissionsAsync();
    if (status !== 'granted') return false;
    await ML.saveToLibraryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrophyShareScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ TrophyShare: TrophyShareScreenParams }, 'TrophyShare'>>();

  const {
    kind,
    headline,
    subtitle,
    identityTitle,
    isFoundingMember = false,
    surface,
  } = route.params;

  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Fire analytics on mount
  React.useEffect(() => {
    track('trophy_generated', {
      surface,
      kind,
      is_founding_member: isFoundingMember,
    } as Record<string, unknown>);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save to camera roll ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const html = buildTrophyHtml({ kind, headline, subtitle, identityTitle, isFoundingMember });
      const fileUri = await tryPrintToFile(html);

      if (fileUri) {
        const saved = await trySaveToLibrary(fileUri);
        if (saved) {
          track('trophy_shared', { surface, kind, method: 'save_to_roll' } as Record<string, unknown>);
          Alert.alert('Saved', 'Your trophy has been saved to your camera roll.');
          return;
        }
        // Permission denied or media library not installed — fall through to share
        const shared = await tryShareFile(fileUri);
        if (shared) {
          track('trophy_shared', { surface, kind, method: 'share_file_fallback' } as Record<string, unknown>);
          return;
        }
      }

      // Final fallback: share text summary
      await Share.share({
        message: `${headline} — ${subtitle}\n\nIdentity: ${identityTitle}\n\n@theGrowthProject`,
        title: 'My Growth Project Trophy',
      });
      track('trophy_shared', { surface, kind, method: 'text_fallback' } as Record<string, unknown>);
    } catch {
      Alert.alert('Unable to save', 'Please use the Share button instead.');
    } finally {
      setSaving(false);
    }
  }, [kind, headline, subtitle, identityTitle, isFoundingMember, surface]);

  // ── Share ─────────────────────────────────────────────────────────────────

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const html = buildTrophyHtml({ kind, headline, subtitle, identityTitle, isFoundingMember });
      const fileUri = await tryPrintToFile(html);

      if (fileUri) {
        const shared = await tryShareFile(fileUri);
        if (shared) {
          track('trophy_shared', { surface, kind, method: 'share_file' } as Record<string, unknown>);
          return;
        }
      }

      // Always-available fallback: native Share sheet with text
      await Share.share({
        message: `${headline} — ${subtitle}\n\nIdentity: ${identityTitle}\n\n@theGrowthProject`,
        title: 'My Growth Project Trophy',
      });
      track('trophy_shared', { surface, kind, method: 'share_text' } as Record<string, unknown>);
    } catch {
      Alert.alert('Unable to share', 'Please try again in a moment.');
    } finally {
      setSharing(false);
    }
  }, [kind, headline, subtitle, identityTitle, isFoundingMember, surface]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <HapticPressable intent="light" onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={Colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.headerTitle}>Your Trophy</Text>
        <View style={styles.closeBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Trophy card preview ── */}
        <View style={styles.cardWrapper}>
          <TrophyArtifact
            kind={kind}
            headline={headline}
            subtitle={subtitle}
            identityTitle={identityTitle}
            isFoundingMember={isFoundingMember}
            previewScale={0.88}
          />
        </View>

        {/* ── Supporting copy ── */}
        <Text style={styles.tagline}>Share your achievement.</Text>
        <Text style={styles.taglineSub}>
          Every share brings someone else into the growth mindset.
        </Text>

        {/* ── Action buttons ── */}
        <View style={styles.actions}>
          {/* Save to camera roll */}
          <HapticPressable
            intent="success"
            onPress={handleSave}
            disabled={saving || sharing}
            style={[styles.btn, styles.btnSave]}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                <Text style={styles.btnTextPrimary}>Save to Camera Roll</Text>
              </>
            )}
          </HapticPressable>

          {/* Share */}
          <HapticPressable
            intent="medium"
            onPress={handleShare}
            disabled={saving || sharing}
            style={[styles.btn, styles.btnShare]}
          >
            {sharing ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color={Colors.primary} />
                <Text style={styles.btnTextSecondary}>Share</Text>
              </>
            )}
          </HapticPressable>
        </View>

        {/* ── Dismiss ── */}
        <HapticPressable intent="light" onPress={() => navigation.goBack()} style={styles.dismiss}>
          <Text style={styles.dismissText}>Maybe later</Text>
        </HapticPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    paddingTop: tokens.spacing.xl,
    paddingBottom: 56,
    paddingHorizontal: tokens.spacing.xl,
  },
  cardWrapper: {
    ...tokens.shadows.sm,
    borderRadius: tokens.radius.xl,
    marginBottom: tokens.spacing.xl,
  },
  tagline: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: tokens.spacing.sm,
  },
  taglineSub: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: tokens.spacing.lg,
  },
  actions: {
    width: '100%',
    gap: tokens.spacing.md,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    paddingVertical: 16,
    gap: 8,
  },
  btnSave: {
    backgroundColor: Colors.primary,
  },
  btnShare: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  btnTextPrimary: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  btnTextSecondary: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: -0.1,
  },
  dismiss: {
    marginTop: tokens.spacing.xl,
    padding: tokens.spacing.md,
  },
  dismissText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});

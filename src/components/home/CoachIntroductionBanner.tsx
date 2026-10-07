/**
 * CoachIntroductionBanner — shown on the client HomeScreen below the greeting.
 *
 * Logic:
 * - MMKV 'home.coach_intro_banner_dismissed' === 'true' → return null
 * - user.coach_id absent → render nothing
 * - user.coach_id present → fetch /v1/clients/me/coach, show coach name/avatar
 * - On 404 → render nothing
 * - Skeleton while fetching (height 64 row, no ActivityIndicator)
 *
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { prefsStorage } from '../../storage/mmkv';
import api from '../../services/api';

// ─── MMKV Keys ────────────────────────────────────────────────────────────────
// R15: per-user scope so a different client on the same device cannot inherit
// the previous client's banner-dismissed state.

const INTRO_DISMISSED_KEY_BASE = 'home.coach_intro_banner_dismissed';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoachProfile {
  id: string;
  name: string;
  avatar_url?: string | null;
}

// ─── CoachIntroductionBanner ──────────────────────────────────────────────────

export default function CoachIntroductionBanner() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const introKey = useMemo(
    () => (currentUser?.id ? `${INTRO_DISMISSED_KEY_BASE}:${currentUser.id}` : null),
    [currentUser?.id],
  );

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'not_found' | 'idle'>('idle');

  // Check dismissed flag
  useEffect(() => {
    if (!introKey) return;
    prefsStorage.getStringAsync(introKey).then((val) => {
      setDismissed(val === 'true');
    }).catch(() => setDismissed(false));
  }, [introKey]);

  // Fetch coach when we know user.coach_id and banner isn't dismissed
  useEffect(() => {
    if (dismissed !== false) return;
    const coachId = currentUser?.coach_id;
    if (!coachId) return;

    let cancelled = false;
    setLoadState('loading');
    (async () => {
      try {
        const res = await api.get<CoachProfile>('/v1/clients/me/coach');
        if (!cancelled) {
          setCoach(res.data);
          setLoadState('loaded');
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // 404 means coach not yet assigned; treat other errors as idle (suppress banner)
        if (!cancelled) setLoadState(status === 404 ? 'not_found' : 'idle');
      }
    })();
    return () => { cancelled = true; };
  }, [dismissed, currentUser?.coach_id]);

  const handleDismiss = useCallback(() => {
    if (introKey) {
      prefsStorage.set(introKey, 'true').catch(() => {});
    }
    setDismissed(true);
  }, [introKey]);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (dismissed === null) return null; // still reading MMKV
  if (dismissed === true) return null;

  const coachId = currentUser?.coach_id;

  if (!coachId) return null;

  // Loading skeleton
  if (loadState === 'loading') {
    return <View style={styles.skeleton} testID="coach-intro-skeleton" />;
  }

  // Loaded
  if (loadState !== 'loaded' || !coach) return null;

  const initials = coach.name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={styles.banner} testID="coach-intro-banner">
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {coach.avatar_url ? (
          <Image
            source={{ uri: coach.avatar_url }}
            style={styles.avatar}
            accessibilityLabel={`${coach.name} avatar`}
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Text */}
      <Text style={styles.bannerText} testID="coach-intro-name">
        You're working with {coach.name}.
      </Text>

      {/* Dismiss */}
      <TouchableOpacity
        onPress={handleDismiss}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss coach introduction banner"
        testID="coach-intro-dismiss"
      >
        <Text style={styles.dismissText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      // DES-K2-128: one hairline above, no box or fill (A23 section).
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 18,
      marginBottom: 24,
      gap: 12,
    },
    bannerText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    dismiss: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
    dismissText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 18,
      color: colors.textMuted,
      lineHeight: 20,
    },
    avatarContainer: {
      flexShrink: 0,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    avatarFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarInitials: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textPrimary,
    },
    skeleton: {
      height: 64,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: 24,
    },
  });

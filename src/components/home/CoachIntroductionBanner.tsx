/**
 * CoachIntroductionBanner — shown on the client HomeScreen below the greeting.
 *
 * Logic:
 * - MMKV 'home.coach_intro_banner_dismissed' === 'true' → return null
 * - user.coach_id absent → show WaitingForCoachBanner
 * - user.coach_id present → fetch /v1/clients/me/coach, show coach name/avatar
 * - On 404 → show "Your coach will assign your first workout soon." (no dismiss)
 * - Skeleton while fetching (height 64 row, no ActivityIndicator)
 *
 * WaitingForCoachBanner:
 * - MMKV 'home.waiting_banner_dismissed' === 'true' → return null
 * - Dismissible, writes key on dismiss
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { prefsStorage } from '../../storage/mmkv';
import api from '../../services/api';

// ─── MMKV Keys ────────────────────────────────────────────────────────────────

const INTRO_DISMISSED_KEY = 'home.coach_intro_banner_dismissed';
const WAITING_DISMISSED_KEY = 'home.waiting_banner_dismissed';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoachProfile {
  id: string;
  name: string;
  avatar_url?: string | null;
}

// ─── WaitingForCoachBanner ────────────────────────────────────────────────────

function WaitingForCoachBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    prefsStorage.getStringAsync(WAITING_DISMISSED_KEY).then((val) => {
      setDismissed(val === 'true');
    }).catch(() => setDismissed(false));
  }, []);

  const handleDismiss = useCallback(() => {
    prefsStorage.set(WAITING_DISMISSED_KEY, 'true').catch(() => {});
    setDismissed(true);
  }, []);

  if (dismissed !== false) return null;

  return (
    <View style={styles.banner} testID="waiting-for-coach-banner">
      <Text style={styles.bannerText}>
        Your coach will assign your first workout. For now, explore the app.
      </Text>
      <TouchableOpacity
        onPress={handleDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss waiting for coach banner"
        testID="waiting-banner-dismiss"
      >
        <Text style={styles.dismissText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── CoachIntroductionBanner ──────────────────────────────────────────────────

export default function CoachIntroductionBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'not_found' | 'idle'>('idle');

  // Check dismissed flag
  useEffect(() => {
    prefsStorage.getStringAsync(INTRO_DISMISSED_KEY).then((val) => {
      setDismissed(val === 'true');
    }).catch(() => setDismissed(false));
  }, []);

  // Fetch coach when we know user.coach_id and banner isn't dismissed
  useEffect(() => {
    if (dismissed !== false) return;
    const coachId = currentUser?.coach_id;
    if (!coachId) return; // no coach → WaitingForCoachBanner handles

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
    prefsStorage.set(INTRO_DISMISSED_KEY, 'true').catch(() => {});
    setDismissed(true);
  }, []);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (dismissed === null) return null; // still reading MMKV
  if (dismissed === true) return null;

  const coachId = currentUser?.coach_id;

  // No coach assigned → show waiting banner
  if (!coachId) {
    return <WaitingForCoachBanner />;
  }

  // Loading skeleton
  if (loadState === 'loading') {
    return <View style={styles.skeleton} testID="coach-intro-skeleton" />;
  }

  // 404 — informational only, no dismiss
  if (loadState === 'not_found') {
    return (
      <View style={styles.banner} testID="coach-intro-not-found">
        <Text style={styles.bannerText}>
          Your coach will assign your first workout soon.
        </Text>
      </View>
    );
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
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 14,
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
      backgroundColor: colors.primaryDark,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarInitials: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textOnPrimary,
    },
    skeleton: {
      height: 64,
      borderRadius: 2,
      backgroundColor: colors.surface,
      marginBottom: 24,
    },
  });

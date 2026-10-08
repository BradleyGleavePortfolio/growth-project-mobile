/**
 * EmptyStateNoClients — Empty state for the coach's client roster screen.
 *
 * When the coach has no clients, shows a prominent invite-code block with:
 * - Optimistic MMKV hydration from 'coach.wizard.step_2_invite_code'
 * - Background fetch from GET /coach/invite-codes
 * - Share + Copy actions
 * - Skeleton while loading (no ActivityIndicator)
 * - Graceful fallback to Settings nudge on 404
 *
 * @module src/ui/empty-states/EmptyStateNoClients
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';
import { prefsStorage } from '../../storage/mmkv';
import { coachApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InviteCode {
  id: string;
  code: string;
  deep_link_url?: string;
}

interface Props {
  /** Called when the "Open invite codes" CTA is pressed (no code yet) */
  onGoToSettings?: () => void;
  /**
   * Alias for the primary invite CTA. Equivalent to `onGoToSettings`
   * — both navigate the coach to the invite-management surface.
   * Kept so callers using the v1 EmptyState API (`onInvite`) continue
   * to compile and behave correctly.
   */
  onInvite?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// R15: scoped to the signed-in coach so a different coach signing in cannot
// inherit the previous coach's invite code.
const MMKV_CODE_KEY_BASE = 'coach.wizard.step_2_invite_code';

// ─── Component ────────────────────────────────────────────────────────────────

export function EmptyStateNoClients({ onGoToSettings, onInvite }: Props) {
  const { colors: legacy, semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, legacy), [semanticColors, legacy]);
  const handleInviteCta = onGoToSettings ?? onInvite;
  const currentUser = useCurrentUser();
  const cacheKey = useMemo(
    () => (currentUser?.id ? `${MMKV_CODE_KEY_BASE}:${currentUser.id}` : null),
    [currentUser?.id],
  );

  const [code, setCode] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 'notfound' means the API returned 404 — show Settings nudge
  const [state, setState] = useState<'loading' | 'loaded' | 'notfound'>('loading');

  // ── Hydrate from MMKV optimistically ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cached = cacheKey ? await prefsStorage.getStringAsync(cacheKey) : null;
        if (cached) {
          setCode(cached);
          setState('loaded');
        }
      } catch {
        // best-effort; background fetch will fill in
      }

      // Background refresh
      try {
        const res = await coachApi.listInviteCodes();
        const list = (res.data as InviteCode[] | undefined) ?? [];
        if (list.length === 0) {
          setState('notfound');
          return;
        }
        const first = list[0];
        setCode(first.code);
        setDeepLink(first.deep_link_url ?? null);
        setState('loaded');
        // Cache for next render
        if (cacheKey) {
          prefsStorage.set(cacheKey, first.code).catch(() => {});
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setState('notfound');
        } else {
          // Network error — if we have an optimistic code, stay 'loaded'
          if (!code) setState('notfound');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [cacheKey]);

  const handleShare = useCallback(() => {
    if (!code) return;
    const message = deepLink
      ? `Join me on Growth Project. Use code ${code} or tap: ${deepLink}`
      : `Join me on Growth Project. Use code ${code}`;
    Share.share({ message }).catch(() => {});
  }, [code, deepLink]);

  const handleCopyCode = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      // best-effort copy; if expo-clipboard is unavailable we silently skip
      // rather than crash the empty-state render
    }
    // HapticService honours the Haptics switch and no-ops where unsupported.
    await HapticService.softImpact();
  }, [code]);

  // ── Not found — nudge to invite codes ─────────────────────────────────────
  if (state === 'notfound') {
    return (
      <View style={styles.container}>
        <Text style={styles.headline}>Your first client is one link away.</Text>
        <Text style={styles.body}>Set up your invite code to get started.</Text>
        {handleInviteCta ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleInviteCta}
            accessibilityRole="button"
            accessibilityLabel="Open invite codes"
            testID="empty-no-clients-settings-btn"
          >
            <Text style={styles.primaryBtnText}>Open invite codes</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <View style={styles.container}>
        <Text style={styles.headline}>Your first client is one link away.</Text>
        <View style={styles.skeletonCode} />
        <View style={[styles.skeletonLine, { width: '70%', marginTop: 8 }]} />
        <View style={[styles.skeletonBtn, { marginTop: 24 }]} />
      </View>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.headline}>Your first client is one link away.</Text>

      {/* Code block */}
      <View style={styles.codeBlock} testID="invite-code-block">
        <Text style={styles.codeText} testID="invite-code-text">{code}</Text>
      </View>

      {/* Deep link */}
      {deepLink ? (
        <Text style={styles.deepLinkText} numberOfLines={1} testID="invite-deep-link">
          {deepLink}
        </Text>
      ) : null}

      {/* Share button */}
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={handleShare}
        accessibilityRole="button"
        accessibilityLabel="Share your invite code"
        testID="share-code-btn"
      >
        <Text style={styles.primaryBtnText}>Share your code</Text>
      </TouchableOpacity>

      {/* Copy link */}
      <TouchableOpacity
        style={styles.copyBtn}
        onPress={handleCopyCode}
        accessibilityRole="button"
        accessibilityLabel="Copy invite code to clipboard"
        testID="copy-code-btn"
      >
        <Text style={styles.copyBtnText}>Copy code</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: SemanticTokens, legacy: ThemeColors) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: 48,
      paddingHorizontal: 24,
    },
    headline: {
      ...typography.h2,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 24,
    },
    body: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 16,
    },
    // Unfilled (bone shows through) with the theme hairline.
    codeBlock: {
      width: '100%',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center',
      marginBottom: 8,
    },
    codeText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 20,
      letterSpacing: 3,
      color: colors.textPrimary,
    },
    deepLinkText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 24,
      textAlign: 'center',
    },
    primaryBtn: {
      width: '100%',
      backgroundColor: colors.accent,
      paddingVertical: 12,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.lg,
      marginTop: 8,
    },
    primaryBtnText: {
      ...typography.bodyMd,
      color: colors.textOnAccent,
    },
    copyBtn: {
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
      marginTop: 4,
    },
    copyBtnText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
    },
    // Skeletons
    skeletonCode: {
      width: '100%',
      height: 44,
      borderRadius: radius.lg,
      backgroundColor: legacy.surface,
    },
    skeletonLine: {
      height: 12,
      borderRadius: 2,
      backgroundColor: legacy.surface,
    },
    skeletonBtn: {
      width: '100%',
      height: 48,
      borderRadius: radius.lg,
      backgroundColor: legacy.surface,
    },
  });

export default EmptyStateNoClients;

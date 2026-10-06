/**
 * CommunityTermsGate — one-time community terms agreement (App Store
 * Guideline 1.2, B-IOSREV-2).
 *
 * Apple requires that people agree to terms that make clear there is no
 * tolerance for objectionable content or abusive users before they take part
 * in user-generated content. The filter, report, block and contact pieces
 * already exist (server filter, SafetyMenu, CommunitySafetyScreen); this gate
 * is the agreement step.
 *
 * It wraps the client and coach Community stacks and the More > Community
 * wins feed, so every Community route (including a push or deep link into a
 * thread or the composer) sits behind it. The agreement is stored per user in prefsStorage under
 * `community_terms_agreed:v1:<userId>`, so a second account on the same phone
 * is asked on its own. "Read the Terms of Service" opens the public /terms
 * page (TERMS_URL).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { radius, spacing } from '../../theme/tokens';
import { prefsStorage } from '../../storage/mmkv';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { COMMUNITY_GUIDELINES } from '../../api/communitySafetyApi';
import { openTermsOfService } from '../../lib/legalLinks';
import { logger } from '../../utils/logger';

export const COMMUNITY_TERMS_KEY_PREFIX = 'community_terms_agreed:v1:';
export const communityTermsKey = (userId: string): string =>
  `${COMMUNITY_TERMS_KEY_PREFIX}${userId}`;

export const COMMUNITY_TERMS_COPY = {
  title: 'Community guidelines',
  intro:
    'Before taking part in Community, read these guidelines and the Terms of Service. Agreeing applies to every post, comment and message in Community.',
  zeroTolerance:
    'There is no tolerance for objectionable content or abusive users. Content that breaks these guidelines is removed, and the account that posted it can be removed.',
  agree: 'Agree and continue',
  readTerms: 'Read the Terms of Service',
} as const;

type GateState = 'loading' | 'needed' | 'agreed';

export default function CommunityTermsGate({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    let mounted = true;
    if (!userId) {
      setState('loading');
      return undefined;
    }
    setState('loading');
    prefsStorage
      .getStringAsync(communityTermsKey(userId))
      .then((value) => {
        if (mounted) setState(value ? 'agreed' : 'needed');
      })
      .catch((err: unknown) => {
        // Unreadable storage: ask again rather than skip the agreement.
        logger.warn('CommunityTermsGate', 'agreement read failed', err);
        if (mounted) setState('needed');
      });
    return () => {
      mounted = false;
    };
  }, [userId]);

  const agree = useCallback(() => {
    if (!userId) return;
    setState('agreed');
    prefsStorage.set(communityTermsKey(userId), new Date().toISOString()).catch((err: unknown) => {
      // Not saved: the person is asked once more next time Community opens.
      logger.warn('CommunityTermsGate', 'agreement save failed', err);
    });
  }, [userId]);

  if (state === 'agreed') return <>{children}</>;

  if (state === 'loading') {
    return (
      <View
        style={[styles.center, { backgroundColor: sc.bgPrimary }]}
        testID="community-terms-loading"
      >
        <ActivityIndicator color={sc.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: sc.bgPrimary }]}
      edges={['top']}
      testID="community-terms-gate"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: sc.textPrimary }]} accessibilityRole="header">
          {COMMUNITY_TERMS_COPY.title}
        </Text>
        <Text style={[styles.body, { color: sc.textMuted }]}>{COMMUNITY_TERMS_COPY.intro}</Text>
        <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
          {COMMUNITY_GUIDELINES.map((line) => (
            <Text key={line} style={[styles.bullet, { color: sc.textPrimary }]}>
              {`\u2022 ${line}`}
            </Text>
          ))}
        </View>
        <Text
          style={[styles.body, styles.strong, { color: sc.textPrimary }]}
          testID="community-terms-zero-tolerance"
        >
          {COMMUNITY_TERMS_COPY.zeroTolerance}
        </Text>
        <HapticPressable
          intent="medium"
          onPress={agree}
          accessibilityRole="button"
          accessibilityLabel={COMMUNITY_TERMS_COPY.agree}
          style={[styles.primary, { backgroundColor: sc.accent }]}
          testID="community-terms-agree"
        >
          <Text style={[styles.primaryText, { color: sc.textOnAccent }]}>
            {COMMUNITY_TERMS_COPY.agree}
          </Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          onPress={openTermsOfService}
          accessibilityRole="link"
          accessibilityLabel={COMMUNITY_TERMS_COPY.readTerms}
          style={styles.link}
          testID="community-terms-read-terms"
        >
          <Text style={[styles.linkText, { color: sc.accentText }]}>
            {COMMUNITY_TERMS_COPY.readTerms}
          </Text>
        </HapticPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Wraps a single Community screen (More > Community wins feed) in the gate. */
export function withCommunityTerms<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) => (
    <CommunityTermsGate>
      <Component {...props} />
    </CommunityTermsGate>
  );
  const displayName = Component.displayName || Component.name || 'Component';
  Wrapped.displayName = `withCommunityTerms(${displayName})`;
  return Wrapped;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '600' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  bullet: { fontSize: 15, lineHeight: 22 },
  primary: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryText: { fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});

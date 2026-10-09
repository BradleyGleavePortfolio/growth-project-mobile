import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { coachApi } from '../../services/api';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { typography, radius } from '../../theme/tokens';
import { Screen } from '../../ui';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';

export default function CoachGuidelinesScreen() {
  const { colors: base, semanticColors: sc } = useTheme();
  const colors = useMemo(() => ({ ...base, background: sc.bgPrimary, surface: sc.bgPrimary,
    primaryPale: sc.bgPrimary, textPrimary: sc.textPrimary, textSecondary: sc.textMuted,
    textMuted: sc.textMuted, primary: sc.accent, border: sc.border, error: sc.textMuted, textOnPrimary: sc.textOnAccent }), [base, sc]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const [guideline, setGuideline] = useState<{ title?: string; description?: string; created_at?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  // Audit fix H-1: distinguish "no data" from "failed to load". The
  // previous implementation swallowed errors silently, so a network
  // failure rendered identically to a coach who had not yet written
  // guidelines. Tracking error separately lets us surface a retry
  // button only when the request actually failed.
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    coachApi
      .getMyGuidelines()
      .then((res) => {
        setGuideline(res.data);
      })
      .catch(() => {
        setError('Guidelines did not load. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [currentUser]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Screen
      edges={['top']}
      contentStyle={styles.content}
      header={<View style={styles.topBar}>
        <TouchableOpacity style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Coach guidelines</Text>
        <View style={{ width: 44 }} />
      </View>}
    >
        {loading ? (
          <SkeletonScreen count={3} />
        ) : error ? (
          <View style={styles.emptyCard} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
            <Text style={styles.emptyTitle}>Could not load guidelines</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={load}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              accessibilityHint="Tries to load your coach guidelines again"
              testID="coach-guidelines-retry"
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : guideline ? (
          <>
            <View style={styles.headerCard}>
              <View style={styles.headerIcon}>
                <Ionicons name="clipboard-outline" size={24} color={sc.textMuted} />
              </View>
              <Text style={styles.headerTitle}>{guideline.title || 'Guidelines'}</Text>
              {guideline.created_at ? <Text style={styles.headerSub}>Added {formatDate(guideline.created_at)}</Text> : null}
            </View>

            <View style={styles.guidelineCard}>
              {(guideline.description || '').split('\n').map((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed) return <View key={idx} style={{ height: 12 }} />;

                if (trimmed.startsWith('# ')) {
                  return (
                    <Text key={idx} style={styles.heading1}>
                      {trimmed.slice(2)}
                    </Text>
                  );
                }
                if (trimmed.startsWith('## ')) {
                  return (
                    <Text key={idx} style={styles.heading2}>
                      {trimmed.slice(3)}
                    </Text>
                  );
                }
                if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                  return (
                    <View key={idx} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{trimmed.slice(2)}</Text>
                    </View>
                  );
                }

                return (
                  <Text key={idx} style={styles.paragraph}>
                    {trimmed}
                  </Text>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="clipboard-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No guidelines yet</Text>
            <Text style={styles.emptyText}>
              No guidelines added yet.
            </Text>
          </View>
        )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  // Screen owns the inset top (insets.top + 12) and the page colour.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h1, flexShrink: 1, textAlign: 'center', color: colors.textPrimary },
  content: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 100 },
  headerCard: {
    backgroundColor: colors.primaryPale,
    borderRadius: radius.card,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: 4 },
  headerSub: { ...typography.bodySmall, fontVariant: ['tabular-nums'], color: colors.textSecondary },
  // A hairline section, not a box: no fill, no corners.
  guidelineCard: {
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  heading1: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 8,
    marginTop: 8,
  },
  heading2: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 6,
    marginTop: 12,
  },
  paragraph: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    paddingLeft: 8,
    marginBottom: 4,
  },
  bulletDot: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    color: colors.textSecondary,
    marginRight: 8,
    lineHeight: 22,
  },
  bulletText: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    flex: 1,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 40,
    alignItems: 'center',
    marginTop: 40,
    gap: 12,
  },
  emptyTitle: { ...typography.h4, color: colors.textPrimary },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
  retryBtnText: {
    fontFamily: typography.bodyMd.fontFamily,
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.4,
  },

  });

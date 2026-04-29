import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { coachApi } from '../../services/api';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export default function CoachGuidelinesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const [guideline, setGuideline] = useState<{ title?: string; description?: string; created_at?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    coachApi.getMyGuidelines()
      .then((res) => {
        setGuideline(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [currentUser]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Coach Guidelines</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        ) : guideline ? (
          <>
            <View style={styles.headerCard}>
              <View style={styles.headerIcon}>
                <Ionicons name="clipboard" size={24} color={colors.primary} />
              </View>
              <Text style={styles.headerTitle}>Your Workout Plan</Text>
              <Text style={styles.headerSub}>
                Last updated {guideline.created_at ? formatDate(guideline.created_at) : '—'}
              </Text>
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
            <Text style={styles.emptyTitle}>No Guidelines Yet</Text>
            <Text style={styles.emptyText}>
              No guidelines added yet.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topTitle: { fontSize: 17, fontWeight: '500', color: colors.textPrimary },
  content: { padding: 20, paddingBottom: 100 },
  headerCard: {
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '500', color: colors.textPrimary, marginBottom: 4 },
  headerSub: { fontSize: 13, color: colors.textSecondary },
  guidelineCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 20,
  },
  heading1: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 8,
    marginTop: 8,
  },
  heading2: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
    marginBottom: 6,
    marginTop: 12,
  },
  paragraph: {
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
    fontSize: 14,
    color: colors.primary,
    marginRight: 8,
    lineHeight: 22,
  },
  bulletText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    flex: 1,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 40,
    alignItems: 'center',
    marginTop: 40,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  });

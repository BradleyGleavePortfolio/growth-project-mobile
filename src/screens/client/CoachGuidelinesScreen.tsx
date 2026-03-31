import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { getCoachGuidelines, CoachGuideline } from '../../db/workoutDb';

export default function CoachGuidelinesScreen() {
  const navigation = useNavigation<any>();
  const currentUser = useCurrentUser();
  const [guideline, setGuideline] = useState<CoachGuideline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    getCoachGuidelines(currentUser.id).then((g) => {
      setGuideline(g);
      setLoading(false);
    });
  }, [currentUser]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
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
                <Ionicons name="clipboard" size={24} color={Colors.primary} />
              </View>
              <Text style={styles.headerTitle}>Your Workout Plan</Text>
              <Text style={styles.headerSub}>
                Last updated {formatDate(guideline.updatedAt)}
              </Text>
            </View>

            <View style={styles.guidelineCard}>
              {guideline.content.split('\n').map((line, idx) => {
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
            <Ionicons name="clipboard-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Guidelines Yet</Text>
            <Text style={styles.emptyText}>
              Your coach hasn't added workout guidelines yet. Check back soon!
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  content: { padding: 20, paddingBottom: 100 },
  headerCard: {
    backgroundColor: Colors.primaryPale,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4 },
  headerSub: { fontSize: 13, color: Colors.textSecondary },
  guidelineCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  heading1: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
    marginTop: 8,
  },
  heading2: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
    marginTop: 12,
  },
  paragraph: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    color: Colors.primary,
    marginRight: 8,
    lineHeight: 22,
  },
  bulletText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
    flex: 1,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    marginTop: 40,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});

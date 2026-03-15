import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useCoachStore } from '../../store/coachStore';
import { Colors } from '../../constants/colors';
import { Shadow, Radius } from '../../constants/theme';
import { getDatabase } from '../../db/database';
import { generateId } from '../../utils/date';
import FadeInView from '../../components/FadeInView';

// ── Program Templates ──────────────────────────────────────────────────────

interface ProgramTemplate {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  nutritionNotes: string;
  trainingNotes: string;
  tags: string[];
  color: string;
}

const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: 'fat_loss',
    emoji: '🔥',
    title: 'Fat Loss Protocol',
    subtitle: 'Aggressive caloric deficit with muscle preservation',
    nutritionNotes:
      '• Caloric deficit of 500–700 kcal/day below TDEE\n• High protein: 1.0–1.2g per lb of body weight\n• Carb cycling: low carb on rest days, moderate on training days\n• Prioritize whole foods, minimize processed sugars\n• Meal timing: pre/post workout nutrition essential\n• Expect 1–1.5 lbs of fat loss per week',
    trainingNotes:
      '• 4–5x/week resistance training (compound movements first)\n• 2–3x/week LISS cardio (30–45 min, 60–70% max HR)\n• HIIT 1x/week for metabolic boost\n• Prioritize progressive overload to preserve muscle\n• Active recovery on rest days (walking, stretching)',
    tags: ['Fat Loss', 'Deficit', 'High Protein', 'Cardio'],
    color: '#FF6B35',
  },
  {
    id: 'lean_bulk',
    emoji: '💪',
    title: 'Lean Bulk Protocol',
    subtitle: 'Clean caloric surplus for maximum muscle gain',
    nutritionNotes:
      '• Caloric surplus of 300–500 kcal/day above TDEE\n• Protein: 0.8–1.0g per lb of body weight\n• Carbohydrates: primary energy source, time around workouts\n• Healthy fats: 25–30% of total calories\n• Avoid junk food surplus — quality calories only\n• Expect 0.5–1 lb of lean mass gain per week',
    trainingNotes:
      '• 4–5x/week heavy compound lifting\n• Progressive overload: add weight or reps weekly\n• Minimal cardio (1–2x/week maintenance cardio)\n• Prioritize recovery: 7–9 hours sleep\n• Deload every 6–8 weeks',
    tags: ['Lean Bulk', 'Surplus', 'Muscle Gain', 'Strength'],
    color: '#2D6A4F',
  },
  {
    id: 'recomp',
    emoji: '⚖️',
    title: 'Body Recomposition',
    subtitle: 'Simultaneously lose fat and build muscle',
    nutritionNotes:
      '• Maintenance calories (TDEE ±100 kcal)\n• Very high protein: 1.0–1.2g per lb of body weight\n• Carb cycling: higher carbs on training days\n• Nutrient timing is critical — eat around workouts\n• Patience required: slower progress than bulk or cut\n• Ideal for beginners and those returning after a break',
    trainingNotes:
      '• 3–5x/week resistance training\n• 2–3x/week moderate cardio\n• Focus on form and muscle mind-connection\n• Track body composition (measurements + photos) not just weight\n• Allow 3–6 months to see significant changes',
    tags: ['Recomp', 'Maintenance', 'Balanced', 'Body Composition'],
    color: '#457B9D',
  },
  {
    id: 'maintenance',
    emoji: '🎯',
    title: 'Maintenance Protocol',
    subtitle: 'Sustain current physique and optimize performance',
    nutritionNotes:
      '• Calories at TDEE (no deficit or surplus)\n• Protein: 0.7–0.8g per lb of body weight\n• Flexible macros: focus on food quality over strict tracking\n• Intuitive eating principles once targets are understood\n• Continue logging 4–5 days per week for awareness\n• Enjoy a sustainable, flexible lifestyle',
    trainingNotes:
      '• 3–4x/week training (mix of strength and cardio)\n• Maintain current strength levels — no need to push PRs\n• Try new activities to maintain motivation\n• Prioritize health markers: sleep, stress, energy levels\n• Adjust calories seasonally as activity changes',
    tags: ['Maintenance', 'Sustainable', 'Flexible', 'Lifestyle'],
    color: '#74C69D',
  },
  {
    id: 'mobility',
    emoji: '🧘',
    title: 'Mobility & Wellness',
    subtitle: 'Recovery, flexibility, and holistic health focus',
    nutritionNotes:
      '• Anti-inflammatory diet: prioritize whole foods\n• Adequate hydration: 0.5–1 oz per lb of body weight\n• Omega-3 rich foods: fatty fish, walnuts, flaxseed\n• Minimize processed foods, alcohol, excess sugar\n• Consider magnesium and collagen supplementation\n• Prioritize gut health with fermented foods and fiber',
    trainingNotes:
      '• Daily mobility work: 15–20 min morning routine\n• 2–3x/week yoga or Pilates\n• 2x/week light strength training\n• Daily step goal: 8,000–10,000 steps\n• Cold/heat therapy for recovery\n• Breathwork and stress management practices',
    tags: ['Mobility', 'Wellness', 'Recovery', 'Anti-Inflammatory'],
    color: '#9B72AA',
  },
];

// ── Ensure extended guidelines table ─────────────────────────────────────

async function ensureGuidelinesTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS coach_guidelines_v2 (
      id TEXT PRIMARY KEY NOT NULL,
      coachId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cg2_client ON coach_guidelines_v2(clientId);
  `);
}

async function applyTemplateToClient(
  coachId: string,
  clientId: string,
  template: ProgramTemplate
): Promise<void> {
  await ensureGuidelinesTable();
  const db = await getDatabase();
  const id = 'cg2_' + generateId();
  const content = `## Nutrition\n${template.nutritionNotes}\n\n## Training\n${template.trainingNotes}`;
  await db.runAsync(
    `INSERT INTO coach_guidelines_v2 (id, coachId, clientId, title, content, tags, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, coachId, clientId, template.title + ' ' + template.emoji, content, JSON.stringify(template.tags), new Date().toISOString()]
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ProgramTemplatesScreen() {
  const { currentUser } = useAuthStore();
  const { clients, loadClients } = useCoachStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ProgramTemplate | null>(null);
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentUser) loadClients(currentUser.id);
  }, [currentUser?.id]);

  const handleApply = (template: ProgramTemplate) => {
    setSelectedTemplate(template);
    setClientModalVisible(true);
  };

  const handleSelectClient = async (clientId: string, clientName: string) => {
    if (!selectedTemplate || !currentUser) return;
    setLoading(true);
    setClientModalVisible(false);
    try {
      await applyTemplateToClient(currentUser.id, clientId, selectedTemplate);
      Alert.alert(
        '✅ Template Applied',
        `"${selectedTemplate.title}" has been assigned to ${clientName}.`,
        [{ text: 'Great!' }]
      );
    } catch (err) {
      Alert.alert('Error', 'Could not apply template. Please try again.');
    } finally {
      setLoading(false);
      setSelectedTemplate(null);
    }
  };

  const activeClients = clients.filter((c) => c.status === 'active');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <FadeInView>
          <View style={styles.header}>
            <Text style={styles.title}>Program Templates</Text>
            <Text style={styles.subtitle}>Apply proven protocols to your clients</Text>
          </View>
        </FadeInView>

        {/* Template Cards */}
        {PROGRAM_TEMPLATES.map((template, idx) => {
          const isExpanded = expanded === template.id;
          return (
            <FadeInView key={template.id} delay={idx * 60}>
              <View style={[styles.templateCard, isExpanded && styles.templateCardExpanded]}>
                {/* Card Header */}
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => setExpanded(isExpanded ? null : template.id)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.emojiCircle, { backgroundColor: template.color + '20' }]}>
                    <Text style={styles.emoji}>{template.emoji}</Text>
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.templateTitle}>{template.title}</Text>
                    <Text style={styles.templateSubtitle}>{template.subtitle}</Text>
                    {/* Tags */}
                    <View style={styles.tagsRow}>
                      {template.tags.map((tag) => (
                        <View key={tag} style={[styles.tagChip, { backgroundColor: template.color + '15' }]}>
                          <Text style={[styles.tagText, { color: template.color }]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Expanded Content */}
                {isExpanded && (
                  <View style={styles.expandedContent}>
                    <View style={styles.divider} />

                    <View style={styles.notesSection}>
                      <View style={styles.notesSectionHeader}>
                        <Ionicons name="restaurant-outline" size={16} color={Colors.primary} />
                        <Text style={styles.notesSectionTitle}>Nutrition Plan</Text>
                      </View>
                      <Text style={styles.notesText}>{template.nutritionNotes}</Text>
                    </View>

                    <View style={styles.notesSection}>
                      <View style={styles.notesSectionHeader}>
                        <Ionicons name="barbell-outline" size={16} color={Colors.primary} />
                        <Text style={styles.notesSectionTitle}>Training Plan</Text>
                      </View>
                      <Text style={styles.notesText}>{template.trainingNotes}</Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.applyBtn, { backgroundColor: template.color }]}
                      onPress={() => handleApply(template)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.applyBtnText}>Apply to Client →</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </FadeInView>
          );
        })}
      </ScrollView>

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Applying template...</Text>
        </View>
      )}

      {/* Client Selection Modal */}
      <Modal
        visible={clientModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setClientModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Select Client</Text>
              {selectedTemplate && (
                <Text style={styles.modalSubtitle}>
                  Applying: {selectedTemplate.emoji} {selectedTemplate.title}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setClientModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.clientList}>
            {activeClients.length === 0 ? (
              <View style={styles.emptyClients}>
                <Ionicons name="people-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No active clients found</Text>
              </View>
            ) : (
              activeClients.map((client) => (
                <TouchableOpacity
                  key={client.id}
                  style={styles.clientRow}
                  onPress={() => handleSelectClient(client.id, `${client.firstName} ${client.lastName}`)}
                  activeOpacity={0.75}
                >
                  <View style={styles.clientAvatar}>
                    <Text style={styles.clientAvatarText}>
                      {client.firstName[0]}{client.lastName[0]}
                    </Text>
                  </View>
                  <View style={styles.clientRowInfo}>
                    <Text style={styles.clientRowName}>{client.firstName} {client.lastName}</Text>
                    <Text style={styles.clientRowEmail}>{client.email}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  templateCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.small,
  },
  templateCardExpanded: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    gap: 12,
  },
  emojiCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  emoji: {
    fontSize: 24,
  },
  cardHeaderText: {
    flex: 1,
    gap: 4,
  },
  templateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  templateSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 16,
  },
  notesSection: {
    marginBottom: 16,
  },
  notesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  notesSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  notesText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  // Modal
  modalSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  clientList: {
    padding: 20,
    gap: 10,
  },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.small,
  },
  clientAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clientAvatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  clientRowInfo: {
    flex: 1,
  },
  clientRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  clientRowEmail: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  emptyClients: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});

/**
 * BothPillarsScreen — placeholder cross-pillar coach view.
 *
 * Stage 2 stub. The Practice model says coaches who manage both Body
 * (fitness) and Wealth (finance) clients see a cross-pillar roster
 * here, with each client tagged for the pillars they actually use.
 *
 * Stage 3 wires the actual data: it fetches the coach's roster from
 * BOTH backends (fitness + finance), de-dupes by user identity (Stage 3
 * also lands the federation handshake), and tags each row with the
 * pillars they participate in.
 *
 * This file ships a designed empty state + a stub roster so coaches
 * see the surface and the badge UX before Stage 3 wires the network
 * calls. The stub is deliberately read-only and does not call any
 * API — it is faux data behind a flag-like comment so QA cannot
 * accidentally believe it is wired.
 *
 * If you find yourself adding a fetch here, you are doing Stage 3.
 * Open the linked PR instead.
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Typography } from '../../theme';

interface StubClient {
  id: string;
  name: string;
  pillars: Array<'body' | 'wealth' | 'mind'>;
  last_activity: string;
}

// Stub data. Stage 3 replaces this with a fetch against the federated
// roster endpoint. Keep the shape stable so the wire-up is a one-line
// swap.
const STUB_CLIENTS: StubClient[] = [
  { id: 'stub-1', name: 'Sarah K.',     pillars: ['body', 'wealth'], last_activity: '2 days ago' },
  { id: 'stub-2', name: 'Marcus T.',    pillars: ['body'],           last_activity: '5h ago'    },
  { id: 'stub-3', name: 'Yusuf A.',     pillars: ['wealth'],         last_activity: '1 day ago' },
  { id: 'stub-4', name: 'Renata G.',    pillars: ['body', 'wealth'], last_activity: '3 days ago' },
  { id: 'stub-5', name: 'James W.',     pillars: ['body'],           last_activity: '6h ago'    },
];

export default function BothPillarsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>BOTH PILLARS</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Hero */}
      <Text style={styles.eyebrow}>CROSS-PILLAR PRACTICE</Text>
      <Text style={styles.headline}>Coming in Stage 3.</Text>
      <Text style={styles.lede}>
        When a client engages with both your fitness and wealth practice, this
        view will surface them once with badges for each pillar — no toggling
        between apps. Stage 3 wires the federation handshake that unifies the
        roster across both backends.
      </Text>

      {/* Stub roster */}
      <View style={styles.stubBanner}>
        <Ionicons name="construct-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.stubBannerText}>
          Preview only. The roster below is sample data.
        </Text>
      </View>

      <View style={styles.list}>
        {STUB_CLIENTS.map((c) => (
          <View key={c.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{c.name}</Text>
              <Text style={styles.rowMeta}>{c.last_activity}</Text>
            </View>
            <View style={styles.badgeRow}>
              {c.pillars.includes('body') ? <PillarBadge label="BODY" colors={colors} /> : null}
              {c.pillars.includes('wealth') ? <PillarBadge label="WEALTH" colors={colors} /> : null}
              {c.pillars.includes('mind') ? <PillarBadge label="MIND" colors={colors} /> : null}
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footnote}>
        Stage 3 ships the federated roster fetch + identity reconciliation
        between the Body and Wealth backends. Until then, this screen is a
        designed preview only — no real data is fetched.
      </Text>
    </ScrollView>
  );
}

function PillarBadge({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 0.5,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text
        style={{
          ...Typography.label,
          fontSize: 10,
          letterSpacing: 1.4,
          color: colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 64 },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 16,
    },
    backBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      ...Typography.label,
      color: colors.textSecondary,
    },
    eyebrow: {
      ...Typography.label,
      color: colors.textSecondary,
    },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 24,
      color: colors.textSecondary,
      marginTop: 8,
    },
    stubBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: 24,
    },
    stubBannerText: {
      ...Typography.caption,
      color: colors.textSecondary,
    },
    list: {
      marginTop: 16,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 4,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    rowName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    rowMeta: {
      ...Typography.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      gap: 6,
    },
    footnote: {
      ...Typography.caption,
      color: colors.textMuted,
      fontStyle: 'italic',
      marginTop: 24,
    },
  });

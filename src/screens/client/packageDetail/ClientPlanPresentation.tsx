/** C5 Style C, slice 3: presentation only; checkout stays with its host. */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { Screen, useScreenInsets } from '../../../ui';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

export const CLIENT_PLAN_COPY = {
  about: 'About this plan',
  included: "What's included",
  billing: 'Billing',
  due: 'Due today',
  from: (coach: string) => `From ${coach}`,
};

export function PlanMasthead({ title, coach, price, onBack }: {
  title: string; coach: string | null; price?: string; onBack?: () => void;
}) {
  const { semanticColors: c } = useTheme();
  return (
    <View style={[s.masthead, { backgroundColor: c.surface.masthead }]}>
      <View style={s.headingRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={c.textOnAccent} />
          </TouchableOpacity>
        ) : null}
        <View style={s.headingText}>
          <Text style={[s.title, { color: c.textOnAccent }]} accessibilityRole="header">{title}</Text>
          {price ? <Text style={[s.meta, { color: c.textOnAccent }]}>{price}</Text> : null}
        </View>
        {coach ? (
          <View style={[s.seal, { backgroundColor: c.bgPrimary, borderColor: c.data.peak }]} accessible={false}>
            <Text style={[s.initial, { color: c.accentText }]}>{coach.trim().charAt(0)}</Text>
          </View>
        ) : null}
      </View>
      <View style={[s.rule, { backgroundColor: c.data.peak }]} />
    </View>
  );
}

function CoachNote({ description, coach }: { description: string | null; coach: string | null }) {
  const { semanticColors: c } = useTheme();
  return description ? (
    <View style={s.note}>
      {coach ? (
        <View style={[s.noteSeal, { backgroundColor: c.surface.masthead }]} accessible={false}>
          <Text style={[s.initial, { color: c.textOnAccent }]}>{coach.trim().charAt(0)}</Text>
        </View>
      ) : null}
      <View style={s.headingText}>
        <Text style={[s.quote, { color: c.textPrimary }]}>{description}</Text>
        {coach ? <Text style={[s.meta, { color: c.textMuted }]}>{CLIENT_PLAN_COPY.from(coach)}</Text> : null}
      </View>
    </View>
  ) : null;
}

export function PlanOfferCard({ name, price, description, features, coach, onOpen, testID }: {
  name: string; price: string; description: string | null; features: string[];
  coach: string | null; onOpen: () => void; testID: string;
}) {
  const { semanticColors: c } = useTheme();
  return (
    <View style={[s.card, { backgroundColor: c.bgSurface, borderColor: c.border, borderLeftColor: c.data.peak }]} testID={testID}>
      <Text style={[s.cardTitle, { color: c.textPrimary }]} accessibilityRole="header">{name}</Text>
      <Text style={[s.cardPrice, { color: c.accentText }]}>{price}</Text>
      {features.length ? <Text style={[s.meta, { color: c.textPrimary }]}>{features.join(' · ')}</Text> : null}
      <CoachNote description={description} coach={coach} />
      <TouchableOpacity
        style={s.open} onPress={onOpen} accessibilityRole="button"
        accessibilityLabel={`${CLIENT_PLAN_COPY.about}, ${name}, ${price}`} testID={`${testID}-open`}
      >
        <Text style={[s.link, { color: c.accentText }]}>{CLIENT_PLAN_COPY.about}</Text>
        <Ionicons name="chevron-forward" size={18} color={c.accentText} />
      </TouchableOpacity>
    </View>
  );
}

export function ClientPlanPage({ name, price, description, features, coach, onBack, children, footer }: {
  name: string; price: string; description: string | null; features: string[]; coach: string | null;
  onBack: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  const { semanticColors: c } = useTheme();
  const insets = useScreenInsets();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const ink = Animated.timing(opacity, { toValue: 1, duration: reduced ? 150 : 200, useNativeDriver: true });
    ink.start();
    return () => ink.stop();
  }, [opacity, reduced]);
  return (
    <Screen
      edges={['bottom']} testID="client-plan-page"
      header={<View style={{ backgroundColor: c.surface.masthead, paddingTop: insets.top + 12, paddingHorizontal: 24 }}>
        <PlanMasthead title={name} price={price} coach={coach} onBack={onBack} />
      </View>}
      footer={footer}
    >
      <Animated.View style={{ opacity }}>
        <CoachNote description={description} coach={coach} />
        {features.length ? (
          <View style={s.section}>
            <Text style={[s.overline, { color: c.textMuted }]} accessibilityRole="header">{CLIENT_PLAN_COPY.included}</Text>
            {features.map((feature, i) => (
              <View key={i} style={s.feature}>
                <View style={[s.dot, { backgroundColor: c.data.peak }]} />
                <Text style={[s.body, { color: c.textPrimary }]}>{feature}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {children}
      </Animated.View>
    </Screen>
  );
}

const s = StyleSheet.create({
  masthead: { marginHorizontal: -24, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 18 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingText: { flex: 1, minWidth: 0 },
  title: { ...typography.h1 },
  meta: { ...typography.bodySmall, marginTop: 6 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  seal: { width: 44, height: 44, borderRadius: radius.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  initial: { ...typography.h2, fontStyle: 'italic' },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 20 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderRadius: radius.card, padding: 16, marginBottom: 12 },
  cardTitle: { ...typography.h2 },
  cardPrice: { ...typography.h3, fontVariant: ['tabular-nums'], marginTop: 6 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginVertical: 18 },
  noteSeal: { width: 36, height: 36, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  quote: { ...typography.h2, fontStyle: 'italic' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 12, alignSelf: 'flex-start' },
  link: { ...typography.bodyMd },
  section: { marginVertical: 20 },
  overline: { ...typography.eyebrow, marginBottom: 12 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: radius.chip, marginTop: 10 },
  body: { ...typography.body, flex: 1 },
});

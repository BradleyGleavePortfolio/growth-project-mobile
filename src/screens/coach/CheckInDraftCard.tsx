/**
 * CHECKIN-DRAFT-M (ctx#503 B-list frame; owner #203-E14 "A and drafts list"): Roman's reply to a client's check-in as a
 * card in Roman's drafts list (main's PendingAiDraftsScreen, among the Stream 2 cards): the client's name, Check-in ·
 * {day}, Roman's words, Drafted by Roman, Not sent, Review draft (the sheet at ready) and Back to check-in (the file).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as palette, coachInboxB as B, neutral, radius, typography } from '../../theme/tokens';
import { SEMI, styleA } from './home-v11/HomeParts';
import { RomanMark } from './home-v11/RomanMark';
import { dayWord, type CheckInDraft } from './checkInDrafts';

export function CheckInDraftCard({ draft, name, onReview, onBack }: { draft: CheckInDraft; name: string; onReview: () => void; onBack: () => void }) {
  return (
    <View style={s.card} testID={`checkin-draft-card-${draft.draftId}`}>
      <Text style={s.name}>{name}</Text>
      <Text style={s.source}>{`Check-in · ${dayWord(draft.day)}`}</Text>
      <Text style={s.body} numberOfLines={4}>{draft.body}</Text>
      <View style={s.byRow}>
        <RomanMark size={20} r={12} />
        <Text style={s.by}>Drafted by Roman</Text>
        <Text style={s.notSent}>Not sent</Text>
      </View>
      <Pressable style={({ pressed }) => [s.review, pressed && s.pressed]} onPress={onReview} accessibilityRole="button" accessibilityLabel="Review draft">
        <Text style={s.reviewText}>Review draft</Text>
      </Pressable>
      <Pressable style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to check-in" hitSlop={4}>
        <Ionicons name="chevron-back" size={22} color={B.deep} />
        <Text style={s.backText}>Back to check-in</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  // The B-list frame's card: white, a hairline edge and the card radius, on the list's page.
  card: { backgroundColor: neutral[0], borderRadius: radius.card, borderWidth: 1, borderColor: styleA.cardLine, padding: 18, marginBottom: 12 },
  name: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, lineHeight: 32, color: B.ink },
  source: { fontFamily: SEMI, fontSize: 12.5, lineHeight: 17, letterSpacing: 1.6, textTransform: 'uppercase', color: B.ink, marginTop: 4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, color: B.body, marginTop: 12 },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  by: { ...typography.bodySmall, color: styleA.inkMuted, flex: 1 },
  notSent: { ...typography.bodySmall, color: styleA.inkMuted },
  review: { minHeight: 48, marginTop: 16, borderRadius: radius.button, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  reviewText: { fontFamily: SEMI, fontSize: 16, lineHeight: 21, color: neutral[0] },
  pressed: { opacity: 0.85 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8, alignSelf: 'flex-start' },
  backText: { ...typography.body, fontSize: 15, color: B.deep },
});

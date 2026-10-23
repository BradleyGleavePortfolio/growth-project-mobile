/**
 * Roman's notices on "Your path" (style A frames 07, 08, 09, 10, 11; Opus B-G2, B-G4, Sol B-851-G3): one white ledger
 * card with Roman's face. A title is bold beside the face with the body under it (AI help off, daily cap, offline);
 * a notice with only a line sets it in regular body text beside the face (credits out, frame 08).
 *
 * CopilotRefusal: "AI help is off" for a client is this card with the full-width "Allow AI help" (frame 07), which
 * opens main's AiConsentSheet, so the grant, its ledger and its identity fence are main's. The words are main's
 * (aiRefusalCopy, CP-A-38). Every other refusal keeps main's AiRefusalNotice.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import AiRefusalNotice, { AI_REFUSAL_ACTIONS } from '../../../components/ai/AiRefusalNotice';
import AiConsentSheet from '../../../components/ai/AiConsentSheet';
import { useOpenSupport } from '../../../components/ai/useOpenSupport';
import { aiRefusalCopy, type AiRefusal } from '../../../lib/ai/aiRefusal';
import { PrimaryButton } from '../../../ui';
import { ledger } from './ledger';

export function RomanNotice({ title, body, children, testID }: { title?: string; body?: string; children?: React.ReactNode; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  const ink = { color: sc.textPrimary };
  return (
    <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <View style={s.who}>
        <RomanAvatar crop="neutral" size={36} />
        {title
          ? <Text style={[typography.bodyMd, s.strong, s.grow, ink]} testID={testID ? `${testID}-title` : undefined}>{title}</Text>
          : <Text style={[typography.body, s.grow, ink]}>{body}</Text>}
      </View>
      {title && body ? <Text style={[typography.body, ink]}>{body}</Text> : null}
      {children}
    </View>
  );
}

export function CopilotRefusal({ refusal, onRetry, testID }: { refusal: AiRefusal; onRetry: () => void; testID: string }) {
  const [open, setOpen] = useState(false);
  const support = useOpenSupport();
  if (refusal.kind !== 'consent_required') {
    return <AiRefusalNotice refusal={refusal} audience="client" surface="roman" onRetry={onRetry} testID={testID} />;
  }
  const copy = aiRefusalCopy(refusal, 'client', 'roman');
  return (
    <RomanNotice title={copy.title} body={copy.body} testID={testID}>
      <PrimaryButton label={AI_REFUSAL_ACTIONS.allow} onPress={() => setOpen(true)} haptic={false} wrap testID={`${testID}-allow`} />
      <AiConsentSheet visible={open} onGranted={() => { setOpen(false); onRetry(); }} onClose={() => setOpen(false)}
        onContactSupport={support ? () => void support() : undefined} testID={`${testID}-consent-sheet`} />
    </RomanNotice>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  strong: { fontWeight: '600' },
  grow: { flex: 1 },
});

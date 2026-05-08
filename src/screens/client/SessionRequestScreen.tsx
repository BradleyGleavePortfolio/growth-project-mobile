// SessionRequestScreen — client flow for proposing a call window.
//
// Disabled-state aware: if SESSIONS_CLIENT_REQUESTS_ENABLED is OFF the form
// renders read-only with the disabled placeholder. Submission goes through
// the typed adapter; in mock mode it returns a realistic "requested" session
// and shows the confirmation state.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  SESSIONS_DISABLED_PLACEHOLDER,
  SESSION_REQUEST_FORM,
  sessionTypeLabel,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { MoreStackParamList } from '../../navigation/ClientNavigator';
import type { SessionType } from '../../types/sessions';
import { errorMessage } from '../../types/common';

type Props = {
  navigation: NativeStackNavigationProp<MoreStackParamList, 'SessionRequest'>;
  route: RouteProp<MoreStackParamList, 'SessionRequest'>;
};

const TYPE_OPTIONS: SessionType[] = [
  'check_in',
  'deep_dive',
  'plan_review',
  'ad_hoc',
];

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'submitted' }
  | { kind: 'error'; message: string };

export default function SessionRequestScreen({ route }: Props) {
  const { clientId, coachId } = route.params;
  const enabled = isSessionsFeatureEnabled('SESSIONS_CLIENT_REQUESTS_ENABLED');
  const [type, setType] = useState<SessionType>('check_in');
  const [note, setNote] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });

  async function onSubmit() {
    setSubmitState({ kind: 'submitting' });
    try {
      // Preferred window defaulting to 24h ahead for shell purposes; a real
      // date/time picker lands in a follow-up once availability endpoints exist.
      const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      await getSessionsAdapter().requestSession({
        clientId,
        coachId,
        type,
        preferredStart: start.toISOString(),
        preferredEnd: end.toISOString(),
        note: note.trim() || undefined,
      });
      setSubmitState({ kind: 'submitted' });
    } catch (err) {
      setSubmitState({ kind: 'error', message: errorMessage(err) });
    }
  }

  if (!enabled) {
    return (
      <View style={styles.root} testID="session-request-disabled">
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>
            {SESSIONS_DISABLED_PLACEHOLDER.title}
          </Text>
          <Text style={styles.placeholderBody}>
            {SESSIONS_DISABLED_PLACEHOLDER.body}
          </Text>
        </View>
      </View>
    );
  }

  if (submitState.kind === 'submitted') {
    return (
      <View style={styles.root} testID="session-request-submitted">
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>
            {SESSION_REQUEST_FORM.submittedTitle}
          </Text>
          <Text style={styles.placeholderBody}>
            {SESSION_REQUEST_FORM.submittedBody}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          style={styles.heading}
          accessibilityRole="header"
        >
          {SESSION_REQUEST_FORM.title}
        </Text>
        <Text style={styles.intro}>{SESSION_REQUEST_FORM.intro}</Text>

        <View style={styles.typeRow}>
          {TYPE_OPTIONS.map((opt) => {
            const selected = opt === type;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.typeChip, selected && styles.typeChipSelected]}
                onPress={() => setType(opt)}
                accessibilityLabel={`Session type: ${sessionTypeLabel(opt)}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`session-type-${opt}`}
              >
                <Text
                  style={[
                    styles.typeChipLabel,
                    selected && styles.typeChipLabelSelected,
                  ]}
                >
                  {sessionTypeLabel(opt)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>{SESSION_REQUEST_FORM.noteLabel}</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder={SESSION_REQUEST_FORM.notePlaceholder}
          placeholderTextColor={colors.stone}
          multiline
          numberOfLines={4}
          accessibilityLabel={SESSION_REQUEST_FORM.noteLabel}
          accessibilityHint={SESSION_REQUEST_FORM.notePlaceholder}
          testID="session-request-note"
        />

        {submitState.kind === 'error' ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            testID="session-request-error"
          >
            {submitState.message}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.submit,
            submitState.kind === 'submitting' && styles.submitDisabled,
          ]}
          onPress={onSubmit}
          disabled={submitState.kind === 'submitting'}
          accessibilityLabel={SESSION_REQUEST_FORM.submit}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitState.kind === 'submitting' }}
          testID="session-request-submit"
        >
          <Text style={styles.submitLabel}>{SESSION_REQUEST_FORM.submit}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bone },
  content: { padding: spacing.lg },
  heading: { ...typography.h2, color: colors.ink, marginBottom: spacing.sm },
  intro: { ...typography.body, color: colors.charcoal, marginBottom: spacing.lg },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  typeChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChipSelected: { backgroundColor: colors.forest, borderColor: colors.forest },
  typeChipLabel: { ...typography.caption, color: colors.charcoal },
  typeChipLabelSelected: { color: colors.bone },
  fieldLabel: { ...typography.eyebrow, color: colors.charcoal, marginBottom: spacing.xs },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.cream,
    borderRadius: 8,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  error: {
    ...typography.body,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
  submit: {
    backgroundColor: colors.forest,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitLabel: { ...typography.bodyMd, color: colors.bone },
  placeholder: {
    margin: spacing.lg,
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
  },
  placeholderTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
});

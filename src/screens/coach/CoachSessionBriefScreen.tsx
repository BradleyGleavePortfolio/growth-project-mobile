// CoachSessionBriefScreen — pre-call brief shell.
//
// Displays only what the backend explicitly marks as "ready". Does not
// fabricate highlights from local data — there is no sessions-side AI in
// this scaffold, by design.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  COACH_BRIEF,
  SESSIONS_DISABLED_PLACEHOLDER,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { SessionBrief } from '../../types/sessions';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'CoachSessionBrief'>;
  route: RouteProp<ClientsStackParamList, 'CoachSessionBrief'>;
};

export default function CoachSessionBriefScreen({ route }: Props) {
  const { sessionId } = route.params;
  const enabled = isSessionsFeatureEnabled('SESSIONS_BRIEF_ENABLED');
  const [brief, setBrief] = useState<SessionBrief | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getSessionsAdapter()
      .getBrief(sessionId)
      .then((b) => {
        if (!alive) return;
        setBrief(b);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled, sessionId]);

  if (!enabled) {
    return (
      <Placeholder
        title={SESSIONS_DISABLED_PLACEHOLDER.title}
        body={SESSIONS_DISABLED_PLACEHOLDER.body}
        testID="coach-brief-disabled"
      />
    );
  }

  if (!loaded) {
    return (
      <Placeholder
        title={COACH_BRIEF.preparingTitle}
        body={COACH_BRIEF.preparingBody}
        testID="coach-brief-loading"
      />
    );
  }

  if (!brief || !brief.isReady) {
    return (
      <Placeholder
        title={brief ? COACH_BRIEF.preparingTitle : COACH_BRIEF.noBriefTitle}
        body={brief ? COACH_BRIEF.preparingBody : COACH_BRIEF.noBriefBody}
        testID="coach-brief-not-ready"
      />
    );
  }

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          {COACH_BRIEF.title}
        </Text>
        <Text style={styles.subtitle}>
          For {brief.clientDisplayName}
        </Text>

        {brief.highlights.length > 0 ? (
          <>
            <Text
              style={styles.sectionLabel}
              accessibilityRole="header"
            >
              Highlights
            </Text>
            {brief.highlights.map((h, i) => (
              <Text
                key={i}
                style={styles.bullet}
                accessible
                accessibilityLabel={h}
              >
                {h}
              </Text>
            ))}
          </>
        ) : null}

        {brief.clientPrepNotes && brief.clientPrepNotes.length > 0 ? (
          <>
            <Text
              style={styles.sectionLabel}
              accessibilityRole="header"
            >
              Client wants to discuss
            </Text>
            {brief.clientPrepNotes.map((n, i) => (
              <Text
                key={i}
                style={styles.bullet}
                accessible
                accessibilityLabel={n}
              >
                {n}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Placeholder(props: { title: string; body: string; testID: string }) {
  return (
    <View style={styles.placeholder} testID={props.testID}>
      <Text style={styles.placeholderTitle}>{props.title}</Text>
      <Text style={styles.placeholderBody}>{props.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bone },
  content: { padding: spacing.lg },
  heading: { ...typography.h2, color: colors.ink, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, color: colors.stone, marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  bullet: { ...typography.body, color: colors.ink, marginBottom: spacing.xs },
  placeholder: {
    flex: 1,
    margin: spacing.lg,
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
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

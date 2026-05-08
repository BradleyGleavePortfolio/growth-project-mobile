// SessionPrepareScreen — calm prompt list shown ahead of a coaching call.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  SESSIONS_DISABLED_PLACEHOLDER,
  SESSION_PREPARE,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { MoreStackParamList } from '../../navigation/ClientNavigator';
import type { SessionPrepPrompt } from '../../types/sessions';

type Props = {
  navigation: NativeStackNavigationProp<MoreStackParamList, 'SessionPrepare'>;
  route: RouteProp<MoreStackParamList, 'SessionPrepare'>;
};

export default function SessionPrepareScreen({ route }: Props) {
  const { sessionId } = route.params;
  const enabled = isSessionsFeatureEnabled('SESSIONS_PREP_ENABLED');
  const [prompt, setPrompt] = useState<SessionPrepPrompt | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getSessionsAdapter()
      .getPrepPrompt(sessionId)
      .then((p) => {
        if (alive) {
          setPrompt(p);
          setAcknowledged(!!p?.acknowledgedAt);
        }
      })
      .catch(() => {
        // Fail-closed — leave prompt null, the placeholder copy applies.
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
        testID="session-prepare-disabled"
      />
    );
  }

  if (acknowledged) {
    return (
      <Placeholder
        title={SESSION_PREPARE.title}
        body={SESSION_PREPARE.acknowledged}
        testID="session-prepare-ack"
      />
    );
  }

  if (!prompt) {
    return (
      <Placeholder
        title={SESSION_PREPARE.title}
        body={SESSION_PREPARE.intro}
        testID="session-prepare-empty"
      />
    );
  }

  async function onAcknowledge() {
    try {
      await getSessionsAdapter().acknowledgePrep(sessionId);
    } catch {
      // Ignore — local optimism is fine; backend will re-issue if needed.
    }
    setAcknowledged(true);
  }

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          {SESSION_PREPARE.title}
        </Text>
        <Text style={styles.intro}>{SESSION_PREPARE.intro}</Text>
        {prompt.prompts.map((line, i) => (
          <View
            key={i}
            style={styles.promptRow}
            accessible
            accessibilityLabel={line}
          >
            <Text style={styles.bullet} accessibilityElementsHidden>•</Text>
            <Text style={styles.promptText}>{line}</Text>
          </View>
        ))}
        <TouchableOpacity
          style={styles.cta}
          onPress={onAcknowledge}
          accessibilityLabel={SESSION_PREPARE.acknowledge}
          accessibilityRole="button"
          testID="session-prepare-ack-btn"
        >
          <Text style={styles.ctaLabel}>{SESSION_PREPARE.acknowledge}</Text>
        </TouchableOpacity>
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
  heading: { ...typography.h2, color: colors.ink, marginBottom: spacing.sm },
  intro: { ...typography.body, color: colors.charcoal, marginBottom: spacing.lg },
  promptRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  bullet: { ...typography.body, color: colors.forest, marginRight: spacing.sm },
  promptText: { ...typography.body, color: colors.ink, flex: 1 },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.forest,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaLabel: { ...typography.bodyMd, color: colors.bone },
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

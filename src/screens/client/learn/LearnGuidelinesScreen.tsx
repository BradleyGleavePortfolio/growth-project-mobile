/**
 * LEARN-A, board 3 right (flag learnHub): the coach's guidelines as written, opened from Learn's Read all
 * and the Train header. Message {coach} is a text action, not a second filled button. #LEARN-LOCK op 1: no
 * lock page; a 402 from a server before LEARN-B is said in today's words, with no plans button.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, QuietTextButton, Screen } from '../../../ui';
import { QuietError, QuietLoading, isConnectionFailure } from '../../../ui/states/QuietStates';
import { LearnBack, LearnText } from './LearnParts';
import { GUIDELINES_PLAN_BODY, GUIDELINES_PLAN_TITLE, learnCopy, updatedOn, useLearn } from './learnData';

export default function LearnGuidelinesScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const learn = useLearn();
  const copy = learnCopy(learn.name);
  const q = learn.guidelinesQuery;
  const g = learn.guidelines;
  const updated = g && g !== 'plan' ? updatedOn(g.updatedAt) : null;
  const openThread = () => (navigation.getParent() ?? navigation).navigate('Home', { screen: 'Messages', initial: false });

  const say = (title: string, text: string, testID: string) => (
    <View testID={testID}>
      <Text style={s.lead}>{title}</Text>
      <Text style={s.muted}>{text}</Text>
    </View>
  );
  let body: React.ReactNode;
  if (learn.user && !learn.coachId) body = say(copy.emptyTitle, copy.emptyBody, 'guidelines-empty');
  else if (q.data === undefined && q.error) {
    body = <QuietError layout="inline" message={isConnectionFailure(q.error) ? `Guidelines did not load. ${copy.noAnswer}` : 'Guidelines did not load.'}
      onRetry={() => void q.refetch()} testID="guidelines-error" />;
  } else if (q.data === undefined) body = <QuietLoading label="Loading" rows={5} testID="guidelines-loading" />;
  else if (g === 'plan') body = say(GUIDELINES_PLAN_TITLE, GUIDELINES_PLAN_BODY, 'guidelines-plan');
  else if (g) body = <LearnText text={g.text} />;
  else body = say(copy.emptyTitle, copy.emptyBody, 'guidelines-empty');

  return (
    <Screen edges={['top']} testID="guidelines-screen"
      footer={learn.coachId ? <QuietTextButton label={copy.message} align="center" onPress={openThread} testID="guidelines-message" /> : undefined}>
      <LearnBack navigation={navigation} />
      <Overline style={s.eyebrow}>{updated ? `${copy.from} · updated ${updated}` : copy.from}</Overline>
      <Text style={s.title} accessibilityRole="header">Your guidelines</Text>
      {body}
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  eyebrow: { marginTop: 12 },
  title: { ...typography.h1, color: sc.textPrimary, marginTop: 8, marginBottom: 12 },
  lead: { ...typography.bodyMd, color: sc.textPrimary, marginBottom: 4 },
  muted: { ...typography.body, color: sc.textMuted },
});

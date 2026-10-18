/**
 * LEARN-A, boards 3 and 11-13 (flag learnHub): what the client's coach wrote. The masthead stays in every
 * state; then the guidelines card, the numbered lessons and one forest button for the next lesson. A 402
 * from a server before LEARN-B is said in today's words in the card, and the lessons stay open.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { CormorantGaramond_400Regular_Italic, useFonts } from '@expo-google-fonts/cormorant-garamond';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, QuietTextButton, Screen, useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading, isConnectionFailure } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { LearnBack, LessonMark } from './LearnParts';
import { GUIDELINES_PLAN_BODY, GUIDELINES_PLAN_TITLE, learnCopy, lessonMeta, updatedOn, useLearn } from './learnData';

const excerpt = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.replace(/^(?:[-*•]|\d+\.)\s*/, '').replace(/\*\*/g, '')).join(' ');

export default function LearnScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const insets = useScreenInsets();
  const online = isEffectivelyOnline(useNetworkStatus());
  const [italic] = useFonts({ CormorantGaramond_400Regular_Italic });
  const learn = useLearn();
  const { lessons, guidelines: g, known, refetch } = learn;
  const copy = learnCopy(learn.name);

  // Offline on first open: the page loads by itself once the phone is back online.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && !known) void refetch();
    wasOnline.current = online;
  }, [online, known, refetch]);

  const open = (id: string) => { void HapticService.selection(); navigation.navigate('LearnLesson', { id }); };
  const openThread = () => (navigation.getParent() ?? navigation).navigate('Home', { screen: 'Messages', initial: false });
  const done = lessons.filter((l) => l.done).length;
  const next = lessons.findIndex((l) => !l.done);
  const updated = g && g !== 'plan' ? updatedOn(g.updatedAt) : null;

  const empty = (
    <View testID="learn-empty">
      <Text style={s.emptyTitle} accessibilityRole="header">{copy.emptyTitle}</Text>
      <Text style={[s.muted, s.emptyBody]}>{copy.emptyBody}</Text>
      {learn.coachId ? <QuietTextButton label={copy.message} onPress={openThread} testID="learn-message" /> : null}
    </View>
  );

  let body: React.ReactNode;
  if (learn.user && !learn.coachId) body = empty;
  else if (!known && !online) body = <Text style={s.offline} testID="learn-offline">{copy.offline}</Text>;
  else if (!known && learn.error) {
    body = <QuietError layout="inline" message={isConnectionFailure(learn.error) ? `${copy.failed} ${copy.noAnswer}` : copy.failed}
      onRetry={() => void refetch()} testID="learn-error" />;
  } else if (!known) body = <QuietLoading label={copy.loading} rows={4} testID="learn-loading" />;
  else if (!learn.hasContent) body = empty;
  else {
    body = (
      <>
        {g ? (
          <View style={s.card} testID="learn-guidelines">
            <Overline style={s.ink}>Your guidelines</Overline>
            {g === 'plan' ? (
              <>
                <Text style={s.planTitle}>{GUIDELINES_PLAN_TITLE}</Text>
                <Text style={s.muted}>{GUIDELINES_PLAN_BODY}</Text>
              </>
            ) : (
              <>
                <Text style={[s.excerpt, italic && s.italic]} numberOfLines={3}>{excerpt(g.text)}</Text>
                <View style={s.cardFoot}>
                  <Text style={s.muted}>{updated ? `Updated ${updated}` : ''}</Text>
                  <QuietTextButton label="Read all" align="end" onPress={() => navigation.navigate('CoachGuidelines')} testID="learn-read-all" />
                </View>
              </>
            )}
          </View>
        ) : null}
        {lessons.length > 0 ? (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Overline>Lessons</Overline>
              <Text style={s.muted}>{`${done} of ${lessons.length} done`}</Text>
            </View>
            <View style={s.track} accessible accessibilityRole="progressbar"
              accessibilityLabel={`${done} of ${lessons.length} lessons complete`} accessibilityValue={{ min: 0, max: lessons.length, now: done }}>
              <View style={[s.trackFill, { flex: done }]} />
              <View style={{ flex: lessons.length - done }} />
            </View>
            <View style={s.list}>
              {lessons.map((l, i) => {
                const meta = lessonMeta(l);
                return (
                  <Pressable key={l.id} onPress={() => open(l.id)} accessibilityRole="button" testID={`learn-lesson-${i + 1}`}
                    accessibilityLabel={`Lesson ${i + 1}, ${l.title}, ${l.done ? 'complete' : 'not complete'}`}
                    style={({ pressed }) => [s.row, i > 0 && s.rowLine, pressed && s.pressed]}>
                    <LessonMark n={i + 1} state={l.done ? 'done' : i === next ? 'next' : 'later'} />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle}>{l.title}</Text>
                      {meta ? <Text style={s.muted}>{meta}</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={sc.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </>
    );
  }

  const footer = known && next >= 0
    ? <PrimaryButton label={`Read lesson ${next + 1}`} onPress={() => navigation.navigate('LearnLesson', { id: lessons[next].id })} testID="learn-next" />
    : undefined;

  return (
    <Screen edges={[]} contentStyle={s.page} footer={footer} testID="learn-screen">
      <View style={[s.masthead, { paddingTop: insets.top + layout.statusBarGap }]}>
        <LearnBack navigation={navigation} onDark />
        <Overline style={[s.mastheadMuted, s.from]}>{copy.from}</Overline>
        <Text style={s.title} accessibilityRole="header">Learn</Text>
        <Text style={[s.lede, s.mastheadMuted]}>{copy.lede}</Text>
      </View>
      <View style={s.body}>{body}</View>
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  page: { paddingHorizontal: 0 },
  masthead: { backgroundColor: sc.surface.masthead, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingHorizontal: layout.gutter, paddingBottom: 28 },
  mastheadMuted: { color: sc.textOnMastheadMuted },
  from: { marginTop: 12 },
  title: { ...typography.h1, color: sc.textOnAccent, marginTop: 6 },
  lede: { ...typography.body, marginTop: 4 },
  body: { paddingHorizontal: layout.gutter, paddingTop: 24 },
  ink: { color: sc.textPrimary },
  muted: { ...typography.bodySmall, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  offline: { ...typography.h2, color: sc.textPrimary },
  emptyTitle: { ...typography.h2, color: sc.textPrimary },
  emptyBody: { ...typography.body, marginTop: 8, marginBottom: 8 },
  card: { backgroundColor: sc.surface.sage, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.surface.sageLine, padding: 20, gap: 8 },
  planTitle: { ...typography.bodyMd, color: sc.textPrimary },
  excerpt: { ...typography.h3, fontFamily: typography.h2.fontFamily, fontWeight: '400', lineHeight: 26, color: sc.textPrimary },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  section: { marginTop: 28 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 },
  track: { flexDirection: 'row', height: 4, borderRadius: radius.chip, backgroundColor: sc.data.trackLight, overflow: 'hidden', marginTop: 10, marginBottom: 14 },
  trackFill: { backgroundColor: sc.data.forest },
  list: { backgroundColor: sc.bgSurface, borderRadius: radius.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  rowText: { flex: 1 },
  rowTitle: { ...typography.bodyMd, color: sc.textPrimary },
  pressed: { opacity: 0.7 },
});

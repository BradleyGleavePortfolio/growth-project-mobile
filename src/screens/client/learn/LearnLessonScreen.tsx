/**
 * LEARN-A, boards 4 and 13 right (flag learnHub): one lesson and Mark as complete. Done shows only after
 * the server saves it (300 ms fade, none with Reduce Motion; success haptic) and the closure names the
 * next lesson. A failed save keeps today's sentence above the button, with one error haptic.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackActions, useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, PrimaryButton, QuietTextButton, Screen } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { lessonsApi } from '../../../services/api';
import { LearnBack, LearnText, LessonMark } from './LearnParts';
import { learnCopy, lessonMeta, useLearn } from './learnData';

export default function LearnLessonScreen() {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { id } = (useRoute().params ?? {}) as { id?: string };
  const reduced = useReducedMotion();
  const learn = useLearn();
  const copy = learnCopy(learn.name);
  const { lessons } = learn;
  const total = lessons.length;
  const index = lessons.findIndex((l) => l.id === id);
  const lesson = index >= 0 ? lessons[index] : null;
  const after = lessons.findIndex((l, i) => !l.done && i !== index);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  const complete = async () => {
    if (!lesson || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await lessonsApi.complete(lesson.id);
      fade.setValue(reduced ? 1 : 0);
      learn.markDone(lesson.id);
      void HapticService.success();
      if (!reduced) Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } catch {
      setSaveError('Lesson completion did not save. Check your connection and try again.');
      void HapticService.error();
    } finally {
      setSaving(false);
    }
  };
  const openLink = (url: string, kind: 'video' | 'article') => {
    setLinkError(null);
    Linking.openURL(url).catch(() => setLinkError(`The lesson ${kind} could not open. Try the link again.`));
  };
  const openNext = () => { void HapticService.selection(); navigation.dispatch(StackActions.replace('LearnLesson', { id: lessons[after].id })); };

  if (!lesson) {
    return (
      <Screen edges={['top']} testID="lesson-screen">
        <LearnBack navigation={navigation} />
        <View style={s.state}>
          {learn.error ? <QuietError layout="inline" message={copy.failed} onRetry={() => void learn.refetch()} />
            : learn.known ? <Text style={s.title}>{copy.emptyTitle}</Text>
            : <QuietLoading label={copy.loading} rows={4} />}
        </View>
      </Screen>
    );
  }

  const meta = lessonMeta(lesson);
  const footer = lesson.done ? undefined : (
    <View style={s.footer}>
      {saveError ? <Text style={s.ink} accessibilityRole="alert" testID="lesson-save-error">{saveError}</Text> : null}
      <PrimaryButton label={saving ? 'Saving completion…' : 'Mark as complete'} loading={saving} onPress={() => void complete()} testID="lesson-complete" />
    </View>
  );

  return (
    <Screen edges={['top']} footer={footer} testID="lesson-screen">
      <LearnBack navigation={navigation} />
      <Overline style={s.eyebrow}>{copy.lessonOf(index + 1, total)}</Overline>
      <Text style={s.title} accessibilityRole="header">{lesson.title}</Text>
      {meta ? <Text style={s.muted}>{meta}</Text> : null}
      <View style={s.rule} />
      {lesson.text ? <LearnText text={lesson.text} /> : null}
      {lesson.videoUrl ? <QuietTextButton role="link" label="Watch lesson" onPress={() => openLink(lesson.videoUrl as string, 'video')} /> : null}
      {lesson.articleUrl ? <QuietTextButton role="link" label="Read article" onPress={() => openLink(lesson.articleUrl as string, 'article')} /> : null}
      {!lesson.text && !lesson.videoUrl && !lesson.articleUrl ? <Text style={s.ink}>No lesson content or links are available.</Text> : null}
      {linkError ? <Text style={s.ink} accessibilityRole="alert">{linkError}</Text> : null}
      {lesson.done ? (
        <Animated.View style={[s.closure, { opacity: fade }]} testID="lesson-closure">
          <View style={s.closureRow} accessible accessibilityLiveRegion="polite">
            <LessonMark state="done" />
            <Text style={[s.closureText, s.fill]}>{after < 0 ? copy.allDone(total) : `Lesson ${index + 1} of ${total} complete.`}</Text>
          </View>
          {after >= 0 ? (
            <Pressable onPress={openNext} accessibilityRole="button" testID="lesson-next"
              style={({ pressed }) => [s.closureRow, s.line, pressed && s.pressed]}>
              <View style={s.fill}>
                <Text style={s.next}>{`Next: ${lessons[after].title}`}</Text>
                <Text style={s.muted}>{[`Lesson ${after + 1} of ${total}`, lessonMeta(lessons[after])].filter(Boolean).join(' · ')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={sc.textMuted} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  state: { marginTop: 16 },
  eyebrow: { marginTop: 12 },
  title: { ...typography.h1, color: sc.textPrimary, marginTop: 8 },
  muted: { ...typography.bodySmall, color: sc.textMuted, marginTop: 2 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: sc.border, marginTop: 16, marginBottom: 20 },
  ink: { ...typography.bodySmall, color: sc.textPrimary },
  footer: { gap: layout.footerItemGap },
  closure: { marginTop: 20, backgroundColor: sc.bgSurface, borderRadius: radius.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  closureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: layout.rowMinHeight, paddingHorizontal: 16, paddingVertical: 12 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  closureText: { ...typography.bodyMd, color: sc.textPrimary },
  next: { ...typography.bodyMd, color: sc.accentText },
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
});

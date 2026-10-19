/**
 * LEARN-B (#LEARN-LESSONS op 1): the coach's Lessons editor in Programs.
 * A row opens one sheet: the lessons in the order clients read them in Learn,
 * then a lesson's title, text and optional video link. Move up / down sets the
 * order; Delete (with a confirm) uses DELETE /lessons/:id, which only the
 * coach who wrote the lesson may call. Behind featureFlags.coachLessons (off).
 */
import React, { useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import FadeInView from '../../components/FadeInView';
import { featureFlags } from '../../config/featureFlags';
import { lessonsApi } from '../../services/api';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import { Headline, Lede, PrimaryButton, QuietRow, Screen, ScreenTopBar, TextLink } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';

export interface CoachLesson {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  order_index: number;
}
type Draft = { title: string; text: string; video: string };
type Editing = CoachLesson | 'new' | null;

const KEY = ['lessons', 'coach'] as const;
const LEDE = 'Your clients read these in Learn.';

/** A web link the client app opens; a bare "youtu.be/x" gets https:// in front. */
export function videoLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return '';
  const link = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(link) && link.length <= 500 ? link : null;
}

/** The list after moving one lesson, and the order writes that make the server agree. */
export function moveLesson(list: CoachLesson[], index: number, by: -1 | 1) {
  const to = index + by;
  if (to < 0 || to >= list.length) return null;
  const swapped = [...list];
  [swapped[index], swapped[to]] = [swapped[to], swapped[index]];
  const ordered = swapped.map((l, i) => ({ ...l, order_index: i }));
  const was = new Map(list.map((l) => [l.id, l.order_index]));
  return { ordered, writes: ordered.filter((l) => was.get(l.id) !== l.order_index) };
}

/** Programs row; renders nothing while the flag is off. */
export function CoachLessonsEntry(): React.ReactElement | null {
  return featureFlags.coachLessons ? <LessonsEntry /> : null;
}

function useLessons() {
  return useQuery({ queryKey: KEY, queryFn: async () => (await lessonsApi.getAll()).data as CoachLesson[] });
}

function LessonsEntry() {
  const { semanticColors: sc } = useTheme();
  const [open, setOpen] = useState(false);
  const count = useLessons().data?.length;
  return (
    <>
      <QuietRow
        label="Lessons"
        detail={LEDE}
        value={count ? String(count) : undefined}
        onPress={() => setOpen(true)}
        style={[styles.entry, { borderTopColor: sc.border }]}
        testID="coach-lessons-entry"
      />
      <LessonsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function LessonsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { semanticColors: sc } = useTheme();
  const qc = useQueryClient();
  const lessons = useLessons();
  const list = lessons.data ?? [];
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<Draft>({ title: '', text: '', video: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const failed = (message: string) => {
    void HapticService.error();
    return message;
  };

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (editing === 'new' || !editing ? await lessonsApi.create(body) : await lessonsApi.update(editing.id, body)).data as CoachLesson,
    onSuccess: (saved) => {
      void HapticService.success();
      setSavedId(saved.id);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => setProblem(failed('The lesson did not save. Try again.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => lessonsApi.remove(id),
    onSuccess: () => {
      void HapticService.success();
      setEditing(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => setProblem(failed('The lesson was not deleted. Try again.')),
  });
  const reorder = useMutation({
    mutationFn: (writes: CoachLesson[]) => Promise.all(writes.map((l) => lessonsApi.update(l.id, { order_index: l.order_index }))),
    onError: () => setNotice(failed('The new order did not save. Try again.')),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const edit = (l: CoachLesson | 'new') => {
    setDraft(l === 'new' ? { title: '', text: '', video: '' } : { title: l.title, text: l.description ?? '', video: l.video_url ?? '' });
    setProblem(null);
    setNotice(null);
    setEditing(l);
  };
  const dirty =
    editing !== null &&
    (editing === 'new'
      ? !!(draft.title.trim() || draft.text.trim() || draft.video.trim())
      : draft.title !== editing.title || draft.text !== (editing.description ?? '') || draft.video !== (editing.video_url ?? ''));
  const back = () => {
    if (save.isPending || remove.isPending) return;
    if (!editing) {
      setNotice(null);
      return onClose();
    }
    if (!dirty) return setEditing(null);
    Alert.alert('Discard lesson changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: () => setEditing(null) },
    ]);
  };
  const submit = () => {
    const link = videoLink(draft.video);
    const issue = !draft.title.trim() ? 'Add a title.' : link === null ? 'That video link does not look right. Check it, or leave it empty.' : null;
    if (issue) {
      void HapticService.warning();
      return setProblem(issue);
    }
    setProblem(null);
    const body = { title: draft.title.trim(), description: draft.text.trim(), video_url: link || null };
    save.mutate(editing === 'new' ? { ...body, order_index: Math.max(-1, ...list.map((l) => l.order_index)) + 1 } : body);
  };
  const confirmDelete = (l: CoachLesson) => {
    void HapticService.warning();
    Alert.alert('Delete this lesson?', 'Your clients will no longer see it.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(l.id) },
    ]);
  };
  const move = (index: number, by: -1 | 1) => {
    const next = moveLesson(list, index, by);
    if (!next || reorder.isPending) return;
    void HapticService.selection();
    setNotice(null);
    void qc.cancelQueries({ queryKey: KEY });
    qc.setQueryData(KEY, next.ordered);
    reorder.mutate(next.writes);
  };

  const field = [styles.input, { color: sc.textPrimary, borderColor: sc.border }];
  const label = [styles.label, { color: sc.textMuted }];
  const edges = Platform.OS === 'ios' ? (['bottom'] as const) : (['top', 'bottom'] as const);

  const sheet = (body: React.ReactElement) => (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={back}>
      {body}
    </Modal>
  );

  if (editing) {
    const existing = editing === 'new' ? null : editing;
    return sheet(
      <Screen
        edges={edges}
        testID="coach-lesson-editor"
        header={<ScreenTopBar onBack={back} testID="coach-lesson-editor-bar" />}
        footer={
          <>
            <PrimaryButton label="Save" onPress={submit} loading={save.isPending} disabled={remove.isPending} testID="coach-lesson-save" />
            {existing ? (
              <TextLink label="Delete lesson" onPress={() => confirmDelete(existing)} disabled={save.isPending || remove.isPending} testID="coach-lesson-delete" />
            ) : null}
          </>
        }
      >
        <Headline level="h2">{existing ? 'Edit lesson' : 'New lesson'}</Headline>
        <Text style={label}>Title</Text>
        <TextInput value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={300} accessibilityLabel="Title" style={field} testID="coach-lesson-title" />
        <Text style={label}>Text</Text>
        <TextInput value={draft.text} onChangeText={(text) => setDraft({ ...draft, text })} maxLength={5000} multiline accessibilityLabel="Text" style={[field, styles.body]} testID="coach-lesson-text" />
        <Text style={label}>Video link (optional)</Text>
        <TextInput
          value={draft.video}
          onChangeText={(video) => setDraft({ ...draft, video })}
          maxLength={500}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://"
          placeholderTextColor={sc.textMuted}
          accessibilityLabel="Video link (optional)"
          style={field}
          testID="coach-lesson-video"
        />
        {problem ? <QuietError layout="inline" message={problem} testID="coach-lesson-problem" /> : null}
      </Screen>,
    );
  }

  const loaded = lessons.data !== undefined;
  return sheet(
    <Screen
      edges={edges}
      testID="coach-lessons"
      header={
        <ScreenTopBar
          trailing={
            <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.icon} testID="coach-lessons-close">
              <Ionicons name="close" size={24} color={sc.textPrimary} />
            </Pressable>
          }
        />
      }
      footer={loaded ? <PrimaryButton label="Add lesson" onPress={() => edit('new')} testID="coach-lessons-add" /> : undefined}
    >
      <Headline level="h2">Lessons</Headline>
      <Lede size="small">{LEDE}</Lede>
      <View style={styles.list}>
        {lessons.isPending ? <QuietLoading label="Loading lessons" testID="coach-lessons-loading" /> : null}
        {lessons.isError && !loaded ? (
          <QuietError message={loadFailureMessage(lessons.error, 'Your lessons')} onRetry={() => void lessons.refetch()} retrying={lessons.isFetching} testID="coach-lessons-error" />
        ) : null}
        {loaded && list.length === 0 ? (
          <Text style={[typography.body, { color: sc.textMuted }]} testID="coach-lessons-empty">No lessons yet.</Text>
        ) : null}
        {notice ? <QuietError layout="inline" message={notice} testID="coach-lessons-notice" /> : null}
        {list.map((l, i) => {
          const row = (
            <View key={l.id} style={[styles.row, { borderBottomColor: sc.border }]} testID={`coach-lesson-${l.id}`}>
              <Pressable
                onPress={() => edit(l)}
                accessibilityRole="button"
                accessibilityLabel={`${i + 1}. ${l.title}`}
                accessibilityHint="Opens the lesson to edit"
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                testID={`coach-lesson-open-${l.id}`}
              >
                <Text style={[styles.num, { color: sc.textMuted }]}>{i + 1}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.title, { color: sc.textPrimary }]} numberOfLines={2}>{l.title}</Text>
                  {l.description ? <Text style={[styles.detail, { color: sc.textMuted }]} numberOfLines={1}>{l.description}</Text> : null}
                </View>
                {l.video_url ? <Ionicons name="play-circle-outline" size={20} color={sc.textMuted} accessible={false} /> : null}
              </Pressable>
              {list.length > 1
                ? ([[-1, 'arrow-up', 'up'], [1, 'arrow-down', 'down']] as const).map(([by, icon, word]) =>
                    (by === -1 ? i === 0 : i === list.length - 1) ? (
                      <View key={word} style={styles.icon} />
                    ) : (
                      <Pressable
                        key={word}
                        onPress={() => move(i, by)}
                        disabled={reorder.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${l.title} ${word}`}
                        style={({ pressed }) => [styles.icon, (pressed || reorder.isPending) && styles.pressed]}
                        testID={`coach-lesson-${word}-${l.id}`}
                      >
                        <Ionicons name={icon} size={20} color={sc.textMuted} />
                      </Pressable>
                    ),
                  )
                : null}
            </View>
          );
          return l.id === savedId ? <FadeInView key={l.id} duration={240}>{row}</FadeInView> : row;
        })}
      </View>
    </Screen>,
  );
}

const styles = StyleSheet.create({
  entry: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  list: { marginTop: layout.sectionGap, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: layout.touchMin },
  rowText: { flex: 1 },
  num: { ...typography.bodySmall, minWidth: 18, fontVariant: ['tabular-nums'] },
  title: { ...typography.body, lineHeight: 22 },
  detail: { ...typography.bodySmall, marginTop: 2 },
  icon: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  label: { ...typography.caption, marginTop: 20, marginBottom: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, ...typography.body },
  body: { minHeight: 160, textAlignVertical: 'top' },
});

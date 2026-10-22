/**
 * A client's Copilot plan change in the coach's Roman drafts list (style A frame 06). The coach decides; Roman never
 * applies anything. Approve applies Roman's change as it is. Edit changes the one field (the day, or the kcal) and the
 * server applies it on the live plan (the refreshed baseline), so after "the plan changed" Edit still works. Decline
 * keeps the plan and may carry a one-line note the client sees (#CP-NOTE, #CP-DECLINE).
 */
import React, { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, layout, pathTint, radius, typography } from '../../../theme/tokens';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import AiRefusalNotice from '../../../components/ai/AiRefusalNotice';
import { aiRefusalOf, type AiRefusal } from '../../../lib/ai/aiRefusal';
import { copilotApi, copilotErrorOf, type DecideBody, type PathChangeDraft } from '../../../api/copilotApi';
import { ChangeTiles } from '../../client/copilot/ChangeTiles';
import { COPILOT_COPY as C, describeChange, kcalText, shortDay, when } from '../../client/copilot/pathChangeWords';

const DAY = 86_400_000;
const NOTE_MAX = 200;
/** The client's own move window (backend #1120): 2 days back to 7 days ahead of now. */
const inWindow = (t: number, now: number) => t > now - 2 * DAY && t < now + 7 * DAY;
/** Whole days that bring Roman's day inside the window, so an older draft's Edit starts there (0 when already in). */
const intoWindow = (t: number, now: number) =>
  t <= now - 2 * DAY ? Math.floor((now - 2 * DAY - t) / DAY) + 1 : t >= now + 7 * DAY ? -Math.floor((t - now - 7 * DAY) / DAY) - 1 : 0;
const kcalOk = (v: string) => /^\d{3,4}$/.test(v) && Number(v) >= 800 && Number(v) <= 7000;

export interface PathChangeDraftCardProps {
  draft: PathChangeDraft;
  /** The client's full name from the coach's roster, or null while it loads. */
  clientName: string | null;
  onDecided: () => void;
  decide?: (id: string, body: DecideBody) => Promise<void>;
  now?: () => number;
}

type Mode = 'view' | 'edit' | 'decline';

export function PathChangeDraftCard({ draft, clientName, onDecided, decide = copilotApi.decide, now = Date.now }: PathChangeDraftCardProps) {
  const { semanticColors: sc } = useTheme();
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<AiRefusal | null>(null);
  const [planChanged, setPlanChanged] = useState(false);
  const [gone, setGone] = useState(false);
  const toAt = draft.change.kind === 'move_session' ? Date.parse(draft.change.to_at) : 0;
  const [start] = useState(() => intoWindow(toAt, now()));
  const [days, setDays] = useState(start);
  const [kcal, setKcal] = useState(draft.change.kind === 'set_calorie_target' ? String(Math.round(draft.change.to_kcal)) : '');
  const [note, setNote] = useState('');

  const c = draft.change;
  const d = describeChange(c);
  const name = clientName?.trim() || C.yourClient;
  const first = clientName?.trim().split(/\s+/)[0] || C.yourClient.toLowerCase();
  const initials = (clientName ?? '').trim().split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
  const movedAt = c.kind === 'move_session' ? toAt + days * DAY : 0;
  /** Roman's day slipped out of the window: Approve as is would be refused; Edit (starting inside) and Decline stay. */
  const outOfWindow = c.kind === 'move_session' && !inWindow(toAt, now());

  const go = async (body: DecideBody) => {
    setBusy(true);
    setLine(null);
    setRefusal(null);
    try {
      await decide(draft.id, body);
      void HapticService.success();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      onDecided();
    } catch (err) {
      void HapticService.error();
      const r = aiRefusalOf(err);
      const e = copilotErrorOf(err);
      // Decided elsewhere or the client left (404, or a 403 that is not AI help off): gone, the list reloads.
      const decidedElsewhere = !r && (e.status === 404 || e.status === 403);
      if (r) setRefusal(r);
      else if (!decidedElsewhere) setLine((e.code?.startsWith('COPILOT_') || e.status === 400) && e.message ? e.message : C.failed);
      if (e.code === 'COPILOT_PLAN_CHANGED') setPlanChanged(true);
      if (decidedElsewhere || e.code === 'COPILOT_SUGGESTION_EXPIRED') setGone(true);
      if (decidedElsewhere) onDecided();
    } finally {
      setBusy(false);
    }
  };

  const approveEdit = () =>
    void go({ decision: 'approved', payload: c.kind === 'move_session' ? { to_at: new Date(movedAt).toISOString() } : { to_kcal: Number(kcal) } });
  const decline = () => void go({ decision: 'rejected', ...(note.trim() ? { note: note.trim() } : null) });
  const field = { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface };

  const editTo = c.kind === 'move_session' ? shortDay(new Date(movedAt)) : kcalText(Number(kcal));
  const editor = c.kind === 'move_session' ? (
    <View style={s.steps}>
      <Step icon="chevron-back" label={C.earlier} disabled={!inWindow(movedAt - DAY, now())} onPress={() => setDays((n) => n - 1)} />
      <Step icon="chevron-forward" label={C.later} disabled={!inWindow(movedAt + DAY, now())} onPress={() => setDays((n) => n + 1)} />
    </View>
  ) : (
    <TextInput value={kcal} onChangeText={(v) => setKcal(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" accessibilityLabel={C.newTarget}
      style={[typography.bodyMd, s.input, field]} testID="path-draft-kcal" />
  );

  return (
    <View style={[s.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} testID={`path-draft-${draft.id}`}>
      <View style={s.who}>
        {initials ? (
          <View style={[s.avatar, { backgroundColor: forestPop.deep }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={[typography.bodySmall, s.value, { color: forestPop.gold }]}>{initials}</Text>
          </View>
        ) : null}
        <View style={s.flex}>
          <Text style={[typography.bodyMd, s.value, { color: sc.textPrimary }]} accessibilityRole="header">{name}</Text>
          <Text style={[typography.caption, { color: sc.textMuted }]}>{C.askedBy(first, when(draft.sentAt, new Date(now())))}</Text>
        </View>
      </View>
      <View style={[s.panel, { backgroundColor: pathTint.still }]}>
        <Text style={[typography.h4, { color: sc.textPrimary }]}>{d.title}</Text>
        <ChangeTiles from={d.from} to={mode === 'edit' ? editTo : d.to} inset />
        {mode === 'edit' ? editor : null}
        {draft.reason ? (
          <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>
            <Text style={s.value}>{C.reason}</Text>{` ${draft.reason}`}
          </Text>
        ) : null}
      </View>
      <View style={s.mark} accessible accessibilityLabel={C.drafted}>
        <RomanAvatar crop="neutral" size={20} />
        <Text style={[typography.caption, s.italic, { color: sc.textMuted }]}>{C.drafted}</Text>
      </View>
      {refusal ? <AiRefusalNotice refusal={refusal} audience="coach" surface="draft" onRetry={() => setRefusal(null)} compact /> : null}
      {line ? <Text style={[typography.bodySmall, { color: forestPop.error }]} accessibilityRole="alert" testID="path-draft-error">{line}</Text> : null}
      {mode === 'decline' ? (
        <TextInput value={note} onChangeText={(v) => setNote(v.replace(/[\r\n]+/g, ' '))} maxLength={NOTE_MAX} placeholder={C.notePlaceholder(first)}
          placeholderTextColor={sc.textMuted} returnKeyType="done" accessibilityLabel={C.notePlaceholder(first)} style={[typography.body, s.input, s.note, field]} testID="path-draft-note"
          multiline submitBehavior="blurAndSubmit" />
      ) : null}
      {gone ? null : mode === 'view' ? (
        <>
          <View style={s.actions}>
            {planChanged || outOfWindow ? null : <PrimaryButton label={C.approve} onPress={() => void go({ decision: 'approved' })} loading={busy} haptic={false} style={s.flex} testID="path-draft-approve" />}
            <Pressable onPress={() => setMode('edit')} disabled={busy} accessibilityRole="button" style={[s.outline, s.flex, { borderColor: sc.textPrimary }]} testID="path-draft-edit">
              <Text style={[typography.bodyMd, s.value, { color: sc.textPrimary }]}>{C.edit}</Text>
            </Pressable>
          </View>
          <TextLink label={C.decline} onPress={() => setMode('decline')} tone="muted" disabled={busy} testID="path-draft-decline" />
        </>
      ) : (
        <View style={s.actions}>
          <PrimaryButton label={mode === 'edit' ? C.approve : C.decline} onPress={mode === 'edit' ? approveEdit : decline} loading={busy} haptic={false}
            disabled={mode === 'edit' && (c.kind === 'set_calorie_target' ? !kcalOk(kcal) : !inWindow(movedAt, now()))} style={s.flex} testID="path-draft-confirm" />
          <TextLink label={C.cancel} onPress={() => { setMode('view'); setDays(start); }} tone="muted" disabled={busy} testID="path-draft-cancel" />
        </View>
      )}
    </View>
  );
}

function Step({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  const back = icon === 'chevron-back';
  return (
    <Pressable onPress={() => { void HapticService.selection(); onPress(); }} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
      style={[s.outline, s.flex, s.step, { borderColor: forestPop.moss }, disabled && s.off]} testID={back ? 'path-draft-earlier' : 'path-draft-later'}>
      {back ? <Ionicons name={icon} size={16} color={forestPop.forest} /> : null}
      <Text style={[typography.bodySmall, s.value, { color: sc.textPrimary }]}>{label}</Text>
      {back ? null : <Ionicons name={icon} size={16} color={forestPop.forest} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  value: { fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  panel: { borderRadius: radius.button, padding: 12, gap: 10 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Stretch: Earlier day and Later day keep one height when a label wraps at large text.
  steps: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  outline: { minHeight: layout.buttonHeight, paddingHorizontal: 18, borderWidth: 1, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.button, paddingHorizontal: 12 },
  // One line to the server (line breaks are dropped as typed), wrapped on screen so the whole note shows.
  note: { paddingTop: 11, paddingBottom: 11, textAlignVertical: 'top' },
  step: { flexDirection: 'row', gap: 4, minHeight: 44, paddingHorizontal: 10 },
  off: { opacity: 0.35 },
});

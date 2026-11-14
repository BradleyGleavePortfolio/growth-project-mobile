/**
 * CHECKIN-DRAFT-M (owner #203-E13, #203-E14; ctx#503 CHECKIN-DRAFT frames, layouts A and B): Roman's reply to one
 * client's check-in, on Roman's deep-head sheet (DraftSheets' K3 look). Opened from the check-in row it asks Roman
 * once (POST /ai/gateway/invoke with check_in_id; the server writes everything Roman reads); opened from Roman's
 * drafts list it starts at the draft. The coach can edit the words; nothing reaches the client until his Send on
 * this sheet, for the draft on screen, with the words on screen (PATCH /ai/gateway/drafts/:id). No retry, reconnect
 * or timer sends or asks by itself. Not now rejects the draft; the scrim and Back leave it waiting in the list.
 * Its state lives and dies with the sheet, which lives in one client's file (ClientDetailScreen keys it by client).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { coachApi } from '../../../services/api';
import { coachAiExecutionApi } from '../../../api/coachAiExecutionApi';
import { REPORT_WIRE_REASON, type ReportReason } from '../../../api/messagesApi';
import ReportMessageSheet from '../../../components/messaging/ReportMessageSheet';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors as palette, forestPop, neutral, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { askRomanToDraft } from '../home-v11/DraftSheets';
import { SEMI, styleA } from '../home-v11/HomeParts';
import { RomanMark } from '../home-v11/RomanMark';
import { sheetDayLine } from '../checkInDrafts';
import { checkInDraftFields, checkInSubtitle } from './useClientDetailData';
import type { CheckInDraftFields } from './types';

/** Reused words (DraftSheets.tsx:135, :142, :176) and the approved new lines (ctx#503 CD-41, CD-49, CD-55, CD-60, CD-61). */
const CANNOT = "Roman can't write this right now. Nothing was sent.";
const COULD_NOT = "Roman couldn't write this. Nothing was sent. Try again in a moment.";
const READ_FIRST = 'You read it before it goes. Nothing is sent until you tap Send.';
const OFFLINE_ASK = 'You’re offline. Connect to ask Roman for a draft. Nothing was sent.';
const OFFLINE_DRAFT = 'You’re offline. Your edits are still here. Connect before sending.';
const EDITS_STAY = 'Your edits stay here until you tap Send.';
/** The server's edit rule (backend coach-message.materialiser.ts): 1 to 4,000 characters, trimmed. */
const MAX_BODY = 4000;
/** An invoke the server refused (b#1234 CONTRACT): asking again would get the same answer, so no Try again. */
const REFUSED = new Set([400, 402, 403, 404, 422]);

type Step = 'idle' | 'writing' | 'refused' | 'failed' | 'ready' | 'editing' | 'sending' | 'sent';
interface Draft { draftId: string; roman: string; text: string }

const statusOf = (err: unknown): number | undefined => (err as { response?: { status?: number } })?.response?.status;
/** A repeat's 403 "Draft already approved": the first Send went through (ai-approval.service.ts decide). */
const alreadyApproved = (err: unknown) =>
  statusOf(err) === 403 && /already approved/i.test(String((err as { response?: { data?: { message?: unknown } } }).response?.data?.message ?? ''));

export interface CheckInDraftSheetProps {
  clientId: string;
  /** The client's name as the coach's file or roster shows it (the chip); `first` heads the sheet. */
  clientName: string;
  first: string;
  checkInId: string;
  /** YYYY-MM-DD. */
  day: string;
  /** The check-in from the Timeline (layout A). Left out (layout B): the sheet reads that day's check-ins. */
  source?: CheckInDraftFields;
  /** Opened from Roman's drafts list (layout B): the draft, so the sheet starts at ready and asks Roman nothing. */
  draft?: { draftId: string; body: string };
  onClose: () => void;
}

export function CheckInDraftSheet({ clientId, clientName, first, checkInId, day, source, draft: given, onClose }: CheckInDraftSheetProps) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { bottom } = useScreenInsets();
  const qc = useQueryClient();
  const online = isEffectivelyOnline(useNetworkStatus());
  const [step, setStep] = useState<Step>(given ? 'ready' : 'idle');
  const [draft, setDraft] = useState<Draft | null>(given ? { draftId: given.draftId, roman: given.body, text: given.body } : null);
  const [editText, setEditText] = useState('');
  const [sendFailed, setSendFailed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [read, setRead] = useState<CheckInDraftFields | null | 'loading'>(source ?? 'loading');
  const alive = useRef(true);
  const busy = useRef(false); // one invoke or one Send at a time
  useEffect(() => () => { alive.current = false; }, []);
  const changed = useCallback(() => { void qc.invalidateQueries({ queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY }); }, [qc]);

  const ask = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStep('writing');
    try {
      const d = await askRomanToDraft({ capability: 'draft.coach_message', subject_user_id: clientId, message: '', check_in_id: checkInId });
      if (!alive.current) return;
      if (d) setDraft({ draftId: d.draftId, roman: d.reply, text: d.reply });
      setStep(d ? 'ready' : 'refused');
    } catch (err) {
      if (alive.current) setStep(REFUSED.has(statusOf(err) ?? 0) ? 'refused' : 'failed');
    } finally {
      busy.current = false;
    }
  }, [clientId, checkInId]);

  // Opened from the row: one ask, only if online now; offline waits for the coach's own tap (never on reconnect).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || given) return;
    asked.current = true;
    if (online) void ask();
  }, [ask, given, online]);

  // Opened from the list: that day's check-ins, the one this draft replies to. Not found or no answer: no panel.
  useEffect(() => {
    if (source) return;
    let live = true;
    coachApi.getClientCheckIns(clientId, { from: day, to: day })
      .then((res: { data?: unknown }) => {
        const row = Array.isArray(res?.data) ? (res.data as { id?: unknown }[]).find((r) => r?.id === checkInId) : undefined;
        if (live) setRead(row ? checkInDraftFields(row as Parameters<typeof checkInDraftFields>[0]) : null);
      })
      .catch(() => { if (live) setRead(null); });
    return () => { live = false; };
  }, [source, clientId, checkInId, day]);

  const send = async () => {
    if (!draft || busy.current || !online) return;
    busy.current = true;
    setSendFailed(false);
    setStep('sending');
    const edited = draft.text !== draft.roman;
    try {
      await coachAiExecutionApi.approveDraft(draft.draftId, undefined, edited ? { body: draft.text.trim() } : undefined);
      if (alive.current) setStep('sent');
    } catch (err) {
      if (!alive.current) return;
      const status = statusOf(err);
      if (alreadyApproved(err)) setStep('sent');
      else if (status === 404 || status === 403) setStep('refused');
      else { setSendFailed(true); setStep('ready'); }
    } finally {
      busy.current = false;
      changed();
    }
  };

  // Not now turns the draft down (the existing rejection), as Home's sheets do.
  const notNow = () => {
    if (step === 'writing' || step === 'sending') return;
    if (draft && step !== 'sent') void coachAiExecutionApi.rejectDraft(draft.draftId).catch(() => undefined).finally(changed);
    onClose();
  };
  // The scrim and Back leave the draft waiting in Roman's drafts list; in the editor they go back to the review text.
  const dismiss = () => {
    if (step === 'writing' || step === 'sending') return;
    if (step === 'editing') { setStep('ready'); return; }
    onClose();
  };
  const startEdit = () => { if (draft) { setEditText(draft.text); setStep('editing'); } };
  const saveEdit = () => {
    const t = editText.trim();
    if (!draft || !t) return;
    setDraft({ ...draft, text: t });
    setStep('ready');
  };
  const submitReport = async ({ reason }: { reason: ReportReason }) => {
    if (!draft) return;
    try {
      await coachAiExecutionApi.reportDraft(draft.draftId, REPORT_WIRE_REASON[reason]);
    } finally {
      changed();
    }
    if (!alive.current) return;
    setReporting(false);
    Alert.alert('Reported', 'Your report has been submitted.');
  };

  const hasDraft = !!draft && (step === 'ready' || step === 'sending');
  const title = step === 'sent' ? `Sent to ${first}` : step === 'editing' ? 'Edit your reply' : hasDraft ? `Roman's draft for ${first}` : `Reply to ${first}`;
  const edited = !!draft && draft.text !== draft.roman;
  const panel = step === 'sent' || read === 'loading' || read === null ? null : (
    <View style={s.source} testID="checkin-draft-source">
      <Text style={s.sourceHead}>{read.note ? `${first}’s check-in` : 'No written note'}</Text>
      <Text style={s.sourceText}>{read.note ?? checkInSubtitle({ mood: read.mood, energy: read.energy, sleep_hours: read.sleepHours })}</Text>
    </View>
  );
  const banner = hasDraft && !online ? OFFLINE_DRAFT : hasDraft && sendFailed ? `Not sent to ${first}. Try again.` : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={s.scrim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close" testID="checkin-draft-scrim" />
        <View style={[s.sheet, { paddingBottom: bottom + 12 }]} testID="checkin-draft-sheet">
          <View style={s.head}>
            <View style={s.grab} />
            <View style={s.headMark}>
              <RomanMark size={32} r={17} gap={2} />
              <Text style={s.headName} accessibilityElementsHidden importantForAccessibility="no">{'Roman'.toUpperCase()}</Text>
            </View>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            {step === 'sent' ? null : (
              <View style={s.chip}>
                <Ionicons name="chatbubble-outline" size={16} color={styleA.onDeep} />
                <View style={s.chipText}>
                  <Text style={s.chipLine}>{`${clientName} · Check-in`}</Text>
                  <Text style={s.chipLine}>{sheetDayLine(day)}</Text>
                </View>
              </View>
            )}
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
            {panel}
            {step === 'writing' ? (
              <View accessibilityLiveRegion="polite">
                <Text style={s.writing}>Roman is writing</Text>
                <View style={[s.bar, { width: '100%' }]} /><View style={[s.bar, { width: '92%' }]} /><View style={[s.bar, { width: '60%' }]} />
                <Text style={s.muted}>{READ_FIRST}</Text>
              </View>
            ) : null}
            {step === 'idle' && !online ? <Text style={s.line} accessibilityLiveRegion="polite">{OFFLINE_ASK}</Text> : null}
            {step === 'refused' ? (
              <View accessibilityLiveRegion="polite">
                <Ionicons name="chatbubble-outline" size={28} color={styleA.ink} style={s.refusedIcon} />
                <Text style={s.line}>{CANNOT}</Text>
              </View>
            ) : null}
            {step === 'failed' ? <Text style={s.line} accessibilityLiveRegion="polite">{COULD_NOT}</Text> : null}
            {hasDraft && draft ? (
              <>
                {banner ? <Text style={s.banner} accessibilityLiveRegion="polite">{banner}</Text> : null}
                {edited ? <Text style={s.edited}>Edited by you</Text> : null}
                <View style={s.byRow}>
                  <RomanMark size={20} r={12} />
                  <Text style={s.by}>Drafted by Roman</Text>
                  <Text style={s.notSent}>Not sent</Text>
                </View>
                <View style={s.draftBox}><Text style={s.draftText} testID="checkin-draft-text">{draft.text}</Text></View>
                <Text style={s.muted}>{READ_FIRST}</Text>
                {step === 'ready' ? (
                  <Pressable style={s.report} onPress={() => setReporting(true)} accessibilityRole="button" accessibilityLabel="Report this draft" testID="checkin-draft-report">
                    <Ionicons name="flag-outline" size={20} color={styleA.inkMuted} />
                    <Text style={s.reportText}>Report this draft</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
            {step === 'editing' ? (
              <>
                <Text style={s.label}>{`Your reply to ${first}`}</Text>
                <TextInput
                  style={s.input} multiline autoFocus value={editText} maxLength={MAX_BODY}
                  onChangeText={(t) => setEditText(t.slice(0, MAX_BODY))}
                  accessibilityLabel={`Your reply to ${first}`} textAlignVertical="top"
                />
                <Text style={s.muted}>{EDITS_STAY}</Text>
              </>
            ) : null}
            {step === 'sent' && draft ? (
              <View accessibilityLiveRegion="polite">
                <View style={s.sentRow}>
                  <Ionicons name="checkmark-circle-outline" size={20} color={palette.forest} />
                  <Text style={s.sentTo}>{`Sent to ${first}`}</Text>
                </View>
                <View style={s.bubble}>
                  <Text style={s.bubbleText}>{draft.text}</Text>
                  <View style={s.face} accessible accessibilityLabel="Roman helped draft this message. You sent it.">
                    <RomanAvatar crop="neutral" size={17} />
                  </View>
                </View>
                <Text style={s.sentBy}>Drafted by Roman</Text>
                <Text style={s.muted}>Sent by you in Messages.</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={s.actions}>
            {step === 'idle' ? (
              <Btn s={s} kind="primary" label="Draft a reply" disabled={!online} onPress={() => void ask()} testID="checkin-draft-ask" />
            ) : null}
            {step === 'writing' ? <Btn s={s} kind="primary" label="Roman is writing" disabled onPress={() => undefined} /> : null}
            {step === 'failed' ? <Btn s={s} kind="primary" label="Try again" onPress={() => void ask()} /> : null}
            {step === 'refused' ? <Btn s={s} kind="outline" label="Not now" onPress={notNow} /> : null}
            {step === 'ready' ? (
              <View style={s.pair}>
                <Btn s={s} kind="outline" label="Edit" a11y={`Edit reply to ${first}'s check-in`} onPress={startEdit} flex={1} />
                <Btn s={s} kind="primary" label="Send" a11y={`Send to ${first}`} disabled={!online} onPress={() => void send()} flex={1.6} />
              </View>
            ) : null}
            {step === 'sending' ? <Btn s={s} kind="primary" label="Sending" a11y={`Send to ${first}`} disabled onPress={() => undefined} /> : null}
            {step === 'editing' ? (
              <View style={s.pair}>
                <Btn s={s} kind="outline" label="Cancel" onPress={() => setStep('ready')} flex={1} />
                <Btn s={s} kind="primary" label="Save edits" disabled={!editText.trim()} onPress={saveEdit} flex={1.6} />
              </View>
            ) : null}
            {step === 'sent' ? <Btn s={s} kind="primary" label="Done" onPress={onClose} /> : null}
            {step === 'idle' || step === 'failed' || step === 'ready' ? <Btn s={s} kind="text" label="Not now" onPress={notNow} /> : null}
          </View>
        </View>
        {draft ? (
          <ReportMessageSheet
            visible={reporting} look="roman" noDetails revealError messagePreview={draft.text}
            onSubmit={submitReport} onClose={() => setReporting(false)}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

type S = ReturnType<typeof makeStyles>;
function Btn({ s, kind, label, a11y, disabled = false, onPress, flex, testID }: {
  s: S; kind: 'primary' | 'outline' | 'text'; label: string; a11y?: string; disabled?: boolean; onPress: () => void; flex?: number; testID?: string;
}) {
  const box = kind === 'primary' ? [s.primary, disabled && s.primaryOff] : kind === 'outline' ? s.outline : s.textBtn;
  const words = kind === 'primary' ? [s.primaryText, disabled && s.primaryTextOff] : kind === 'outline' ? s.outlineText : s.textBtnText;
  return (
    <Pressable
      style={[box, flex ? { flex } : null]} disabled={disabled} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled }} testID={testID}
    >
      <Text style={words}>{label}</Text>
    </Pressable>
  );
}

/** RENEWAL3 K3's sheet gutter, as DraftSheets draws it: 22 on iPhone, 18 on Android. */
const GUTTER = Platform.OS === 'android' ? 18 : 22;

const makeStyles = ({ colors, semanticColors: sem, colorScheme }: ReturnType<typeof useTheme>) => {
  const light = colorScheme !== 'dark';
  const sheet = light ? neutral[0] : sem.bgSurface;
  const ink = light ? styleA.ink : colors.textPrimary;
  return StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: sem.overlay },
    sheet: { maxHeight: '92%', backgroundColor: sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
    // The deep head, as DraftSheets' 'roman' look draws K3's (styleA tones on forestPop.deep).
    head: { paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 18, backgroundColor: forestPop.deep },
    grab: { width: 40, height: 5, borderRadius: radius.chip, backgroundColor: styleA.line, alignSelf: 'center', marginBottom: 16 },
    headMark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    headName: { ...typography.caption, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.8, color: forestPop.gold },
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 20, lineHeight: 26, color: neutral[0] },
    chip: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: styleA.deep2 },
    chipText: { flex: 1, minWidth: 0 },
    chipLine: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 19, color: styleA.onDeep },
    body: { paddingHorizontal: GUTTER, paddingTop: 16, paddingBottom: 8 },
    source: { borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: light ? forestPop.sage : sem.bgSurface, marginBottom: 14 },
    sourceHead: { fontFamily: SEMI, fontSize: 12, lineHeight: 16, letterSpacing: 1.4, textTransform: 'uppercase', color: palette.forest, marginBottom: 4 },
    sourceText: { ...typography.body, fontSize: 15, lineHeight: 21, color: ink },
    writing: { fontFamily: SEMI, fontSize: 18, lineHeight: 24, color: ink, marginBottom: 14 },
    bar: { height: 10, borderRadius: radius.chip, backgroundColor: styleA.cardLine, marginBottom: 10 },
    line: { ...typography.body, fontSize: 16, lineHeight: 23, color: ink },
    refusedIcon: { marginBottom: 12 },
    banner: {
      overflow: 'hidden', borderRadius: radius.button, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10,
      fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 19, backgroundColor: palette.warningBg, color: palette.warningInk,
    },
    edited: { fontFamily: SEMI, fontSize: 13, lineHeight: 18, color: palette.forest, marginBottom: 6 },
    byRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    by: { flex: 1, ...typography.bodySmall, color: styleA.inkMuted },
    notSent: { ...typography.bodySmall, color: styleA.inkMuted },
    draftBox: { borderWidth: 1, borderColor: light ? styleA.cardLine : sem.border, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: sheet },
    draftText: { fontSize: 16, lineHeight: 24, color: ink },
    muted: { ...typography.bodySmall, color: styleA.inkMuted, marginTop: 10 },
    report: {
      flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginTop: 14, paddingTop: 6,
      borderTopWidth: 1, borderTopColor: light ? styleA.cardLine : sem.border,
    },
    reportText: { ...typography.body, fontSize: 15, color: styleA.inkMuted },
    label: { fontFamily: SEMI, fontSize: 14, lineHeight: 19, color: ink, marginBottom: 8 },
    input: {
      minHeight: 160, maxHeight: 280, borderWidth: 1, borderColor: styleA.inkMuted, borderRadius: radius.input,
      paddingTop: 12, paddingBottom: 12, paddingHorizontal: 14, fontSize: 16, lineHeight: 23, color: ink, backgroundColor: sheet,
    },
    sentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    sentTo: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: ink },
    bubble: { borderRadius: radius.card, paddingTop: 14, paddingBottom: 30, paddingHorizontal: 16, backgroundColor: palette.forest },
    bubbleText: { fontSize: 16, lineHeight: 23, color: neutral[0] },
    face: {
      position: 'absolute', right: 10, bottom: 8, width: 22, height: 22, borderRadius: radius.chip, borderWidth: 1.5,
      borderColor: palette.romanAccent, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bone,
    },
    sentBy: { fontFamily: SEMI, fontSize: 13, lineHeight: 18, color: palette.forest, marginTop: 10 },
    actions: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: light ? styleA.cardLine : sem.border },
    pair: { flexDirection: 'row', gap: 10 },
    primary: { minHeight: 48, borderRadius: radius.button, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    primaryOff: { backgroundColor: light ? '#E2DCCF' : sem.border },
    primaryText: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: neutral[0] },
    primaryTextOff: { color: styleA.inkMuted },
    outline: { minHeight: 48, borderRadius: radius.button, borderWidth: 1, borderColor: palette.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    outlineText: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: light ? palette.forest : colors.textPrimary },
    textBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    textBtnText: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: ink },
  });
};

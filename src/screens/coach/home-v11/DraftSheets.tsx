/**
 * Ask-first Roman drafts from the coach Home (spec #688 6295886580): a win's congratulations and a reach-out to
 * an at-risk client. Nothing is asked of Roman until the coach says so, and nothing reaches the client until the
 * coach taps Send: POST /ai/gateway/invoke (`draft.coach_message`) files a pending draft (approval required),
 * PATCH /ai/gateway/drafts/:id approves it; "Not now" on a written draft rejects it, so none waits. The sheet
 * cannot be closed while Roman writes or the draft sends. HomeSheet is the Home's one sheet (LO B1).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import api from '../../../services/api';
import { coachAiExecutionApi } from '../../../api/coachAiExecutionApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietLoading } from '../../../ui/states/QuietStates';
import type { AtRiskEntry } from '../../../services/commandCenterApi';
import { firstWord, type HomeWinDraft } from './homeDay';
import { RomanMark } from './RomanMark';

export interface DraftAsk {
  clientName: string;
  /** What the draft is for, in the coach's words: shown on the ask step. */
  about: string;
  request: HomeWinDraft;
  /** A server route that builds Roman's request itself (b#1130's plan-ended draft); the answer reads as invoke's. */
  path?: string;
  /** That route answered 404 (b#1141: the pair is blocked, or the plan is no longer ended): the list re-reads without it. */
  onGone?: () => void;
  /** RENEWAL3 K3a/K3b: Roman's deep head (mark, "Roman", the title, the context chip) over the sheet. Plan-ended asks only. */
  look?: 'roman';
}

type Step =
  | { kind: 'ask' }
  | { kind: 'writing' }
  | { kind: 'ready'; draftId: string; reply: string }
  | { kind: 'sending'; draftId: string; reply: string }
  | { kind: 'sent' }
  | { kind: 'failed'; words: string; draft?: { draftId: string; reply: string } };

interface InvokeAnswer { enabled?: boolean; provider?: string; reply?: string; approval?: { required?: boolean; draft_id?: string | null } }

/** Roman's written draft, or null when Roman is off or filed nothing: then nothing can be sent. */
export async function askRomanToDraft(request: HomeWinDraft, path?: string): Promise<{ draftId: string; reply: string } | null> {
  const res = await api.post<InvokeAnswer>(path ?? '/ai/gateway/invoke', path ? {} : request);
  const a = res.data ?? {};
  const draftId = a.approval?.draft_id;
  if (a.enabled === false || a.provider === 'stub' || a.approval?.required !== true || typeof draftId !== 'string' || !draftId) return null;
  if (typeof a.reply !== 'string' || !a.reply.trim()) return null;
  return { draftId, reply: a.reply.trim() };
}

/** A reach-out request for one at-risk client, with the server's reason (Roman's request, never shown). */
export function reachOutAsk(r: AtRiskEntry): DraftAsk {
  return {
    clientName: r.display_name,
    about: `A short check-in for ${firstWord(r.display_name)}. ${r.top_factor}.`,
    request: {
      capability: 'draft.coach_message',
      subject_user_id: r.user_id,
      message: `Write a short, warm check-in from the coach to this client. For you only, never say it to them: ${r.top_factor}. Ask one easy question. No emojis.`,
    },
  };
}

export interface ListRow { id: string; title: string; line?: string; label: string; onPick: () => void; /** a quiet done mark, e.g. Reached out today */ mark?: string }
export interface SheetList { title: string; rows: ListRow[] }
type S = ReturnType<typeof makeStyles>;

/** The coach Home's one sheet: a list (wins, Reach-outs) or one ask-first draft. iOS presents no Modal while another
 * closes (CoachlessHomeSlot PLAN_SHEET_DELAY_MS), so a row's draft opens in this sheet and closes back to its list. */
export function HomeSheet({ list, ask, onCloseList, onCloseAsk, onSent }: { list: SheetList | null; ask: DraftAsk | null; onCloseList: () => void; onCloseAsk: () => void; onSent: () => void }) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { bottom } = useScreenInsets();
  const close = useRef(onCloseList); // the scrim and Back close what the sheet shows
  if (!ask && !list) return null;
  if (!ask) close.current = onCloseList;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => close.current()}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close.current()} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, ask?.look === 'roman' && s.sheetRoman, { paddingBottom: bottom + 16 }]} testID={ask ? 'home-draft-sheet' : 'home-list-sheet'}>
          {ask?.look === 'roman' ? null : <View style={s.grab} />}
          {ask ? <DraftSteps ask={ask} s={s} close={close} onClose={onCloseAsk} onSent={onSent} /> : list ? (
            <>
              <Text style={s.title} accessibilityRole="header">{list.title}</Text>
              <ScrollView bounces={false}>
                {list.rows.map((r) => (
                  <Pressable key={r.id} style={s.row} onPress={r.onPick} accessibilityRole="button" accessibilityLabel={r.label} testID={`home-list-${r.id}`}>
                    <View style={s.rowText}>
                      <Text style={s.rowTitle}>{r.title}</Text>
                      {r.line ? <Text style={s.muted} numberOfLines={2}>{r.line}</Text> : null}
                      {r.mark ? (
                        <View style={s.mark} testID={`home-list-mark-${r.id}`}>
                          <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                          <Text style={s.markText}>{r.mark}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.chev}>›</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable style={s.secondary} onPress={onCloseList} accessibilityRole="button" accessibilityLabel="Done" testID="home-list-close">
                <Text style={s.secondaryText}>Done</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** Mounted fresh for each ask, so a new ask never shows the last one's step. */
function DraftSteps({ ask, s, close: closeRef, onClose, onSent }: { ask: DraftAsk; s: S; close: React.RefObject<() => void>; onClose: () => void; onSent: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'ask' });
  const first = firstWord(ask.clientName);

  const write = async () => {
    setStep({ kind: 'writing' });
    try {
      const d = await askRomanToDraft(ask.request, ask.path);
      setStep(d ? { kind: 'ready', ...d } : { kind: 'failed', words: "Roman can't write this right now. Nothing was sent." });
    } catch (err) {
      if (ask.path && (err as { response?: { status?: number } })?.response?.status === 404) {
        setStep({ kind: 'failed', words: "Roman can't write this right now. Nothing was sent." }); // not "try again": it won't work
        ask.onGone?.();
        return;
      }
      setStep({ kind: 'failed', words: "Roman couldn't write this. Nothing was sent. Try again in a moment." });
    }
  };
  const send = async (draftId: string, reply: string) => {
    setStep({ kind: 'sending', draftId, reply });
    try {
      await coachAiExecutionApi.approveDraft(draftId);
      setStep({ kind: 'sent' });
      onSent();
    } catch {
      setStep({ kind: 'failed', words: `Not sent to ${first}. Try again.`, draft: { draftId, reply } });
    }
  };
  // A written draft the coach turns down is rejected, so nothing waits to be sent.
  const close = () => {
    if (step.kind === 'writing' || step.kind === 'sending') return;
    const pending = step.kind === 'ready' ? step.draftId : step.kind === 'failed' ? step.draft?.draftId : undefined;
    if (pending) void coachAiExecutionApi.rejectDraft(pending).catch(() => undefined);
    onClose();
  };
  closeRef.current = close;

  const draft = step.kind === 'ready' || step.kind === 'sending' ? step : step.kind === 'failed' ? step.draft : undefined;
  const title = step.kind === 'sent' ? `Sent to ${first}` : draft ? `Roman's draft for ${first}` : `Ask Roman to write to ${first}?`;
  return (
    <>
      {ask.look === 'roman' ? (
        <View style={s.head} testID="home-draft-head">
          <View style={[s.grab, s.grabOnDeep]} />
          <View style={s.headMark}>
            <RomanMark size={44} />
            <Text style={s.headName} accessibilityElementsHidden importantForAccessibility="no">{'Roman'.toUpperCase()}</Text>
          </View>
          <Text style={[s.title, s.titleOnDeep]} accessibilityRole="header">{title}</Text>
          {step.kind === 'ask' ? <Text style={[s.muted, s.mutedOnDeep]}>You read it before it goes. Nothing is sent until you tap Send.</Text> : null}
          {step.kind !== 'sent' ? (
            <View style={s.about} testID="home-draft-about">
              <Ionicons name="refresh" size={16} color={forestPop.onDeep} />
              <Text style={s.aboutText}>{ask.about}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <ScrollView bounces={false}>
        {ask.look === 'roman' ? null : <Text style={s.title} accessibilityRole="header">{title}</Text>}
        {step.kind === 'ask' && ask.look !== 'roman' ? <Text style={s.body}>{ask.about}</Text> : null}
        {step.kind === 'ask' && ask.look !== 'roman' ? <Text style={s.muted}>You read it before it goes. Nothing is sent until you tap Send.</Text> : null}
        {step.kind === 'writing' ? <QuietLoading label="Roman is writing" /> : null}
        {draft ? <View style={s.draft}><Text style={s.body} testID="home-draft-text">{draft.reply}</Text></View> : null}
        {step.kind === 'failed' ? <Text style={s.error} accessibilityLiveRegion="polite">{step.words}</Text> : null}
      </ScrollView>
      <View style={s.actions}>
        {step.kind === 'ask' || (step.kind === 'failed' && !step.draft) ? (
          <HapticPressable intent="light" style={s.primary} onPress={write} accessibilityRole="button" accessibilityLabel={step.kind === 'failed' ? 'Try again' : 'Ask Roman'} testID="home-draft-ask">
            <Text style={s.primaryText}>{step.kind === 'failed' ? 'Try again' : 'Ask Roman'}</Text>
          </HapticPressable>
        ) : null}
        {draft ? (
          <HapticPressable intent="medium" style={s.primary} disabled={step.kind === 'sending'} onPress={() => send(draft.draftId, draft.reply)} accessibilityRole="button" accessibilityLabel={`Send to ${first}`} testID="home-draft-send">
            <Text style={s.primaryText}>{step.kind === 'sending' ? 'Sending' : 'Send'}</Text>
          </HapticPressable>
        ) : null}
        {step.kind !== 'writing' && step.kind !== 'sending' ? (
          <Pressable style={s.secondary} onPress={close} accessibilityRole="button" accessibilityLabel={step.kind === 'sent' ? 'Done' : 'Not now'} testID="home-draft-close">
            <Text style={s.secondaryText}>{step.kind === 'sent' ? 'Done' : 'Not now'}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const makeStyles = ({ colors, semanticColors: sem }: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: sem.overlay },
    sheet: { maxHeight: '85%', paddingTop: 8, paddingHorizontal: layout.gutter, backgroundColor: colors.background, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
    grab: { width: 40, height: 5, borderRadius: radius.chip, backgroundColor: sem.border, alignSelf: 'center', marginBottom: 12 },
    // RENEWAL3 K3a/K3b: the deep head runs edge to edge over the sheet's top.
    sheetRoman: { paddingTop: 0, overflow: 'hidden' },
    head: { marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 16, marginBottom: 16, backgroundColor: forestPop.deep },
    grabOnDeep: { backgroundColor: forestPop.brand400 },
    headMark: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
    headName: { ...typography.caption, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.8, color: forestPop.gold },
    titleOnDeep: { fontSize: 22, lineHeight: 28, color: forestPop.onDeep },
    mutedOnDeep: { ...typography.body, marginTop: 0, color: forestPop.onDeepMuted },
    about: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, marginTop: 12, minHeight: 36, paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.chip, backgroundColor: forestPop.forest },
    aboutText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: forestPop.onDeep, flexShrink: 1 },
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 20, lineHeight: 26, color: colors.textPrimary, marginBottom: 8 },
    body: { ...typography.body, color: colors.textPrimary },
    muted: { ...typography.bodySmall, color: colors.textMuted, marginTop: 6 },
    error: { ...typography.bodySmall, color: colors.error, marginTop: 10 },
    draft: { marginTop: 4, padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sem.border, backgroundColor: sem.bgSurface },
    actions: { gap: 4, marginTop: 16 },
    primary: { minHeight: 52, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    primaryText: { ...typography.bodyMd, fontSize: 17, color: sem.textOnAccent },
    secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { ...typography.bodyMd, color: colors.textPrimary },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sem.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { ...typography.bodyMd, color: colors.textPrimary },
    chev: { fontSize: 24, color: colors.textMuted, paddingLeft: 8 },
    mark: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    markText: { ...typography.bodySmall, color: colors.textMuted, flexShrink: 1 },
  });

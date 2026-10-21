/**
 * Ask-first Roman drafts from the coach Home (spec #688 6295886580): a win's congratulations and a reach-out to
 * a client who needs the coach. Nothing is asked of Roman until the coach says so, and nothing reaches the client
 * until the coach taps Send: POST /ai/gateway/invoke (`draft.coach_message`) files a pending draft (approval
 * required), PATCH /ai/gateway/drafts/:id approves it; "Not now" on a written draft rejects it, so none waits.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../../../components/HapticPressable';
import api from '../../../services/api';
import { coachAiExecutionApi } from '../../../api/coachAiExecutionApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietLoading } from '../../../ui/states/QuietStates';
import { firstWord, type HomeWinDraft } from './homeDay';
import type { NeedsRow } from './useCoachHomeV11';

export interface DraftAsk {
  clientName: string;
  /** What the draft is for, in the coach's words: shown on the ask step. */
  about: string;
  request: HomeWinDraft;
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
export async function askRomanToDraft(request: HomeWinDraft): Promise<{ draftId: string; reply: string } | null> {
  const res = await api.post<InvokeAnswer>('/ai/gateway/invoke', request);
  const a = res.data ?? {};
  const draftId = a.approval?.draft_id;
  if (a.enabled === false || a.provider === 'stub' || a.approval?.required !== true || typeof draftId !== 'string' || !draftId) return null;
  if (typeof a.reply !== 'string' || !a.reply.trim()) return null;
  return { draftId, reply: a.reply.trim() };
}

/** A reach-out request for one client who needs the coach (Roman's request, never shown). */
export function reachOutAsk(row: NeedsRow, name: string): DraftAsk {
  return {
    clientName: name,
    about: `A short check-in for ${firstWord(name)}. ${row.reason.text}.`,
    request: {
      capability: 'draft.coach_message',
      subject_user_id: row.client.id,
      message: `Write a short, warm check-in from the coach to this client. Why now: ${row.reason.text}. Ask one easy question. No emojis.`,
    },
  };
}

export function RomanDraftSheet({ ask, onClose }: { ask: DraftAsk | null; onClose: () => void }) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { bottom } = useScreenInsets();
  const [step, setStep] = useState<Step>({ kind: 'ask' });
  useEffect(() => { if (ask) setStep({ kind: 'ask' }); }, [ask]);
  if (!ask) return null;
  const first = firstWord(ask.clientName);

  const write = async () => {
    setStep({ kind: 'writing' });
    try {
      const d = await askRomanToDraft(ask.request);
      setStep(d ? { kind: 'ready', ...d } : { kind: 'failed', words: "Roman can't write this right now. Nothing was sent." });
    } catch {
      setStep({ kind: 'failed', words: "Roman couldn't write this. Nothing was sent. Try again in a moment." });
    }
  };
  const send = async (draftId: string, reply: string) => {
    setStep({ kind: 'sending', draftId, reply });
    try {
      await coachAiExecutionApi.approveDraft(draftId);
      setStep({ kind: 'sent' });
    } catch {
      setStep({ kind: 'failed', words: `Not sent to ${first}. Try again.`, draft: { draftId, reply } });
    }
  };
  // A written draft the coach turns down is rejected, so nothing waits to be sent.
  const close = () => {
    const pending = step.kind === 'ready' ? step.draftId : step.kind === 'failed' ? step.draft?.draftId : undefined;
    if (pending) void coachAiExecutionApi.rejectDraft(pending).catch(() => undefined);
    onClose();
  };

  const draft = step.kind === 'ready' || step.kind === 'sending' ? step : step.kind === 'failed' ? step.draft : undefined;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: bottom + 16 }]} testID="home-draft-sheet">
          <View style={s.grab} />
          <ScrollView bounces={false}>
            <Text style={s.title} accessibilityRole="header">
              {step.kind === 'sent' ? `Sent to ${first}` : draft ? `Roman's draft for ${first}` : `Ask Roman to write to ${first}?`}
            </Text>
            {step.kind === 'ask' ? <Text style={s.body}>{ask.about}</Text> : null}
            {step.kind === 'ask' ? <Text style={s.muted}>You read it before it goes. Nothing is sent until you tap Send.</Text> : null}
            {step.kind === 'writing' ? <QuietLoading label="Roman is writing" /> : null}
            {draft ? <View style={s.draft}><Text style={s.body} testID="home-draft-text">{draft.reply}</Text></View> : null}
            {step.kind === 'failed' ? <Text style={s.error} accessibilityLiveRegion="polite">{step.words}</Text> : null}
            {step.kind === 'sent' ? <Text style={s.body}>{first} has your message.</Text> : null}
          </ScrollView>
          <View style={s.actions}>
            {step.kind === 'ask' || (step.kind === 'failed' && !step.draft) ? (
              <HapticPressable intent="light" style={s.primary} onPress={write} accessibilityRole="button" accessibilityLabel="Ask Roman" testID="home-draft-ask">
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
        </View>
      </View>
    </Modal>
  );
}

/** The Reach-outs ring's rows: one "Reach out to {name}?" per client who needs the coach, most urgent first. */
export function ReachOutSheet({ rows, nameOf, visible, onPick, onSeeAll, onClose }: {
  rows: NeedsRow[]; nameOf: (r: NeedsRow) => string; visible: boolean;
  onPick: (r: NeedsRow) => void; onSeeAll: () => void; onClose: () => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { bottom } = useScreenInsets();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: bottom + 16 }]} testID="home-reach-sheet">
          <View style={s.grab} />
          <Text style={s.title} accessibilityRole="header">Reach-outs</Text>
          {rows.length === 0 ? <Text style={s.body}>Nobody needs a reach-out right now.</Text> : null}
          <ScrollView bounces={false}>
            {rows.map((r) => {
              const name = nameOf(r);
              return (
                <Pressable key={r.client.id} style={s.row} onPress={() => onPick(r)} accessibilityRole="button" accessibilityLabel={`Reach out to ${name}?`} testID={`home-reach-${r.client.id}`}>
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>Reach out to {name}?</Text>
                    <Text style={s.muted} numberOfLines={2}>{r.reason.text}</Text>
                  </View>
                  <Text style={s.chev}>›</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={s.secondary} onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See everyone who needs you" testID="home-reach-all">
            <Text style={s.secondaryText}>See everyone who needs you</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors, semanticColors: sem }: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: sem.overlay },
    sheet: { maxHeight: '85%', paddingTop: 8, paddingHorizontal: layout.gutter, backgroundColor: colors.background, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
    grab: { width: 40, height: 5, borderRadius: radius.chip, backgroundColor: sem.border, alignSelf: 'center', marginBottom: 12 },
    title: { ...typography.h3, color: colors.textPrimary, marginBottom: 8 },
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
  });

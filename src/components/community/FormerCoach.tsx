/**
 * FormerCoach — COMMUNITY-DM-FORMER-REACH-M (owner ALM-P1, #ALM-E12: "former coach style c - but cap at JUST the 1st most
 * recent prior coach"; ALM-D5; 203-D12, 203-D51). Style 3 "Coaches first" of DM-FORMER-REACH-MOCK (ctx#602,
 * handoffs/op-almalfi/mockups/DM-FORMER-REACH/src/html/S3_*.html), every number below is that CSS:
 *   - FormerCoachCard: the cream card under her coach's card (.fcard, .ftile, .over, .fname, .meta), in row 1b's form
 *     (the operator's call: no message text, no count, as every row reads today), on her list and on the locked page.
 *   - FormerCoachMasthead + FormerCoachPaper: the thread as a Style C page (.mast, .mast h1, .over.onDeep, .sheet).
 *   - FormerCoachSheet: the three dots' sheet (.bsheet): why she can still write, then Report and Block as rows.
 *   - FormerCoachClosed: the closed page (S3_closed): one answer for removed, banned or gone, with no reason given.
 * The server decides who is listed (GET /community/me former_coach_dms, b#1253 CONTRACT 6866534247); the phone shows
 * former_coach_dms[0] only and names the coach only by coach_display_name (DM-FORMER-COACH-BE), else "Former coach".
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import { brand, colors, forestPop as fp, lightTokens, semantic, voiceShades } from '../../theme/tokens';
import { useDmThreads } from '../../hooks/useCommunity';
import { dropAuthorFromCoachInbox } from '../../hooks/useCoachCommunity';
import { describeCommunityFailure } from '../../api/communityErrors';
import type { CommunityMeResponse } from '../../api/communityApi';
import {
  communitySafetyApi,
  COMMUNITY_GUIDELINES,
  COMMUNITY_REPORT_REASONS,
  COMMUNITY_REPORT_SENT_TITLE,
  communityReportSentMessage,
} from '../../api/communitySafetyApi';
import { CLOSED_LINE, ConversationClosedLine, type ClosedBy } from '../messaging/ConversationClosed';
import { firstNameOf, initialsOf } from '../../screens/community/coach-dm/coachDm';
import { dmActivity } from './DmRow';

/** W1 / W11 (approved, operator #203-E15): the relation, and the title when the phone has no name. */
export const FORMER_COACH = 'Former coach';
/** W2 (approved, operator #203-E15): the coach's row for a client who left. */
export const FORMER_CLIENT = 'Former client';
/** W7 (approved, operator #203-E15): the closed page's line; true for removed, banned and gone alike. */
export const FORMER_CLOSED_LINE = 'You can no longer message each other here.';
/** W6 (approved, operator #203-E15): why she can still write to her old coach. */
export const formerReachLine = (name: string | null): string =>
  name
    ? `You are still in ${firstNameOf(name)}'s community, so you can message each other here.`
    : "You are still in your former coach's community, so you can message each other here.";

export interface FormerCoach { workspaceId: string; coachId: string; name: string | null }

/** The one former coach the phone shows: former_coach_dms[0] (#ALM-E12 caps it at one), never her coach now. */
export function formerCoachOf(me: CommunityMeResponse | undefined, myCoachId: string | null | undefined): FormerCoach | null {
  const first = me?.former_coach_dms?.[0];
  if (!first || first.coach_user_id === myCoachId) return null;
  return { workspaceId: first.workspace_id, coachId: first.coach_user_id, name: first.coach_display_name?.trim() || null };
}

/** The thread's former coach: listed by /me for this person, then held for the visit, so a thread the server stops
 * listing keeps its page and community, and the server's own refusal of the read closes it. */
export function useFormerThread(me: CommunityMeResponse | undefined, myCoachId: string | null | undefined, recipientId: string): FormerCoach | null {
  const listed = formerCoachOf(me, myCoachId);
  const now = listed && listed.coachId === recipientId ? listed : null;
  const [held, setHeld] = useState<FormerCoach | null>(now);
  if (now && (held?.coachId !== now.coachId || held.workspaceId !== now.workspaceId || held.name !== now.name)) setHeld(now);
  return now ?? (held?.coachId === recipientId ? held : null);
}

const spoken = (line: string) => line.charAt(0).toLowerCase() + line.slice(1);

export function FormerCoachCard({ name, lastMessageAt, onPress, testID = 'dm-former-coach' }: {
  name: string | null;
  /** The thread's last message; undefined when the phone cannot tell (no line drawn). */
  lastMessageAt?: string | null;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  const activity = lastMessageAt === undefined ? null : dmActivity(lastMessageAt);
  const letter = name ? Array.from(initialsOf(name) ?? '')[0] ?? null : null;
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name ? `Open conversation with ${name}, former coach` : 'Open conversation with your former coach'}
      accessibilityValue={activity ? { text: spoken(activity.line) } : undefined}
      testID={testID}
      style={s.card}
    >
      <View style={s.tile} testID={`${testID}-tile`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {letter ? <Text style={s.letter} maxFontSizeMultiplier={1.5}>{letter}</Text> : null}
      </View>
      <View style={s.words}>
        {name ? <Text style={s.over}>{FORMER_COACH}</Text> : null}
        <Text style={s.name}>{name ?? FORMER_COACH}</Text>
        {activity ? <Text style={s.meta}>{activity.line}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={fp.n700} />
    </HapticPressable>
  );
}

/** The card with its time: the former community's own thread list (the server lists only the coach's thread there). */
export function FormerCoachEntry({ former, onPress, testID }: { former: FormerCoach; onPress: () => void; testID?: string }): React.ReactElement {
  const threads = useDmThreads(former.workspaceId);
  const thread = threads.data?.find((t) => t.other_user_id === former.coachId);
  return <FormerCoachCard name={former.name} lastMessageAt={thread ? thread.last_message_at : undefined} onPress={onPress} testID={testID} />;
}

export function FormerCoachMasthead({ name, onBack, onAbout }: { name: string | null; onBack: () => void; onAbout?: () => void }): React.ReactElement {
  return (
    <View style={s.mast} testID="former-thread-masthead">
      <View style={s.mrow}>
        <HapticPressable intent="light" onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={s.icon} testID="former-thread-back">
          <Ionicons name="chevron-back" size={26} color={fp.onDeep} />
        </HapticPressable>
        {onAbout ? (
          <HapticPressable intent="light" onPress={onAbout} accessibilityRole="button" accessibilityLabel="About this conversation"
            style={s.icon} testID="former-thread-about">
            <Ionicons name="ellipsis-horizontal" size={22} color={fp.onDeep} />
          </HapticPressable>
        ) : null}
      </View>
      <View style={s.mt}>
        {name ? <Text style={[s.over, s.overDeep]}>{FORMER_COACH}</Text> : null}
        <Text style={s.h1} accessibilityRole="header">{name ?? FORMER_COACH}</Text>
      </View>
    </View>
  );
}

/** The page's sheet: its 24 pt corners ride 22 pt up over the masthead. */
export function FormerCoachPaper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={s.paper} testID="former-thread-paper">{children}</View>;
}

/** Closed (S3_closed): the title, one line that names no reason, and her coach now, when she has one. A block keeps
 * its own approved line (#169-5: who closed it) under the same title. */
export function FormerCoachClosed({ by, name, coachName, onCoach }: {
  by: ClosedBy;
  name: string | null;
  coachName: string | null;
  /** Opens her coach's thread; omitted with no coach (the row and button are not drawn). */
  onCoach?: () => void;
}): React.ReactElement {
  return (
    <View style={s.closed} testID="former-thread-closed">
      <View style={s.closedTop}>
        <Text style={s.closedTitle} accessibilityRole="header">{CLOSED_LINE}</Text>
        {by ? (
          <ConversationClosedLine by={by} name={name} style={s.closedBar} testID="former-thread-closed-by" />
        ) : (
          <Text style={s.closedLine} accessibilityLiveRegion="polite">{FORMER_CLOSED_LINE}</Text>
        )}
        {onCoach ? (
          <HapticPressable intent="light" onPress={onCoach} accessibilityRole="button"
            accessibilityLabel={coachName ? `Open conversation with ${coachName}, your coach` : 'Open conversation with your coach'}
            style={s.olr} testID="former-thread-closed-coach">
            <Text style={s.olrLabel}>Your coach</Text>
            <Text style={s.olrValue} numberOfLines={1}>{coachName ?? ''}</Text>
            <Ionicons name="chevron-forward" size={20} color={fp.n700} />
          </HapticPressable>
        ) : null}
      </View>
      {onCoach ? (
        <View style={s.foot}>
          <HapticPressable intent="medium" onPress={onCoach} accessibilityRole="button" accessibilityLabel="Send your coach a message"
            style={s.btn} testID="former-thread-closed-action">
            <Text style={s.btnText}>Send your coach a message</Text>
          </HapticPressable>
        </View>
      ) : null}
    </View>
  );
}

const EMERGENCY_LINE = COMMUNITY_GUIDELINES[COMMUNITY_GUIDELINES.length - 1];

/** The three dots' sheet (S3_block): who, why she can still write (W6), then Report (the latest message from the coach,
 * as the thread's header menu reports; no row when there is none) and Block (203-D51), with SafetyMenu's reasons,
 * confirm, calls and refusals. An Alert after the sheet is raised once the sheet has gone (SafetyMenu Opus R5-B4). */
export function FormerCoachSheet({ visible, name, coachId, reportMessageId, onClose, onBlocked, testID = 'former-sheet' }: {
  visible: boolean;
  name: string | null;
  coachId: string;
  reportMessageId: string | null;
  onClose: () => void;
  onBlocked: () => void;
  testID?: string;
}): React.ReactElement {
  const qc = useQueryClient();
  const bottom = useSafeAreaInsets().bottom;
  const [step, setStep] = useState<'menu' | 'reasons'>('menu');
  const [busy, setBusy] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const who = name ?? 'this member';
  const runPending = () => {
    const next = pending.current;
    pending.current = null;
    next?.();
  };
  useEffect(() => runPending, []);
  const close = () => {
    setStep('menu');
    onClose();
  };
  const afterClose = (next: () => void) => {
    close();
    if (Platform.OS === 'ios') pending.current = next;
    else next();
  };
  const report = async (reason: string) => {
    if (!reportMessageId) return;
    setBusy(true);
    try {
      await communitySafetyApi.report({ target_type: 'message', target_id: reportMessageId, reason });
      afterClose(() => Alert.alert(COMMUNITY_REPORT_SENT_TITLE, communityReportSentMessage(reason)));
    } catch (err) {
      const failure = describeCommunityFailure(err, 'report');
      Alert.alert(failure.title, failure.message);
    } finally {
      setBusy(false);
    }
  };
  const block = () => afterClose(() => Alert.alert(
    `Block ${who}?`,
    `You and ${who} will no longer see each other's posts, comments, messages or voice notes, and neither of you can message the other. In a direct message they see that you blocked them; nobody else is told. You can unblock them from Community safety.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await communitySafetyApi.block(coachId);
            dropAuthorFromCoachInbox(qc, coachId);
            await qc.invalidateQueries({ queryKey: ['community'] });
            onBlocked();
          } catch (err) {
            const failure = describeCommunityFailure(err, 'block');
            Alert.alert(failure.title, failure.message);
          }
        },
      },
    ],
  ));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} onDismiss={runPending}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} importantForAccessibility="no" testID={`${testID}-scrim`} />
        <View style={[s.bsheet, { paddingBottom: bottom }]} accessibilityViewIsModal testID={testID}>
          <View style={s.grab} />
          <ScrollView style={s.body} bounces={false}>
            {busy ? <ActivityIndicator color={fp.forest} style={s.busy} /> : step === 'menu' ? (
              <>
                <View style={s.sheetHead}>
                  {name ? <Text style={s.over}>{FORMER_COACH}</Text> : null}
                  <Text style={[s.name, s.sheetName]} accessibilityRole="header">{name ?? FORMER_COACH}</Text>
                  <Text style={s.why}>{formerReachLine(name)}</Text>
                </View>
                <View style={s.rows}>
                  {reportMessageId ? (
                    <SheetRow label="Report" spokenLabel="Report this content" onPress={() => setStep('reasons')} testID={`${testID}-report`} />
                  ) : null}
                  <SheetRow label={`Block ${who}`} danger onPress={block} testID={`${testID}-block`} />
                </View>
              </>
            ) : (
              <View style={s.rows}>
                <Text style={s.heading} accessibilityRole="header">Why are you reporting this?</Text>
                {COMMUNITY_REPORT_REASONS.map((r) => (
                  <SheetRow key={r.code} label={r.label} onPress={() => void report(r.code)} testID={`${testID}-reason-${r.code}`} />
                ))}
                <Text style={s.emergency}>{EMERGENCY_LINE}</Text>
              </View>
            )}
          </ScrollView>
          <HapticPressable intent="light" onPress={close} accessibilityRole="button" accessibilityLabel="Cancel" style={s.cancel} testID={`${testID}-cancel`}>
            <Text style={s.cancelText}>Cancel</Text>
          </HapticPressable>
        </View>
      </View>
    </Modal>
  );
}

function SheetRow({ label, spokenLabel, danger, onPress, testID }: { label: string; spokenLabel?: string; danger?: boolean; onPress: () => void; testID: string }) {
  return (
    <HapticPressable intent={danger ? 'warning' : 'light'} onPress={onPress} accessibilityRole="button" accessibilityLabel={spokenLabel ?? label}
      style={s.row} testID={testID}>
      <Text style={[s.rowText, danger ? s.danger : null]}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={fp.n700} />
    </HapticPressable>
  );
}

const SERIF = 'CormorantGaramond_600SemiBold';
const s = StyleSheet.create({
  // .fcard: margin 8 16 4, #FFFDF8, a 1 pt #DCD5CC line, radius 16; .top padding 12 14 10, gap 14.
  card: {
    marginTop: 8, marginHorizontal: 16, marginBottom: 4, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 14, gap: 14,
    flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: lightTokens.border, backgroundColor: fp.surface,
  },
  // .ftile: 48 pt, radius 12, cream with a 1 pt #3A5C46 line inside, Cormorant 600 24 #2C4A36.
  tile: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: brand[500], backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: SERIF, fontSize: 24, color: fp.forest },
  words: { flex: 1, minWidth: 0 },
  // .over: 11, .14em, 600, upper case, gold ink #6B4F1A (on deep: gold #D4B96B), line 1.3.
  over: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11, lineHeight: 14.3, letterSpacing: 1.54, textTransform: 'uppercase', color: fp.goldInk },
  overDeep: { color: fp.gold },
  // .fname: Cormorant 600 22/1.2 ink, wraps; .meta 13.5/1.3 #5A5A56.
  name: { fontFamily: SERIF, fontSize: 22, lineHeight: 26.4, color: fp.ink },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 17.55, color: fp.n700 },
  // .mast: deep, 30 below; .mrow padding 0 6; .mt padding 2 22 0; h1 Cormorant 500 32/1.2 #FBF7F0.
  mast: { backgroundColor: fp.deep, paddingBottom: 30 },
  mrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mt: { paddingTop: 2, paddingHorizontal: 22 },
  h1: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 32, lineHeight: 38.4, color: fp.onDeep },
  // .sheet: the page colour, 24 pt top corners, 22 pt up over the masthead.
  paper: { flex: 1, minHeight: 0, marginTop: -22, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: lightTokens.bgPrimary },
  // S3_closed: padding 30 24 0, gap 12; h2 Cormorant 500 26/1.22; p 16/1.5 #3D3D3A; .olr 52 high, lines #DCD5CC.
  closed: { flex: 1 },
  closedTop: { flex: 1, paddingTop: 30, paddingHorizontal: 24, gap: 12 },
  closedTitle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, lineHeight: 31.72, color: fp.ink },
  closedLine: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, color: colors.charcoal },
  closedBar: { backgroundColor: 'transparent', borderTopWidth: 0, justifyContent: 'flex-start', paddingHorizontal: 0, paddingVertical: 0, minHeight: 0 },
  olr: {
    marginTop: 6, minHeight: 52, paddingVertical: 8, gap: 10, flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: lightTokens.border,
  },
  olrLabel: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, color: fp.ink },
  olrValue: { flex: 1, minWidth: 0, textAlign: 'right', fontFamily: 'Inter_400Regular', fontSize: 15, color: fp.n700 },
  // .foot padding 8 24 14; .btn.big 54 high, radius 12, #2C4A36, 600 16 #FBF7F0.
  foot: { paddingTop: 8, paddingHorizontal: 24, paddingBottom: 14 },
  btn: { minHeight: 54, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: fp.forest },
  btnText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20, textAlign: 'center', color: fp.onDeep },
  // .scrim ink at .40; .bsheet #FFFDF8, 24 pt top corners, padding 8 0 0; .grab 40 x 5.
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: lightTokens.overlay },
  bsheet: { maxHeight: '90%', paddingTop: 8, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: fp.surface },
  grab: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 6, backgroundColor: voiceShades.track },
  body: { flexGrow: 0, flexShrink: 1 },
  busy: { paddingVertical: 32 },
  sheetHead: { paddingTop: 6, paddingHorizontal: 22, paddingBottom: 4 },
  sheetName: { fontSize: 26, lineHeight: 31.2 },
  why: { marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21.75, color: colors.charcoal },
  // .olr rows in the sheet: padding 4 22 0, 52 high, a 1 pt line above each and below the last.
  rows: { paddingTop: 4, paddingHorizontal: 22 },
  row: { minHeight: 52, paddingVertical: 8, gap: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderTopWidth: 1, marginTop: -1, borderColor: lightTokens.border },
  rowText: { flex: 1, fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 16, lineHeight: 20.8, color: fp.ink },
  danger: { color: semantic.danger.fg },
  heading: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 18, lineHeight: 23, marginTop: 4, marginBottom: 6, color: fp.ink },
  emergency: {
    overflow: 'hidden', borderWidth: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10, marginBottom: 4,
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: fp.ink, backgroundColor: voiceShades.leafWash, borderColor: voiceShades.washEdge,
  },
  // .scancel: 52 high, 600 16 ink.
  cancel: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, color: fp.ink },
});

/**
 * JoinCoachState (owner 2026-10-09 00:0x): the calm locked state a client with
 * no coach meets on Roman and Community. One serif headline, one muted line,
 * one forest "Join a coach" (EntitlementProvider.messageCoach: the coach-code
 * sheet on Messages). Copy never says "your coach": there is none yet.
 * COMMUNITY-DM-FORMER-REACH-M (owner ALM-D5: "as it shows in style C for v1"; 203-D12): on Community, her one former
 * coach's card (Style 3 S3_nocoach, in row 1b's form) sits under the line, and it opens that one thread here.
 * FIX-DMFR-M-1 (OPERATOR RULING 7213408207 item 2): the card follows the phone's DM switch like every other DM entry
 * (C4); the terms pages in front of the thread carry Back to this page (C1); Android's back is heard only while the
 * Community tab is in front (C6).
 * DM-FORMER-PUSH-M (the operator's call under ALM-D5, R1): his message notification or tgp://community/dm link opens
 * that thread here too, through the card's own step, once /me lists him; a decided tap is spent from the tab's route.
 */
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { NavigationContext, NavigationRouteContext, type Route } from '@react-navigation/native';
import { Headline, Lede, PrimaryButton, Screen, ScreenTopBar, TextLink, type ScreenEdge } from '../../ui';
import RomanAvatar from '../roman/RomanAvatar';
import { AI_REFUSAL_ACTIONS } from '../ai/AiRefusalNotice';
import { useOpenSupport } from '../ai/useOpenSupport';
import { COMMUNITY_REPORT_CRISIS_LINE } from '../../api/communitySafetyApi';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import { readUserCacheSync } from '../../lib/userCache';
import { featureFlags } from '../../config/featureFlags';
import { layout, spacing } from '../../theme/tokens';
import { useCommunityMe } from '../../hooks/useCommunity';
import CommunityTermsGate from '../community/CommunityTermsGate';
import { FormerCoachEntry, useFormerCoach } from '../community/FormerCoach';
import CommunityDmThreadScreen from '../../screens/community/CommunityDmThreadScreen';
import { UUID } from '../../navigation/incomingLinks';

export const JOIN_A_COACH = 'Join a coach';
export const ROMAN_LOCK_TITLE = 'Roman works with a coach';
export const ROMAN_LOCK_BODY =
  "Roman reads your plan and a coach's guidance, so he is available once you join a coach. Your own logging stays open.";
export const COMMUNITY_LOCK_TITLE = 'Community comes with a coach';
export const COMMUNITY_LOCK_BODY =
  'Community is where a coach and their clients talk. It opens once you join a coach.';

/**
 * True for a signed-in client account with no coach. Coaches have no coach_id
 * either, so the role is checked too. Re-read on screen focus, so a join made
 * in the code sheet opens the screen when the person comes back to it.
 */
export function useClientNeedsCoach(): boolean {
  const currentUser = useCurrentUser();
  const coachless = useCoachlessClient();
  const navigation = useContext(NavigationContext);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (typeof navigation?.addListener !== 'function') return undefined;
    return navigation.addListener('focus', refresh);
  }, [navigation]);
  const user = readUserCacheSync() ?? currentUser;
  return coachless && user?.role === 'student';
}

export interface JoinCoachStateProps {
  title: string;
  body: string;
  /** Back chevron; omitted on a tab root. */
  onBack?: () => void;
  /** Roman's face above the headline (Roman surfaces). */
  roman?: boolean;
  /** Tab roots leave the bottom edge to the tab bar. */
  edges?: readonly ScreenEdge[];
  /** COACH-AI-CONSENT: the coach's Roman off state (CAC-5) puts its own button under the text instead. */
  action?: { label: string; onPress: () => void };
  /** Drawn under the line (Community: her former coach's card); the page then scrolls, so 320 pt at 130% fits. */
  extra?: React.ReactNode;
  testID?: string;
}

export default function JoinCoachState({
  title,
  body,
  onBack,
  roman = false,
  edges = ['top', 'bottom'],
  action,
  extra,
  testID = 'join-coach-state',
}: JoinCoachStateProps): React.ReactElement {
  const { messageCoach } = useEntitlement();
  return (
    <Screen
      edges={edges}
      scroll={!!extra}
      centerContent
      // S3_nocoach draws no bar over the page with the card: an empty one would push the card under the button.
      header={extra && !onBack ? undefined : <ScreenTopBar onBack={onBack} testID={`${testID}-top`} />}
      footer={action ? undefined : <PrimaryButton label={JOIN_A_COACH} onPress={messageCoach} testID={`${testID}-join`} />}
      testID={testID}
    >
      <View style={styles.block}>
        {roman ? <RomanAvatar size={40} /> : null}
        <Headline level="h2">{title}</Headline>
        <Lede>{body}</Lede>
        {extra ? <View style={styles.extra}>{extra}</View> : null}
        {action ? <PrimaryButton label={action.label} onPress={action.onPress} testID={`${testID}-action`} /> : null}
        {roman && !action ? <RomanLockHelp testID={testID} /> : null}
      </View>
    </Screen>
  );
}

/** b#900 lens: never only a join wall. The app's crisis line, as is, and Contact support. */
function RomanLockHelp({ testID }: { testID: string }): React.ReactElement {
  const openSupport = useOpenSupport();
  return (
    <View style={styles.block} testID={`${testID}-help`}>
      <Lede size="small" testID={`${testID}-crisis`}>{COMMUNITY_REPORT_CRISIS_LINE}</Lede>
      {openSupport ? (
        <TextLink label={AI_REFUSAL_ACTIONS.contactSupport} onPress={openSupport} size="small" align="start" testID={`${testID}-support`} />
      ) : null}
    </View>
  );
}

/**
 * A tab root that belongs to a coach (Community): a client with no coach sees
 * JoinCoachState (no Back; the tab bar owns the bottom edge) instead.
 */
export function CoachOnlyGate({
  title,
  body,
  testID,
  children,
}: Pick<JoinCoachStateProps, 'title' | 'body' | 'testID'> & { children: React.ReactNode }): React.ReactElement {
  const needsCoach = useClientNeedsCoach();
  const params = useContext(NavigationRouteContext ?? NoRoute)?.params;
  // DM-FORMER-PUSH-M: the stack takes a tap itself and leaves it on the tab's route, so a page drawn after the stack in
  // this mount is handed the params found at that flip, and spends them as no tap (by identity: its effects run first).
  const stack = useRef<{ drawn: boolean; took?: object }>({ drawn: false });
  if (!needsCoach) stack.current = { drawn: true };
  else if (stack.current.drawn) stack.current = { drawn: false, took: params };
  if (needsCoach) return <CoachlessLock title={title} body={body} testID={testID} took={stack.current.took} />;
  return <>{children}</>;
}

// A harness that stubs @react-navigation/native has no route context: read as no route (as the banner reads its container).
const NoRoute = createContext<Route<string> | undefined>(undefined);
type TabParams = { screen?: unknown; params?: { recipientId?: unknown }; initial?: unknown } | undefined;
interface TabTap { params: TabParams; recipientId: string | null; held: boolean; spend: () => void }

/** DM-FORMER-PUSH-M: a DM tap as the router leaves it on the Community tab ({ screen: 'CommunityDmThread', params:
 * { recipientId } }), and its spend (screen, params and initial cleared, so it never opens again and a stack mounted
 * later starts at its root). The params the stack took (`took`) are no tap. */
function useTabTap(took: object | undefined): TabTap {
  const navigation = useContext(NavigationContext);
  const params = useContext(NavigationRouteContext ?? NoRoute)?.params as TabParams;
  const id = params?.screen === 'CommunityDmThread' ? params.params?.recipientId : undefined;
  const tap = params !== took && typeof id === 'string' && UUID.test(id) ? id : null;
  const held = !!params && (params.screen !== undefined || params.params !== undefined || params.initial !== undefined);
  const spend = useCallback(() => navigation?.setParams?.({ screen: undefined, params: undefined, initial: undefined }), [navigation]);
  return { params, recipientId: tap, held: held && (tap !== null || params === took), spend };
}

/** The locked page: with the phone's DM switch off it is the page as before (no card, no /me read), as every other DM
 * entry is behind featureFlags.communityDm (C4); a tap there, or the stack's own, is spent and opens nothing. */
function CoachlessLock({ took, ...props }: Pick<JoinCoachStateProps, 'title' | 'body' | 'testID'> & { took?: object }): React.ReactElement {
  const tap = useTabTap(took);
  const off = !featureFlags.communityDm;
  const { params, recipientId, held, spend } = tap;
  useEffect(() => {
    if (held && (off || !recipientId)) spend();
  }, [params, recipientId, held, off, spend]);
  if (off) return <JoinCoachState {...props} edges={['top']} />;
  return <CoachlessLockWithFormer {...props} tap={tap} />;
}

/** Whether this tab is in front: its navigator's focus and blur (no navigator: in front). */
function useTabInFront(): boolean {
  const navigation = useContext(NavigationContext);
  const [inFront, setInFront] = useState(true);
  useEffect(() => {
    if (typeof navigation?.addListener !== 'function') return undefined;
    setInFront(navigation.isFocused?.() ?? true);
    const offFocus = navigation.addListener('focus', () => setInFront(true));
    const offBlur = navigation.addListener('blur', () => setInFront(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return inFront;
}

/** ALM-D5: the locked page with her former coach's card (GET /community/me former_coach_dms[0]); the card opens that
 * thread in this tab, behind the community terms, and Back (the terms pages', the thread's, Android's) returns to the
 * page. */
function CoachlessLockWithFormer({ title, body, testID = 'join-coach-state', tap }: Pick<JoinCoachStateProps, 'title' | 'body' | 'testID'> & { tap: TabTap }): React.ReactElement {
  const me = useCommunityMe();
  const former = useFormerCoach(me.data, null);
  const [openWith, setOpenWith] = useState<string | null>(null);
  const inFront = useTabInFront();
  const navigation = useContext(NavigationContext);
  // DM-FORMER-PUSH-M: a tap is decided on this visit's /me (useServerAnswered's rule, no latch), or, once this visit's
  // read failed, on the copy the card is drawn from; a restored copy or a restored error alone waits, un-spent. It opens
  // only the card's coach, by the card's own step, while the tab is in front (read live: the mirror lags a router tap);
  // a tap for anyone else, or one the tab is no longer in front for, is spent and opens nothing, now or later.
  const decided = (me.isSuccess && (me.isFetchedAfterMount || !me.isStale)) || (me.isError && me.isFetchedAfterMount);
  const listed = former?.coachId ?? null;
  const { params, recipientId, spend } = tap;
  useEffect(() => {
    if (!recipientId) return;
    const front = navigation?.isFocused?.() ?? true;
    if (front && !decided) return;
    if (front && recipientId === listed) setOpenWith(listed);
  }, [params, recipientId, decided, listed, inFront, navigation, spend]);
  useEffect(() => () => { spend(); }, [spend]);
  useEffect(() => {
    if (!openWith || !inFront) return undefined; // C6: another tab's Back is that tab's
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenWith(null);
      return true;
    });
    return () => sub.remove();
  }, [openWith, inFront]);
  if (openWith) {
    const back = () => setOpenWith(null);
    return (
      <CommunityTermsGate onBack={back}>
        <CommunityDmThreadScreen inGate={{ recipientId: openWith, onBack: back }} />
      </CommunityTermsGate>
    );
  }
  // She acted first: a tap still waiting is spent, so it opens nothing later.
  const press = (coachId: string) => {
    if (recipientId) spend();
    setOpenWith(coachId);
  };
  const card = former ? <FormerCoachEntry former={former} onPress={() => press(former.coachId)} testID={`${testID}-former`} /> : undefined;
  return <JoinCoachState title={title} body={body} edges={['top']} extra={card} testID={testID} />;
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  // S3_nocoach: the card 16 pt from the screen's sides (the page's 24 pt gutter, 8 out), 6 more above it.
  extra: { marginTop: 6, marginHorizontal: -layout.gutter },
});

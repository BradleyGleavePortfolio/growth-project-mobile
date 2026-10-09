/**
 * JoinCoachState: the calm locked state a client with no coach meets where
 * coaching lives (owner 2026-10-09 00:0x: "Lets lock roman usage away for
 * coachless clients with epxlanation, lets show \"Join a coach\" on community
 * message screens - lets leave basic self logging alone though!").
 *
 * One serif headline, one muted line, one forest "Join a coach" button. The
 * button opens the existing coachless join path: the coach-code sheet on
 * Messages (EntitlementProvider.messageCoach, the same action as the coachless
 * gate in ProtectedScreen). Copy never says "your coach": there is none yet.
 */
import React, { useContext, useEffect, useReducer } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { Headline, Lede, PrimaryButton, Screen, ScreenTopBar, type ScreenEdge } from '../../ui';
import RomanAvatar from '../roman/RomanAvatar';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import { readUserCacheSync } from '../../lib/userCache';
import { spacing } from '../../theme/tokens';

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
  testID?: string;
}

export default function JoinCoachState({
  title,
  body,
  onBack,
  roman = false,
  edges = ['top', 'bottom'],
  testID = 'join-coach-state',
}: JoinCoachStateProps): React.ReactElement {
  const { messageCoach } = useEntitlement();
  return (
    <Screen
      edges={edges}
      scroll={false}
      centerContent
      header={<ScreenTopBar onBack={onBack} testID={`${testID}-top`} />}
      footer={<PrimaryButton label={JOIN_A_COACH} onPress={messageCoach} testID={`${testID}-join`} />}
      testID={testID}
    >
      <View style={styles.block}>
        {roman ? <RomanAvatar size={40} /> : null}
        <Headline level="h2">{title}</Headline>
        <Lede>{body}</Lede>
      </View>
    </Screen>
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
  if (needsCoach) return <JoinCoachState title={title} body={body} edges={['top']} testID={testID} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
});

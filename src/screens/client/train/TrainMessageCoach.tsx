/**
 * WORKOUT-STATES-M (C1 v2 C7, frame C2_first): "Message {coach}" under Quick workout on a coached client's first day.
 * WorkoutScreen mounts it only then (the switch on, a coach, the hero shown, the assignments read settled with no
 * workout), so the closed-chat read never starts for a client with no coach or on a page with a workout. It is kept
 * out of TrainToday.tsx, which the assignment page and the workout summary also import.
 * The words are Home's and You's (messageCoachLabel); the coach is the tab's own (trainCoachName on the same coaches
 * read TrainDay holds); the link shows only while the coaching chat is known open (FR-880R2/R3, owner 10-23
 * "Dissapear"); a tap opens the coaching chat as You does, over Home's first screen, so Back lands on Home.
 */
import React from 'react';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { messageCoachLabel } from '../../../components/home/HomeHeaderActions';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useCoachChatClosed } from '../../../hooks/useCoachChatClosed';
import { TextLink } from '../../../ui';
import { trainCoachName } from './TrainToday';

export default function TrainMessageCoach({ coachId }: { coachId: string }) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const chat = useCoachChatClosed(coachId);
  const coaches = useMyCoaches(true).data;
  if (!chat.known || chat.closed) return null;
  const open = () => (navigation.getParent() ?? navigation).navigate('Home', { screen: 'Messages', initial: false });
  return <TextLink label={messageCoachLabel(trainCoachName(coaches, coachId))} tone="accent" onPress={open} testID="train-message-coach" />;
}

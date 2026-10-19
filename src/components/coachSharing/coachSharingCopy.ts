/**
 * Client-facing copy for Settings > Privacy > Coach sharing (B-SHARE-127).
 * No switches (owner #SHARE-SIMPLE / #SHARE-JOIN): the page says what the
 * current coach sees and how new device data stops (a disconnect in
 * Connected devices, disconnectCopy.ts; or the phone's Health permissions,
 * as the join sentence W-SU-1 says). Android says Health Connect.
 */
import { Platform } from 'react-native';

const health = () => (Platform.OS === 'android' ? 'Health Connect' : 'Apple Health');

export const coachSharingCopy = {
  settingsRow: 'Coach sharing',
  settingsRowHint: 'Opens what your coach can see',
  intro: 'Your coach sees your workouts, food logs, weigh-ins, check-ins and habits.',
  loading: 'Loading coach sharing',
  loadFailed: 'Coach sharing could not load. Check the connection and try again.',
  retry: 'Try again',
  noCoach: 'Coach sharing applies once a coach is connected to this account.',
  devicesNote: () =>
    `Your coach also sees data from ${health()} and other devices you connect. To stop new data, disconnect it in Connected devices or turn TGP Fitness off in your phone's ${health()} permissions. Data already shared stays with your coach.`,
  devicesLink: 'Connected devices',
  devicesLinkHint: 'Opens your connected devices',
} as const;

/** Client-facing copy for coach sharing (B-SHARE-126). HELD: needs owner approval of the wording. */
const coach = (name: string | null) => name ?? 'your coach';

export const coachSharingCopy = {
  eyebrow: 'COACH SHARING',
  title: (name: string | null) => `Share your logs with ${coach(name)}?`,
  what: (name: string | null) => `${name ?? 'Your coach'} will see your workouts, food logs, weigh-ins, and check-ins and habits.`,
  later: 'Change this any time in Settings > Privacy > Coach sharing.',
  share: 'Share with my coach',
  shareHint: (name: string | null) => `Shares workouts, food logs, weigh-ins, and check-ins and habits with ${coach(name)}`,
  sharing: 'Sharing',
  notNow: 'Not now',
  notNowHint: 'Continues without sharing. This can be changed later in Settings',
  shareFailed: 'Sharing did not finish. Check the connection and try again.',

  // Settings > Privacy > Coach sharing
  settingsRow: 'Coach sharing',
  settingsRowHint: 'Choose which logs your coach can see',
  intro: 'Choose what your coach sees. Each change saves right away.',
  ownerNote: 'Your coach uses the TGP owner account, which can see these logs even when they are turned off here.',
  on: 'Shared',
  off: 'Not shared',
  rowFailed: (label: string) => `${label} could not be updated. Check the connection and try again.`,
  loading: 'Loading coach sharing',
  loadFailed: 'Coach sharing could not load. Check the connection and try again.',
  retry: 'Try again',
  noCoach: 'Coach sharing applies once a coach is connected to this account.',
} as const;

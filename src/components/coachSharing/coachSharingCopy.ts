/**
 * Client-facing copy for Settings > Privacy > Coach sharing (B-SHARE-127).
 * No switches (owner #SHARE-SIMPLE / #SHARE-JOIN): each log shows what the
 * server says the coach can read. Only existing strings; the intro, devices
 * note and row hint wait for an owner wording ruling (PR #758 table).
 */
export const coachSharingCopy = {
  settingsRow: 'Coach sharing',
  on: 'Shared',
  off: 'Not shared',
  loading: 'Loading coach sharing',
  loadFailed: 'Coach sharing could not load. Check the connection and try again.',
  retry: 'Try again',
  noCoach: 'Coach sharing applies once a coach is connected to this account.',
  devicesLink: 'Connected devices',
  devicesLinkHint: 'Opens your connected devices',
} as const;

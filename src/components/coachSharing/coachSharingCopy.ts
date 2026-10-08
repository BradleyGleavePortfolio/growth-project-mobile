/** Client-facing copy for Settings > Privacy > Coach sharing (B-SHARE-127). */
export const coachSharingCopy = {
  settingsRow: 'Coach sharing',
  settingsRowHint: 'Choose which logs your coach can see',
  /** The switches cover these four logs only; connected devices are stated under them (FW-BODY B2). */
  intro: 'Choose which of these logs your coach sees. Each change saves right away.',
  /** owner_access true: the server says the coach is the owner account. */
  ownerNote: 'Your coach uses the TGP owner account, which can see these logs even when they are turned off here.',
  /** owner_access not reported (older backend): the case cannot be ruled out, so it is stated as a condition. */
  ownerNoteUnknown:
    'If your coach uses the TGP owner account, that account can see these logs even when they are turned off here.',
  on: 'Shared',
  off: 'Not shared',
  rowFailed: (label: string) => `${label} could not be updated. Check the connection and try again.`,
  loading: 'Loading coach sharing',
  loadFailed: 'Coach sharing could not load. Check the connection and try again.',
  retry: 'Try again',
  noCoach: 'Coach sharing applies once a coach is connected to this account.',
  /**
   * FW-BODY B2: a coach reads Apple Health and Health Connect data whatever the
   * switches say (backend wearable-samples.service.ts assertCoachOwnsClient checks
   * the coach link only), and a disconnect keeps what came in (disconnectCopy.ts).
   */
  devicesNote:
    'Connected devices, such as Apple Health and Health Connect, are not covered by these switches. Your coach can see the data they bring in, and data already shared stays with your coach after you disconnect.',
  devicesLink: 'Connected devices',
  devicesLinkHint: 'Opens your connected devices',
} as const;

/** The owner-account line for a read, or null when the server says the coach is not the owner account. */
export function ownerAccessNote(ownerAccess: boolean | null): string | null {
  if (ownerAccess === true) return coachSharingCopy.ownerNote;
  if (ownerAccess === null) return coachSharingCopy.ownerNoteUnknown;
  return null;
}

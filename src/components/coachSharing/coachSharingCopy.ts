/** Client-facing copy for Settings > Privacy > Coach sharing (B-SHARE-127). */
export const coachSharingCopy = {
  settingsRow: 'Coach sharing',
  settingsRowHint: 'Choose which logs your coach can see',
  intro: 'Choose what your coach sees. Each change saves right away.',
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
} as const;

/** The owner-account line for a read, or null when the server says the coach is not the owner account. */
export function ownerAccessNote(ownerAccess: boolean | null): string | null {
  if (ownerAccess === true) return coachSharingCopy.ownerNote;
  if (ownerAccess === null) return coachSharingCopy.ownerNoteUnknown;
  return null;
}

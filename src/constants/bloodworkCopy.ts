/**
 * Bloodwork copy — centralised, audited strings.
 *
 * Every string a user sees on a bloodwork surface must come from this
 * module. The forbidden-claims tests
 * (`src/__tests__/bloodworkCopy.test.ts`) scan this file for diagnostic /
 * prescriptive language. If you need to add a string, add it here, not
 * inline in a screen — that way the audit can catch it.
 *
 * Tone: educational, coaching context, never clinical authority.
 */

/**
 * Long-form disclaimer, shown at the top of every bloodwork surface
 * and in the acknowledgement modal.
 */
export const BLOODWORK_DISCLAIMER_LONG =
  'These results, notes, and tips are educational coaching context only. ' +
  'They are not medical advice and are not a diagnosis, and they are not ' +
  'a substitute for guidance from your doctor or another licensed ' +
  'clinician. Always speak with your clinician about your results and ' +
  'before making changes to your care.';

/**
 * Short banner shown above any AI- or coach-derived insight body.
 */
export const BLOODWORK_DISCLAIMER_SHORT =
  'Educational coaching context — not medical advice.';

/**
 * Title of the one-time acknowledgement modal shown on first entry.
 */
export const BLOODWORK_DISCLAIMER_MODAL_TITLE =
  'Before you view your lab results';

/**
 * Bullet points in the acknowledgement modal. Plain English. No emoji.
 * BEFORE PUBLIC LAUNCH: final wording needs lawyer sign-off.
 */
export const BLOODWORK_DISCLAIMER_MODAL_BULLETS: readonly string[] = [
  'The values and notes here are for your own reference only. They are not medical advice.',
  'This app cannot diagnose illness, recommend treatments, or replace your doctor.',
  'Always talk to a licensed clinician before acting on any lab result.',
  'Your coach may add educational context, but that is not clinical guidance.',
  'If you are concerned about a result, contact your doctor or health service.',
];

/**
 * Text of the acknowledgement button. The user taps this to confirm they
 * have read and understood the disclaimer.
 */
export const BLOODWORK_DISCLAIMER_ACK_BUTTON = 'I understand';

/**
 * Inline note shown next to anything still awaiting coach review.
 */
export const BLOODWORK_AWAITING_REVIEW_NOTE =
  'Your coach is reviewing this. Tips appear here once they sign off.';

/**
 * Copy used when a coach marks a row as "needs clinician context".
 */
export const BLOODWORK_CLINICIAN_REFERRAL_NOTE =
  'Your coach has flagged this for your clinician. Please share these ' +
  'results with your doctor — your coach will not interpret it for you.';

/**
 * Empty-state copy on the client manual-entry screen.
 */
export const BLOODWORK_CLIENT_EMPTY_TITLE = 'No lab results yet';
export const BLOODWORK_CLIENT_EMPTY_BODY =
  'You can manually add results from a lab printout or your patient ' +
  'portal. Your coach will review them and may add educational notes.';

/**
 * Empty-state copy on the coach review queue.
 */
export const BLOODWORK_COACH_EMPTY_TITLE = 'No lab panels to review';
export const BLOODWORK_COACH_EMPTY_BODY =
  'When a client submits results, they appear here for review. You can ' +
  'add educational context, ask for a missing source, or refer the ' +
  'client to their clinician.';

/**
 * Copy used when the feature flag is OFF (in case a deep link or stale
 * route hits the screen anyway). Intentionally bland.
 */
export const BLOODWORK_FEATURE_OFF_TITLE = 'Lab results are not enabled';
export const BLOODWORK_FEATURE_OFF_BODY =
  'This area is being prepared. Your coach will let you know when it is ' +
  'available.';

/**
 * Copy shown during the disclaimer loading state (e.g. while SecureStore
 * is being read on first mount).
 */
export const BLOODWORK_LOADING_DISCLAIMER_CHECK = 'Loading...';

/**
 * Manual-entry form labels. Kept in copy file so the audit picks them up.
 */
export const BLOODWORK_FORM_LABELS = {
  panelLabel: 'Panel name (optional)',
  panelLabelHint: 'e.g. "Annual physical, March 2026"',
  collectionDate: 'Collection date',
  labName: 'Lab or source (optional)',
  labNameHint: 'e.g. Quest, LabCorp, patient portal',
  sourceNotes: 'Notes about the source (optional)',
  markerName: 'Marker',
  markerNameHint: 'e.g. Vitamin D, 25-OH',
  markerValue: 'Value',
  markerUnit: 'Unit',
  referenceLow: 'Reference low (optional)',
  referenceHigh: 'Reference high (optional)',
  submitForReview: 'Submit to coach for review',
  saveDraft: 'Save draft',
  manualEntryNote: 'Manual entry — type values from your lab printout.',
} as const;

/**
 * Coach-side action labels.
 */
export const BLOODWORK_COACH_ACTIONS = {
  markReviewed: 'Mark as reviewed',
  requestSource: 'Ask client for source',
  referToClinician: 'Refer to clinician',
  hideFromClient: 'Hide from client',
  flagDisputed: 'Flag as disputed',
  approveAIDraft: 'Approve educational draft',
  rejectAIDraft: 'Reject draft',
} as const;

/**
 * Strings explicitly forbidden anywhere in the bloodwork surface. Used
 * by `src/__tests__/bloodworkCopy.test.ts` to keep the tone honest.
 *
 * These are *substrings*, case-insensitive. The intent is "if a string
 * contains this word/phrase, it should fail review". `prescribe`,
 * `dosage`, etc. would be diagnostic / prescriptive even with a
 * disclaimer next to them.
 */
/**
 * The list bans phrases that *make* a clinical claim. We deliberately do
 * NOT ban the bare word "diagnosis" — the long-form disclaimer needs to
 * say "not a diagnosis", which is the opposite of a clinical claim. If a
 * future copy edit wants to say "diagnose" or "diagnostic" in a way that
 * implies the app is doing diagnosis, the per-phrase entries below catch
 * it.
 */
export const BLOODWORK_FORBIDDEN_PHRASES: readonly string[] = [
  'you have',          // "you have hypothyroidism", "you have low iron"
  'you are diagnosed',
  'we diagnose',
  'this diagnoses',
  'diagnose your',
  'prescrib',          // prescribe / prescription / prescribing
  'dosage',
  'dose of',
  'should take',
  'recommend you take',
  'we recommend taking',
  'treat your',
  'cure',
  'urgent care',
  'go to the er',
  'call 911',
  'this is dangerous',
  'this is critical',
  'stop your medication',
];

/**
 * Phrases the long-form disclaimer MUST contain. Tested explicitly so a
 * future copy edit can't quietly drop the safety language.
 */
export const BLOODWORK_REQUIRED_DISCLAIMER_PHRASES: readonly string[] = [
  'not medical advice',
  'not a diagnosis',
  'clinician',
];

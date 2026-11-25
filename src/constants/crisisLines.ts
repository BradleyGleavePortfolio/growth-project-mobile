/**
 * The one home of the crisis sentences the app typed more than once (#202-S5, owner "OPTION 1 - FOLD IT INTO THE TWO
 * CRISIS-TEXT JOBS": each sentence lives once on the phone, every screen reads that copy, and a test fails if it is
 * typed out anywhere else; src/__tests__/crisisTextM.oneCopy.test.ts). Both are guideline 7's words, owner-approved
 * 2026-10-01 09:07 PDT. Readers keep every byte of their full message (pinned by sha-256): guideline 7
 * (COMMUNITY_GUIDELINES), REPORT_EMERGENCY_NOTE and P8_COPY.emergency. No imports here, so any file can read it.
 */

export const CRISIS_LINE_DANGER_911 = 'If you are in danger, call 911.';

export const CRISIS_LINE_STRUGGLING_988 = 'If you are struggling emotionally, call or text 988.';

/**
 * The 911 / 988 line: guideline 7's two sentences. The poster of community text the server's crisis check flagged
 * sees it (CRISIS-TEXT-M, owner #200-S1 op 1; operator ruling 3: COMMUNITY_REPORT_CRISIS_LINE's bytes differ, so
 * guideline 7's win).
 */
export const CRISIS_LINE_911_988 = `${CRISIS_LINE_DANGER_911} ${CRISIS_LINE_STRUGGLING_988}`;

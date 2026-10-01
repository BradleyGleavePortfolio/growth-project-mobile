/**
 * Consultation engine: conditions, validation, navigation order, chapter
 * progress, resume and the save payload. Pure functions, no rendering.
 */
import { SCREENS, screenById } from '../definitions';
import {
  ageOn,
  answersForSave,
  chapterProgress,
  endsChapter,
  evaluateCondition,
  fillCopy,
  firstIncompleteScreenId,
  firstSessionOptions,
  hasAnswersBeyondConsent,
  isConsentAnswerCurrent,
  isVisible,
  nextScreenId,
  previousScreenId,
  progressSegments,
  requiredComplete,
  resumeScreenId,
  toggleSelection,
  validateScreen,
  visibleScreens,
} from '../engine';
import { createHash } from 'crypto';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_VERSION,
  aiConsentCopyText,
  buildSummary,
  CONSENT_BINDING,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_COPY_SHA256,
  CONSENT_FOOTER,
  CONSENT_PARAGRAPHS,
  CONSENT_TITLE,
  consentCopyText,
  CONSULT_CONSENT_COPY_VERSION,
  P8_COPY,
} from '../copy';
import { answersBeforeSafety, fullAnswers, NOW } from '../__fixtures__/consultFixtures';

const def = (id: string) => {
  const s = screenById(id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe('definitions', () => {
  it('lists every contract screen in order, as data', () => {
    expect(SCREENS.map((s) => s.id)).toEqual([
      'W1', 'P0', 'G1', 'G2', 'B1', 'B2', 'B3', 'B4', 'L1', 'L2', 'T1', 'T2', 'T3', 'T4',
      'S1', 'S2', 'S3', 'S3b', 'N1', 'N2', 'N3', 'N4', 'N5',
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'C1',
    ]);
    for (const s of SCREENS) {
      expect(typeof s.chapter).toBe('number');
      expect(s.template).toBeTruthy();
      expect(s.question.length).toBeGreaterThan(0);
    }
  });

  it('copy follows Quiet Luxury: no exclamation marks, no emoji, no em dashes', () => {
    const strings: string[] = [];
    for (const s of SCREENS) {
      strings.push(s.question, s.roman ?? '', s.why ?? '', s.sub ?? '', s.cta ?? '');
      for (const o of s.options ?? []) strings.push(o.label, o.sub ?? '');
      for (const o of s.detail?.chipsOptions ?? []) strings.push(o.label);
    }
    strings.push(...CONSENT_PARAGRAPHS, CONSENT_CHECKBOX_LABEL, P8_COPY.intro, P8_COPY.physician, ...P8_COPY.guidance, ...P8_COPY.next);
    for (const t of strings) {
      expect(t).not.toMatch(/!/);
      expect(t).not.toMatch(/\u2014/);
      expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('the P0 copy is the D2 contract copy: two boxes, box 1 for coaching, box 2 optional for Roman and AI', () => {
    expect(CONSENT_TITLE).toBe('Before we start');
    expect(CONSENT_PARAGRAPHS).toHaveLength(3);
    const coaching = CONSENT_PARAGRAPHS.join(' ');
    expect(coaching).toMatch(/personal training and nutrition guidance only/);
    expect(coaching).toMatch(/We do not diagnose, treat, or give medical advice/);
    expect(coaching).toMatch(/the screening questions/);
    expect(coaching).toMatch(/We never sell it/);
    expect(coaching).toMatch(/the clinic does not see it/);
    // Box 1 is not an AI consent: no processor named above or in it.
    expect(coaching + CONSENT_CHECKBOX_LABEL).not.toMatch(/Anthropic|Roman/);
    expect(CONSENT_CHECKBOX_LABEL).toBe(
      'I agree to the training waiver, and to The Growth Project and my coach collecting and using my information to coach me.',
    );
    expect(AI_CONSENT_PARAGRAPH).toMatch(/powered by Anthropic, a third-party AI provider/);
    expect(AI_CONSENT_PARAGRAPH).toMatch(/never your coach's private notes/);
    expect(AI_CONSENT_PARAGRAPH).toMatch(/kept for 180 days/);
    expect(AI_CONSENT_CHECKBOX_LABEL).toMatch(/^Optional: I allow Roman/);
    expect(CONSENT_FOOTER).toMatch(/^Nothing is sent until you continue\./);
    expect(CONSENT_FOOTER).toMatch(/guided tour works either way/);
    // Verbatim contract copy uses straight apostrophes (the R2a server copy hashes depend on it).
    expect(AI_CONSENT_PARAGRAPH + AI_CONSENT_CHECKBOX_LABEL + CONSENT_FOOTER).not.toMatch(/\u2019/);
    // Plain copy: no exclamation marks.
    for (const t of [...CONSENT_PARAGRAPHS, CONSENT_CHECKBOX_LABEL, AI_CONSENT_PARAGRAPH, AI_CONSENT_CHECKBOX_LABEL, CONSENT_FOOTER]) {
      expect(t).not.toMatch(/!/);
    }
  });

  it('versions are bound: consult-consent-v2 with client-ai-v3 and pt-waiver-v1', () => {
    expect(CONSULT_CONSENT_COPY_VERSION).toBe('consult-consent-v2');
    expect(AI_CONSENT_VERSION).toBe('client-ai-v3');
    expect(CONSENT_BINDING).toEqual({
      copy_version: 'consult-consent-v2',
      ai_consent_version: 'client-ai-v3',
      waiver_version: 'pt-waiver-v1',
    });
  });

  it('pinned copy hashes match the displayed text (any copy change must bump the version and the hash)', () => {
    const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
    expect(sha(consentCopyText())).toBe(CONSENT_COPY_SHA256);
    expect(sha(aiConsentCopyText())).toBe(AI_CONSENT_COPY_SHA256);
    expect(consentCopyText().startsWith('Before we start\n\nThe Growth Project provides')).toBe(true);
    expect(aiConsentCopyText()).toBe(`${AI_CONSENT_PARAGRAPH}\n\n${AI_CONSENT_CHECKBOX_LABEL}`);
    // Backend R2a (#622) pins the same text: paragraph 4, box 2 label and their join.
    expect(sha(AI_CONSENT_PARAGRAPH)).toBe('77c0e7062adb29cf59a532b130e50d5b373789c3564972cc309d8361bf57227b');
    expect(sha(AI_CONSENT_CHECKBOX_LABEL)).toBe('77da153df7f06a045e1abbbb83b771f8a33941d47268e276becc6b4ffe5e5eba');
    // If this fails, the copy changed: bump CONSULT_CONSENT_COPY_VERSION (and
    // AI_CONSENT_VERSION for paragraph 4 / box 2) and re-pin with the new text.
    expect(CONSENT_COPY_SHA256).toBe('154bd332c992e4e28ac58d1f1c40e856ff055581e383d85656f245853f55589f');
    expect(AI_CONSENT_COPY_SHA256).toBe('d8738c900ed2bfbb12b7ca6423132a532fc47e2cd0fe52854cc38e34c427840f');
  });

  it('P8 gives guidance and a next step before the physician line', () => {
    expect(P8_COPY.guidance.length).toBeGreaterThanOrEqual(3);
    expect(P8_COPY.next.some((t) => /next step/.test(t))).toBe(true);
    expect(P8_COPY.emergency).toMatch(/911/);
    expect(P8_COPY.emergency).toMatch(/988/);
  });
});

describe('conditions', () => {
  it('evaluates equals, notEquals, includes, all and any', () => {
    const a = { S3: 'gym', G2: ['other'], P2: 'yes' };
    expect(evaluateCondition({ key: 'S3', equals: 'gym' }, a)).toBe(true);
    expect(evaluateCondition({ key: 'S3', notEquals: 'gym' }, a)).toBe(false);
    expect(evaluateCondition({ key: 'G2', includes: 'other' }, a)).toBe(true);
    expect(evaluateCondition({ all: [{ key: 'S3', equals: 'gym' }, { key: 'P2', equals: 'no' }] }, a)).toBe(false);
    expect(evaluateCondition({ any: [{ key: 'P1', equals: 'yes' }, { key: 'P2', equals: 'yes' }] }, a)).toBe(true);
  });

  it('S3b shows only for "At home, with some equipment"', () => {
    expect(isVisible(def('S3b'), { S3: 'home_some' })).toBe(true);
    expect(isVisible(def('S3b'), { S3: 'gym' })).toBe(false);
    expect(isVisible(def('S3b'), {})).toBe(false);
  });

  it('P8 shows only when any P1-P7 answer is yes', () => {
    expect(isVisible(def('P8'), fullAnswers())).toBe(false);
    for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
      expect(isVisible(def('P8'), fullAnswers({ [k]: 'yes' }))).toBe(true);
    }
  });

  it('navigation skips hidden screens in both directions', () => {
    const gym = fullAnswers({ S3: 'gym' });
    expect(nextScreenId('S3', gym)).toBe('N1');
    expect(previousScreenId('N1', gym)).toBe('S3');
    const home = fullAnswers();
    expect(nextScreenId('S3', home)).toBe('S3b');
    expect(nextScreenId('P7', fullAnswers())).toBe('C1');
    expect(nextScreenId('P7', fullAnswers({ P3: 'yes' }))).toBe('P8');
    expect(nextScreenId('P8', fullAnswers({ P3: 'yes' }))).toBe('C1');
    expect(nextScreenId('C1', fullAnswers())).toBeNull();
    expect(previousScreenId('W1', {})).toBeNull();
  });
});

describe('validation', () => {
  it('required single-select needs an answer', () => {
    expect(validateScreen(def('G1'), {}).valid).toBe(false);
    expect(validateScreen(def('G1'), { G1: 'fat_loss' }).valid).toBe(true);
  });

  it('caps G2 at three and honours exclusive options', () => {
    let cur: string[] = [];
    for (const v of ['energy', 'strength', 'family', 'event']) cur = toggleSelection(cur, v, { max: 3 });
    expect(cur).toEqual(['energy', 'strength', 'family']);
    expect(toggleSelection(['dairy', 'nuts'], 'nothing', { exclusive: 'nothing' })).toEqual(['nothing']);
    expect(toggleSelection(['nothing'], 'dairy', { exclusive: 'nothing' })).toEqual(['dairy']);
    expect(toggleSelection(['dairy'], 'dairy')).toEqual([]);
    expect(validateScreen(def('G2'), { G2: ['a', 'b', 'c', 'd'] }).valid).toBe(false);
  });

  it('S3b and N2 need at least one selection', () => {
    expect(validateScreen(def('S3b'), { S3: 'home_some', S3b: [] }).valid).toBe(false);
    expect(validateScreen(def('S3b'), { S3: 'home_some', S3b: ['barbell'] }).valid).toBe(true);
    expect(validateScreen(def('N2'), { N2: [] }).valid).toBe(false);
  });

  it('T3 yes requires at least one area; no does not', () => {
    expect(validateScreen(def('T3'), { T3: 'no' }).valid).toBe(true);
    const r = validateScreen(def('T3'), { T3: 'yes' });
    expect(r.valid).toBe(false);
    expect(r.message).toBe('Choose at least one area.');
    expect(validateScreen(def('T3'), { T3: 'yes', T3_areas: ['knee'] }).valid).toBe(true);
  });

  it('date of birth enforces ages 16 to 100 and real dates', () => {
    expect(ageOn('1988-03-14', NOW)).toBe(38);
    expect(ageOn('2010-10-01', NOW)).toBe(15);
    expect(validateScreen(def('B2'), { B2: '1988-03-14' }, NOW).valid).toBe(true);
    const young = validateScreen(def('B2'), { B2: '2012-01-01' }, NOW);
    expect(young.valid).toBe(false);
    expect(young.message).toMatch(/16 and over/);
    expect(validateScreen(def('B2'), { B2: '1990-02-31' }, NOW).message).toBe('Choose a real date.');
  });

  it('height and weight must be in range', () => {
    expect(validateScreen(def('B3'), { B3: { height_cm: 167.6, weight_lbs: 172, unit: 'imperial' } }).valid).toBe(true);
    expect(validateScreen(def('B3'), { B3: { height_cm: 50, weight_lbs: 172, unit: 'imperial' } }).valid).toBe(false);
  });

  it('P0 is valid only with the agreed box', () => {
    expect(validateScreen(def('P0'), {}).valid).toBe(false);
    expect(validateScreen(def('P0'), fullAnswers()).valid).toBe(true);
  });

  it('P0 comes straight after W1, before any answer, and the safety chapter has no consent box (A-02)', () => {
    expect(SCREENS[0].id).toBe('W1');
    expect(SCREENS[1].id).toBe('P0');
    expect(def('P0').chapter).toBe(0);
    const safety = SCREENS.filter((x) => x.chapter === 7);
    expect(safety.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    expect(safety.some((x) => x.template === 'consent')).toBe(false);
    expect(SCREENS.filter((x) => x.template === 'consent')).toHaveLength(1);
    // With no answers at all, the first gap is the agreement.
    expect(firstIncompleteScreenId({}, NOW)).toBe('P0');
    expect(resumeScreenId(null, { G1: 'fat_loss' }, NOW)).toBe('P0');
  });

  it('a stored P0 counts only when it matches the displayed copy version (A-03)', () => {
    const cur = (v: unknown) => isConsentAnswerCurrent(v as never);
    const ok = { agreed: true, copy_version: CONSULT_CONSENT_COPY_VERSION, agreed_at: '2026-09-30T19:00:00.000Z' };
    expect(cur(ok)).toBe(true);
    expect(cur({ ...ok, copy_version: 'consult-consent-v0' })).toBe(false);
    expect(cur({ ...ok, copy_version: 'consult-consent-v1' })).toBe(false); // the single-box copy
    expect(cur({ ...ok, text_sha256: CONSENT_COPY_SHA256 })).toBe(true);
    expect(cur({ ...ok, text_sha256: 'ABC' })).toBe(false);
    expect(cur({ ...ok, copy_version: 'obsolete-v0' })).toBe(false);
    expect(cur({ ...ok, agreed: false })).toBe(false);
    expect(cur({ ...ok, agreed_at: 'not a date' })).toBe(false);
    expect(cur({ agreed: true })).toBe(false);
    expect(cur('yes')).toBe(false);
    expect(cur(['agreed'])).toBe(false);
    expect(cur(undefined)).toBe(false);
    expect(validateScreen(def('P0'), { P0: { ...ok, copy_version: 'obsolete-v0' } as never }).valid).toBe(false);
    expect(resumeScreenId('SUM', fullAnswers({ P0: { ...ok, copy_version: 'obsolete-v0' } as never }), NOW)).toBe('P0');
  });

  it('cached answers must be real options, finite measures and a current C1 (C-01)', () => {
    expect(validateScreen(def('B1'), { B1: 'invalid-option' }, NOW).valid).toBe(false);
    expect(validateScreen(def('B1'), { B1: 'female' }, NOW).valid).toBe(true);
    expect(validateScreen(def('B3'), { B3: { height_cm: 'garbage', weight_lbs: 'garbage' } } as never, NOW).valid).toBe(false);
    expect(validateScreen(def('B3'), { B3: 'not-a-measure' } as never, NOW).valid).toBe(false);
    expect(validateScreen(def('C1'), { C1: '2020-01-01' }, NOW).valid).toBe(false);
    expect(validateScreen(def('C1'), { C1: '2026-10-01' }, NOW).valid).toBe(true);
    expect(validateScreen(def('N2'), { N2: ['dairy', 'not-a-food'] }, NOW).valid).toBe(false);
    expect(validateScreen(def('T3'), { T3: 'yes', T3_areas: ['elbow_wrist', 'tail'] }, NOW).valid).toBe(false);
    expect(validateScreen(def('S1'), { S1: 4 } as never, NOW).valid).toBe(false);
  });

  it('screening questions are required, never skippable', () => {
    for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
      expect(def(k).skippable).toBeFalsy();
      expect(validateScreen(def(k), {}).valid).toBe(false);
    }
  });

  it('detail text is limited to its max length', () => {
    expect(validateScreen(def('P1'), { P1: 'yes', P1_note: 'x'.repeat(281) }).valid).toBe(false);
    expect(validateScreen(def('P1'), { P1: 'yes', P1_note: 'x'.repeat(280) }).valid).toBe(true);
  });

  it('the full sample answer set is complete', () => {
    expect(requiredComplete(fullAnswers(), NOW)).toBe(true);
    expect(firstIncompleteScreenId(fullAnswers({ L1: undefined }), NOW)).toBe('L1');
  });
});

describe('chapter progress', () => {
  it('reports position within the chapter from visible screens', () => {
    expect(chapterProgress('B3', fullAnswers())).toEqual({ chapter: 2, position: 3, count: 4, totalChapters: 8 });
    expect(chapterProgress('S3', fullAnswers()).count).toBe(4);
    expect(chapterProgress('S3', fullAnswers({ S3: 'gym' })).count).toBe(3);
    expect(chapterProgress('P1', fullAnswers()).count).toBe(7); // P1-P7 (P0 moved to the start)
    expect(chapterProgress('P1', fullAnswers({ P1: 'yes' })).count).toBe(8); // + P8
  });

  it('fills completed chapters and the current one partially', () => {
    const segs = progressSegments({ chapter: 3, position: 1, count: 2, totalChapters: 8 });
    expect(segs).toEqual([1, 1, 0.5, 0, 0, 0, 0, 0]);
  });

  it('marks chapter ends as save points', () => {
    const a = fullAnswers();
    expect(endsChapter('G2', a)).toBe(true);
    expect(endsChapter('G1', a)).toBe(false);
    expect(endsChapter('S3b', a)).toBe(true);
    expect(endsChapter('S3', fullAnswers({ S3: 'gym' }))).toBe(true);
    expect(endsChapter('C1', a)).toBe(true);
  });
});

describe('resume', () => {
  it('starts at the welcome with no answers', () => {
    expect(resumeScreenId(null, {}, NOW)).toBe('W1');
  });

  it('returns to the saved screen when it is still visible', () => {
    expect(resumeScreenId('P0', answersBeforeSafety(), NOW)).toBe('P0');
    expect(resumeScreenId('P1', answersBeforeSafety(), NOW)).toBe('P1');
    expect(resumeScreenId('N3', answersBeforeSafety(), NOW)).toBe('N3');
  });

  it('returns to an earlier gap before the saved screen', () => {
    const a = answersBeforeSafety();
    delete a.L1;
    expect(resumeScreenId('N3', a, NOW)).toBe('L1');
  });

  it('falls back to the first gap when the saved screen is now hidden', () => {
    const a = answersBeforeSafety();
    a.S3 = 'gym';
    expect(resumeScreenId('S3b', a, NOW)).toBe('P1');
  });

  it('resumes at the summary when everything is answered', () => {
    expect(resumeScreenId('SUM', fullAnswers(), NOW)).toBe('SUM');
    expect(resumeScreenId(undefined, fullAnswers(), NOW)).toBe('SUM');
  });
});

describe('save payload', () => {
  it('clears (null) answers for hidden screens and collapsed details, so the server does not keep them (B-06)', () => {
    const a = fullAnswers({ S3: 'gym', T3: 'no', T3_areas: ['knee'], P2: 'no', P2_note: 'old note' });
    const out = answersForSave(a);
    expect(out).toHaveProperty('S3b', null);
    expect(out).toHaveProperty('T3_areas', null);
    expect(out).toHaveProperty('P2_note', null);
    expect(out.G1).toBe('fat_loss');
    expect(out.P0).toEqual(a.P0);
    expect(JSON.stringify(out)).not.toContain('old note');
    // Intro and message screens have no answer to clear.
    expect(out).not.toHaveProperty('W1');
  });

  it('an emptied note or a deselected "other" is sent as null while the parent is still open (B-06)', () => {
    const out = answersForSave(fullAnswers({ T3: 'yes', T3_areas: ['knee'], T3_note: '', G2: ['energy'], G2_other: 'Run a 10k' }));
    expect(out.T3_areas).toEqual(['knee']);
    expect(out).toHaveProperty('T3_note', null);
    expect(out).toHaveProperty('G2_other', null);
    const kept = answersForSave(fullAnswers({ G2: ['energy', 'other'], G2_other: 'Run a 10k' }));
    expect(kept.G2_other).toBe('Run a 10k');
  });

  it('every key a save can carry, clears included, is a key backend #607 accepts (unknown keys are a 400)', () => {
    // Mirrors VALIDATORS in growth-project-backend src/onboarding/consultation-answers.ts at #607 245da2e7.
    const screening = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
    const accepted = new Set([
      'B1', 'B2', 'B3', 'B4', 'C1', 'G1', 'G2', 'G2_other', 'L1', 'L2', 'N1', 'N2', 'N2_other', 'N3', 'N4', 'N5',
      'P0', 'S1', 'S2', 'S3', 'S3b', 'T1', 'T2', 'T3', 'T3_areas', 'T3_note', 'T4',
      ...screening, ...screening.map((k) => `${k}_note`),
    ]);
    for (const a of [{}, fullAnswers(), fullAnswers({ S3: 'home_some', T3: 'yes', P2: 'yes', G2: ['other'] })]) {
      for (const k of Object.keys(answersForSave(a))) expect(accepted.has(k) ? k : `unknown:${k}`).toBe(k);
    }
  });

  it('a body of P0 and clears only counts as consent-only', () => {
    expect(hasAnswersBeyondConsent({ P0: fullAnswers().P0, P8: null, T3_note: null })).toBe(false);
    expect(hasAnswersBeyondConsent({ P0: fullAnswers().P0, G1: 'fat_loss' })).toBe(true);
  });

  it('keeps detail answers when the detail is open', () => {
    const out = answersForSave(fullAnswers({ T3: 'yes', T3_areas: ['knee'], P4: 'yes', P4_note: 'Old knee surgery' }));
    expect(out.T3_areas).toEqual(['knee']);
    expect(out.P4_note).toBe('Old knee surgery');
  });

  it('visible screens include P8 only on a yes', () => {
    expect(visibleScreens(fullAnswers()).some((s) => s.id === 'P8')).toBe(false);
    expect(visibleScreens(fullAnswers({ P6: 'yes' })).some((s) => s.id === 'P8')).toBe(true);
  });
});

describe('copy helpers', () => {
  it('fills coach and first name with calm fallbacks', () => {
    expect(fillCopy('Before {coach} builds', { coachName: 'Bradley' })).toBe('Before Bradley builds');
    expect(fillCopy('Before {coach} builds', {})).toBe('Before your coach builds');
    expect(fillCopy('{Coach} will see', {})).toBe('Your coach will see');
    expect(fillCopy('{greeting},\n{first}.', { firstName: 'Maya', now: NOW })).toBe('Good afternoon,\nMaya.');
    expect(fillCopy('{greeting},\n{first}.', { now: NOW })).toBe('Good afternoon.');
  });

  it('builds the first-session options from the clock', () => {
    const opts = firstSessionOptions(NOW);
    expect(opts.map((o) => o.label)).toEqual(['Today', 'Tomorrow, Thursday', 'Friday', 'Saturday']);
    expect(opts[1].value).toBe('2026-10-01');
  });

  it('builds a deterministic summary that never echoes screening answers', () => {
    const sum = buildSummary(fullAnswers(), NOW);
    expect(sum.map((x) => x.body)).toEqual([
      'Lose body fat, for more energy and to keep up with family.',
      '38 years, 5 ft 6 in and 172 lb, aiming for 150 lb.',
      'Moderately active. New to structured training. Three sessions a week, mornings, at home with dumbbells and bands. Thirty to forty-five minutes each.',
      'Nothing noted.',
      'No particular pattern, avoiding dairy, three meals a day.',
      'Complete.',
    ]);
    const yes = buildSummary(fullAnswers({ P5: 'yes', P5_note: 'private' }), NOW);
    expect(yes[5].body).toBe('Complete. Please check with your physician before starting.');
    expect(JSON.stringify(yes)).not.toMatch(/private/);
  });
});

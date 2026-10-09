/** K5-K8 pure rules (prototype 82-85): summary sentences, link text, copy rules. */
import { PROGRAMMING_STYLE_OPTIONS } from '../../../../../lib/coachConsultation/flow';
import {
  K5_COPY,
  K6_COPY,
  K7_COPY,
  K8_COPY,
  cardSentence,
  displayUrl,
  joinSentence,
  practiceSummary,
  shareMessage,
  specialtyLabels,
} from '../practiceCopy';

describe('K8 summary sentences', () => {
  it('leaves out a section the coach skipped and never prints an empty sentence', () => {
    const out = practiceSummary({ name: 'Jordan Reyes', business: '  ', specialtyLabels: [] });
    expect(out.map((s) => s.key)).toEqual(['card', 'link']);
    expect(out[0].sentence).toBe('Jordan Reyes.');
    expect(practiceSummary({}).map((s) => s.key)).toEqual(['link']);
    expect(practiceSummary({}).slice(-1)[0].sentence).toBe('Your link is in Settings > Invite Codes.');
    expect(practiceSummary({ linkLoaded: true }).slice(-1)[0].sentence).toBe('Your link is ready to share.');
  });

  it('joins one, two and many labels', () => {
    expect(joinSentence(['Mobility'])).toBe('Mobility.');
    expect(joinSentence(['Strength', 'Mobility'])).toBe('Strength and mobility.');
    expect(joinSentence([])).toBe('');
  });

  it('names specialties in the order chosen and drops unknown keys', () => {
    expect(specialtyLabels(['strength', 'fat_loss', 'beginners', 'unknown'])).toEqual(['Strength', 'Fat loss', 'Beginners']);
    expect(specialtyLabels(undefined)).toEqual([]);
  });

  it('does not double the full stop', () => {
    expect(cardSentence('Jordan Reyes', 'Reyes Strength Co.')).toBe('Jordan Reyes, Reyes Strength Co.');
    expect(cardSentence('', '')).toBe('');
  });
});

describe('K6 link text', () => {
  it('prints the link without the scheme and shares the real url', () => {
    expect(displayUrl('https://thegrowthproject.app/join/RS7K2Q/')).toBe('thegrowthproject.app/join/RS7K2Q');
    expect(shareMessage('https://thegrowthproject.app/join/RS7K2Q')).toBe(
      'Join my coaching on The Growth Project: https://thegrowthproject.app/join/RS7K2Q',
    );
  });
});

describe('copy rules', () => {
  const all = [
    ...Object.values(K5_COPY),
    ...PROGRAMMING_STYLE_OPTIONS.map((o) => o.label),
    ...Object.values(K6_COPY),
    ...Object.values(K7_COPY),
    ...Object.values(K8_COPY),
  ];
  // Roman speaks in the first person; the K5 options and the button labels
  // ("Share my link", "Show me around") are the coach's own voice.
  const appVoice = [
    ...Object.values(K6_COPY).filter((t) => t !== K6_COPY.roman),
    ...Object.values(K7_COPY),
    ...Object.values(K8_COPY).filter((t) => t !== K8_COPY.roman),
  ];

  it('has no exclamation marks or emojis', () => {
    for (const t of all) {
      expect(t).not.toMatch(/!/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('never speaks as "I" outside Roman', () => {
    for (const t of appVoice) expect(t).not.toMatch(/(^|\s)(I|I'm|I'll|I've|I'd)(\s|$)/);
  });
});

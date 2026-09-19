import dictionary from '../i18n/en.json';
// Preserve the original P1 dictionary contract independently of appended P2 groups.
const en = { common: dictionary.common, offer: dictionary.offer, source: dictionary.source, handoff: dictionary.handoff, accessibility: dictionary.accessibility };
import { importJourneyCopy as t, importOfferQuestion, ImportJourneyCopyKey } from '../importJourneyCopy';
import { brand, colors, darkTokens, lightTokens } from '../../../../theme/tokens';

it('resolves every authored P1 string and requires the only placeholder variable', () => {
  for (const [group, entries] of Object.entries(en)) {
    for (const [name, value] of Object.entries(entries)) {
      const key = `${group}.${name}` as ImportJourneyCopyKey;
      const result = key === 'handoff.source' ? t(key, { sourceName: 'TrueCoach' }) : t(key);
      expect(result).toBe(key === 'handoff.source' ? 'Selected site: \u2068TrueCoach\u2069' : value);
      expect(result).not.toMatch(/\{\w+\}/);
    }
  }
  expect(Object.keys(en)).toEqual(['common', 'offer', 'source', 'handoff', 'accessibility']);
  // P1 deliberately contains no run counters, pairing, link delivery or result copy.
  expect(JSON.stringify(en)).not.toMatch(/\{count\}|copied|saved|paired|imported successfully/);
});

it('pins neutral, explicit sir, and Roman-off wording', () => {
  expect(importOfferQuestion(true)).toBe('Have you coached on another platform before?');
  expect(importOfferQuestion(true, 'sir')).toBe('Have you coached on another platform before, sir?');
  expect(importOfferQuestion(false, 'sir')).toBe('Have you coached on another platform before?');
  expect(t('offer.value')).toBe('Would you like to bring your clients and coaching history into TGP?');
  expect(t('handoff.body')).toBe('You will need Chrome on a computer. Keep this setup open while you connect the TGP extension.');
});

it('interpolates a whole sentence as literal text, including replacement metacharacters', () => {
  expect(t('handoff.source', { sourceName: '$& {literal} <plain text>' })).toBe('Selected site: \u2068$& {literal} <plain text>\u2069');
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(h => parseInt(h, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

it.each([['light', lightTokens], ['dark', darkTokens]] as const)('measures actual %s text and control-boundary token pairs', (_mode, c) => {
  for (const bg of [c.bgPrimary, c.bgSurface, c.disabledBg]) expect(contrast(c.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
  for (const bg of [c.bgPrimary, c.bgSurface]) {
    expect(contrast(c.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textPrimary, bg)).toBeGreaterThanOrEqual(3);
  }
  expect(contrast(c.textOnAccent, colors.forest)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(c.textOnAccent, brand[800])).toBeGreaterThanOrEqual(4.5);
  expect(contrast(c.textOnDisabled, c.disabledBg)).toBeGreaterThanOrEqual(4.5);
});

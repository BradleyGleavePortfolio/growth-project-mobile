import en from '../i18n/en.json';
import { importJourneyCopy as t, ImportJourneyCopyKey, importQuantityCopy, isImportQuantity, importObservationCopy, importCheckedScopeCopy } from '../importJourneyCopy';

it('resolves every plain P2 string and pins its approved placeholders', () => {
  const visit = (value: unknown, prefix: string) => {
    if (typeof value === 'string') {
      if (!value.includes('{')) expect(t(prefix as Extract<ImportJourneyCopyKey, `progress.${string}` | `result.${string}`>)).toBe(value);
      else expect(value).toMatch(/\{(count|time|scopeLabel)\}/);
    } else for (const [key, entry] of Object.entries(value as object)) visit(entry, `${prefix}.${key}`);
  };
  visit(en.progress, 'progress'); visit(en.result, 'result');
  expect(JSON.stringify([en.progress, en.result])).not.toMatch(/Retry all|Start a new attempt|\{reference\}|\{clientName\}/);
});

it.each(['receipts', 'nativeClients', 'unconfirmedClients'] as const)('formats explicit zero/one/other %s quantities, never unknown as zero', kind => {
  expect(importQuantityCopy(kind, 0)).toContain('\u20680\u2069');
  expect(importQuantityCopy(kind, 1)).toContain('\u20681\u2069');
  expect(importQuantityCopy(kind, 12000, 'en-US')).toContain('\u206812,000\u2069');
  expect(importQuantityCopy(kind, 12000, 'de-DE')).toContain('\u206812.000\u2069');
  expect(importQuantityCopy(kind, 1, 'invalid_locale')).toContain('\u20681\u2069');
  for (const v of [undefined, null, '', '12', -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(isImportQuantity(v)).toBe(false); expect(importQuantityCopy(kind, v)).toBeNull();
  }
});

it('uses only supplied observation time and reviewed scope, never render time or arbitrary prose', () => {
  const observed = { epochMs: 0, locale: 'en-US', timeZone: 'UTC' };
  expect(importObservationCopy(observed)).toContain('Jan 1, 1970');
  expect(importObservationCopy(observed)).toContain('UTC');
  expect(importObservationCopy()).toBeNull();
  expect(importObservationCopy({ ...observed, epochMs: Infinity })).toBeNull();
  expect(importObservationCopy({ ...observed, epochMs: 8640000000000001 })).toBeNull();
  expect(importObservationCopy({ ...observed, timeZone: 'secret-token' })).toBeNull();
  expect(importCheckedScopeCopy('selectedClientRecords')).toBe('Checked scope: \u2068Selected client records\u2069.');
  expect(importCheckedScopeCopy('<unreviewed>' as 'selectedClientRecords')).toBeNull();
});

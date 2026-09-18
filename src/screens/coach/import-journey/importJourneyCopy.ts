import en from './i18n/en.json';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

type QuantityKey = `progress.${'receipts' | 'native'}.${'zero' | 'one' | 'other'}` | `result.unconfirmed.${'zero' | 'one' | 'other'}`;
// Variable-bearing P2 copy is accessed through the narrow formatters below.
export type ImportJourneyCopyKey = Exclude<Leaves<typeof en>, QuantityKey | 'progress.lastUpdate' | 'result.scope'>;
export type ImportAddressForm = 'neutral' | 'sir';
type PlainKey = Exclude<ImportJourneyCopyKey, 'handoff.source'>;

// Feature-local English only, matching day-one/i18n; not a new i18n runtime.
export function importJourneyCopy(key: PlainKey): string;
export function importJourneyCopy(key: 'handoff.source', vars: { sourceName: string }): string;
export function importJourneyCopy(
  key: ImportJourneyCopyKey,
  vars?: { sourceName: string },
): string {
  let value: unknown = en;
  for (const part of key.split('.')) {
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== 'string') throw new Error('Missing import journey copy');
  return value.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (name !== 'sourceName' || !vars) throw new Error('Missing import journey copy variable');
    // Isolate catalog names when the surrounding UI uses RTL layout.
    return `\u2068${vars.sourceName}\u2069`;
  });
}

export function importOfferQuestion(
  romanEnabled: boolean,
  addressForm: ImportAddressForm = 'neutral',
): string {
  return importJourneyCopy(romanEnabled && addressForm === 'sir' ? 'offer.questionSir' : 'offer.question');
}

/** Unknown never becomes zero. This checks display data, not server authority. */
export function isImportQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export type ImportQuantityKind = 'receipts' | 'nativeClients' | 'unconfirmedClients';
export function importQuantityCopy(kind: ImportQuantityKind, value: unknown, locale = 'en'): string | null {
  if (!isImportQuantity(value)) return null;
  const forms = kind === 'receipts' ? en.progress.receipts : kind === 'nativeClients' ? en.progress.native : en.result.unconfirmed;
  const form = value === 0 ? forms.zero : value === 1 ? forms.one : forms.other;
  let count: string;
  try { count = new Intl.NumberFormat(locale).format(value); } catch { count = new Intl.NumberFormat('en').format(value); }
  return form.replace('{count}', `\u2068${count}\u2069`);
}

/** Caller supplies an actual observation, never render time. No timer or freshness inference. */
export type ImportObservedAt = { epochMs: number; locale: string; timeZone: string };
export function importObservationCopy(value?: ImportObservedAt): string | null {
  if (!value || !isImportQuantity(value.epochMs) || value.epochMs > 8640000000000000) return null;
  try {
    const time = new Intl.DateTimeFormat(value.locale, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short', timeZone: value.timeZone,
    }).format(new Date(value.epochMs));
    return en.progress.lastUpdate.replace('{time}', `\u2068${time}\u2069`);
  } catch { return null; }
}

export function importCheckedScopeCopy(scope: 'selectedClientRecords'): string | null {
  if (scope !== 'selectedClientRecords') return null;
  return en.result.scope.replace('{scopeLabel}', `\u2068${en.result.selectedClientRecords}\u2069`);
}

import en from './i18n/en.json';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type ImportJourneyCopyKey = Leaves<typeof en>;
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

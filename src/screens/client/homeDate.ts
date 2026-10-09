/**
 * Home date overline (B34). Home used to print "Thursday, the eighth.":
 * ordinal words, a full stop and no month, which the owner read as odd.
 * It now shows weekday, day and month in the phone's own locale order
 * ("Thursday, 8 October" in en-GB style, "Thursday, October 8" in en-US),
 * the same shape as prototype 63 (LAND). The overline token (typography
 * .eyebrow) sets the small caps; this string stays in sentence case.
 */
export function homeDateLine(date: Date, locale?: string | string[]): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

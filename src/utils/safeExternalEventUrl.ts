/**
 * safeExternalEventUrl — scheme guard for the single EXTERNAL link a community
 * event may carry (v2-3). There is NO native room (Step 0): a live/replay link
 * is an externally-hosted URL the client opens in the system browser. Before
 * we ever hand a URL to `Linking.openURL`, we MUST confirm it is an https URL,
 * never a `javascript:` / `data:` / `file:` / plain `http:` scheme that could
 * exfiltrate, execute, or downgrade.
 *
 * Returns the normalised href when the input parses to an `https:` URL, or
 * `null` for anything else (unparseable, wrong scheme, empty). The caller
 * surfaces a calm error when this returns null rather than opening anything.
 */
export function safeExternalEventUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return parsed.href;
}

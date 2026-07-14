/**
 * safeImportLoginUrl — scheme + host guard for the external login site a coach
 * opens during import. Before any URL reaches `Linking.openURL` we MUST confirm
 * it is an https URL pointing at a real public host — never a
 * `javascript:` / `data:` / `file:` / plain `http:` scheme, and never a
 * private, loopback, or link-local host that could be used to probe the
 * device's local network (SSRF-style abuse of the browser handoff).
 *
 * Returns the normalised href for a safe https public URL, or `null` for
 * anything else (unparseable, wrong scheme, credentials in URL, private/
 * loopback/link-local host). Callers surface a calm error on `null` rather
 * than opening anything.
 */

/** Reject hosts that resolve to the device/loopback/private network space. */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  // WHATWG URL keeps IPv6 literals bracketed (e.g. "[::1]"); strip them so the
  // range checks below see the bare address.
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8')) {
    return true;
  }

  // IPv4 private / loopback / link-local ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127) return true; // 10/8, 127/8
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 0) return true; // 0/8 "this host"
  }

  return false;
}

export function safeImportLoginUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  // Embedded credentials (https://user:pass@host) are a phishing/exfil vector.
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  if (isPrivateOrLoopbackHost(parsed.hostname)) return null;

  return parsed.href;
}

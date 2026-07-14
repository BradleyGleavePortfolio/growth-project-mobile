/**
 * safeImportLoginUrl — scheme + host guard for the external login site a coach
 * opens during import. Before any URL reaches `Linking.openURL` we MUST confirm
 * it is an https URL pointing at a real public host — never a
 * `javascript:` / `data:` / `file:` / plain `http:` scheme, and never a
 * private, loopback, or link-local host that could be used to probe the
 * device's local network (SSRF-style abuse of the browser handoff).
 *
 * Host classification parses ADDRESS SEMANTICS, not string prefixes: IPv4 is
 * canonicalised (dotted, shorthand, decimal, hex, octal) to a 32-bit value and
 * range-checked; IPv6 literals are expanded to eight hextets (incl. IPv4-mapped
 * `::ffff:a.b.c.d`) and range-checked. This makes the guard independent of how
 * the host WHATWG-normalises, so the RN/Hermes runtime and the Node test env
 * classify identically. Bare DNS names are never IPv6-classified, so public
 * hosts like `fdny.gov` / `fcbarcelona.com` are correctly allowed.
 *
 * Returns the normalised href for a safe https public URL, or `null` for
 * anything else. Callers surface a calm error on `null` rather than opening.
 */

/** Canonicalise an IPv4 host (inet_aton forms) to a 32-bit int, or null. */
function ipv4ToInt(host: string): number | null {
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n = NaN;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = parseInt(p, 10);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums.pop();
  if (last === undefined || nums.some((p) => p > 255)) return null;
  const span = Math.pow(256, 4 - nums.length);
  if (last >= span) return null;
  return (nums.reduce((v, p) => v * 256 + p, 0) * span + last) >>> 0;
}

function isPrivateV4(ip: number): boolean {
  const a = (ip >>> 24) & 255;
  const b = (ip >>> 16) & 255;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  return a === 192 && b === 168; // 192.168/16
}

/** Expand an IPv6 literal (brackets already stripped) to 8 hextets, or null. */
function parseV6(input: string): number[] | null {
  let addr = input;
  const v4: number[] = [];
  if (addr.includes('.')) {
    const colon = addr.lastIndexOf(':', addr.indexOf('.'));
    const n = colon === -1 ? null : ipv4ToInt(addr.slice(colon + 1));
    if (n === null) return null;
    v4.push((n >>> 16) & 0xffff, n & 0xffff);
    addr = addr.slice(0, colon);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const hex = (s: string): number[] =>
    s === '' ? [] : s.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const head = hex(halves[0]);
  const tail = halves.length === 2 ? hex(halves[1]) : [];
  const known = head.length + tail.length + v4.length;
  if (halves.length === 2 && known > 7) return null;
  const gap = halves.length === 2 ? 8 - known : 0;
  const full = [...head, ...new Array(gap).fill(0), ...tail, ...v4];
  return full.length === 8 && full.every((x) => x >= 0 && x <= 0xffff) ? full : null;
}

function isPrivateV6(g: number[]): boolean {
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: and ::1
  if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true; // fc00::/7 unique-local
  if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true; // fe80::/10 link-local
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff; // ::ffff:v4
  const compat = g.slice(0, 6).every((x) => x === 0); // ::v4 (deprecated)
  return (mapped || compat) && isPrivateV4(((g[6] << 16) | g[7]) >>> 0);
}

/** Reject hosts that resolve to the device/loopback/private network space. */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  const isV6 = hostname.startsWith('[');
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isV6) {
    const groups = parseV6(host); // unparseable literal → reject
    return groups === null ? true : isPrivateV6(groups);
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4ToInt(host);
  return v4 === null ? false : isPrivateV4(v4); // bare DNS name → public
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
  return isPrivateOrLoopbackHost(parsed.hostname) ? null : parsed.href;
}

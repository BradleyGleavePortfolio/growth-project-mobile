import { safeImportLoginUrl } from '../safeImportLoginUrl';

describe('safeImportLoginUrl', () => {
  it('accepts a normal public https URL and returns the normalised href', () => {
    expect(safeImportLoginUrl('https://app.truecoach.co/login')).toBe(
      'https://app.truecoach.co/login',
    );
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(safeImportLoginUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it.each([
    ['http (not https)', 'http://example.com/login'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>1</script>'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com/x'],
  ])('rejects %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([[null], [undefined], [''], ['   '], ['not a url'], ['//no-scheme.com']])(
    'rejects empty / unparseable input %p',
    (value) => {
      expect(safeImportLoginUrl(value as string | null | undefined)).toBeNull();
    },
  );

  it('rejects URLs carrying embedded credentials', () => {
    expect(safeImportLoginUrl('https://user:pass@example.com/login')).toBeNull();
  });

  it.each([
    ['localhost', 'https://localhost/login'],
    ['localhost subdomain', 'https://api.localhost/login'],
    ['loopback v4', 'https://127.0.0.1/login'],
    ['loopback 127/8', 'https://127.5.5.5/login'],
    ['0.0.0.0', 'https://0.0.0.0/login'],
    ['0/8 this-host', 'https://0.1.2.3/login'],
    ['private 10/8', 'https://10.0.0.5/login'],
    ['private 172.16/12', 'https://172.16.4.4/login'],
    ['private 172.31/12', 'https://172.31.255.1/login'],
    ['private 192.168/16', 'https://192.168.1.1/login'],
    ['link-local 169.254/16', 'https://169.254.1.1/login'],
    ['ipv6 loopback', 'https://[::1]/login'],
    ['ipv6 unique-local fd', 'https://[fd00::1]/login'],
    ['ipv6 link-local fe80', 'https://[fe80::1]/login'],
  ])('rejects private/loopback/link-local host: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([
    ['172.15.x below the 172.16-31 block', 'https://172.15.0.1/login'],
    ['172.32.x above the 172.16-31 block', 'https://172.32.0.1/login'],
    ['11.x public', 'https://11.0.0.1/login'],
    ['169.255.x above link-local', 'https://169.255.0.1/login'],
    ['192.169.x beside 192.168', 'https://192.169.0.1/login'],
    ['9.x below 10/8', 'https://9.255.255.255/login'],
    ['128.x above 127/8', 'https://128.0.0.1/login'],
  ])('does NOT reject public host that merely borders a private range: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBe(url);
  });

  it.each([
    ['ipv6 unspecified ::', 'https://[::]/login'],
    ['ipv6 unique-local fc00', 'https://[fc00::1]/login'],
  ])('rejects additional private ipv6 literal: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([
    ['username only', 'https://user@example.com/login'],
    ['password only', 'https://:pass@example.com/login'],
  ])('rejects URL with partial embedded credentials: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it('lower-cases the scheme/host but preserves the path casing on return', () => {
    expect(safeImportLoginUrl('HTTPS://App.Example.COM/Login/Path')).toBe(
      'https://app.example.com/Login/Path',
    );
  });

  it('preserves an explicit port on a safe public host', () => {
    expect(safeImportLoginUrl('https://app.example.com:8443/login')).toBe(
      'https://app.example.com:8443/login',
    );
  });

  it('preserves query string and fragment on a safe public host', () => {
    expect(safeImportLoginUrl('https://app.example.com/login?next=%2Fhome#top')).toBe(
      'https://app.example.com/login?next=%2Fhome#top',
    );
  });

  it('accepts a bare public host with no path (URL appends the root slash)', () => {
    expect(safeImportLoginUrl('https://example.com')).toBe('https://example.com/');
  });

  it('is idempotent: feeding a normalised href back through returns the same value', () => {
    const once = safeImportLoginUrl('https://App.Example.com/Login');
    expect(once).not.toBeNull();
    expect(safeImportLoginUrl(once)).toBe(once);
  });

  it.each([
    ['uppercase LOCALHOST', 'https://LOCALHOST/login'],
    ['loopback v4 with port', 'https://127.0.0.1:8443/login'],
    ['ipv6 loopback with port', 'https://[::1]:8443/login'],
    ['private 10/8 with port', 'https://10.1.2.3:9000/login'],
    ['localhost subdomain uppercase', 'https://API.LOCALHOST/login'],
  ])('rejects private/loopback host even with a port or casing: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([
    ['https with no host', 'https://'],
    ['space before host', 'https:// example.com/login'],
    ['scheme-relative', '//example.com/login'],
    ['bare word', 'example.com'],
  ])('rejects malformed/hostless input: %s', (_label, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it('accepts a deep multi-segment path on a public multi-label host', () => {
    expect(safeImportLoginUrl('https://sub.domain.co.uk/auth/v2/login')).toBe(
      'https://sub.domain.co.uk/auth/v2/login',
    );
  });

  it('returns a stable string type (never boolean/undefined) for accepted URLs', () => {
    const out = safeImportLoginUrl('https://example.com/login');
    expect(typeof out).toBe('string');
  });

  it.each([
    '10.0.0.0', '10.255.255.255',
    '172.16.0.0', '172.20.10.10', '172.31.255.255',
    '192.168.0.0', '192.168.255.255',
    '127.0.0.0', '127.255.255.255',
    '169.254.0.0', '169.254.255.255',
  ])('rejects every address inside a private/loopback/link-local block: %s', (host) => {
    expect(safeImportLoginUrl(`https://${host}/login`)).toBeNull();
  });

  it.each([
    '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.0', '192.167.0.1', '192.169.0.1',
  ])('accepts a genuinely public IPv4 host just outside the private blocks: %s', (host) => {
    expect(safeImportLoginUrl(`https://${host}/login`)).toBe(`https://${host}/login`);
  });

  it('rejects a loopback host even when credentials are also present', () => {
    expect(safeImportLoginUrl('https://user:pass@127.0.0.1/login')).toBeNull();
  });

  it.each([
    ['ipv4-mapped loopback', 'https://[::ffff:127.0.0.1]/login'],
    ['ipv4-mapped private 10/8', 'https://[::ffff:10.0.0.5]/login'],
    ['ipv4-mapped private 192.168', 'https://[::ffff:192.168.1.1]/login'],
    ['ipv4-mapped link-local', 'https://[::ffff:169.254.1.1]/login'],
    ['ipv4-compatible loopback', 'https://[::127.0.0.1]/login'],
  ])('rejects IPv4-mapped/compatible IPv6 that embeds a private address: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it('accepts an IPv4-mapped IPv6 that embeds a genuinely public address', () => {
    // ::ffff:8.8.8.8 maps to public 8.8.8.8 — classified by the embedded value.
    expect(safeImportLoginUrl('https://[::ffff:8.8.8.8]/login')).not.toBeNull();
  });

  it.each([
    ['fe80', 'https://[fe80::1]/login'],
    ['fe90 mid-range', 'https://[fe90::1]/login'],
    ['fea0 mid-range', 'https://[fea0::1]/login'],
    ['febf top of range', 'https://[febf::1]/login'],
  ])('rejects the entire fe80::/10 link-local range: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([
    ['fec0 above link-local', 'https://[fec0::1]/login'],
    ['fe00 below link-local', 'https://[fe00::1]/login'],
    ['public 2001:db8', 'https://[2001:db8::1]/login'],
  ])('does NOT reject a public IPv6 just outside the private ranges: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).not.toBeNull();
  });

  it.each([
    ['decimal loopback', 'https://2130706433/login'],
    ['hex loopback', 'https://0x7f000001/login'],
    ['octal-dotted loopback', 'https://0177.0.0.1/login'],
    ['short-form loopback', 'https://127.1/login'],
    ['hex private 10/8', 'https://0xa000005/login'],
    ['dotted-decimal private', 'https://10.0.0.1/login'],
  ])('rejects shorthand/encoded IPv4 that resolves into a private/loopback block: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).toBeNull();
  });

  it.each([
    ['decimal public 8.8.8.8', 'https://134744072/login'],
    ['dotted public', 'https://8.8.8.8/login'],
  ])('accepts shorthand/encoded IPv4 that resolves to a public address: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).not.toBeNull();
  });

  it.each([
    ['fdny.gov', 'https://fdny.gov/login'],
    ['fcbarcelona.com', 'https://fcbarcelona.com/login'],
    ['fe-hyphen public', 'https://fe-example.com/login'],
    ['fd-prefixed label', 'https://fd-startup.io/login'],
  ])('does NOT reject a public DNS host that merely starts with fc/fd/fe: %s', (_l, url) => {
    expect(safeImportLoginUrl(url)).toBe(url);
  });

  it('accepts an internationalised (IDN) public host (not mis-classified as private)', () => {
    // A unicode/IDN label is a public DNS host — it must never trip the IP guards.
    const out = safeImportLoginUrl('https://münchen.example/login');
    expect(out).not.toBeNull();
    expect(out).toMatch(/^https:\/\//);
  });

  it('rejects a bracketed IPv6 literal that is not parseable', () => {
    expect(safeImportLoginUrl('https://[gggg::1]/login')).toBeNull();
  });
});

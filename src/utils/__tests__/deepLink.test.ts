import {
  parseInviteDeepLink,
  buildInviteUniversalLink,
  INVITE_UNIVERSAL_HOST,
} from '../deepLink';

describe('parseInviteDeepLink — custom scheme', () => {
  it('parses tgp://join/<code>', () => {
    const r = parseInviteDeepLink('tgp://join/SMOKE01');
    expect(r).toEqual({ inviteCode: 'SMOKE01', source: 'custom-scheme', raw: 'tgp://join/SMOKE01' });
  });

  it('parses tgp://join with no code (manual entry)', () => {
    const r = parseInviteDeepLink('tgp://join');
    expect(r).not.toBeNull();
    expect(r!.inviteCode).toBeNull();
    expect(r!.source).toBe('custom-scheme');
  });

  it('parses tgp://join/ with trailing slash and no code', () => {
    const r = parseInviteDeepLink('tgp://join/');
    expect(r!.inviteCode).toBeNull();
  });

  it('strips a query string after the code', () => {
    const r = parseInviteDeepLink('tgp://join/ABC123?ref=qr');
    expect(r!.inviteCode).toBe('ABC123');
  });

  it('strips a fragment after the code', () => {
    const r = parseInviteDeepLink('tgp://join/ABC123#x');
    expect(r!.inviteCode).toBe('ABC123');
  });

  it('decodes percent-encoded codes (QR encoder safe-alpha shapes)', () => {
    const r = parseInviteDeepLink('tgp://join/%41%42%43');
    expect(r!.inviteCode).toBe('ABC');
  });

  it('returns the raw segment when percent-decoding throws', () => {
    // %ZZ is not a valid escape — decodeURIComponent throws. We must not crash.
    const r = parseInviteDeepLink('tgp://join/%ZZ123');
    expect(r!.inviteCode).toBe('%ZZ123');
  });
});

describe('parseInviteDeepLink — universal link', () => {
  it(`parses https://${INVITE_UNIVERSAL_HOST}/join/<code>`, () => {
    const r = parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/join/SMOKE01`);
    expect(r).toEqual({
      inviteCode: 'SMOKE01',
      source: 'universal-link',
      raw: `https://${INVITE_UNIVERSAL_HOST}/join/SMOKE01`,
    });
  });

  it('parses /join with no code (manual entry path)', () => {
    const r = parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/join`);
    expect(r!.inviteCode).toBeNull();
    expect(r!.source).toBe('universal-link');
  });

  it('parses /join/ with trailing slash and no code', () => {
    const r = parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/join/`);
    expect(r!.inviteCode).toBeNull();
  });

  it('handles a query string after the code', () => {
    const r = parseInviteDeepLink(
      `https://${INVITE_UNIVERSAL_HOST}/join/ABC123?utm_source=email`,
    );
    expect(r!.inviteCode).toBe('ABC123');
  });

  it('handles a fragment after the code', () => {
    const r = parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/join/ABC123#welcome`);
    expect(r!.inviteCode).toBe('ABC123');
  });

  it('rejects deeper paths than /join/<code>', () => {
    expect(parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/join/ABC/extra`)).toBeNull();
  });

  it('rejects paths that are not /join', () => {
    expect(parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/welcome`)).toBeNull();
    expect(parseInviteDeepLink(`https://${INVITE_UNIVERSAL_HOST}/joinme/ABC`)).toBeNull();
  });

  it('rejects other hosts', () => {
    expect(parseInviteDeepLink('https://example.com/join/ABC')).toBeNull();
    expect(parseInviteDeepLink('https://app.example.com/join/ABC')).toBeNull();
  });

  it('rejects http URLs from a different host', () => {
    expect(parseInviteDeepLink('http://malicious.local/join/ABC')).toBeNull();
  });
});

describe('parseInviteDeepLink — defensive', () => {
  it('returns null for empty / nullish input', () => {
    expect(parseInviteDeepLink('')).toBeNull();
    expect(parseInviteDeepLink('   ')).toBeNull();
    expect(parseInviteDeepLink(null)).toBeNull();
    expect(parseInviteDeepLink(undefined)).toBeNull();
  });

  it('returns null for unrelated schemes', () => {
    expect(parseInviteDeepLink('mailto:hi@example.com')).toBeNull();
    expect(parseInviteDeepLink('intent://join/ABC')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(parseInviteDeepLink('https://')).toBeNull();
    expect(parseInviteDeepLink('not a url')).toBeNull();
  });

  it('trims surrounding whitespace from share-sheet wrapped links', () => {
    const r = parseInviteDeepLink(`  https://${INVITE_UNIVERSAL_HOST}/join/ABC  `);
    expect(r!.inviteCode).toBe('ABC');
  });
});

describe('buildInviteUniversalLink', () => {
  it('produces a canonical https URL on the universal-link host', () => {
    expect(buildInviteUniversalLink('ABC123')).toBe(
      `https://${INVITE_UNIVERSAL_HOST}/join/ABC123`,
    );
  });

  it('percent-encodes codes that contain URL-unsafe characters', () => {
    // Real invite codes are safe-alpha, but defending against future format
    // changes is cheap. The roundtrip via parseInviteDeepLink should restore
    // the original code.
    const code = 'a b/c';
    const url = buildInviteUniversalLink(code);
    expect(url).toBe(`https://${INVITE_UNIVERSAL_HOST}/join/a%20b%2Fc`);
    expect(parseInviteDeepLink(url)!.inviteCode).toBe(code);
  });

  it('refuses to build a URL with no code', () => {
    expect(() => buildInviteUniversalLink('')).toThrow();
    expect(() => buildInviteUniversalLink('   ')).toThrow();
  });
});

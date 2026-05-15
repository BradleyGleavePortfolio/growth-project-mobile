import { buildPackageShareUrl, PACKAGE_SHARE_HOST, PACKAGE_SHARE_PATH } from '../packageShare';

describe('buildPackageShareUrl', () => {
  it('builds an https://<host>/p/<token> URL', () => {
    const url = buildPackageShareUrl('abc123');
    expect(url).toBe(`${PACKAGE_SHARE_HOST}${PACKAGE_SHARE_PATH}/abc123`);
  });

  it('URI-encodes the share token', () => {
    expect(buildPackageShareUrl('a/b c')).toContain('a%2Fb%20c');
  });

  it('uses the universal-link host (must match app.json)', () => {
    expect(PACKAGE_SHARE_HOST).toBe('https://app.trygrowthproject.com');
  });
});

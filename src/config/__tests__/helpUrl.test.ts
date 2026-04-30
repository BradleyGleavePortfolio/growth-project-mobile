import { env, helpUrl } from '../env';

describe('helpUrl', () => {
  it('returns the configured base URL when no path is supplied', () => {
    expect(helpUrl()).toBe(env.HELP_BASE_URL);
  });

  it('joins a relative path against the base URL with a single separator', () => {
    expect(helpUrl('coach')).toBe(`${env.HELP_BASE_URL}/coach`);
    expect(helpUrl('/coach')).toBe(`${env.HELP_BASE_URL}/coach`);
  });

  it('produces an https URL by default', () => {
    expect(helpUrl()).toMatch(/^https:\/\//);
  });

  it('does not contain a trailing slash on the base URL', () => {
    expect(env.HELP_BASE_URL.endsWith('/')).toBe(false);
  });
});

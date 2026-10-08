/**
 * FW-BODY U10 (failing on main): a client with no coach was told "your coach
 * stops seeing ..." on Disconnect. Coached copy stays word for word; the
 * coachless copy names no coach. The Connect disclosure is tested in
 * ConnectProviderSheet.test.tsx.
 */
jest.mock('../../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));

import { disconnectConfirmCopy } from '../disconnectCopy';

describe('Disconnect confirm', () => {
  it('coached copy is unchanged', () => {
    expect(disconnectConfirmCopy('APPLE_HEALTHKIT', 'Apple Health').body).toBe(
      'The Growth Project stops bringing in new Apple Health data from this phone, and your coach stops seeing new Apple Health data. Data already shared stays with your coach. You can connect Apple Health again at any time.',
    );
    expect(disconnectConfirmCopy('SAMSUNG_HEALTH', 'Samsung Health').body).toBe(
      'Samsung Health shares its data through Health Connect, so this disconnects Health Connect. The Growth Project stops bringing in new Health Connect data from this phone, from Samsung Health and every other app, and your coach stops seeing it. Data already shared stays with your coach. You can connect again at any time.',
    );
    expect(disconnectConfirmCopy('OURA', 'Oura', false).body).toBe(
      'The Growth Project stops receiving new Oura data, and your coach stops seeing new Oura data. Data already shared stays with your coach. You can connect Oura again at any time.',
    );
  });

  it('a client with no coach is not told about a coach', () => {
    expect(disconnectConfirmCopy('APPLE_HEALTHKIT', 'Apple Health', true)).toEqual({
      title: 'Disconnect Apple Health?',
      body: 'The Growth Project stops bringing in new Apple Health data from this phone. Data already brought in stays in your account. You can connect Apple Health again at any time.',
    });
    expect(disconnectConfirmCopy('HEALTH_CONNECT', 'Health Connect', true).body).toBe(
      'The Growth Project stops bringing in new Health Connect data from this phone. Data already brought in stays in your account. You can connect Health Connect again at any time.',
    );
    expect(disconnectConfirmCopy('SAMSUNG_HEALTH', 'Samsung Health', true).body).toBe(
      'Samsung Health shares its data through Health Connect, so this disconnects Health Connect. The Growth Project stops bringing in new Health Connect data from this phone, from Samsung Health and every other app. Data already brought in stays in your account. You can connect again at any time.',
    );
    expect(disconnectConfirmCopy('OURA', 'Oura', true).body).toBe(
      'The Growth Project stops receiving new Oura data. Data already brought in stays in your account. You can connect Oura again at any time.',
    );
  });
});

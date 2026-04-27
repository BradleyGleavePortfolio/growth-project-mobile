// Cross-check the React Navigation linking config in RootNavigator against
// app.json's intent filters / associatedDomains. The two sources of truth must
// agree or deep links silently break: app.json declares "I will receive these
// URLs", RootNavigator declares "and here is how to route them once received".
//
// Pure JS / fs — no NavigationContainer mounted. Keeps the test fast and
// avoids dragging react-native-screens / reanimated into the test harness.

import * as fs from 'fs';
import * as path from 'path';
import {
  INVITE_CUSTOM_SCHEME,
  INVITE_UNIVERSAL_HOST,
  INVITE_PATH,
} from '../../utils/deepLink';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const ROOT_NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'RootNavigator.tsx'),
  'utf8',
);

describe('app.json declares the invite deep-link surface', () => {
  it('iOS associatedDomains lists applinks for the universal host', () => {
    const ad: string[] = APP_JSON.expo.ios.associatedDomains;
    expect(ad).toContain(`applinks:${INVITE_UNIVERSAL_HOST}`);
  });

  it('Android intent filter routes https://<host>/join with autoVerify', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const httpsFilter = filters.find((f: any) =>
      (f.data || []).some(
        (d: any) => d.scheme === 'https' && d.host === INVITE_UNIVERSAL_HOST,
      ),
    );
    expect(httpsFilter).toBeDefined();
    expect(httpsFilter.autoVerify).toBe(true);
    const httpsData = httpsFilter.data.find(
      (d: any) => d.scheme === 'https' && d.host === INVITE_UNIVERSAL_HOST,
    );
    expect(httpsData.pathPrefix).toBe(INVITE_PATH);
  });

  it('Android intent filter also routes the tgp:// custom scheme to /join', () => {
    const filters = APP_JSON.expo.android.intentFilters;
    const customFilter = filters.find((f: any) =>
      (f.data || []).some((d: any) => d.scheme === INVITE_CUSTOM_SCHEME),
    );
    expect(customFilter).toBeDefined();
    const data = customFilter.data.find((d: any) => d.scheme === INVITE_CUSTOM_SCHEME);
    expect(data.host).toBe('join');
  });

  it('expo.scheme matches the deep-link parser constant', () => {
    expect(APP_JSON.expo.scheme).toBe(INVITE_CUSTOM_SCHEME);
  });
});

describe('RootNavigator linking config agrees with app.json', () => {
  it('declares both the custom-scheme prefix and the universal-link host', () => {
    expect(ROOT_NAV_SRC).toMatch(/'tgp:\/\/'/);
    expect(ROOT_NAV_SRC).toMatch(
      new RegExp(`'https:\\/\\/${INVITE_UNIVERSAL_HOST.replace(/\./g, '\\.')}'`),
    );
  });

  it('routes /join/:invite_code to CreateAccount', () => {
    // The linking config uses the path 'join/:invite_code?'. Search for the
    // literal so a typo (`/join/:code` etc.) shows up here instead of in QA.
    expect(ROOT_NAV_SRC).toMatch(/path:\s*'join\/:invite_code\?'/);
  });
});

describe('hosted association templates match app.json', () => {
  it('assetlinks.json package_name matches expo.android.package', () => {
    const al = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'docs', 'well-known', 'assetlinks.json'), 'utf8'),
    );
    const packages = al
      .map((s: any) => s && s.target && s.target.package_name)
      .filter(Boolean);
    expect(packages).toContain(APP_JSON.expo.android.package);
  });

  it('apple-app-site-association covers /join/* and bare /join', () => {
    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'docs', 'well-known', 'apple-app-site-association'),
        'utf8',
      ),
    );
    const components = aasa.applinks.details.flatMap((d: any) => d.components || []);
    const paths = components.map((c: any) => c['/']);
    expect(paths).toEqual(expect.arrayContaining(['/join/*', '/join']));
  });
});

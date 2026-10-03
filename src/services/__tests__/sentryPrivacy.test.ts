/**
 * B-330-3: the explicit Sentry content policy (src/services/sentryPrivacy.ts).
 * Every case plants a synthetic canary where real content would sit.
 */
import type { Breadcrumb, Event } from '@sentry/react-native';

import { REDACTED_URL, routeOnlyUrl, scrubBreadcrumb, scrubEvent } from '../sentryPrivacy';

const CANARY = 'AUDIT_SYNTHETIC_PRIVATE_MESSAGE';
const EMAIL = 'person.canary@example.com';

describe('routeOnlyUrl', () => {
  it.each([
    [`https://api.example.test/api/search?q=${CANARY}`, 'https://api.example.test/api/search'],
    [`https://api.example.test/api/messages/thread#${CANARY}`, 'https://api.example.test/api/messages/thread'],
    [`https://user:${CANARY}@api.example.test/api/me`, 'https://api.example.test/api/me'],
    [`https://api.example.test/api/v1/clients/3f2a9c1e-0000-4000-8000-000000000000/check-ins`, 'https://api.example.test/api/v1/clients/:id/check-ins'],
    [`https://api.example.test/api/users/${EMAIL}/profile`, 'https://api.example.test/api/users/:id/profile'],
    [`/api/messages/${CANARY}?draft=${CANARY}`, '/api/messages/:id'],
    [`HTTPS://API.example.test/Api`, 'https://API.example.test/:id'],
  ])('%s -> %s', (input, expected) => {
    expect(routeOnlyUrl(input)).toBe(expected);
  });

  it('non-http URLs are replaced whole; empty values stay empty', () => {
    expect(routeOnlyUrl(`data:text/plain,${CANARY}`)).toBe(REDACTED_URL);
    expect(routeOnlyUrl(`file:///var/mobile/${CANARY}.m4a`)).toBe(REDACTED_URL);
    expect(routeOnlyUrl(`blob:${CANARY}`)).toBe(REDACTED_URL);
    expect(routeOnlyUrl('')).toBeUndefined();
    expect(routeOnlyUrl(42)).toBeUndefined();
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs (their text can hold anything)', () => {
    expect(scrubBreadcrumb({ category: 'console', level: 'log', message: CANARY, data: { arguments: [CANARY] } })).toBeNull();
  });

  const httpCases: Array<[Breadcrumb, string]> = [
    [{ category: 'xhr', type: 'http', data: { method: 'GET', url: `https://api.example.test/api/search?q=${CANARY}`, status_code: 200, request_body_size: 3 } }, 'xhr'],
    [{ category: 'fetch', type: 'http', data: { method: 'post', url: `https://api.example.test/api/messages/${CANARY}`, status_code: 201, body: CANARY } }, 'fetch'],
    [{ type: 'http', category: 'http', data: { method: 'GET', url: `https://api.example.test/x?token=${CANARY}`, reason: CANARY } }, 'http'],
  ];
  it.each(httpCases)('HTTP breadcrumb keeps only method, route-shaped URL and status (%#)', (crumb, category) => {
    const out = scrubBreadcrumb({ ...crumb, message: CANARY, timestamp: 5 });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out).toMatchObject({ type: 'http', category, timestamp: 5 });
    expect(Object.keys(out?.data ?? {})).toEqual(expect.arrayContaining(['method', 'url']));
    for (const k of Object.keys(out?.data ?? {})) expect(['method', 'url', 'status_code']).toContain(k);
  });

  it('touch breadcrumbs keep component and file names, never labels', () => {
    const out = scrubBreadcrumb({
      category: 'touch',
      type: 'user',
      message: `Touch event within element: ${CANARY}`,
      data: { path: [{ name: 'SendButton', label: CANARY, file: 'ChatScreen.tsx' }, { name: 'View' }, { label: CANARY }] },
    });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out).toMatchObject({
      category: 'touch',
      message: 'Touch event within element: SendButton',
      data: { path: [{ name: 'SendButton', file: 'ChatScreen.tsx' }, { name: 'View' }] },
    });
  });

  it('any other breadcrumb loses its message and free-text data; structural identifiers stay', () => {
    const out = scrubBreadcrumb({
      category: 'app.lifecycle',
      type: 'navigation',
      level: 'info',
      message: `Opened note ${CANARY}`,
      data: { state: 'foreground', note: CANARY, to: 'CheckInScreen', from: `a ${CANARY} b` },
    });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out).toEqual({ category: 'app.lifecycle', type: 'navigation', level: 'info', data: { state: 'foreground', to: 'CheckInScreen' } });
  });

  it('never throws on odd input', () => {
    expect(scrubBreadcrumb(null)).toBeNull();
    expect(scrubBreadcrumb(undefined)).toBeNull();
    expect(scrubBreadcrumb({ category: 'xhr' })).toEqual({ category: 'xhr', type: 'http' });
  });
});

describe('scrubEvent', () => {
  it('error event: breadcrumbs (JS and native-merged), user, request are scrubbed', () => {
    const event: Event = {
      exception: { values: [{ type: 'Error', value: 'synthetic failure' }] },
      breadcrumbs: [
        { category: 'console', message: CANARY },
        { type: 'http', category: 'http', data: { url: `https://api.example.test/api/search?q=${CANARY}`, method: 'GET' } },
      ],
      user: { id: 'acct-1', email: EMAIL, username: CANARY, ip_address: '203.0.113.9' },
      request: {
        url: `https://api.example.test/api/search?q=${CANARY}`,
        query_string: `q=${CANARY}`,
        data: { text: CANARY },
        cookies: { session: CANARY },
        headers: { Authorization: `Bearer ${CANARY}`, Cookie: CANARY, 'User-Agent': 'tgp' },
      },
    };
    const out = scrubEvent(event);
    const json = JSON.stringify(out);
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain('203.0.113.9');
    expect(out.user).toEqual({ id: 'acct-1' });
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.request).toEqual({ url: 'https://api.example.test/api/search', headers: { 'User-Agent': 'tgp' } });
    expect(out.exception?.values?.[0].value).toBe('synthetic failure');
  });

  it('an event user without an id is removed (never an email-only user)', () => {
    expect(scrubEvent({ user: { email: EMAIL } }).user).toBeUndefined();
  });

  it('transaction: http.client spans lose query, fragment and full URLs', () => {
    const tx: Event = {
      type: 'transaction',
      contexts: { trace: { trace_id: 't', span_id: 's', data: { url: `https://api.example.test/a?q=${CANARY}`, 'http.query': `?q=${CANARY}` } } },
      spans: [
        {
          span_id: 'a',
          trace_id: 't',
          start_timestamp: 1,
          op: 'http.client',
          description: `GET https://api.example.test/api/messages/${CANARY}?q=${CANARY}`,
          data: {
            url: `https://api.example.test/api/messages/${CANARY}?q=${CANARY}`,
            'http.url': `https://api.example.test/api/messages/${CANARY}?q=${CANARY}`,
            'http.query': `?q=${CANARY}`,
            'http.fragment': `#${CANARY}`,
            'http.method': 'GET',
          },
        },
      ],
    };
    const out = scrubEvent(tx);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out.spans?.[0].description).toBe('GET https://api.example.test/api/messages/:id');
    expect(out.spans?.[0].data).toEqual({
      url: 'https://api.example.test/api/messages/:id',
      'http.url': 'https://api.example.test/api/messages/:id',
      'http.method': 'GET',
    });
  });
  it('B-305-12: the OTA contexts keep only their closed shapes (raw emergency_launch_reason removed)', () => {
    const event: Event = {
      contexts: {
        ota_updates: {
          is_enabled: true,
          is_embedded_launch: true,
          is_emergency_launch: true,
          is_using_embedded_assets: 'yes',
          update_id: 'ABCDEF00-1111-2222-3333-444455556666',
          channel: `clinic ${EMAIL}`,
          runtime_version: `1.0.0 ${CANARY}`,
          check_automatically: 'on_load',
          launch_duration: 412,
          emergency_launch_reason: `Failed to launch for ${CANARY} ${EMAIL}`,
          emergency_reason_category: 'asset_or_bundle',
          created_at: CANARY,
        },
        ota_emergency: { reason_category: 'timeout', reason: CANARY },
        device: { family: 'iPhone' },
      },
    };
    const out = scrubEvent(event);
    expect(out.contexts?.ota_updates).toEqual({
      is_enabled: true,
      is_embedded_launch: true,
      is_emergency_launch: true,
      update_id: 'abcdef00-1111-2222-3333-444455556666',
      channel: 'other',
      check_automatically: 'on_load',
      launch_duration: 412,
      emergency_reason_category: 'asset_or_bundle',
    });
    expect(out.contexts?.ota_emergency).toEqual({ reason_category: 'timeout' });
    expect(out.contexts?.device).toEqual({ family: 'iPhone' });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(JSON.stringify(out)).not.toContain(EMAIL);
  });

  it('B-305-12: an OTA context with nothing safe left is removed, not forwarded', () => {
    const event: Event = {
      contexts: {
        ota_updates: { emergency_launch_reason: CANARY },
        ota_emergency: { reason_category: CANARY },
      },
    };
    const out = scrubEvent(event);
    expect(out.contexts).toEqual({});
  });
});

/**
 * S14 round 3 — on-device connect/refresh copy (owner error-copy rule).
 * Every failure says what happened and a working next action; known statuses
 * and machine codes get their own copy; unexpected failures carry a short
 * reference, a support path, and a Sentry report.
 */

import { AxiosError, AxiosHeaders } from 'axios';

const mockReportUnexpected = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReportUnexpected(...args),
}));

import {
  WEARABLES_SUPPORT_EMAIL,
  connectFailureMessage,
  notSyncingHereCopy,
  partialImportMessage,
  INGEST_DISABLED_COPY,
} from '../onDeviceCopy';
import {
  OnDeviceNotSignedInError,
  OnDeviceStepError,
} from '../../../../services/health/onDeviceSync';
import { OnDeviceSessionChangedError } from '../../../../services/health/sessionFence';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnavailableError,
} from '../../../../services/health/healthConnect/errors';

function httpError(status: number, data: unknown, requestId?: string): AxiosError {
  return new AxiosError('http', String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: new AxiosHeaders(requestId ? { 'x-request-id': requestId } : {}),
    config: { headers: new AxiosHeaders() },
    data,
  });
}

const networkError = () =>
  new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() });

beforeEach(() => mockReportUnexpected.mockReset());

const BANNED = [/Something went wrong/i, /^Please try again\.?$/i, /!/];

function expectPlain(text: string) {
  for (const re of BANNED) expect(text).not.toMatch(re);
}

describe('connectFailureMessage', () => {
  it('says nothing when the run was cancelled by closing the sheet', () => {
    expect(
      connectFailureMessage(new OnDeviceSessionChangedError('cancelled'), 'Apple Health'),
    ).toBeNull();
  });

  it('explains an account change and offers Continue', () => {
    const m = connectFailureMessage(new OnDeviceSessionChangedError(), 'Apple Health');
    expect(m?.action).toBe('connect');
    expect(m?.text).toMatch(/signed-in account changed/);
  });

  it('routes a signed-out person to log in, with no retry button', () => {
    const m = connectFailureMessage(new OnDeviceNotSignedInError(), 'Apple Health');
    expect(m?.action).toBe('none');
    expect(m?.text).toMatch(/Log in again/);
  });

  it.each([
    [
      new OnDeviceStepError('register', networkError()),
      'connect',
      /couldn't reach The Growth Project/,
    ],
    [new OnDeviceStepError('import', networkError()), 'resume', /connection dropped/],
    [new OnDeviceStepError('import', httpError(401, {})), 'none', /session has ended/],
    [
      new OnDeviceStepError('import', httpError(403, { code: 'wearables_connection_forbidden' })),
      'connect',
      /no longer linked to your account/,
    ],
    [
      new OnDeviceStepError('register', httpError(403, { code: 'forbidden' })),
      'none',
      /client account only/,
    ],
    [new OnDeviceStepError('import', httpError(429, {})), 'resume', /too many requests/],
    [
      new OnDeviceStepError('import', new HealthConnectPermissionDeniedError(['Steps'])),
      'resume',
      /access wasn't granted/,
    ],
    [
      new OnDeviceStepError('import', new HealthConnectUnavailableError()),
      'resume',
      /Health Connect isn't ready/,
    ],
  ])('maps %p to its own copy', (err, action, re) => {
    const m = connectFailureMessage(err, 'Health Connect');
    expect(m?.action).toBe(action);
    expect(m?.text).toMatch(re);
    expectPlain(m?.text ?? '');
    expect(mockReportUnexpected).not.toHaveBeenCalled();
  });

  it('unexpected server failure: server reference, support path, Sentry report', () => {
    const m = connectFailureMessage(
      new OnDeviceStepError('import', httpError(500, {}, 'abcdef12-3456-7890')),
      'Apple Health',
    );
    expect(m?.text).toContain('Reference abcdef12.');
    expect(m?.text).toContain(WEARABLES_SUPPORT_EMAIL);
    expectPlain(m?.text ?? '');
    expect(mockReportUnexpected).toHaveBeenCalledWith(
      'wearables.on_device_connect',
      expect.objectContaining({ status: 500, requestId: 'abcdef12-3456-7890' }),
    );
  });

  it('unexpected local failure still gets a reference that is sent to Sentry', () => {
    const m = connectFailureMessage(new Error('boom'), 'Apple Health');
    const ref = /Reference ([A-Za-z0-9-]{1,8})\./.exec(m?.text ?? '')?.[1];
    expect(ref).toBeTruthy();
    const reported = mockReportUnexpected.mock.calls[0][1] as { requestId: string };
    expect(reported.requestId.startsWith(ref ?? 'x')).toBe(true);
    // No error message or health value is ever put into the report.
    expect(JSON.stringify(mockReportUnexpected.mock.calls)).not.toContain('boom');
  });
});

describe('other copy', () => {
  it('partial import offers Continue import, all-failed offers Try again', () => {
    const partial = partialImportMessage('Apple Health', {
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c',
      postedCount: 4,
      complete: false,
    });
    expect(partial.action).toBe('resume');
    expect(partial.text).toMatch(/Continue import/);
    const none = partialImportMessage('Apple Health', {
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c',
      postedCount: 0,
      complete: false,
    });
    expect(none.text).toMatch(/Try again/);
    expectPlain(partial.text);
    expectPlain(none.text);
  });

  it('not syncing here and lane-off copy are plain', () => {
    expect(notSyncingHereCopy('Apple Health')).toBe(
      'Apple Health is not syncing on this phone. Tap Reconnect to continue.',
    );
    expectPlain(INGEST_DISABLED_COPY);
  });
});

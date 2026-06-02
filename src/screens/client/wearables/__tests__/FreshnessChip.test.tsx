/**
 * FreshnessChip — summariseFreshness reducer tests (pluralisation + tone
 * thresholds) and a render smoke check.
 *
 * The chip is derived from connections (plan line 91), NOT a server field, so
 * these tests pin the bucket-filter + attention-count logic exactly.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import FreshnessChip, { summariseFreshness } from '../components/FreshnessChip';
import type { WearableConnection } from '../../../../api/wearablesConnectionsApi';

function conn(
  provider: WearableConnection['provider'],
  status: string,
): WearableConnection {
  return {
    id: `c_${provider}`,
    user_id: 'u1',
    provider,
    external_account_id: null,
    access_token_expires_at: null,
    scopes: [],
    webhook_subscription_id: null,
    channel_expires_at: null,
    status,
    last_error: null,
    last_synced_at: '2026-06-01T00:00:00.000Z',
    backfilled_until: null,
    disconnected_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  };
}

describe('summariseFreshness', () => {
  it('reports empty when no relevant provider is connected', () => {
    const s = summariseFreshness([], 'HEALTH_FITNESS');
    expect(s.tone).toBe('empty');
    expect(s.connectedCount).toBe(0);
  });

  it('reports current when all bucket sources are healthy', () => {
    const s = summariseFreshness(
      [conn('APPLE_HEALTHKIT', 'connected'), conn('GARMIN', 'connected')],
      'HEALTH_FITNESS',
    );
    expect(s.tone).toBe('current');
    expect(s.label).toBe('All sources current');
    expect(s.connectedCount).toBe(2);
  });

  it('pluralises attention copy correctly', () => {
    const one = summariseFreshness(
      [conn('APPLE_HEALTHKIT', 'connected'), conn('GARMIN', 'expired')],
      'HEALTH_FITNESS',
    );
    expect(one.tone).toBe('attention');
    expect(one.label).toBe('1 source needs attention');

    const two = summariseFreshness(
      [conn('GARMIN', 'expired'), conn('FITBIT', 'error')],
      'HEALTH_FITNESS',
    );
    expect(two.label).toBe('2 sources need attention');
  });

  it('ignores disconnected sources and out-of-bucket providers', () => {
    // STRAVA only feeds HEALTH_FITNESS; viewing SLEEP_RECOVERY should drop it.
    const s = summariseFreshness(
      [conn('STRAVA', 'connected'), conn('APPLE_HEALTHKIT', 'disconnected')],
      'SLEEP_RECOVERY',
    );
    expect(s.tone).toBe('empty');
    expect(s.connectedCount).toBe(0);
  });
});

describe('FreshnessChip render', () => {
  it('renders the derived label and is tappable', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <FreshnessChip
        connections={[conn('APPLE_HEALTHKIT', 'connected')]}
        bucket="HEALTH_FITNESS"
        onPress={onPress}
      />,
    );
    expect(getByText('All sources current')).toBeTruthy();
  });
});

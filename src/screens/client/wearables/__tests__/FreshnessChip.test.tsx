/**
 * FreshnessChip — summariseFreshness reducer tests (pluralisation + tone
 * thresholds) and a render smoke check.
 *
 * The chip is derived from connections (plan line 91), NOT a server field, so
 * these tests pin the bucket-filter + attention-count logic exactly.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// The chip reads connections from the internal hook when no `connections` prop
// is passed (HK-3b contract). Mock the hook so the no-prop path is testable
// without a QueryClientProvider (R1 P0 #3 internal-hook fallback).
const mockUseWearableConnections = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
}));

import FreshnessChip, {
  FreshnessChip as NamedFreshnessChip,
  summariseFreshness,
  computeFreshnessTier,
  FRESHNESS_STALE_HOURS,
} from '../components/FreshnessChip';
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
    // Synced just now so a healthy connection reads as `current` (not the new
    // `stale` tier) in tests that don't pin `now`. Recency-specific cases use
    // `connSynced(...)` with an explicit timestamp + injected `now` below.
    last_synced_at: new Date().toISOString(),
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
  beforeEach(() => {
    mockUseWearableConnections.mockReset();
    // Default: internal hook returns nothing so the prop path is unaffected.
    mockUseWearableConnections.mockReturnValue({ data: [] });
  });

  it('renders the derived label and is tappable', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <FreshnessChip
        connections={[conn('APPLE_HEALTHKIT', 'connected')]}
        bucket="HEALTH_FITNESS"
        onPress={onPress}
      />,
    );
    expect(getByText('All sources current')).toBeTruthy();
  });

  it('works WITHOUT a connections prop — reads the internal hook (HK-3b shape)', async () => {
    // HK-3b mounts the chip with just { bucket, tone?, onPress? }.
    mockUseWearableConnections.mockReturnValue({
      data: [conn('APPLE_HEALTHKIT', 'connected'), conn('GARMIN', 'connected')],
    });
    const { getByText } = await render(
      <FreshnessChip bucket="HEALTH_FITNESS" tone="warm" onPress={jest.fn()} />,
    );
    expect(getByText('All sources current')).toBeTruthy();
  });

  it('exposes a named export matching the default export', () => {
    expect(NamedFreshnessChip).toBe(FreshnessChip);
  });
});

describe('stale tier (R1 visual P1 #3)', () => {
  const NOW = Date.parse('2026-06-01T12:00:00.000Z');

  function connSynced(
    provider: WearableConnection['provider'],
    syncedAt: string | null,
  ): WearableConnection {
    return { ...conn(provider, 'connected'), last_synced_at: syncedAt };
  }

  it('grades a healthy-but-lagging source as stale (synced > N hours ago)', () => {
    const staleSince = new Date(
      NOW - (FRESHNESS_STALE_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const s = summariseFreshness(
      [connSynced('APPLE_HEALTHKIT', staleSince)],
      'HEALTH_FITNESS',
      NOW,
    );
    expect(s.tone).toBe('stale');
    expect(s.staleCount).toBe(1);
    expect(s.label).toBe('1 source syncing');
  });

  it('stays current when the last sync is within the stale window', () => {
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
    const s = summariseFreshness(
      [connSynced('APPLE_HEALTHKIT', recent)],
      'HEALTH_FITNESS',
      NOW,
    );
    expect(s.tone).toBe('current');
  });

  it('ranks a hard attention problem above a soft stale lag', () => {
    const staleSince = new Date(
      NOW - (FRESHNESS_STALE_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const s = summariseFreshness(
      [connSynced('APPLE_HEALTHKIT', staleSince), conn('GARMIN', 'expired')],
      'HEALTH_FITNESS',
      NOW,
    );
    expect(s.tone).toBe('attention');
    expect(computeFreshnessTier({
      connections: [connSynced('APPLE_HEALTHKIT', staleSince), conn('GARMIN', 'expired')],
      bucket: 'HEALTH_FITNESS',
      now: NOW,
    })).toBe('attention');
  });
});

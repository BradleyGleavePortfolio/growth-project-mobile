/**
 * B-TEST LO-934 B3 (Opus lens, m#934 @ 98258c2b): GOAL NEEDS-YOU-R2 B/N1 draws "Joined Jun 9" under a Gone quiet
 * client's name (NY-16, approved). The roster row carries createdAt; the list must show the line.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../../ui/states/QuietStates', () => ({ QuietLoading: () => null, QuietError: () => null }));

import NeedsYouList from '../NeedsYouList';
import type { NeedsAreas } from '../../../../utils/coach/needsYou';
import type { RosterClient } from '../../../../utils/coach/clientRoster';

const maya = { id: 'maya', firstName: 'Maya', lastName: 'Ortiz', email: 'maya@example.com', status: 'active', createdAt: '2026-06-09T10:00:00.000Z', activity: { lastActiveOn: '2026-10-28' } } as unknown as RosterClient;
const areas: NeedsAreas = {
  safety: [], alerts: [], quiet: [{ client: maya, reason: { text: 'Last logged 8 days ago', action: 'nudge', ok: false } }], fresh: [], routine: [],
  attention: 1, routineCount: 0, total: 1,
};
const noop = () => undefined;

describe('B-TEST LO-934 B3: Needs you list rows carry the GOAL "Joined {date}" line (NY-16)', () => {
  it('a Gone quiet row shows "Joined Jun 9" under the name', async () => {
    const v = await render(
      <NeedsYouList
        {...({ areas, rosterCount: 1, loading: false, error: null, alertsFailed: false, refreshing: false, onRefresh: noop, onRetry: noop, onBack: noop,
          onOpenSafety: noop, onOpenAlert: noop, onOpenClient: noop, onAction: noop } as unknown as React.ComponentProps<typeof NeedsYouList>)}
      />,
    );
    expect(v.getByText('Maya Ortiz')).toBeTruthy();
    expect(v.queryByText(/Joined Jun 9/)).not.toBeNull();
  });
});

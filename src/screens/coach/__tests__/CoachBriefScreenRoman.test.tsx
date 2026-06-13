/**
 * CoachBriefScreen — §2.3 Roman wiring test.
 *
 * Asserts the live screen mounts RomanBriefCard (FACE+VOICE: the card carries
 * <RomanAvatar />) and selects the right §2.3 voice mode from the brief
 * payload:
 *   - default when there are clients needing attention,
 *   - celebration (record morning) when the roster is clear and not stale,
 *   - error when fetchCoachBrief rejects (Bradley Law #36 — surfaced, logged
 *     via logger.warn, not a swallowed catch and not a raw console call).
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { logger } from '../../../utils/logger';

import type { CoachBriefPayload, CoachBriefClientCard } from '../../../types/wave11';

// Feature flag ON so the screen renders its content (not the preview lock).
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, romanChat: true },
}));

// Deterministic coach name for the §2.3 token.
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'm@x.io', firstName: 'Marcus' }),
}));

const mockFetchCoachBrief = jest.fn();
jest.mock('../../../services/wave11Adapters', () => ({
  fetchCoachBrief: () => mockFetchCoachBrief(),
}));

import CoachBriefScreen from '../CoachBriefScreen';

function payload(over: Partial<CoachBriefPayload> = {}): CoachBriefPayload {
  return {
    morningSummary: { aiDraft: 'draft', approvedByCoach: false },
    clients: [],
    generatedAt: '2026-06-09T08:00:00.000Z',
    isStale: false,
    ...over,
  };
}

function clientCard(id: string): CoachBriefClientCard {
  return {
    clientId: id,
    clientDisplayName: `Client ${id}`,
    aiSummary: 'summary',
    aiFlags: [],
    todos: [],
  } as CoachBriefClientCard;
}

describe('CoachBriefScreen — §2.3 Roman brief card', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders RomanBriefCard with the neutral default line when clients need attention', async () => {
    mockFetchCoachBrief.mockResolvedValue(payload({ clients: [clientCard('a'), clientCard('b')] }));
    const { getByTestId, getByText } = render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('roman-brief-card')).toBeTruthy());
    // FACE+VOICE: the avatar lives inside the brief card.
    expect(getByTestId('roman-brief-avatar').props.accessibilityLabel).toBe('Roman');
    expect(
      getByText('Good morning, Marcus. Your brief is ready. 2 clients need attention today.'),
    ).toBeTruthy();
  });

  it('selects the celebration (record-morning) line + slight smile when the roster is clear', async () => {
    mockFetchCoachBrief.mockResolvedValue(payload({ clients: [], isStale: false }));
    const { getByTestId, getByText } = render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('roman-brief-card')).toBeTruthy());
    expect(getByTestId('roman-brief-avatar').props.accessibilityLabel).toBe('Roman, pleased');
    expect(
      getByText('Good morning, Marcus. Every client is on track this morning. I cannot recall a tidier brief.'),
    ).toBeTruthy();
  });

  it('selects the §2.3 error line when the brief fails to assemble (no swallowed catch)', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockFetchCoachBrief.mockRejectedValue(new Error('source slow'));
    const { getByTestId, getByText } = render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('roman-brief-card')).toBeTruthy());
    expect(
      getByText('Good morning, Marcus. The brief is not yet complete — one of my sources is slow to respond. I will have it shortly.'),
    ).toBeTruthy();
    // Bradley Law #36: the failure was logged via the structured logger, not
    // swallowed and not a raw console call.
    expect(warn).toHaveBeenCalledWith('CoachBriefScreen', 'failed to load brief', expect.any(Error));
    warn.mockRestore();
  });
});

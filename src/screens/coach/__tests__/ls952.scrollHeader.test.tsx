/**
 * LS-952 B1: at 320 pt / 130% the summary wraps into more than a screen.
 * Its growing content must belong to the drafts scroller, not sit above it.
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }),
}));
jest.mock('../../../ui/layout/Screen', () => ({
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('../copilot/PathChangeDrafts', () => ({
  PATH_DRAFTS_KEY: ['coach', 'path-drafts'],
  usePathChangeDrafts: () => ({ data: [], isLoading: false, isError: false }),
  PathChangeDrafts: () => null,
}));
jest.mock('../../../hooks/usePendingAiDrafts', () => ({
  COACH_AI_PENDING_DRAFTS_QUERY_KEY: ['coach', 'ai', 'pending-drafts'],
  usePendingAiDrafts: () => ({
    data: {
      drafts: [
        { id: 'w1', capability: 'draft.assign_workout', status: 'pending', payload: {} },
        { id: 'm1', capability: 'draft.assign_meal_plan', status: 'pending', payload: {} },
        { id: 'n1', capability: 'draft.send_notification', status: 'pending', payload: {} },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';

it('keeps the expanding draft summary and kind tiles inside the draft scroller', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}><PendingAiDraftsScreen /></QueryClientProvider>,
  );
  try {
    const scroller = within(view.getByTestId('pending-ai-drafts-list'));
    expect(scroller.getByText('Roman has 3 drafts ready')).toBeTruthy();
    expect(scroller.getByTestId('pending-ai-drafts-kinds')).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

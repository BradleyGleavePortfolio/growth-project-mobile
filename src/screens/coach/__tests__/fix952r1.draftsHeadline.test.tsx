/**
 * FIX-952R1 (LO-952 C1): the drafts screen headline counts every card the list shows, Roman's plan changes too;
 * the kind tiles stay the Stream 2 drafts' kinds. With no plan changes the number is the Stream 2 count, as before.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../ui/layout/Screen', () => ({ useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn() }),
  useIsFocused: () => true,
}));
let mockPath: unknown[] = [];
jest.mock('../copilot/PathChangeDrafts', () => ({
  PATH_DRAFTS_KEY: ['coach', 'path-drafts'],
  usePathChangeDrafts: () => ({ data: mockPath, isLoading: false, isError: false }),
  PathChangeDrafts: () => null,
}));
jest.mock('../../../hooks/usePendingAiDrafts', () => ({
  COACH_AI_PENDING_DRAFTS_QUERY_KEY: ['coach', 'ai', 'pending-drafts'],
  usePendingAiDrafts: () => ({
    data: { drafts: [
      { id: 'w1', capability: 'draft.assign_workout', status: 'pending', payload: {} },
      { id: 'n1', capability: 'draft.send_notification', status: 'pending', payload: {} },
    ] },
    isLoading: false, isError: false, isFetching: false, refetch: jest.fn(),
  }),
}));

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';

async function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PendingAiDraftsScreen /></QueryClientProvider>);
}

it('counts the plan changes the list shows in the headline, not in the kind tiles', async () => {
  mockPath = [{ id: 'p1', clientId: 'client-1' }, { id: 'p2', clientId: 'client-2' }];
  const view = await draw();
  expect(view.getByText('Roman has 4 drafts ready')).toBeTruthy();
  expect(view.getByLabelText('1 Workout')).toBeTruthy();
  expect(view.getByLabelText('1 Nudge')).toBeTruthy();
  view.unmount();
});

it('keeps the Stream 2 count when no plan change waits', async () => {
  mockPath = [];
  const view = await draw();
  expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
  view.unmount();
});

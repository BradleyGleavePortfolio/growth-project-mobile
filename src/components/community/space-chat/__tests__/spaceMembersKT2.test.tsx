/**
 * SPLIT-938C (agent 200): the KT-2 proof of the space's people (spaceMembers.ts; planning/KNOWN_TRAPS.md KT-2). The
 * server leaves out blocks both ways and answers 404 to anyone who cannot read the space; the phone asks only while
 * the sheet is open and the server let the viewer in, and keeps the names in memory only.
 * memberContentAccess.test.tsx registers spaceMembers with this title.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

import api from '../../../../services/api';
import { spaceMembersKey, useSpaceMembers } from '../spaceMembers';

const get = api.get as jest.Mock;

it('KT-2: the people of a space are asked for only while enabled (the server let me in), and never kept on the disk', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  get.mockResolvedValue({ data: { members: [{ user_id: 'u-ana', display_name: 'Ana', role: 'student' }], next_cursor: null } });
  const closed = await renderHook(() => useSpaceMembers('space-1', false), { wrapper });
  expect(get).not.toHaveBeenCalled();
  await closed.unmount();
  const open = await renderHook(() => useSpaceMembers('space-1', true), { wrapper });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/community/cohorts/space-1/members', expect.anything()));
  expect(qc.getQueryCache().find({ queryKey: spaceMembersKey('space-1') })?.meta).toEqual({ persist: false });
  await open.unmount();
  qc.clear();
});

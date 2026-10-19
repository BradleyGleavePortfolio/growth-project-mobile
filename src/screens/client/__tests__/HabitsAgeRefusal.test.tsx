/**
 * FIXAGE R3: "an age refusal never shows the client raw server text; it opens
 * the age step once, at the shared boundary." The real api interceptor under
 * a real consumer (HabitsScreen, whose failures alert errorMessage(err), the
 * server's sentence). Only the transport is faked.
 */
type Cfg = Record<string, unknown> & { url?: string };
type Handler = (c: Cfg) => Promise<Cfg>;
type Rejected = (e: unknown) => Promise<unknown>;

jest.mock('axios', () => {
  const server = jest.fn();
  const req: Handler[] = [];
  const res: Rejected[] = [];
  const run = async (config: Cfg) => {
    let c: Cfg = { headers: {}, ...config };
    for (const f of req) c = await f(c);
    try {
      return await server(c);
    } catch (e) {
      return res.reduce<Promise<unknown>>((p, r) => p.catch(r), Promise.reject(Object.assign(e as object, { config: c })));
    }
  };
  const verb = (method: string) => (url: string, a?: unknown) => run({ method, url, data: a });
  const instance = {
    request: run,
    get: verb('get'), post: verb('post'), put: verb('put'), patch: verb('patch'), delete: verb('delete'),
    interceptors: {
      request: { use: (f: Handler) => req.push(f) },
      response: { use: (_ok: unknown, r: Rejected) => res.push(r) },
    },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: () => instance }, __server: server };
});
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'token-a1'), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, status: 'active', checking: false, confirmedActive: true }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-age', role: 'student', coach_id: 'coach-1' }),
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').default,
    semanticColors: require('../../../theme/tokens').lightTokens,
    tokens: require('../../../theme/tokens').default,
  }),
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanCompetencePill: false } }));
jest.mock('../../../components/roman/CompetencePill', () => () => null);

import React from 'react';
import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HabitsScreen from '../HabitsScreen';
import { onAgeConfirmationRequired, settleAgeConfirmation } from '../../../lib/ageGate';

const server: jest.Mock = jest.requireMock('axios').__server;
const forbidden = (data: object) =>
  Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data, headers: {} } });
const AGE = { statusCode: 403, code: 'AGE_CONFIRMATION_REQUIRED', message: 'Age confirmation required' };

const logReply = jest.fn();
const heard = jest.fn();
let stop: () => void = () => undefined;
let qc: QueryClient;
beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  logReply.mockReset();
  heard.mockReset();
  stop = onAgeConfirmationRequired(heard);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  server.mockImplementation(async (c: Cfg) => {
    if (c.url === '/habits') return { data: [{ id: 'water', name: 'Drink water', target_value: 1, unit: 'glass' }] };
    if (c.url === '/habits/water/log') return logReply(c);
    return { data: [] };
  });
});
afterEach(() => {
  stop();
  qc.clear();
  jest.restoreAllMocks();
});

const mount = async () => {
  const r = await render(<QueryClientProvider client={qc}><HabitsScreen /></QueryClientProvider>);
  await r.findByText('Drink water');
  return r;
};

it('an age refusal opens the age step once: no server sentence, no alert; confirmed, the tick is sent again', async () => {
  logReply.mockRejectedValueOnce(forbidden(AGE)).mockResolvedValueOnce({ data: {} });
  const r = await mount();
  await fireEvent.press(r.getByText('Drink water'));
  await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(r.queryByText(/Age confirmation required/)).toBeNull();
  await act(async () => settleAgeConfirmation(true));
  await waitFor(() => expect(logReply).toHaveBeenCalledTimes(2));
  expect(heard).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('an unrelated refusal still reaches the screen as before', async () => {
  logReply.mockRejectedValueOnce(forbidden({ statusCode: 403, code: 'COACH_ONLY', message: 'Coaches only.' }));
  const r = await mount();
  await fireEvent.press(r.getByText('Drink water'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't update habit", 'Coaches only.'));
  expect(heard).not.toHaveBeenCalled();
});
